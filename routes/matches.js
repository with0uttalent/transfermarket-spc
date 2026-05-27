const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { simulateMatch, simulateMatchWithLineup } = require('../services/matchSimulator');
const { applyMatchResults, generateMatchNews } = require('../services/scheduler');
const router = express.Router();

const BASE = `
  SELECT m.*,
    ht.name as home_team_name, ht.logo_url as home_logo, ht.stadium_url as home_stadium_url,
    ht.color_primary as home_color_primary, ht.color_secondary as home_color_secondary, ht.color_pattern as home_color_pattern,
    ht.goal_banner_url as home_goal_banner_url,
    ht.kit_home_url as home_kit_home_url, ht.kit_away_url as home_kit_away_url, ht.kit_third_url as home_kit_third_url,
    at.name as away_team_name, at.logo_url as away_logo,
    at.color_primary as away_color_primary, at.color_secondary as away_color_secondary, at.color_pattern as away_color_pattern,
    at.goal_banner_url as away_goal_banner_url,
    at.kit_home_url as away_kit_home_url, at.kit_away_url as away_kit_away_url, at.kit_third_url as away_kit_third_url,
    t.name as tournament_name,
    lg.name as league_name, lg.logo_url as league_logo_url
  FROM matches m
  JOIN teams ht ON m.home_team_id = ht.id
  JOIN teams at ON m.away_team_id = at.id
  LEFT JOIN tournaments t ON m.tournament_id = t.id
  LEFT JOIN leagues lg ON m.league_id = lg.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { status, team_id, date, limit } = req.query;
  let q = BASE; const p = []; const conds = [];
  if (status)  { conds.push(`m.status=?`); p.push(status); }
  if (team_id) { conds.push(`(m.home_team_id=? OR m.away_team_id=?)`); p.push(team_id, team_id); }
  if (date)    { conds.push(`m.match_date=?`); p.push(date); }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ');
  q += ' ORDER BY m.match_date DESC, m.id DESC';
  if (limit) q += ' LIMIT ' + parseInt(limit);
  const now = Date.now();
  const rows = db.prepare(q).all(...p).map(m => {
    if (m.status === 'in_progress') {
      // If started_at is in the future, display as scheduled with no score
      if (m.started_at && new Date(m.started_at).getTime() > now) {
        return { ...m, status: 'scheduled', home_score: null, away_score: null };
      }
      return { ...m, home_score: null, away_score: null };
    }
    return m;
  });
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  let match = db.prepare(BASE + ' WHERE m.id=?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Not found' });

  let allEvents = db.prepare(`
    SELECT e.*,
      p.name as player_name, p.image_url as player_image_url,
      p2.name as player2_name,
      t.name as team_name
    FROM match_events e
    LEFT JOIN players p  ON e.player_id  = p.id
    LEFT JOIN players p2 ON e.player2_id = p2.id
    LEFT JOIN teams   t  ON e.team_id    = t.id
    WHERE e.match_id=?
    ORDER BY e.minute
  `).all(req.params.id);

  const _getChallengeMessage = () => {
    if (!match.is_friendly) return null;
    const ch = db.prepare(`SELECT message, from_team_id FROM match_challenges WHERE match_id=? AND status='accepted'`).get(match.id);
    if (!ch?.message) return null;
    const fromTeam = db.prepare(`SELECT name FROM teams WHERE id=?`).get(ch.from_team_id);
    return { text: ch.message, from_team_name: fromTeam?.name || null };
  };

  if (match.status === 'in_progress' && match.started_at) {
    const elapsed = (Date.now() - new Date(match.started_at).getTime()) / 1000;
    const liveMin = Math.min(90, Math.floor(elapsed));

    // Kick-off hasn't happened yet — show as scheduled (no score, no events)
    if (elapsed < 0) {
      const playerStats2 = db.prepare(`
        SELECT p.id as player_id, p.name as player_name, p.position, p.image_url, p.team_id,
          COALESCE(s.goals,0) as goals, COALESCE(s.assists,0) as assists,
          COALESCE(s.yellow_cards,0) as yellow_cards, COALESCE(s.red_cards,0) as red_cards,
          COALESCE(s.rating,6.0) as rating
        FROM team_lineups tl JOIN players p ON tl.player_id=p.id
        LEFT JOIN player_match_stats s ON s.player_id=p.id AND s.match_id=?
        WHERE tl.team_id IN (SELECT home_team_id FROM matches WHERE id=? UNION SELECT away_team_id FROM matches WHERE id=?) AND tl.slot<=11
        ORDER BY COALESCE(s.rating,6.0) DESC
      `).all(req.params.id, req.params.id, req.params.id);
      return res.json({
        ...match, status: 'scheduled', live_minute: 0,
        home_score: null, away_score: null, events: [],
        stats: playerStats2, fullStats: null,
        challengeMessage: _getChallengeMessage(),
      });
    }

    if (liveMin >= 90) {
      // Atomically finalize — only the first request to do this triggers side-effects
      const nextStatus = (match.tournament_id && match.home_score === match.away_score) ? 'overtime' : 'finished';
      const r = db.prepare(`UPDATE matches SET status=? WHERE id=? AND status='in_progress'`).run(nextStatus, match.id);
      if (r.changes > 0) {
        if (nextStatus === 'finished') {
          const ht = db.prepare(`SELECT name FROM teams WHERE id=?`).get(match.home_team_id);
          const at = db.prepare(`SELECT name FROM teams WHERE id=?`).get(match.away_team_id);
          generateMatchNews(match.id, ht.name, at.name, match.home_score, match.away_score, allEvents);
          if (match.tournament_id) advanceTournamentWinner(match, match.home_score, match.away_score);
        }
      }
      match = { ...match, status: nextStatus };
    } else {
      // Return only events up to the live minute
      const liveEvents = allEvents.filter(e => e.minute <= liveMin);
      let liveHome = 0, liveAway = 0;
      for (const e of liveEvents) {
        if (e.event_type === 'goal') {
          if (e.team_id === match.home_team_id) liveHome++; else liveAway++;
        } else if (e.event_type === 'own_goal') {
          if (e.team_id === match.home_team_id) liveAway++; else liveHome++;
        }
      }
      const playerStats = db.prepare(`
        SELECT
          p.id as player_id, p.name as player_name, p.position, p.image_url, p.team_id,
          COALESCE(s.goals, 0) as goals, COALESCE(s.assists, 0) as assists,
          COALESCE(s.yellow_cards, 0) as yellow_cards, COALESCE(s.red_cards, 0) as red_cards,
          COALESCE(s.rating, 6.0) as rating
        FROM team_lineups tl JOIN players p ON tl.player_id = p.id
        LEFT JOIN player_match_stats s ON s.player_id = p.id AND s.match_id = ?
        WHERE tl.team_id IN (
          SELECT home_team_id FROM matches WHERE id=?
          UNION SELECT away_team_id FROM matches WHERE id=?
        ) AND tl.slot <= 11
        ORDER BY COALESCE(s.rating, 6.0) DESC
      `).all(req.params.id, req.params.id, req.params.id);
      const fullStats = db.prepare(`SELECT * FROM match_stats WHERE match_id=?`).get(req.params.id) || null;
      return res.json({
        ...match,
        status: 'in_progress',
        live_minute: liveMin,
        home_score: liveHome,
        away_score: liveAway,
        events: liveEvents,
        stats: playerStats,
        fullStats,
        challengeMessage: _getChallengeMessage(),
      });
    }
  }

  const playerStats = db.prepare(`
    SELECT
      p.id as player_id, p.name as player_name, p.position, p.image_url, p.team_id,
      COALESCE(s.goals, 0)        as goals,
      COALESCE(s.assists, 0)      as assists,
      COALESCE(s.yellow_cards, 0) as yellow_cards,
      COALESCE(s.red_cards, 0)    as red_cards,
      COALESCE(s.rating, 6.0)     as rating
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    LEFT JOIN player_match_stats s ON s.player_id = p.id AND s.match_id = ?
    WHERE tl.team_id IN (
      SELECT home_team_id FROM matches WHERE id=?
      UNION SELECT away_team_id FROM matches WHERE id=?
    ) AND tl.slot <= 11
    ORDER BY COALESCE(s.rating, 6.0) DESC
  `).all(req.params.id, req.params.id, req.params.id);
  const fullStats = db.prepare(`SELECT * FROM match_stats WHERE match_id=?`).get(req.params.id) || null;
  let challengeMessage = null;
  if (match.is_friendly) {
    const ch = db.prepare(`SELECT message, from_team_id FROM match_challenges WHERE match_id=? AND status='accepted'`).get(match.id);
    if (ch?.message) {
      const fromTeam = db.prepare(`SELECT name FROM teams WHERE id=?`).get(ch.from_team_id);
      challengeMessage = { text: ch.message, from_team_name: fromTeam?.name || null };
    }
  }
  res.json({ ...match, events: allEvents, stats: playerStats, fullStats, challengeMessage });
});

router.post('/', requireAuth, (req, res) => {
  const { home_team_id, away_team_id, match_date, tournament_id, tournament_round, is_friendly } = req.body;
  if (!home_team_id || !away_team_id) return res.status(400).json({ error: 'Both teams required' });
  if (home_team_id === away_team_id) return res.status(400).json({ error: 'Teams must be different' });
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO matches (home_team_id,away_team_id,match_date,tournament_id,tournament_round,is_friendly)
     VALUES (?,?,?,?,?,?)`
  ).run(home_team_id, away_team_id, match_date||null, tournament_id||null, tournament_round||0, is_friendly ? 1 : 0);
  res.status(201).json({ id: r.lastInsertRowid });
});

