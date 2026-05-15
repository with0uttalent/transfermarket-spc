'use strict';
const cron = require('node-cron');
const { getDb } = require('../database/db');
const { simulateMatch } = require('./matchSimulator');

function applyMatchResults(matchId, homeTeamId, awayTeamId, result) {
  const db = getDb();
  const { homeScore, awayScore, events, playerStats, mvDeltas } = result;

  db.prepare(`UPDATE matches SET home_score=?, away_score=?, status='finished' WHERE id=?`)
    .run(homeScore, awayScore, matchId);

  const insertEvent = db.prepare(
    `INSERT INTO match_events (match_id, minute, event_type, team_id, player_id, player2_id, description)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (const e of events) {
    insertEvent.run(matchId, e.minute, e.event_type, e.team_id, e.player_id, e.player2_id, e.description);
  }

  // Player stats
  const insertStat = db.prepare(
    `INSERT OR REPLACE INTO player_match_stats (player_id, match_id, goals, assists, yellow_cards, red_cards, rating)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (const [pid, s] of Object.entries(playerStats)) {
    insertStat.run(pid, matchId, s.goals, s.assists, s.yellow_cards, s.red_cards, s.rating);
  }

  // Achievements
  const insertAch = db.prepare(
    `INSERT INTO player_achievements (player_id, achievement_type, description, match_id) VALUES (?,?,?,?)`
  );
  for (const [pid, s] of Object.entries(playerStats)) {
    if (s.goals >= 3) insertAch.run(pid, 'hat_trick', `Hat-trick in match #${matchId}`, matchId);
    else if (s.goals === 2) insertAch.run(pid, 'brace', `Brace in match #${matchId}`, matchId);
    const mvPct = parseFloat(pid) in mvDeltas ? mvDeltas[pid] : 0;
    if (s.rating >= 9) insertAch.run(pid, 'man_of_the_match', `Man of the Match (rating ${s.rating.toFixed(1)})`, matchId);
  }

  // GK clean sheet
  const getPlayers = (tid) => db.prepare(`SELECT id, position FROM players WHERE team_id = ?`).all(tid);
  const homePl = getPlayers(homeTeamId);
  const awayPl = getPlayers(awayTeamId);
  if (awayScore === 0) {
    for (const p of homePl.filter(p => p.position === 'Goalkeeper')) {
      insertAch.run(p.id, 'clean_sheet', `Clean sheet in match #${matchId}`, matchId);
    }
  }
  if (homeScore === 0) {
    for (const p of awayPl.filter(p => p.position === 'Goalkeeper')) {
      insertAch.run(p.id, 'clean_sheet', `Clean sheet in match #${matchId}`, matchId);
    }
  }

  // Market value updates
  for (const [pid, deltaPct] of Object.entries(mvDeltas)) {
    if (deltaPct === 0) continue;
    const player = db.prepare('SELECT market_value FROM players WHERE id = ?').get(pid);
    if (!player || player.market_value <= 0) continue;
    const newMv = Math.max(50000, player.market_value * (1 + deltaPct / 100));
    db.prepare('UPDATE players SET market_value = ? WHERE id = ?').run(newMv, pid);
    db.prepare('INSERT INTO market_value_history (player_id, market_value) VALUES (?,?)').run(pid, newMv);
  }

  // Recalculate team values
  for (const tid of [homeTeamId, awayTeamId]) {
    const tot = db.prepare('SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?').get(tid);
    db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(tot.t, tid);
  }
}

function generateMatchNews(matchId, homeTeam, awayTeam, homeScore, awayScore, events) {
  const db = getDb();
  const result = homeScore > awayScore
    ? `${homeTeam} won ${homeScore}–${awayScore} against ${awayTeam}`
    : homeScore < awayScore
      ? `${awayTeam} won ${awayScore}–${homeScore} against ${homeTeam}`
      : `${homeTeam} and ${awayTeam} drew ${homeScore}–${awayScore}`;

  const goals = events.filter(e => e.event_type === 'goal' || e.event_type === 'own_goal');
  const reds  = events.filter(e => e.event_type === 'red_card');
  let body = result + '.';
  if (goals.length) body += ` Goals: ${goals.map(e => `${e.description.split('!')[0].replace('⚽ GOAL! ', '').replace('⚽ OWN GOAL! ', '')} (${e.minute}')`).join(', ')}.`;
  if (reds.length)  body += ` Red cards: ${reds.map(e => `(${e.minute}')`).join(', ')}.`;

  db.prepare(`INSERT INTO news (title, body, type, match_id) VALUES (?,?,?,?)`)
    .run(`Match result: ${homeTeam} ${homeScore}–${awayScore} ${awayTeam}`, body, 'match', matchId);
}

function simulateScheduledMatches() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const scheduled = db.prepare(`
    SELECT m.*,
      ht.name as home_name, at.name as away_name
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    WHERE m.status = 'scheduled' AND m.match_date <= ?
  `).all(today);

  let count = 0;
  for (const match of scheduled) {
    const homePl = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active'`).all(match.home_team_id);
    const awayPl = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active'`).all(match.away_team_id);
    const result = simulateMatch(match.home_team_id, match.away_team_id, homePl, awayPl);
    applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);
    const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(match.id);
    generateMatchNews(match.id, match.home_name, match.away_name, result.homeScore, result.awayScore, evRows);
    count++;
  }

  // Return expired loans
  const expiredLoans = db.prepare(`SELECT * FROM loans WHERE status='active' AND end_date <= ?`).all(today);
  for (const loan of expiredLoans) {
    db.prepare(`UPDATE players SET team_id=? WHERE id=?`).run(loan.from_team_id, loan.player_id);
    db.prepare(`UPDATE loans SET status='ended' WHERE id=?`).run(loan.id);
    const p = db.prepare(`SELECT name FROM players WHERE id=?`).get(loan.player_id);
    const t = db.prepare(`SELECT name FROM teams WHERE id=?`).get(loan.from_team_id);
    if (p && t) {
      db.prepare(`INSERT INTO news (title, body, type) VALUES (?,?,?)`)
        .run(`Loan ended: ${p.name} returns`, `${p.name} has returned to ${t.name} after loan spell.`, 'transfer');
    }
  }

  if (count > 0) console.log(`[Scheduler] Simulated ${count} match(es) for ${today}`);
}

function startScheduler() {
  // Daily at 00:05
  cron.schedule('5 0 * * *', () => {
    console.log('[Scheduler] Running daily simulation…');
    simulateScheduledMatches();
  });
  console.log('[Scheduler] Daily match simulation scheduled at 00:05.');
}

module.exports = { startScheduler, simulateScheduledMatches, applyMatchResults, generateMatchNews };
