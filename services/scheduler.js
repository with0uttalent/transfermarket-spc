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

function initPlayerSkills(db, player) {
  const mv  = player.market_value || 500000;
  const base = Math.min(88, Math.max(38, Math.round(52 + (Math.log10(Math.max(mv, 100000)) - 5) * 13)));
  const v = () => Math.round((Math.random() - 0.5) * 22);
  const pos = player.position || '';
  let pace, shooting, passing, defending, physical;
  if (pos === 'Goalkeeper') {
    pace = base - 12 + v(); shooting = base - 18 + v(); passing = base - 8 + v(); defending = base + 8 + v(); physical = base + 2 + v();
  } else if (['Centre-Back','Left-Back','Right-Back'].includes(pos)) {
    pace = base + 2 + v(); shooting = base - 14 + v(); passing = base - 4 + v(); defending = base + 12 + v(); physical = base + 10 + v();
  } else if (pos === 'Defensive Midfield') {
    pace = base - 4 + v(); shooting = base - 10 + v(); passing = base + 8 + v(); defending = base + 10 + v(); physical = base + 4 + v();
  } else if (['Central Midfield','Attacking Midfield'].includes(pos)) {
    pace = base + 2 + v(); shooting = base + 2 + v(); passing = base + 12 + v(); defending = base - 8 + v(); physical = base + v();
  } else if (['Left Winger','Right Winger'].includes(pos)) {
    pace = base + 14 + v(); shooting = base + 4 + v(); passing = base + 6 + v(); defending = base - 14 + v(); physical = base - 8 + v();
  } else { // Striker / Forward
    pace = base + 10 + v(); shooting = base + 16 + v(); passing = base - 4 + v(); defending = base - 18 + v(); physical = base + 4 + v();
  }
  const clamp = x => Math.min(99, Math.max(25, x));
  db.prepare(`INSERT OR IGNORE INTO player_skills (player_id, pace, shooting, passing, defending, physical) VALUES (?,?,?,?,?,?)`)
    .run(player.id, clamp(pace), clamp(shooting), clamp(passing), clamp(defending), clamp(physical));
}

function applySkillDeltas(db, skillDeltas) {
  if (!skillDeltas) return;
  const updateSkill = db.prepare(`
    UPDATE player_skills SET
      pace      = MAX(25, MIN(99, pace      + ?)),
      shooting  = MAX(25, MIN(99, shooting  + ?)),
      passing   = MAX(25, MIN(99, passing   + ?)),
      defending = MAX(25, MIN(99, defending + ?)),
      physical  = MAX(25, MIN(99, physical  + ?)),
      updated_at = CURRENT_TIMESTAMP
    WHERE player_id = ?
  `);
  for (const [pid, d] of Object.entries(skillDeltas)) {
    updateSkill.run(d.pace||0, d.shooting||0, d.passing||0, d.defending||0, d.physical||0, pid);
  }
}