function getLineupInfo(db, teamId) {
  const rows = db.prepare(`
    SELECT p.*, tl.position_override as zone
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ? AND tl.slot <= 11 AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id = p.id AND i.matches_remaining > 0)
    ORDER BY tl.slot ASC
    LIMIT 11
  `).all(teamId);
  if (rows.length > 0) {
    const zoneMap = {};
    for (const r of rows) if (r.zone) zoneMap[r.id] = r.zone;
    return { players: rows, zoneMap };
  }
  const players = db.prepare(`
    SELECT p.* FROM players p
    WHERE p.team_id = ? AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id = p.id AND i.matches_remaining > 0)
  `).all(teamId);
  return { players, zoneMap: {} };
}

router.post('/:id/simulate', requireAuth, (req, res) => {
  const db = getDb();
  const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Not found' });
  if (match.status === 'finished') return res.status(400).json({ error: 'Match already finished' });
  if (match.status === 'in_progress') return res.status(400).json({ error: 'Match is already in progress' });

  const home = getLineupInfo(db, match.home_team_id);
  const away = getLineupInfo(db, match.away_team_id);

  // Build skills map and stamina map for all players
  const allPlayerIds = [...home.players, ...away.players].map(p => p.id);
  let skillsMap = {};
  let staminaMap = {};
  if (allPlayerIds.length) {
    const placeholders = allPlayerIds.map(() => '?').join(',');
    const skillRows = db.prepare(`SELECT * FROM player_skills WHERE player_id IN (${placeholders})`).all(...allPlayerIds);
    for (const sk of skillRows) skillsMap[sk.player_id] = sk;
    const staminaRows = db.prepare(`SELECT id, COALESCE(stamina, 100) as stamina FROM players WHERE id IN (${placeholders})`).all(...allPlayerIds);
    for (const sr of staminaRows) staminaMap[sr.id] = sr.stamina;
  }

  // Get bench players (slots 12-22) for substitutions
  const homeReserves = db.prepare(`
    SELECT p.*, tl.position_override, tl.slot, tl.priority_sub
    FROM team_lineups tl JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ? AND tl.slot >= 12 AND tl.slot <= 22 AND p.status = 'active'
    ORDER BY tl.priority_sub DESC, tl.slot ASC
  `).all(match.home_team_id);

  const awayReserves = db.prepare(`
    SELECT p.*, tl.position_override, tl.slot, tl.priority_sub
    FROM team_lineups tl JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ? AND tl.slot >= 12 AND tl.slot <= 22 AND p.status = 'active'
    ORDER BY tl.priority_sub DESC, tl.slot ASC
  `).all(match.away_team_id);

  // Use skill-based simulation if we have enough starters
  let result;
  if (home.players.length >= 7 && away.players.length >= 7) {
    result = simulateMatchWithLineup(
      match.home_team_id, match.away_team_id,
      home.players, homeReserves,
      away.players, awayReserves,
      skillsMap,
      match.is_friendly ? {} : staminaMap
    );
  } else {
    result = simulateMatch(match.home_team_id, match.away_team_id, home.players, away.players, home.zoneMap, away.zoneMap, match.is_friendly ? {} : staminaMap);
  }

  const startedAt = new Date().toISOString();

  if (match.is_friendly) {
    // Friendly: skip MV/stats/skills/injuries — insert events directly
    const insertEvent = db.prepare(
      `INSERT INTO match_events (match_id, minute, event_type, team_id, player_id, player2_id, description) VALUES (?,?,?,?,?,?,?)`
    );
    for (const e of result.events) insertEvent.run(match.id, e.minute, e.event_type, e.team_id, e.player_id, e.player2_id, e.description);
    db.prepare(`UPDATE matches SET home_score=?, away_score=?, status='in_progress', started_at=? WHERE id=?`)
      .run(result.homeScore, result.awayScore, startedAt, match.id);
    return res.json({ ok: true, started_at: startedAt });
  }

  // Non-friendly: applyMatchResults inserts events + applies all stats
  applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);

  // Tournament draw → overtime — keep existing flow but delay reveal via in_progress
  if (match.tournament_id && result.homeScore === result.awayScore) {
    db.prepare(`UPDATE matches SET home_score=?, away_score=?, status='in_progress', started_at=? WHERE id=?`)
      .run(result.homeScore, result.awayScore, startedAt, match.id);
    // Mark overtime after 90s via the GET finalization path — skip for now, set overtime flag later
    // For simplicity: overtime is set when finalized by GET handler
    return res.json({ ok: true, started_at: startedAt, overtime_pending: true });
  }

  db.prepare(`UPDATE matches SET home_score=?, away_score=?, status='in_progress', started_at=? WHERE id=?`)
    .run(result.homeScore, result.awayScore, startedAt, match.id);

  res.json({ ok: true, started_at: startedAt });
});

