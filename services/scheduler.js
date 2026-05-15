'use strict';
const cron = require('node-cron');
const { getDb } = require('../database/db');
const { simulateMatch } = require('./matchSimulator');

function fmtV(v) {
  if (!v || v === 0) return 'undisclosed';
  if (v >= 1e9) return '€' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '€' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '€' + (v / 1e3).toFixed(0) + 'K';
  return '€' + v;
}

function applyMatchResults(matchId, homeTeamId, awayTeamId, result) {
  const db = getDb();
  const { homeScore, awayScore, events, playerStats, mvDeltas, matchStats } = result;

  db.prepare(`UPDATE matches SET home_score=?, away_score=?, status='finished' WHERE id=?`)
    .run(homeScore, awayScore, matchId);

  const insertEvent = db.prepare(
    `INSERT INTO match_events (match_id, minute, event_type, team_id, player_id, player2_id, description)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (const e of events) {
    insertEvent.run(matchId, e.minute, e.event_type, e.team_id, e.player_id, e.player2_id, e.description);
  }

  // Save full match stats (possession, shots, etc.)
  if (matchStats) {
    db.prepare(`
      INSERT OR REPLACE INTO match_stats
        (match_id, possession_home, possession_away, shots_home, shots_away,
         shots_on_target_home, shots_on_target_away, corners_home, corners_away,
         fouls_home, fouls_away, offsides_home, offsides_away)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      matchId,
      matchStats.possession_home, matchStats.possession_away,
      matchStats.shots_home, matchStats.shots_away,
      matchStats.shots_on_target_home, matchStats.shots_on_target_away,
      matchStats.corners_home, matchStats.corners_away,
      matchStats.fouls_home, matchStats.fouls_away,
      matchStats.offsides_home, matchStats.offsides_away,
    );
  }

  const insertStat = db.prepare(
    `INSERT OR REPLACE INTO player_match_stats (player_id, match_id, goals, assists, yellow_cards, red_cards, rating)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (const [pid, s] of Object.entries(playerStats)) {
    insertStat.run(pid, matchId, s.goals, s.assists, s.yellow_cards, s.red_cards, s.rating);
  }

  const insertAch = db.prepare(
    `INSERT INTO player_achievements (player_id, achievement_type, description, match_id) VALUES (?,?,?,?)`
  );
  for (const [pid, s] of Object.entries(playerStats)) {
    if (s.goals >= 3) insertAch.run(pid, 'hat_trick', `Hat-trick in match #${matchId}`, matchId);
    else if (s.goals === 2) insertAch.run(pid, 'brace', `Brace in match #${matchId}`, matchId);
    if (s.rating >= 9) insertAch.run(pid, 'man_of_the_match', `Man of the Match (rating ${s.rating.toFixed(1)})`, matchId);
  }

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

  for (const [pid, deltaPct] of Object.entries(mvDeltas)) {
    if (deltaPct === 0) continue;
    const player = db.prepare('SELECT market_value FROM players WHERE id = ?').get(pid);
    if (!player || player.market_value <= 0) continue;
    const newMv = Math.max(50000, player.market_value * (1 + deltaPct / 100));
    db.prepare('UPDATE players SET market_value = ? WHERE id = ?').run(newMv, pid);
    db.prepare('INSERT INTO market_value_history (player_id, market_value) VALUES (?,?)').run(pid, newMv);
  }

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
  if (goals.length) body += ` Goals: ${goals.map(e => `${(e.description||'').split('!')[0].replace('⚽ GOAL! ','').replace('⚽ OWN GOAL! ','')} (${e.minute}')`).join(', ')}.`;
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

function generateRandomMatch() {
  const db = getDb();
  const teams = db.prepare('SELECT id, name FROM teams').all();
  if (teams.length < 2) return;

  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const homeTeam = shuffled[0];
  const awayTeam = shuffled[1];
  const today    = new Date().toISOString().slice(0, 10);

  const matchR = db.prepare(
    `INSERT INTO matches (home_team_id, away_team_id, match_date, status) VALUES (?,?,?,'scheduled')`
  ).run(homeTeam.id, awayTeam.id, today);
  const matchId = matchR.lastInsertRowid;

  const homePl = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active'`).all(homeTeam.id);
  const awayPl = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active'`).all(awayTeam.id);
  const result = simulateMatch(homeTeam.id, awayTeam.id, homePl, awayPl);

  applyMatchResults(matchId, homeTeam.id, awayTeam.id, result);
  const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(matchId);
  generateMatchNews(matchId, homeTeam.name, awayTeam.name, result.homeScore, result.awayScore, evRows);

  console.log(`[Scheduler] Auto-match: ${homeTeam.name} ${result.homeScore}–${result.awayScore} ${awayTeam.name}`);
}

function generateRandomTransfer() {
  const db = getDb();
  const eligible = db.prepare(`
    SELECT t.id, t.name, COUNT(p.id) as pc
    FROM teams t
    JOIN players p ON p.team_id = t.id AND p.status = 'active'
    GROUP BY t.id HAVING pc >= 4
  `).all();
  if (eligible.length < 2) return;

  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const srcTeam  = shuffled[0];
  const tgtTeam  = shuffled[1];

  const player = db.prepare(`
    SELECT * FROM players WHERE team_id=? AND status='active'
    ORDER BY RANDOM() LIMIT 1
  `).get(srcTeam.id);
  if (!player) return;

  // Skip if player is on an active loan (they're technically at another club)
  const onLoan = db.prepare(`SELECT id FROM loans WHERE player_id=? AND status='active'`).get(player.id);
  if (onLoan) return;

  const feePct = 0.7 + Math.random() * 0.7;
  const fee    = Math.round((player.market_value || 500000) * feePct / 10000) * 10000;
  const today  = new Date().toISOString().slice(0, 10);

  db.prepare('UPDATE players SET team_id=? WHERE id=?').run(tgtTeam.id, player.id);
  db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type)
    VALUES (?,?,?,?,?,'permanent')`).run(player.id, srcTeam.id, tgtTeam.id, fee, today);

  for (const tid of [srcTeam.id, tgtTeam.id]) {
    const tot = db.prepare('SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?').get(tid);
    db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(tot.t, tid);
  }

  db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(
    `Transfer: ${player.name} joins ${tgtTeam.name}`,
    `${player.name} has completed a move from ${srcTeam.name} to ${tgtTeam.name} for a fee of ${fmtV(fee)}.`,
    'transfer', player.id
  );
  console.log(`[Scheduler] Auto-transfer: ${player.name} (${srcTeam.name}→${tgtTeam.name})`);
}

function generateRandomPlayerNews() {
  const db = getDb();
  const players = db.prepare(`
    SELECT p.*, t.name as team_name
    FROM players p LEFT JOIN teams t ON p.team_id = t.id
    WHERE p.status='active' ORDER BY RANDOM() LIMIT 8
  `).all();
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY RANDOM() LIMIT 10').all();
  if (!players.length || !teams.length) return;

  function pickTemplate(player, teams) {
    const otherTeam = teams.find(t => t.id !== player.team_id) || teams[0];
    const all = [
      {
        title: `${player.name} linked with move to ${otherTeam.name}`,
        body:  `Sources suggest ${otherTeam.name} are monitoring ${player.name}. The ${player.position || 'player'} has been in fine form and could be on the move in the upcoming window.`,
        type: 'rumor',
      },
      {
        title: `${otherTeam.name} set to bid for ${player.name}`,
        body:  `${otherTeam.name} are reportedly preparing a formal approach for ${player.name}. The player's agent has confirmed interest from multiple clubs.`,
        type: 'rumor',
      },
      {
        title: `${player.name} contract talks stall at ${player.team_name || 'current club'}`,
        body:  `Renewal negotiations for ${player.name} have hit a snag over wage demands. ${otherTeam.name} are thought to be monitoring the situation closely.`,
        type: 'rumor',
      },
      {
        title: `${player.name} wants new challenge`,
        body:  `${player.name} has reportedly expressed a desire for a new challenge. The player's current contract has less than 18 months remaining, sparking interest from several top clubs.`,
        type: 'rumor',
      },
      {
        title: `Injury concern for ${player.name}`,
        body:  `${player.name} picked up a knock during training and faces a race against time to be fit. Club medical staff are assessing the extent of the problem.`,
        type: 'injury',
      },
      {
        title: `${player.name} set for spell on sidelines`,
        body:  `${player.name} has been ruled out for several weeks with a muscle injury. The club confirmed the player is working with specialists to return as soon as possible.`,
        type: 'injury',
      },
      {
        title: `${player.name} in training ground controversy`,
        body:  `${player.name} reportedly had a heated argument with coaching staff. The club has confirmed the incident but downplayed its impact on team morale.`,
        type: 'scandal',
      },
      {
        title: `${player.name} fined for conduct breach`,
        body:  `${player.name} has been fined by ${player.team_name || 'their club'} following a breach of professional standards. Details of the incident have not been disclosed.`,
        type: 'scandal',
      },
    ];
    return all[Math.floor(Math.random() * all.length)];
  }

  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count && i < players.length; i++) {
    const player = players[i];
    const item = pickTemplate(player, teams);
    db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`)
      .run(item.title, item.body, item.type, player.id);
    console.log(`[Scheduler] Auto-news (${item.type}): ${item.title}`);
  }
}

function startScheduler() {
  // Daily at 00:05 – simulate scheduled matches & return expired loans
  cron.schedule('5 0 * * *', () => {
    console.log('[Scheduler] Running daily simulation…');
    simulateScheduledMatches();
  });

  // Every 3 hours – random match (70% chance per run)
  cron.schedule('0 */3 * * *', () => {
    if (Math.random() < 0.70) {
      try { generateRandomMatch(); } catch(e) { console.warn('[Scheduler] Auto-match failed:', e.message); }
    }
  });

  // Every 6 hours – random transfer (45% chance per run)
  cron.schedule('30 */6 * * *', () => {
    if (Math.random() < 0.45) {
      try { generateRandomTransfer(); } catch(e) { console.warn('[Scheduler] Auto-transfer failed:', e.message); }
    }
  });

  // Every 4 hours – random player news / rumors (85% chance per run)
  cron.schedule('15 */4 * * *', () => {
    if (Math.random() < 0.85) {
      try { generateRandomPlayerNews(); } catch(e) { console.warn('[Scheduler] Auto-news failed:', e.message); }
    }
  });

  console.log('[Scheduler] Daily simulation + auto-match/transfer/news scheduled.');
}

module.exports = { startScheduler, simulateScheduledMatches, applyMatchResults, generateMatchNews };