function applyMatchResults(matchId, homeTeamId, awayTeamId, result) {
  const db = getDb();
  const { homeScore, awayScore, events, playerStats, mvDeltas, matchStats, injuredPlayers, skillDeltas } = result;

  db.prepare(`UPDATE matches SET home_score=?, away_score=?, status='finished' WHERE id=?`)
    .run(homeScore, awayScore, matchId);

  const insertEvent = db.prepare(
    `INSERT INTO match_events (match_id, minute, event_type, team_id, player_id, player2_id, description) VALUES (?,?,?,?,?,?,?)`
  );
  for (const e of events) insertEvent.run(matchId, e.minute, e.event_type, e.team_id, e.player_id, e.player2_id, e.description);

  if (matchStats) {
    db.prepare(`INSERT OR REPLACE INTO match_stats
      (match_id, possession_home, possession_away, shots_home, shots_away,
       shots_on_target_home, shots_on_target_away, corners_home, corners_away,
       fouls_home, fouls_away, offsides_home, offsides_away)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      matchId, matchStats.possession_home, matchStats.possession_away,
      matchStats.shots_home, matchStats.shots_away,
      matchStats.shots_on_target_home, matchStats.shots_on_target_away,
      matchStats.corners_home, matchStats.corners_away,
      matchStats.fouls_home, matchStats.fouls_away,
      matchStats.offsides_home, matchStats.offsides_away,
    );
  }

  const insertStat = db.prepare(
    `INSERT OR REPLACE INTO player_match_stats (player_id, match_id, goals, assists, yellow_cards, red_cards, rating) VALUES (?,?,?,?,?,?,?)`
  );
  for (const [pid, s] of Object.entries(playerStats)) insertStat.run(pid, matchId, s.goals, s.assists, s.yellow_cards, s.red_cards, s.rating);

  const insertAch = db.prepare(`INSERT INTO player_achievements (player_id, achievement_type, description, match_id) VALUES (?,?,?,?)`);
  for (const [pid, s] of Object.entries(playerStats)) {
    if (s.goals >= 3) insertAch.run(pid, 'hat_trick', `Hat-trick in match #${matchId}`, matchId);
    else if (s.goals === 2) insertAch.run(pid, 'brace', `Brace in match #${matchId}`, matchId);
    if (s.rating >= 9) insertAch.run(pid, 'man_of_the_match', `Man of the Match (${s.rating.toFixed(1)})`, matchId);
  }

  const getPlayers = (tid) => db.prepare(`SELECT id, position FROM players WHERE team_id=?`).all(tid);
  if (awayScore === 0) for (const p of getPlayers(homeTeamId).filter(p => p.position === 'Goalkeeper')) insertAch.run(p.id, 'clean_sheet', `Clean sheet in match #${matchId}`, matchId);
  if (homeScore === 0) for (const p of getPlayers(awayTeamId).filter(p => p.position === 'Goalkeeper')) insertAch.run(p.id, 'clean_sheet', `Clean sheet in match #${matchId}`, matchId);

  // Market value updates (dynamic)
  for (const [pid, deltaPct] of Object.entries(mvDeltas)) {
    if (deltaPct === 0) continue;
    const player = db.prepare('SELECT market_value FROM players WHERE id=?').get(pid);
    if (!player || player.market_value <= 0) continue;
    const newMv = Math.max(50000, player.market_value * (1 + deltaPct / 100));
    db.prepare('UPDATE players SET market_value=? WHERE id=?').run(newMv, pid);
    db.prepare('INSERT INTO market_value_history (player_id, market_value) VALUES (?,?)').run(pid, newMv);
  }

  // Injuries: record in player_injuries table (3 matches unavailable)
  if (injuredPlayers && injuredPlayers.length) {
    const injTypes = ['muscle strain','hamstring injury','ankle sprain','calf problem'];
    const insertInjury = db.prepare(`INSERT OR REPLACE INTO player_injuries (player_id, injury_type, matches_remaining) VALUES (?,?,3)`);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    for (const pid of injuredPlayers) insertInjury.run(pid, pick(injTypes));
  }

  // Skill updates
  // Ensure all players have skills initialized
  for (const tid of [homeTeamId, awayTeamId]) {
    const players = db.prepare('SELECT * FROM players WHERE team_id=?').all(tid);
    for (const p of players) initPlayerSkills(db, p);
  }
  if (skillDeltas) applySkillDeltas(db, skillDeltas);

  // Decrement injury counters for all players from both teams
  for (const tid of [homeTeamId, awayTeamId]) {
    db.prepare(`
      UPDATE player_injuries SET matches_remaining = matches_remaining - 1
      WHERE player_id IN (SELECT id FROM players WHERE team_id=?)
        AND matches_remaining > 0
    `).run(tid);
    db.prepare(`DELETE FROM player_injuries WHERE matches_remaining <= 0`).run();
  }

  // Recalculate team values
  for (const tid of [homeTeamId, awayTeamId]) {
    const tot = db.prepare('SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?').get(tid);
    db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(tot.t, tid);
  }
}

function generateMatchNews(matchId, homeTeam, awayTeam, homeScore, awayScore, events) {
  const db = getDb();
  const homeWon = homeScore > awayScore;
  const draw    = homeScore === awayScore;
  const result  = homeWon
    ? `${homeTeam} won ${homeScore}–${awayScore} against ${awayTeam}`
    : draw ? `${homeTeam} and ${awayTeam} drew ${homeScore}–${awayScore}`
           : `${awayTeam} won ${awayScore}–${homeScore} against ${homeTeam}`;

  const goals = events.filter(e => e.event_type === 'goal' || e.event_type === 'own_goal');
  const reds  = events.filter(e => e.event_type === 'red_card');
  const inj   = events.filter(e => e.event_type === 'injury');
  let body = result + '.';
  if (goals.length) body += ` Goals: ${goals.map(e => `(${e.minute}')`).join(', ')}.`;
  if (reds.length)  body += ` Red cards: ${reds.length}.`;
  if (inj.length)   body += ` Injuries: ${inj.length}.`;

  db.prepare(`INSERT INTO news (title, body, type, match_id) VALUES (?,?,?,?)`)
    .run(`${homeTeam} ${homeScore}–${awayScore} ${awayTeam}`, body, 'match', matchId);
}

function generateTeamMatchNews(matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeScore, awayScore) {
  const db = getDb();
  const homeWon = homeScore > awayScore;
  const draw    = homeScore === awayScore;

  const homeMsg = homeWon
    ? `${homeTeamName} secured a ${homeScore}–${awayScore} victory at home! Excellent performance from the squad.`
    : draw
      ? `${homeTeamName} shared the spoils in a ${homeScore}–${awayScore} draw.`
      : `${homeTeamName} suffered a ${homeScore}–${awayScore} defeat. The manager will have plenty to reflect on.`;
  const awayMsg = !homeWon && !draw
    ? `${awayTeamName} claimed a brilliant away win, defeating ${homeTeamName} ${awayScore}–${homeScore}!`
    : draw
      ? `${awayTeamName} held ${homeTeamName} to a ${awayScore}–${homeScore} draw on the road.`
      : `${awayTeamName} were beaten ${homeScore}–${awayScore} away from home.`;

  db.prepare(`INSERT INTO news (title, body, type, match_id, team_id) VALUES (?,?,?,?,?)`)
    .run(`${homeTeamName}: match result`, homeMsg, 'team', matchId, homeTeamId);
  db.prepare(`INSERT INTO news (title, body, type, match_id, team_id) VALUES (?,?,?,?,?)`)
    .run(`${awayTeamName}: match result`, awayMsg, 'team', matchId, awayTeamId);
}

function simulateScheduledMatches() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const scheduled = db.prepare(`
    SELECT m.*, ht.name as home_name, at.name as away_name
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    WHERE m.status='scheduled' AND m.match_date<=?
  `).all(today);

  for (const match of scheduled) {
    const homePl = db.prepare(`
      SELECT p.* FROM players p
      WHERE p.team_id=? AND p.status='active'
        AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)
    `).all(match.home_team_id);
    const awayPl = db.prepare(`
      SELECT p.* FROM players p
      WHERE p.team_id=? AND p.status='active'
        AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)
    `).all(match.away_team_id);
    const result = simulateMatch(match.home_team_id, match.away_team_id, homePl, awayPl);
    applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);
    const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(match.id);
    generateMatchNews(match.id, match.home_name, match.away_name, result.homeScore, result.awayScore, evRows);
    generateTeamMatchNews(match.id, match.home_team_id, match.away_team_id, match.home_name, match.away_name, result.homeScore, result.awayScore);
  }

  // Return expired loans
  const expiredLoans = db.prepare(`SELECT * FROM loans WHERE status='active' AND end_date<=?`).all(today);
  for (const loan of expiredLoans) {
    db.prepare(`UPDATE players SET team_id=? WHERE id=?`).run(loan.from_team_id, loan.player_id);
    db.prepare(`UPDATE loans SET status='ended' WHERE id=?`).run(loan.id);
    const p = db.prepare(`SELECT name FROM players WHERE id=?`).get(loan.player_id);
    const t = db.prepare(`SELECT name FROM teams WHERE id=?`).get(loan.from_team_id);
    if (p && t) db.prepare(`INSERT INTO news (title, body, type) VALUES (?,?,?)`).run(`Loan ended: ${p.name} returns`, `${p.name} has returned to ${t.name} after loan spell.`, 'transfer');
  }
}