function advanceTournamentWinner(match, homeScore, awayScore) {
  const db = getDb();
  const tournament = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(match.tournament_id);
  if (!tournament) return;

  let winnerId = homeScore >= awayScore ? match.home_team_id : match.away_team_id;
  // Check if all matches in this round are finished
  const roundMatches = db.prepare(
    `SELECT * FROM matches WHERE tournament_id=? AND tournament_round=?`
  ).all(match.tournament_id, match.tournament_round);
  const allDone = roundMatches.every(m => m.status === 'finished' || m.id === match.id);

  if (allDone) {
    // Get winners of this round and create next round matches
    const winners = roundMatches.map(m => {
      if (m.id === match.id) return winnerId;
      if (m.ot_type === 'penalties') return m.pen_home > m.pen_away ? m.home_team_id : m.away_team_id;
      return m.home_score >= m.away_score ? m.home_team_id : m.away_team_id;
    });
    const nextRound = match.tournament_round + 1;
    if (winners.length === 1) {
      // Tournament champion!
      const p = db.prepare(`SELECT name FROM teams WHERE id=?`).get(winners[0]);
      db.prepare(`UPDATE tournaments SET status='finished' WHERE id=?`).run(match.tournament_id);
      // Insert title for the winning team
      db.prepare(`INSERT INTO titles (team_id, title_name, season, year, tournament_id, trophy_url) VALUES (?,?,?,?,?,?)`)
        .run(winners[0], tournament.name, `Турнир ${new Date().getFullYear()}`, new Date().getFullYear(), match.tournament_id, tournament.trophy_url || null);
      db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
        .run(`🏆 ${p.name} — чемпион турнира!`, `${p.name} выиграл турнир «${tournament.name}»!`, 'tournament', match.tournament_id);
      // Achievements for winning team players
      const champs = db.prepare(`SELECT id FROM players WHERE team_id=?`).all(winners[0]);
      const insertAch = db.prepare(`INSERT INTO player_achievements (player_id,achievement_type,description,tournament_id) VALUES (?,?,?,?)`);
      for (const cp of champs) {
        insertAch.run(cp.id, 'tournament_winner', `Выиграл ${tournament.name}`, match.tournament_id);
        const pl = db.prepare(`SELECT market_value FROM players WHERE id=?`).get(cp.id);
        if (pl && pl.market_value > 0) {
          const nv = pl.market_value * 1.05;
          db.prepare(`UPDATE players SET market_value=? WHERE id=?`).run(nv, cp.id);
          db.prepare(`INSERT INTO market_value_history (player_id,market_value) VALUES (?,?)`).run(cp.id, nv);
        }
      }
      return;
    }
    // Create next round matches
    for (let i = 0; i < winners.length; i += 2) {
      if (winners[i + 1]) {
        db.prepare(`INSERT INTO matches (home_team_id,away_team_id,match_date,tournament_id,tournament_round) VALUES (?,?,date('now'),?,?)`)
          .run(winners[i], winners[i + 1], match.tournament_id, nextRound);
      }
    }
    db.prepare(`UPDATE tournaments SET current_round=? WHERE id=?`).run(nextRound, match.tournament_id);
    const roundMatchCount = db.prepare(`SELECT COUNT(*) as c FROM matches WHERE tournament_id=? AND tournament_round=?`)
      .get(match.tournament_id, nextRound);
    db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
      .run(`Round ${nextRound} begins`, `${roundMatchCount.c} matches scheduled for round ${nextRound} of "${tournament.name}".`, 'tournament', match.tournament_id);
  }
}

