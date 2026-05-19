const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { generateBracketRound1, roundName } = require('../services/matchSimulator');
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

  // Group matches by round
  const bracket = {};
  const totalRounds = tour.total_rounds || 0;
  for (const m of matches) {
    const rn = roundName(totalRounds, m.tournament_round - 1);
    if (!bracket[m.tournament_round]) bracket[m.tournament_round] = { name: rn, matches: [] };
    bracket[m.tournament_round].matches.push(m);
  }

  res.json({ ...tour, teams, bracket });
});

router.post('/', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const r = db.prepare(`INSERT INTO tournaments (name) VALUES (?)`).run(name);
  res.status(201).json({ id: r.lastInsertRowid, name });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, trophy_url } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const tour = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!tour) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE tournaments SET name=?, trophy_url=? WHERE id=?`)
    .run(name, trophy_url ?? tour.trophy_url, req.params.id);
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

// Start tournament: seed teams, generate round 1 bracket
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

  // Seed by market value
  const teamIds = teams.map(t => t.team_id);
  const pairings = generateBracketRound1(teamIds);

  // Calculate total rounds
  let size = 1;
  while (size < teamIds.length) size *= 2;
  const totalRounds = Math.log2(size);

  // Update seeds
  const setSeed = db.prepare(`UPDATE tournament_teams SET seed=? WHERE tournament_id=? AND team_id=?`);
  teamIds.forEach((tid, i) => setSeed.run(i + 1, req.params.id, tid));

  // Create round 1 matches (BYE = team advances immediately)
  const today = new Date().toISOString().slice(0, 10);
  const insertMatch = db.prepare(
    `INSERT INTO matches (home_team_id, away_team_id, match_date, tournament_id, tournament_round) VALUES (?,?,?,?,1)`
  );
  let byeWinners = [];
  for (const p of pairings) {
    if (p.awayTeamId === null) {
      byeWinners.push(p.homeTeamId); // BYE: auto-advance
    } else if (p.homeTeamId === null) {
      byeWinners.push(p.awayTeamId);
    } else {
      insertMatch.run(p.homeTeamId, p.awayTeamId, today, req.params.id);
    }
  }

  // Save bye winners so simulate-round can combine them with match winners
  db.prepare(`UPDATE tournaments SET bye_winners=? WHERE id=?`)
    .run(byeWinners.length ? JSON.stringify(byeWinners) : null, req.params.id);

  // If some teams got BYE and all first-round matches would be byes, start at round 2
  db.prepare(`UPDATE tournaments SET status='in_progress', current_round=1, total_rounds=? WHERE id=?`)
    .run(totalRounds, req.params.id);

  db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
    .run(`Tournament started: ${tour.name}`, `${teamIds.length} teams compete. Round 1 is ready.`, 'tournament', req.params.id);

  res.json({ message: 'Tournament started', total_rounds: totalRounds, pairings: pairings.length });
});

// Simulate entire current round at once
router.post('/:id/simulate-round', requireAuth, async (req, res) => {
  const db = getDb();
  const tour = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(req.params.id);
  if (!tour || tour.status !== 'in_progress') return res.status(400).json({ error: 'Tournament not in progress' });

  const { simulateMatch } = require('../services/matchSimulator');
  const { applyMatchResults, generateMatchNews } = require('../services/scheduler');

  const roundMatches = db.prepare(
    `SELECT m.*, ht.name as home_name, at.name as away_name
     FROM matches m
     JOIN teams ht ON m.home_team_id=ht.id
     JOIN teams at ON m.away_team_id=at.id
     WHERE m.tournament_id=? AND m.tournament_round=? AND m.status='scheduled'`
  ).all(req.params.id, tour.current_round);

  if (!roundMatches.length) return res.status(400).json({ error: 'No scheduled matches in current round' });

  const results = [];
  let overtimeCount = 0;
  for (const match of roundMatches) {
    const homePl = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active'`).all(match.home_team_id);
    const awayPl = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active'`).all(match.away_team_id);
    const result = simulateMatch(match.home_team_id, match.away_team_id, homePl, awayPl);
    applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);

    // Tournament draw → set to overtime instead of finished
    if (result.homeScore === result.awayScore) {
      db.prepare(`UPDATE matches SET status='overtime' WHERE id=?`).run(match.id);
      overtimeCount++;
      results.push({ match_id: match.id, home_score: result.homeScore, away_score: result.awayScore, overtime: true });
      continue;
    }

    const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(match.id);
    generateMatchNews(match.id, match.home_name, match.away_name, result.homeScore, result.awayScore, evRows);
    const winnerId = result.homeScore >= result.awayScore ? match.home_team_id : match.away_team_id;
    results.push({ match_id: match.id, home_score: result.homeScore, away_score: result.awayScore, winner_id: winnerId });
  }

  if (overtimeCount > 0) {
    return res.json({ simulated: results.length, results, overtime_count: overtimeCount, message: `${overtimeCount} матч(а) требуют дополнительного времени` });
  }

  // Check if round is complete and advance
  const allDone = db.prepare(
    `SELECT COUNT(*) as c FROM matches WHERE tournament_id=? AND tournament_round=? AND status NOT IN ('finished')`
  ).get(req.params.id, tour.current_round);

  if (allDone.c === 0) {
    const roundMatches2 = db.prepare(`SELECT * FROM matches WHERE tournament_id=? AND tournament_round=?`)
      .all(req.params.id, tour.current_round);
    const winners = roundMatches2.map(m => {
      if (m.ot_type === 'penalties') return m.pen_home > m.pen_away ? m.home_team_id : m.away_team_id;
      return m.home_score >= m.away_score ? m.home_team_id : m.away_team_id;
    });
    const savedByes = tour.bye_winners ? JSON.parse(tour.bye_winners) : [];
    const allWinners = [...winners, ...savedByes];
    // Clear bye_winners now that they've been used
    db.prepare(`UPDATE tournaments SET bye_winners=NULL WHERE id=?`).run(req.params.id);
    const nextRound = tour.current_round + 1;
    if (allWinners.length === 1) {
      db.prepare(`UPDATE tournaments SET status='finished' WHERE id=?`).run(req.params.id);
      const champ = db.prepare(`SELECT name FROM teams WHERE id=?`).get(allWinners[0]);
      // Insert title for the winning team
      db.prepare(`INSERT INTO titles (team_id, title_name, season, year, tournament_id, trophy_url) VALUES (?,?,?,?,?,?)`)
        .run(allWinners[0], tour.name, `Турнир ${new Date().getFullYear()}`, new Date().getFullYear(), req.params.id, tour.trophy_url || null);
      db.prepare(`INSERT INTO news (title,body,type,tournament_id) VALUES (?,?,?,?)`)
        .run(`🏆 ${champ.name} выигрывает ${tour.name}!`, `${champ.name} стал чемпионом турнира «${tour.name}»!`, 'tournament', req.params.id);
      const champPl = db.prepare(`SELECT id FROM players WHERE team_id=?`).all(allWinners[0]);
      const insertAch = db.prepare(`INSERT INTO player_achievements (player_id,achievement_type,description,tournament_id) VALUES (?,?,?,?)`);
      for (const cp of champPl) {
        insertAch.run(cp.id, 'tournament_winner', `Выиграл ${tour.name}`, req.params.id);
        const pl = db.prepare(`SELECT market_value FROM players WHERE id=?`).get(cp.id);
        if (pl && pl.market_value > 0) {
          const nv = pl.market_value * 1.05;
          db.prepare(`UPDATE players SET market_value=? WHERE id=?`).run(nv, cp.id);
          db.prepare(`INSERT INTO market_value_history (player_id,market_value) VALUES (?,?)`).run(cp.id, nv);
        }
      }
    } else {
      const today = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < allWinners.length; i += 2) {
        if (allWinners[i + 1] !== undefined) {
          db.prepare(`INSERT INTO matches (home_team_id,away_team_id,match_date,tournament_id,tournament_round) VALUES (?,?,?,?,?)`)
            .run(allWinners[i], allWinners[i + 1], today, req.params.id, nextRound);
        }
      }
      db.prepare(`UPDATE tournaments SET current_round=? WHERE id=?`).run(nextRound, req.params.id);
    }
  }

  res.json({ simulated: results.length, results });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM tournaments WHERE id=?`).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