function generateRandomMatch() {
  const db = getDb();
  const teams = db.prepare('SELECT id, name FROM teams').all();
  if (teams.length < 2) return;
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const homeTeam = shuffled[0], awayTeam = shuffled[1];
  const today = new Date().toISOString().slice(0, 10);

  const matchR = db.prepare(`INSERT INTO matches (home_team_id, away_team_id, match_date, status) VALUES (?,?,?,'scheduled')`).run(homeTeam.id, awayTeam.id, today);
  const matchId = matchR.lastInsertRowid;

  const homePl = db.prepare(`SELECT p.* FROM players p WHERE p.team_id=? AND p.status='active' AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)`).all(homeTeam.id);
  const awayPl = db.prepare(`SELECT p.* FROM players p WHERE p.team_id=? AND p.status='active' AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)`).all(awayTeam.id);

  const result = simulateMatch(homeTeam.id, awayTeam.id, homePl, awayPl);
  applyMatchResults(matchId, homeTeam.id, awayTeam.id, result);
  const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(matchId);
  generateMatchNews(matchId, homeTeam.name, awayTeam.name, result.homeScore, result.awayScore, evRows);
  generateTeamMatchNews(matchId, homeTeam.id, awayTeam.id, homeTeam.name, awayTeam.name, result.homeScore, result.awayScore);
  console.log(`[Scheduler] Auto-match: ${homeTeam.name} ${result.homeScore}–${result.awayScore} ${awayTeam.name}`);
}