// ─── Overtime resolution for tournament draws ─────────────────────────────────
router.post('/:id/overtime', requireAuth, (req, res) => {
  const db = getDb();
  const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Not found' });
  if (match.status !== 'overtime') return res.status(400).json({ error: 'Match not in overtime' });

  const { type } = req.body; // 'golden_goal' or 'classic'
  const homePl = db.prepare(`SELECT market_value FROM players WHERE team_id=? AND status='active'`).all(match.home_team_id);
  const awayPl = db.prepare(`SELECT market_value FROM players WHERE team_id=? AND status='active'`).all(match.away_team_id);

  const str = pl => pl.reduce((s, p) => s + Math.log10(Math.max(p.market_value || 500000, 100000)), 0);
  const homeStr = str(homePl), awayStr = str(awayPl);
  const homeWinProb = (homeStr + awayStr) > 0 ? homeStr / (homeStr + awayStr) : 0.5;

  const goalProb = type === 'golden_goal' ? 0.45 : 0.70;

  if (Math.random() < goalProb) {
    const homeScores = Math.random() < homeWinProb;
    const otHome = homeScores ? 1 : 0, otAway = homeScores ? 0 : 1;
    const newHome = match.home_score + otHome, newAway = match.away_score + otAway;
    db.prepare(`UPDATE matches SET home_score=?, away_score=?, ot_type=?, ot_home=?, ot_away=?, status='finished' WHERE id=?`)
      .run(newHome, newAway, type, otHome, otAway, match.id);
    advanceTournamentWinner(match, newHome, newAway);
    return res.json({ winner: homeScores ? match.home_team_id : match.away_team_id, home_score: newHome, away_score: newAway, ot_type: type });
  }

  if (type === 'classic') {
    db.prepare(`UPDATE matches SET status='penalties' WHERE id=?`).run(match.id);
    return res.json({ needs_penalties: true });
  }

  // No goal in golden goal → still overtime (classic button remains available)
  return res.json({ drew: true, needs_classic: true });
});

router.post('/:id/penalties', requireAuth, (req, res) => {
  const db = getDb();
  const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Not found' });
  if (!['overtime', 'penalties'].includes(match.status)) return res.status(400).json({ error: 'Match not eligible for penalties' });

  const HIT = 0.75;
  let penHome = 0, penAway = 0;
  for (let i = 0; i < 5; i++) {
    if (Math.random() < HIT) penHome++;
    if (Math.random() < HIT) penAway++;
  }
  // Sudden death until winner
  while (penHome === penAway) {
    if (Math.random() < HIT) penHome++;
    if (Math.random() < HIT) penAway++;
  }
  const homeWins = penHome > penAway;
  db.prepare(`UPDATE matches SET pen_home=?, pen_away=?, ot_type='penalties', status='finished' WHERE id=?`)
    .run(penHome, penAway, match.id);
  advanceTournamentWinner(match, homeWins ? 1 : 0, homeWins ? 0 : 1);
  return res.json({ pen_home: penHome, pen_away: penAway, winner: homeWins ? match.home_team_id : match.away_team_id, home_score: match.home_score, away_score: match.away_score });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM matches WHERE id=?`).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
module.exports.advanceTournamentWinner = advanceTournamentWinner;
