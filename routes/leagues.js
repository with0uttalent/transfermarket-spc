'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { simulateMatch } = require('../services/matchSimulator');
const { applyMatchResults, generateMatchNews } = require('../services/scheduler');

const router = express.Router();

// ─── Round-robin schedule generator ─────────────────────────────────────────
// Returns array of matchdays, each matchday is array of {home, away} team ids.
// Uses standard circle algorithm for double round-robin.
function generateDoubleRoundRobin(teamIds) {
  const n = teamIds.length;
  if (n < 2) return [];

  // For odd number of teams add a dummy "bye" team
  const teams = [...teamIds];
  const hasBye = n % 2 !== 0;
  if (hasBye) teams.push(null); // null = bye

  const total = teams.length;
  const rounds = total - 1;           // single round-robin rounds
  const matchesPerRound = total / 2;

  // Single round-robin via circle method
  const singleRR = [];
  const fixed = teams[0];
  const rotating = teams.slice(1);

  for (let r = 0; r < rounds; r++) {
    const roundMatches = [];
    const rot = [...rotating];
    // Rotate: position 0 is fixed
    const current = [fixed, ...rot];

    for (let i = 0; i < matchesPerRound; i++) {
      const home = current[i];
      const away = current[total - 1 - i];
      if (home !== null && away !== null) {
        roundMatches.push({ home, away });
      }
    }
    singleRR.push(roundMatches);
    // rotate right by 1
    rotating.unshift(rotating.pop());
  }

  // Double round-robin: add return fixtures
  const allRounds = [];
  for (const round of singleRR) {
    allRounds.push(round);
  }
  for (const round of singleRR) {
    allRounds.push(round.map(m => ({ home: m.away, away: m.home })));
  }

  return allRounds;
}

function dateAddDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── GET / — list all leagues ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const leagues = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM league_schedule ls WHERE ls.league_id = l.id) AS total_schedule_rows,
      (SELECT COUNT(*) FROM league_standings ls WHERE ls.league_id = l.id) AS team_count
    FROM leagues l
    ORDER BY l.created_at DESC
  `).all();
  res.json(leagues);
});

// ─── POST / — create league ──────────────────────────────────────────────────
router.post('/', requireAdmin, (req, res) => {
  const { name, season, team_ids, match_start_time, match_interval_minutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(team_ids) || team_ids.length < 2) {
    return res.status(400).json({ error: 'team_ids must be an array of at least 2 team IDs' });
  }

  const db = getDb();
  // Validate teams exist
  for (const tid of team_ids) {
    const t = db.prepare('SELECT id FROM teams WHERE id=?').get(tid);
    if (!t) return res.status(400).json({ error: `Team ${tid} not found` });
  }

  const result = db.prepare(
    `INSERT INTO leagues (name, season, status, match_start_time, match_interval_minutes) VALUES (?,?,?,?,?)`
  ).run(name, season || 1, 'setup', match_start_time || '16:00', match_interval_minutes || 15);
  const leagueId = result.lastInsertRowid;

  // Initialize standings rows
  const insertStanding = db.prepare(
    `INSERT OR IGNORE INTO league_standings (league_id, team_id) VALUES (?,?)`
  );
  for (const tid of team_ids) {
    insertStanding.run(leagueId, tid);
  }

  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(leagueId);
  res.status(201).json(league);
});

// ─── GET /:id — league detail ────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });

  // Standings with team info
  const standings = db.prepare(`
    SELECT ls.*, t.name AS team_name, t.logo_url, t.market_value,
           ls.goals_for - ls.goals_against AS goal_diff
    FROM league_standings ls
    JOIN teams t ON ls.team_id = t.id
    WHERE ls.league_id = ?
    ORDER BY ls.points DESC, goal_diff DESC, ls.goals_for DESC
  `).all(league.id);

  // Compute form (last 5 results per team)
  const standingsWithForm = standings.map(row => {
    // Get last 5 matches for this team in this league
    const matches = db.prepare(`
      SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
      FROM league_schedule ls2
      JOIN matches m ON ls2.match_id = m.id
      WHERE ls2.league_id = ? AND (ls2.home_team_id = ? OR ls2.away_team_id = ?)
        AND m.status = 'finished'
      ORDER BY ls2.matchday DESC
      LIMIT 5
    `).all(league.id, row.team_id, row.team_id);

    const form = matches.reverse().map(m => {
      const isHome = m.home_team_id === row.team_id;
      const scored = isHome ? m.home_score : m.away_score;
      const conceded = isHome ? m.away_score : m.home_score;
      if (scored > conceded) return 'W';
      if (scored === conceded) return 'D';
      return 'L';
    });

    return { ...row, form };
  });

  // Schedule grouped by matchday
  const scheduleRows = db.prepare(`
    SELECT ls.*,
           ht.name AS home_team_name, at.name AS away_team_name,
           m.home_score, m.away_score, m.status AS match_status
    FROM league_schedule ls
    JOIN teams ht ON ls.home_team_id = ht.id
    JOIN teams at ON ls.away_team_id = at.id
    LEFT JOIN matches m ON ls.match_id = m.id
    WHERE ls.league_id = ?
    ORDER BY ls.matchday ASC, ls.id ASC
  `).all(league.id);

  const scheduleByMatchday = {};
  for (const row of scheduleRows) {
    if (!scheduleByMatchday[row.matchday]) scheduleByMatchday[row.matchday] = [];
    scheduleByMatchday[row.matchday].push(row);
  }

  // Top scorers and assists from player_match_stats for matches in this league
  const topScorers = db.prepare(`
    SELECT p.id AS player_id, p.name AS player_name, p.position, p.image_url, t.name AS team_name,
           SUM(pms.goals) AS total_goals, SUM(pms.assists) AS total_assists
    FROM player_match_stats pms
    JOIN players p ON pms.player_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    JOIN matches m ON pms.match_id = m.id
    WHERE m.league_id = ?
    GROUP BY p.id
    ORDER BY total_goals DESC, total_assists DESC
    LIMIT 10
  `).all(league.id);

  const topAssists = db.prepare(`
    SELECT p.id AS player_id, p.name AS player_name, p.position, p.image_url, t.name AS team_name,
           SUM(pms.assists) AS total_assists, SUM(pms.goals) AS total_goals
    FROM player_match_stats pms
    JOIN players p ON pms.player_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    JOIN matches m ON pms.match_id = m.id
    WHERE m.league_id = ?
    GROUP BY p.id
    ORDER BY total_assists DESC, total_goals DESC
    LIMIT 10
  `).all(league.id);

  res.json({
    ...league,
    standings: standingsWithForm,
    schedule: scheduleByMatchday,
    topScorers,
    topAssists,
  });
});

// ─── PUT /:id — update league ─────────────────────────────────────────────────
router.put('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });

  const { name, season, trophy_url, logo_url, match_start_time, match_interval_minutes } = req.body;
  db.prepare(`UPDATE leagues SET name=COALESCE(?,name), season=COALESCE(?,season), trophy_url=?, logo_url=?, match_start_time=COALESCE(?,match_start_time), match_interval_minutes=COALESCE(?,match_interval_minutes) WHERE id=?`)
    .run(name || null, season || null, trophy_url ?? league.trophy_url, logo_url ?? league.logo_url, match_start_time || null, match_interval_minutes || null, league.id);
  res.json(db.prepare('SELECT * FROM leagues WHERE id=?').get(league.id));
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  db.prepare('DELETE FROM leagues WHERE id=?').run(league.id);
  res.json({ message: 'League deleted' });
});

// ─── POST /:id/start — start season ─────────────────────────────────────────
router.post('/:id/start', requireAdmin, (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.status === 'active') return res.status(400).json({ error: 'League already active' });

  // Get all teams in this league from standings
  const teamRows = db.prepare(`
    SELECT t.* FROM league_standings ls
    JOIN teams t ON ls.team_id = t.id
    WHERE ls.league_id = ?
  `).all(league.id);

  if (teamRows.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 teams to start a league' });
  }

  const teamIds = teamRows.map(t => t.id);
  const roundsData = generateDoubleRoundRobin(teamIds);
  const totalMatchdays = roundsData.length;

  // Distribute dates over 30 days from today (first matchday = today, last = today+30)
  const today = new Date().toISOString().slice(0, 10);
  const startTime = league.match_start_time || '16:00';
  const intervalMin = league.match_interval_minutes || 15;

  // Clear existing schedule
  db.prepare('DELETE FROM league_schedule WHERE league_id=?').run(league.id);

  const insertSchedule = db.prepare(`
    INSERT INTO league_schedule (league_id, matchday, home_team_id, away_team_id, scheduled_date)
    VALUES (?,?,?,?,?)
  `);

  for (let i = 0; i < roundsData.length; i++) {
    // evenly spread: matchday 0 = today, matchday N-1 = today+30
    const daysOffset = roundsData.length <= 1 ? 0 : Math.round(i * 30 / (roundsData.length - 1));
    const scheduledDate = dateAddDays(today, daysOffset);
    for (const { home, away } of roundsData[i]) {
      insertSchedule.run(league.id, i + 1, home, away, scheduledDate);
    }
  }

  // Calculate budgets
  const marketValues = teamRows.map(t => t.market_value || 0);
  const med = median(marketValues);

  const insertBudget = db.prepare(`
    INSERT OR REPLACE INTO season_budgets (team_id, league_id, total_budget, spent, income)
    VALUES (?,?,?,0,0)
  `);

  for (const team of teamRows) {
    let base = Math.max(3000000, (team.market_value || 0) * 0.22);
    if (med > 0) {
      const mv = team.market_value || 0;
      if (mv < 0.7 * med) base *= 1.4;
      else if (mv < 0.9 * med) base *= 1.2;
      else if (mv > 1.3 * med) base *= 0.85;
    }
    insertBudget.run(team.id, league.id, Math.round(base));
  }

  // Reset transfer budgets for all participating teams at season start
  for (const tid of teamIds) {
    db.prepare(`UPDATE teams SET transfer_budget = 10000000, transfer_budget_spent = 0 WHERE id = ?`).run(tid);
  }

  // Reset standings
  db.prepare(`
    UPDATE league_standings
    SET played=0, won=0, drawn=0, lost=0, goals_for=0, goals_against=0, points=0
    WHERE league_id=?
  `).run(league.id);

  // Ensure all team standings rows exist
  const insertStanding = db.prepare(`INSERT OR IGNORE INTO league_standings (league_id, team_id) VALUES (?,?)`);
  for (const tid of teamIds) insertStanding.run(league.id, tid);

  db.prepare(`
    UPDATE leagues
    SET status='active', current_matchday=0, total_matchdays=?, start_date=?
    WHERE id=?
  `).run(totalMatchdays, today, league.id);

  res.json({
    message: 'Season started',
    total_matchdays: totalMatchdays,
    teams: teamRows.length,
    schedule_rows: totalMatchdays * Math.floor(teamRows.length / 2),
  });
});

// ─── POST /:id/simulate-matchday ──────────────────────────────────────────────
router.post('/:id/simulate-matchday', requireAdmin, (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.status !== 'active') return res.status(400).json({ error: 'League is not active' });

  // Find next unplayed matchday
  const nextRow = db.prepare(`
    SELECT MIN(matchday) as matchday
    FROM league_schedule
    WHERE league_id=? AND match_id IS NULL
  `).get(league.id);

  if (!nextRow || nextRow.matchday === null) {
    return res.status(400).json({ error: 'All matchdays have been played' });
  }
  const matchday = nextRow.matchday;

  // Get all schedule rows for this matchday
  const scheduleRows = db.prepare(`
    SELECT ls.*,
           ht.name AS home_name, at.name AS away_name
    FROM league_schedule ls
    JOIN teams ht ON ls.home_team_id = ht.id
    JOIN teams at ON ls.away_team_id = at.id
    WHERE ls.league_id=? AND ls.matchday=? AND ls.match_id IS NULL
  `).all(league.id, matchday);

  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  const pad2 = n => String(n).padStart(2, '0');
  const startTime = league.match_start_time || '16:00';
  const [sh, sm] = startTime.split(':').map(Number);
  let matchIndex = 0;

  for (const srow of scheduleRows) {
    // Get players for each team (active, not injured)
    const homePl = db.prepare(`
      SELECT p.* FROM players p
      WHERE p.team_id=? AND p.status='active'
        AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)
    `).all(srow.home_team_id);

    const awayPl = db.prepare(`
      SELECT p.* FROM players p
      WHERE p.team_id=? AND p.status='active'
        AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)
    `).all(srow.away_team_id);

    const totalMin = sh * 60 + sm + matchIndex * (league.match_interval_minutes || 15);
    const matchTimeStr = `${pad2(Math.floor(totalMin/60)%24)}:${pad2(totalMin%60)}`;
    matchIndex++;

    const matchR = db.prepare(`
      INSERT INTO matches (home_team_id, away_team_id, match_date, match_time, status, league_id, matchday)
      VALUES (?,?,?,?,'scheduled',?,?)
    `).run(srow.home_team_id, srow.away_team_id, today, matchTimeStr, league.id, matchday);
    const matchId = matchR.lastInsertRowid;

    // Simulate
    const result = simulateMatch(srow.home_team_id, srow.away_team_id, homePl, awayPl);
    applyMatchResults(matchId, srow.home_team_id, srow.away_team_id, result);

    const evRows = db.prepare('SELECT * FROM match_events WHERE match_id=?').all(matchId);
    generateMatchNews(matchId, srow.home_name, srow.away_name, result.homeScore, result.awayScore, evRows);

    // Update league_schedule with match_id
    db.prepare('UPDATE league_schedule SET match_id=? WHERE id=?').run(matchId, srow.id);

    // Update standings for both teams
    const { homeScore, awayScore } = result;
    const homeWon = homeScore > awayScore;
    const draw = homeScore === awayScore;

    const updateStanding = db.prepare(`
      UPDATE league_standings
      SET played = played + 1,
          won    = won    + ?,
          drawn  = drawn  + ?,
          lost   = lost   + ?,
          goals_for     = goals_for     + ?,
          goals_against = goals_against + ?,
          points = points + ?
      WHERE league_id=? AND team_id=?
    `);

    // Home team
    updateStanding.run(
      homeWon ? 1 : 0,
      draw ? 1 : 0,
      (!homeWon && !draw) ? 1 : 0,
      homeScore, awayScore,
      homeWon ? 3 : draw ? 1 : 0,
      league.id, srow.home_team_id
    );

    // Away team
    updateStanding.run(
      (!homeWon && !draw) ? 1 : 0,
      draw ? 1 : 0,
      homeWon ? 1 : 0,
      awayScore, homeScore,
      (!homeWon && !draw) ? 3 : draw ? 1 : 0,
      league.id, srow.away_team_id
    );

    results.push({
      match_id: matchId,
      home: srow.home_name,
      away: srow.away_name,
      score: `${homeScore}-${awayScore}`,
    });
  }

  // Update current_matchday
  db.prepare('UPDATE leagues SET current_matchday=? WHERE id=?').run(matchday, league.id);

  // Check if all matchdays done
  const remaining = db.prepare(`
    SELECT COUNT(*) as cnt FROM league_schedule WHERE league_id=? AND match_id IS NULL
  `).get(league.id);

  if (remaining.cnt === 0) {
    const windowEnd = dateAddDays(today, 7);
    db.prepare(`UPDATE leagues SET status='transfer_window', transfer_window_end=? WHERE id=?`)
      .run(windowEnd, league.id);
  }

  res.json({ matchday, results, remaining: remaining.cnt });
});

// ─── POST /:id/next-season ────────────────────────────────────────────────────
router.post('/:id/next-season', requireAdmin, (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });

  if (league.status !== 'transfer_window') {
    return res.status(400).json({ error: 'Can only advance to next season after transfer window (status must be transfer_window)' });
  }

  // Award title to champion (highest points)
  const champion = db.prepare(`
    SELECT ls.team_id, t.name AS team_name, ls.points
    FROM league_standings ls
    JOIN teams t ON ls.team_id = t.id
    WHERE ls.league_id = ?
    ORDER BY ls.points DESC, (ls.goals_for - ls.goals_against) DESC, ls.goals_for DESC
    LIMIT 1
  `).get(league.id);

  if (champion) {
    const titleName = `${league.name} Champion Season ${league.season}`;
    db.prepare(`
      INSERT INTO titles (team_id, title_name, season, year)
      VALUES (?,?,?,?)
    `).run(champion.team_id, titleName, `Season ${league.season}`, new Date().getFullYear());

    db.prepare(`INSERT INTO news (title, body, type) VALUES (?,?,?)`).run(
      `${champion.team_name} — чемпион ${league.name}!`,
      `${champion.team_name} завоевали титул ${league.name} в сезоне ${league.season}, набрав ${champion.points} очков. Поздравляем команду и тренерский штаб!`,
      'transfer'
    );
  }

  // Increment season number
  const newSeason = league.season + 1;

  // Get teams in this league
  const teamRows = db.prepare(`
    SELECT t.* FROM league_standings ls
    JOIN teams t ON ls.team_id = t.id
    WHERE ls.league_id = ?
  `).all(league.id);

  const teamIds = teamRows.map(t => t.id);

  // Reset standings
  db.prepare(`
    UPDATE league_standings
    SET played=0, won=0, drawn=0, lost=0, goals_for=0, goals_against=0, points=0
    WHERE league_id=?
  `).run(league.id);

  // Generate new schedule
  const roundsData = generateDoubleRoundRobin(teamIds);
  const totalMatchdays = roundsData.length;
  const today = new Date().toISOString().slice(0, 10);
  const daysPerMatchday = Math.max(1, Math.floor(30 / totalMatchdays));

  db.prepare('DELETE FROM league_schedule WHERE league_id=?').run(league.id);

  const insertSchedule = db.prepare(`
    INSERT INTO league_schedule (league_id, matchday, home_team_id, away_team_id, scheduled_date)
    VALUES (?,?,?,?,?)
  `);

  for (let i = 0; i < roundsData.length; i++) {
    const scheduledDate = dateAddDays(today, i * daysPerMatchday);
    for (const { home, away } of roundsData[i]) {
      insertSchedule.run(league.id, i + 1, home, away, scheduledDate);
    }
  }

  // Recalculate budgets
  const marketValues = teamRows.map(t => t.market_value || 0);
  const med = median(marketValues);
  const insertBudget = db.prepare(`
    INSERT OR REPLACE INTO season_budgets (team_id, league_id, total_budget, spent, income)
    VALUES (?,?,?,0,0)
  `);
  for (const team of teamRows) {
    let base = Math.max(3000000, (team.market_value || 0) * 0.22);
    if (med > 0) {
      const mv = team.market_value || 0;
      if (mv < 0.7 * med) base *= 1.4;
      else if (mv < 0.9 * med) base *= 1.2;
      else if (mv > 1.3 * med) base *= 0.85;
    }
    insertBudget.run(team.id, league.id, Math.round(base));
  }

  // Reset transfer budgets for new season
  for (const tid of teamIds) {
    db.prepare(`UPDATE teams SET transfer_budget = 10000000, transfer_budget_spent = 0 WHERE id = ?`).run(tid);
  }

  db.prepare(`
    UPDATE leagues
    SET season=?, status='active', current_matchday=0, total_matchdays=?, start_date=?,
        transfer_window_end=NULL
    WHERE id=?
  `).run(newSeason, totalMatchdays, today, league.id);

  res.json({
    message: `Season ${newSeason} started`,
    champion: champion ? champion.team_name : null,
    new_season: newSeason,
  });
});

// ─── POST /:id/reschedule — update match_time for all upcoming matches ────────
router.post('/:id/reschedule', requireAdmin, (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });

  const startTime = league.match_start_time || '16:00';
  const intervalMin = league.match_interval_minutes || 15;
  const [sh, sm] = startTime.split(':').map(Number);
  const pad2 = n => String(n).padStart(2, '0');

  const matches = db.prepare(`
    SELECT m.id, m.matchday, m.status, m.match_date
    FROM matches m
    WHERE m.league_id = ? AND m.status IN ('scheduled','in_progress')
    ORDER BY m.matchday ASC, m.id ASC
  `).all(league.id);

  const byMatchday = {};
  for (const m of matches) {
    if (!byMatchday[m.matchday]) byMatchday[m.matchday] = [];
    byMatchday[m.matchday].push(m);
  }

  let updated = 0;
  for (const dayMatches of Object.values(byMatchday)) {
    dayMatches.forEach((m, idx) => {
      const totalMin = sh * 60 + sm + idx * intervalMin;
      const h = Math.floor(totalMin / 60) % 24;
      const min = totalMin % 60;
      const timeStr = `${pad2(h)}:${pad2(min)}`;

      if (m.status === 'in_progress') {
        const kickoff = new Date();
        kickoff.setHours(h, min, 0, 0);
        db.prepare(`UPDATE matches SET match_time=?, started_at=?, tg_kickoff_sent=0 WHERE id=?`)
          .run(timeStr, kickoff.toISOString(), m.id);
      } else {
        db.prepare(`UPDATE matches SET match_time=? WHERE id=?`).run(timeStr, m.id);
      }
      updated++;
    });
  }

  res.json({ ok: true, updated });
});

// ─── GET /:id/budget/:teamId ──────────────────────────────────────────────────
router.get('/:id/budget/:teamId', (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });

  const budget = db.prepare(`
    SELECT sb.*, t.name AS team_name, t.market_value
    FROM season_budgets sb
    JOIN teams t ON sb.team_id = t.id
    WHERE sb.league_id=? AND sb.team_id=?
  `).get(req.params.id, req.params.teamId);

  if (!budget) return res.status(404).json({ error: 'Budget not found for this team/league' });

  const available = budget.total_budget + budget.income - budget.spent;
  res.json({ ...budget, available });
});

module.exports = router;