function generateRandomTransfer() {
  const db = getDb();
  const eligible = db.prepare(`
    SELECT t.id, t.name, COUNT(p.id) as pc
    FROM teams t JOIN players p ON p.team_id=t.id AND p.status='active'
    GROUP BY t.id HAVING pc >= 4
  `).all();
  if (eligible.length < 2) return;
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const srcTeam = shuffled[0], tgtTeam = shuffled[1];

  const player = db.prepare(`SELECT * FROM players WHERE team_id=? AND status='active' ORDER BY RANDOM() LIMIT 1`).get(srcTeam.id);
  if (!player) return;
  const onLoan = db.prepare(`SELECT id FROM loans WHERE player_id=? AND status='active'`).get(player.id);
  if (onLoan) return;

  // Fee must be >= market value (100%–145%)
  const feePct = 1.0 + Math.random() * 0.45;
  const fee    = Math.round((player.market_value || 500000) * feePct / 10000) * 10000;
  const today  = new Date().toISOString().slice(0, 10);

  db.prepare('UPDATE players SET team_id=? WHERE id=?').run(tgtTeam.id, player.id);
  db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type) VALUES (?,?,?,?,?,'permanent')`).run(player.id, srcTeam.id, tgtTeam.id, fee, today);

  for (const tid of [srcTeam.id, tgtTeam.id]) {
    const tot = db.prepare('SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?').get(tid);
    db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(tot.t, tid);
  }
  db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(
    `Transfer: ${player.name} joins ${tgtTeam.name}`,
    `${player.name} has completed a move from ${srcTeam.name} to ${tgtTeam.name} for ${fmtV(fee)}.`,
    'transfer', player.id
  );
  console.log(`[Scheduler] Auto-transfer: ${player.name} (${srcTeam.name}→${tgtTeam.name}) ${fmtV(fee)}`);
}

function generateRandomPlayerNews() {
  const db = getDb();
  const players = db.prepare(`SELECT p.*, t.name as team_name FROM players p LEFT JOIN teams t ON p.team_id=t.id WHERE p.status='active' ORDER BY RANDOM() LIMIT 10`).all();
  const teams   = db.prepare('SELECT id, name FROM teams ORDER BY RANDOM() LIMIT 10').all();
  if (!players.length || !teams.length) return;

  function pickItem(player) {
    const otherTeam = teams.find(t => t.id !== player.team_id) || teams[0];
    const pool = [
      { title:`${player.name} linked with move to ${otherTeam.name}`, body:`Sources suggest ${otherTeam.name} are monitoring ${player.name}. The ${player.position||'player'} could be available in the upcoming window.`, type:'rumor' },
      { title:`${otherTeam.name} set to bid for ${player.name}`, body:`${otherTeam.name} are reportedly preparing a formal approach. Personal terms are yet to be discussed.`, type:'rumor' },
      { title:`${player.name} contract talks stall`, body:`Renewal negotiations for ${player.name} have hit a snag. ${otherTeam.name} are thought to be watching closely.`, type:'rumor' },
      { title:`${player.name} wants new challenge`, body:`${player.name} has reportedly expressed a desire for regular first-team football. Several clubs are said to be interested.`, type:'rumor' },
      { title:`Injury concern: ${player.name}`, body:`${player.name} picked up a knock in training and is being assessed by medical staff ahead of upcoming fixtures.`, type:'injury' },
      { title:`${player.name} set for weeks on sidelines`, body:`${player.name} is expected to miss several weeks with a muscle injury. The club is monitoring recovery closely.`, type:'injury' },
      { title:`${player.name} in training ground controversy`, body:`${player.name} reportedly had a heated exchange with coaching staff. The club has downplayed the incident.`, type:'scandal' },
      { title:`${player.name} fined for conduct breach`, body:`${player.name} has been fined by ${player.team_name||'the club'} following a breach of professional standards.`, type:'scandal' },
      { title:`Insight: ${player.name} form analysed`, body:`${player.name} has been one of the standout performers this season. Analysts rate the ${player.position||'player'} among the best in their position.`, type:'rumor' },
      { title:`${player.team_name||'Club'} preparing new contract for ${player.name}`, body:`${player.team_name||'The club'} are keen to tie down ${player.name} to an improved long-term deal amid reported interest from abroad.`, type:'rumor' },
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Generate at least 2 items
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count && i < players.length; i++) {
    const item = pickItem(players[i]);
    db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(item.title, item.body, item.type, players[i].id);
  }
}

function startScheduler() {
  // Daily at 00:05 – simulate scheduled matches & return expired loans
  cron.schedule('5 0 * * *', () => { try { simulateScheduledMatches(); } catch(e) { console.warn('[Scheduler] Daily sim error:', e.message); } });

  // Every 30 minutes – auto-generate and simulate a match
  cron.schedule('*/30 * * * *', () => {
    try { generateRandomMatch(); } catch(e) { console.warn('[Scheduler] Auto-match error:', e.message); }
  });

  // Every 12 hours – auto-generate a transfer (fee >= market value)
  cron.schedule('0 */12 * * *', () => {
    try { generateRandomTransfer(); } catch(e) { console.warn('[Scheduler] Auto-transfer error:', e.message); }
  });

  // Every 15 minutes – generate at least 2 player/team news items
  cron.schedule('*/15 * * * *', () => {
    try { generateRandomPlayerNews(); } catch(e) { console.warn('[Scheduler] Auto-news error:', e.message); }
  });

  console.log('[Scheduler] Crons: match/30min | transfer/12h | news/15min | daily-sim/00:05.');
}

module.exports = { startScheduler, simulateScheduledMatches, applyMatchResults, generateMatchNews };
