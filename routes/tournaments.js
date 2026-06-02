'use strict';
const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { generateBracketRound1, roundName, simulateExtraTime } = require('../services/matchSimulator');
const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.*, COUNT(tt.id) as team_count
    FROM tournaments t
    LEFT JOIN tournament_teams tt ON tt.tournament_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const tour = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(req.params.id);
  if (!tour) return res.status(404).json({ error: 'Not found' });

  const teams = db.prepare(`
    SELECT tt.*, t.name as team_name, t.logo_url, t.market_value,
      c.name as country_name, c.flag_emoji
    FROM tournament_teams tt
    JOIN teams t ON tt.team_id = t.id
    LEFT JOIN countries c ON t.country_id = c.id
    WHERE tt.tournament_id=?
    ORDER BY tt.seed
  `).all(req.params.id);

  const matches = db.prepare(`
    SELECT m.*,
      ht.name as home_team_name, ht.logo_url as home_logo,
      at.name as away_team_name, at.logo_url as away_logo
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    WHERE m.tournament_id=?
    ORDER BY m.tournament_round, m.id
  `).all(req.params.id);

  // BYE teams per round
  const byeRows = db.prepare(`
    SELECT tb.round, tb.team_id, t.name as team_name, t.logo_url
    FROM tournament_byes tb JOIN teams t ON tb.team_id = t.id
    WHERE tb.tournament_id=?
  `).all(req.params.id);
  const byesByRound = {};
  for (const b of byeRows) {
    (byesByRound[b.round] = byesByRound[b.round] || []).push(b);
  }

  // Group matches by round
  const totalRounds = tour.total_rounds || 0;
  const bracket = {};
  for (const m of matches) {
    const rn = roundName(totalRounds, m.tournament_round - 1);
    if (!bracket[m.tournament_round]) bracket[m.tournament_round] = { name: rn, matches: [], byes: [] };
    bracket[m.tournament_round].matches.push(m);
  }
  // Attach byes to each round (even rounds with no matches yet)
  for (const [round, byes] of Object.entries(byesByRound)) {
    if (!bracket[round]) bracket[round] = { name: roundName(totalRounds, round - 1), matches: [], byes: [] };
    bracket[round].byes = byes;
  }

  res.json({ ...tour, teams, bracket });
});

router.post('/', requireAuth, (req, res) => {
  const { name, round_match_time, round_interval_days } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO tournaments (name, round_match_time, round_interval_days) VALUES (?,?,?)`
  ).run(name, round_match_time || '18:00', round_interval_days || 1);
  res.status(201).json({ id: r.lastInsertRowid, name });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, trophy_url, round_match_time, round_interval_days } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const tour = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!tour) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE tournaments SET name=?, trophy_url=?, round_match_time=?, round_interval_days=? WHERE id=?`)
    .run(name, trophy_url ?? tour.trophy_url, round_match_time || tour.round_match_time || '18:00',
         round_interval_days || tour.round_interval_days || 1, req.params.id);
  res.json(db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id));
});

// Add team to tournament
router.post('/:id/teams', requireAuth, (req, res) => {
  const { team_id } = req.body;
  if (!team_id) return res.status(400).json({ error: 'team_id required' });
  const db = getDb();
  const tour = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(req.params.id);
  if (!tour) return res.status(404).json({ error: 'Tournament not found' });
  if (tour.status !== 'setup') return res.status(400).json({ error: 'Tournament already started' });
  const existing = db.prepare(`SELECT id FROM tournament_teams WHERE tournament_id=? AND team_id=?`).get(req.params.id, team_id);
  if (existing) return res.status(400).json({ error: 'Team already in tournament' });
  db.prepare(`INSERT INTO tournament_teams (tournament_id, team_id) VALUES (?,?)`).run(req.params.id, team_id);
  res.status(201).json({ message: 'Team added' });
});

