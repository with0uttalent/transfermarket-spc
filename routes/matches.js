const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { simulateMatch } = require('../services/matchSimulator');
const { applyMatchResults, generateMatchNews } = require('../services/scheduler');
const router = express.Router();

const BASE = `
  SELECT m.*,
    ht.name as home_team_name, ht.logo_url as home_logo, ht.stadium_url as home_stadium_url,
    at.name as away_team_name, at.logo_url as away_logo,
    t.name as tournament_name
  FROM matches m
  JOIN teams ht ON m.home_team_id = ht.id
  JOIN teams at ON m.away_team_id = at.id
  LEFT JOIN tournaments t ON m.tournament_id = t.id
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
  res.json(db.prepare(q).all(...p));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const match = db.prepare(BASE + ' WHERE m.id=?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Not found' });
  const events = db.prepare(`
    SELECT e.*,
      p.name as player_name,
      p2.name as player2_name,
      t.name as team_name
    FROM match_events e
    LEFT JOIN players p  ON e.player_id  = p.id
    LEFT JOIN players p2 ON e.player2_id = p2.id
    LEFT JOIN teams   t  ON e.team_id    = t.id
    WHERE e.match_id=?
    ORDER BY e.minute
  `).all(req.params.id);
  const playerStats = db.prepare(`
    SELECT s.*, p.name as player_name, p.position, p.image_url, t.id as team_id
    FROM player_match_stats s
    JOIN players p ON s.player_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    WHERE s.match_id=?
    ORDER BY s.rating DESC
  `).all(req.params.id);
  const fullStats = db.prepare(`SELECT * FROM match_stats WHERE match_id=?`).get(req.params.id) || null;
  res.json({ ...match, events, stats: playerStats, fullStats });
});

router.post('/', requireAuth, (req, res) => {
  const { home_team_id, away_team_id, match_date, tournament_id, tournament_round } = req.body;
  if (!home_team_id || !away_team_id) return res.status(400).json({ error: 'Both teams required' });
  if (home_team_id === away_team_id) return res.status(400).json({ error: 'Teams must be different' });
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO matches (home_team_id,away_team_id,match_date,tournament_id,tournament_round)
     VALUES (?,?,?,?,?)`
  ).run(home_team_id, away_team_id, match_date||null, tournament_id||null, tournament_round||0);
  res.status(201).json({ id: r.lastInsertRowid });
});

function getLineupStarters(db, teamId) {
  const starters = db.prepare(`
    SELECT p.* FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ? AND tl.slot <= 11 AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id = p.id AND i.matches_remaining > 0)
    ORDER BY tl.slot ASC
    LIMIT 11
  `).all(teamId);
  if (starters.length > 0) return starters;
  return db.prepare(`
    SELECT p.* FROM players p
    WHERE p.team_id = ? AND p.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id = p.id AND i.matches_remaining > 0)
  `).all(teamId);
}

router.post('/:id/simulate', requireAuth, (req, res) => {
  const db = getDb();
  const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Not found' });
  if (match.status === 'finished') return res.status(400).json({ error: 'Match already simulated' });

  const homePl = getLineupStarters(db, match.home_team_id);
  const awayPl = getLineupStarters(db, match.away_team_id);
  const result = simulateMatch(match.home_team_id, match.away_team_id, homePl, awayPl);

  applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);

  const ht = db.prepare(`SELECT name FROM teams WHERE id=?`).get(match.home_team_id);
  const at = db.prepare(`SELECT name FROM teams WHERE id=?`).get(match.away_team_id);
  const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(match.id);
  generateMatchNews(match.id, ht.name, at.name, result.homeScore, result.awayScore, evRows);

  // If tournament match: advance winner
  if (match.tournament_id) {
    advanceTournamentWinner(match, result.homeScore, result.awayScore);
  }

  res.json({ home_score: result.homeScore, away_score: result.awayScore, events_count: evRows.length });
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
      return m.home_score >= m.away_score ? m.home_team_id : m.away_team_id;
    });
    const nextRound = match.tournament_round + 1;
    if (winners.length === 1) {
      // Tournament champion!
      const p = db.prepare(`SELECT name FROM teams WHERE id=?`).get(winners[0]);
      db.prepare(`UPDATE tournaments SET status='finished' WHERE id=?`).run(match.tournament_id);
      db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
        .run(`🏆 Tournament Champion!`, `${p.name} has won the tournament "${tournament.name}"!`, 'tournament', match.tournament_id);
      // Achievements for winning team players
      const champs = db.prepare(`SELECT id FROM players WHERE team_id=?`).all(winners[0]);
      const insertAch = db.prepare(`INSERT INTO player_achievements (player_id,achievement_type,description,tournament_id) VALUES (?,?,?,?)`);
      for (const cp of champs) {
        insertAch.run(cp.id, 'tournament_winner', `Won ${tournament.name}`, match.tournament_id);
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

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM matches WHERE id=?`).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