router.delete('/:id/teams/:teamId', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM tournament_teams WHERE tournament_id=? AND team_id=?`).run(req.params.id, req.params.teamId);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Removed' });
});

// Start tournament: seed teams, generate round 1 bracket, save BYE teams to byes table
router.post('/:id/start', requireAuth, (req, res) => {
  const db = getDb();
  const tour = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(req.params.id);
  if (!tour) return res.status(404).json({ error: 'Not found' });
  if (tour.status !== 'setup') return res.status(400).json({ error: 'Already started' });

  const teams = db.prepare(`
    SELECT tt.team_id, t.market_value
    FROM tournament_teams tt
    JOIN teams t ON tt.team_id = t.id
    WHERE tt.tournament_id=?
    ORDER BY t.market_value DESC
  `).all(req.params.id);

  if (teams.length < 2) return res.status(400).json({ error: 'Need at least 2 teams' });

  const teamIds = teams.map(t => t.team_id);
  const pairings = generateBracketRound1(teamIds);

  let size = 1;
  while (size < teamIds.length) size *= 2;
  const totalRounds = Math.log2(size);

  // Seed teams by market value rank
  const setSeed = db.prepare(`UPDATE tournament_teams SET seed=? WHERE tournament_id=? AND team_id=?`);
  teamIds.forEach((tid, i) => setSeed.run(i + 1, req.params.id, tid));

  // Schedule round 1 matches for today at the configured time
  const matchTime = tour.round_match_time || '18:00';
  const today = new Date().toISOString().slice(0, 10);

  const insertMatch = db.prepare(
    `INSERT INTO matches (home_team_id, away_team_id, match_date, match_time, status, tournament_id, tournament_round)
     VALUES (?,?,?,?,'scheduled',?,1)`
  );
  const insertBye = db.prepare(
    `INSERT INTO tournament_byes (tournament_id, team_id, round) VALUES (?,?,?)`
  );

  const byeWinners = [];
  for (const p of pairings) {
    if (p.awayTeamId === null) {
      byeWinners.push(p.homeTeamId);
      insertBye.run(req.params.id, p.homeTeamId, 1);
    } else if (p.homeTeamId === null) {
      byeWinners.push(p.awayTeamId);
      insertBye.run(req.params.id, p.awayTeamId, 1);
    } else {
      insertMatch.run(p.homeTeamId, p.awayTeamId, today, matchTime, req.params.id);
    }
  }

  db.prepare(`UPDATE tournaments SET status='in_progress', current_round=1, total_rounds=?, bye_winners=? WHERE id=?`)
    .run(totalRounds, byeWinners.length ? JSON.stringify(byeWinners) : null, req.params.id);

  db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
    .run(`Турнир начался: ${tour.name}`,
         `${teamIds.length} команд участвуют. Матчи 1-го раунда запланированы на ${today} в ${matchTime}.`,
         'tournament', req.params.id);

  res.json({ message: 'Tournament started', total_rounds: totalRounds, pairings: pairings.length, byes: byeWinners.length });
});

// Simulate entire current round at once (manual trigger)
router.post('/:id/simulate-round', requireAuth, async (req, res) => {
  const db = getDb();
  const tour = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(req.params.id);
  if (!tour || tour.status !== 'in_progress') return res.status(400).json({ error: 'Tournament not in progress' });
  const result = await simulateRound(db, tour);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Shared round simulation logic (used by both manual trigger and scheduler)
async function simulateRound(db, tour) {
  const { simulateMatch } = require('../services/matchSimulator');
  const { applyMatchResults, generateMatchNews } = require('../services/scheduler');

  const roundMatches = db.prepare(
    `SELECT m.*, ht.name as home_name, at.name as away_name
     FROM matches m
     JOIN teams ht ON m.home_team_id=ht.id
     JOIN teams at ON m.away_team_id=at.id
     WHERE m.tournament_id=? AND m.tournament_round=? AND m.status='scheduled'`
  ).all(tour.id, tour.current_round);

  if (!roundMatches.length) {
    // No scheduled matches left. If every match of this round is already
    // finished (e.g. they were force-simulated individually), the bracket
    // just needs to be advanced. Otherwise there is genuinely nothing to do.
    const unfinished = db.prepare(
      `SELECT COUNT(*) as c FROM matches WHERE tournament_id=? AND tournament_round=? AND status NOT IN ('finished')`
    ).get(tour.id, tour.current_round);
    const total = db.prepare(
      `SELECT COUNT(*) as c FROM matches WHERE tournament_id=? AND tournament_round=?`
    ).get(tour.id, tour.current_round);

    if (total.c > 0 && unfinished.c === 0) {
      advanceRound(db, tour);
      return { simulated: 0, results: [], advanced: true, message: 'Раунд завершён — сетка построена дальше' };
    }
    return { error: 'No scheduled matches in current round' };
  }

  const results = [];
  const now = new Date();
  const startedAt = now.toISOString();
  const insertEvent = db.prepare(
    `INSERT INTO match_events (match_id, minute, event_type, team_id, player_id, player2_id, description) VALUES (?,?,?,?,?,?,?)`
  );

  // Exclude lazaret (resting) players from tournament squads
  const squadSql = `SELECT * FROM players WHERE team_id=? AND status='active'
    AND id NOT IN (SELECT player_id FROM player_infirmary WHERE team_id=?)`;
  for (const match of roundMatches) {
    const homePl = db.prepare(squadSql).all(match.home_team_id, match.home_team_id);
    const awayPl = db.prepare(squadSql).all(match.away_team_id, match.away_team_id);
    const result = simulateMatch(match.home_team_id, match.away_team_id, homePl, awayPl);
    applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);

    if (result.homeScore === result.awayScore) {
      // Pre-compute extra time + penalties so they appear live at min 91-135
      const ot = simulateExtraTime(match.home_team_id, match.away_team_id, homePl, awayPl);
      for (const e of ot.events) insertEvent.run(match.id, e.minute, e.event_type, e.team_id, e.player_id, e.player2_id, e.description);
      const finalHome = result.homeScore + ot.otHome;
      const finalAway = result.awayScore + ot.otAway;
      db.prepare(`UPDATE matches SET home_score=?, away_score=?, ot_home=?, ot_away=?, pen_home=?, pen_away=?, ot_type=?, status='in_progress', started_at=? WHERE id=?`)
        .run(finalHome, finalAway, ot.otHome, ot.otAway, ot.penHome, ot.penAway, ot.ot_type, startedAt, match.id);
      results.push({ match_id: match.id, home_score: finalHome, away_score: finalAway, ot_type: ot.ot_type, live: true });
      continue;
    }

    // Non-draw: set in_progress so events appear live; finalization happens after 90s
    db.prepare(`UPDATE matches SET status='in_progress', started_at=? WHERE id=?`).run(startedAt, match.id);
    const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(match.id);
    generateMatchNews(match.id, match.home_name, match.away_name, result.homeScore, result.awayScore, evRows);
    const winnerId = result.homeScore > result.awayScore ? match.home_team_id : match.away_team_id;
    results.push({ match_id: match.id, home_score: result.homeScore, away_score: result.awayScore, winner_id: winnerId, live: true });
  }

  return { simulated: results.length, results, message: 'Матчи идут — результаты раскрываются в прямом эфире' };
}

// Advance to next round after all current-round matches finish
function advanceRound(db, tour) {
  const roundMatches = db.prepare(`SELECT * FROM matches WHERE tournament_id=? AND tournament_round=?`)
    .all(tour.id, tour.current_round);
  const winners = roundMatches.map(m => {
    if (m.ot_type === 'penalties') return m.pen_home > m.pen_away ? m.home_team_id : m.away_team_id;
    return m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
  });
  const savedByes = tour.bye_winners ? JSON.parse(tour.bye_winners) : [];
  const allWinners = [...winners, ...savedByes];
  db.prepare(`UPDATE tournaments SET bye_winners=NULL WHERE id=?`).run(tour.id);

  if (allWinners.length === 1) {
    // Tournament over
    db.prepare(`UPDATE tournaments SET status='finished' WHERE id=?`).run(tour.id);
    const champ = db.prepare(`SELECT name FROM teams WHERE id=?`).get(allWinners[0]);
    db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
      .run(`🏆 ${champ.name} выигрывает ${tour.name}!`, `${champ.name} стал чемпионом турнира «${tour.name}»!`, 'tournament', tour.id);

    // Only players who actually participated in tournament matches get the trophy + OVR buff
    const participantIds = new Set(
      db.prepare(`
        SELECT DISTINCT pms.player_id
        FROM player_match_stats pms
        JOIN matches m ON pms.match_id = m.id
        WHERE m.tournament_id = ? AND m.status = 'finished'
      `).all(tour.id).map(r => r.player_id)
    );

    const tourYear = new Date().getFullYear();
    // One team-level title for the champion team
    db.prepare(`INSERT INTO titles (team_id, player_id, title_name, season, year, tournament_id, trophy_url) VALUES (?,NULL,?,?,?,?,?)`)
      .run(allWinners[0], tour.name, `Турнир ${tourYear}`, tourYear, tour.id, tour.trophy_url || null);

    const champPl = db.prepare(`SELECT id FROM players WHERE team_id=?`).all(allWinners[0]);
    const insertAch = db.prepare(`INSERT INTO player_achievements (player_id,achievement_type,description,tournament_id) VALUES (?,?,?,?)`);
    for (const cp of champPl) {
      if (!participantIds.has(cp.id)) continue; // only participants get achievement + buff
      insertAch.run(cp.id, 'tournament_winner', `Выиграл ${tour.name}`, tour.id);
      // OVR buff ~3.5% for tournament winners who participated
      db.prepare(`
        UPDATE player_skills SET
          pace      = MIN(99, CAST(ROUND(pace      * 1.035) AS INTEGER)),
          shooting  = MIN(99, CAST(ROUND(shooting  * 1.035) AS INTEGER)),
          passing   = MIN(99, CAST(ROUND(passing   * 1.035) AS INTEGER)),
          defending = MIN(99, CAST(ROUND(defending * 1.035) AS INTEGER)),
          physical  = MIN(99, CAST(ROUND(physical  * 1.035) AS INTEGER))
        WHERE player_id = ?
      `).run(cp.id);
      const pl = db.prepare(`SELECT market_value FROM players WHERE id=?`).get(cp.id);
      if (pl?.market_value > 0) {
        const nv = pl.market_value * 1.05;
        db.prepare(`UPDATE players SET market_value=? WHERE id=?`).run(nv, cp.id);
        db.prepare(`INSERT INTO market_value_history (player_id,market_value) VALUES (?,?)`).run(cp.id, nv);
      }
    }
    return;
  }

  // Create next round matches, schedule them
  const nextRound = tour.current_round + 1;
  const intervalDays = tour.round_interval_days || 1;
  const matchTime = tour.round_match_time || '18:00';
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + intervalDays);
  const nextDateStr = nextDate.toISOString().slice(0, 10);

  const insertBye = db.prepare(`INSERT INTO tournament_byes (tournament_id, team_id, round) VALUES (?,?,?)`);
  const nextByeWinners = [];

  for (let i = 0; i < allWinners.length; i += 2) {
    if (allWinners[i + 1] !== undefined) {
      db.prepare(`INSERT INTO matches (home_team_id, away_team_id, match_date, match_time, status, tournament_id, tournament_round)
                  VALUES (?,?,?,?,'scheduled',?,?)`)
        .run(allWinners[i], allWinners[i + 1], nextDateStr, matchTime, tour.id, nextRound);
    } else {
      // Odd number of winners — last one gets a bye to next round
      nextByeWinners.push(allWinners[i]);
      insertBye.run(tour.id, allWinners[i], nextRound);
    }
  }

  db.prepare(`UPDATE tournaments SET current_round=?, bye_winners=? WHERE id=?`)
    .run(nextRound, nextByeWinners.length ? JSON.stringify(nextByeWinners) : null, tour.id);
}

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM tournaments WHERE id=?`).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
// Export shared helpers AFTER module.exports = router so they aren't overwritten
module.exports.simulateRound = simulateRound;
module.exports.advanceRound  = advanceRound;
