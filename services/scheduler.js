'use strict';
const cron = require('node-cron');
const { getDb } = require('../database/db');
const { simulateMatch, simulateMatchWithLineup } = require('./matchSimulator');
const { sendMatchResult, sendMatchPreview, sendMatchKickoff, sendLiveEvent, sendMatchResultToLive, sendStandingsBanner } = require('./telegramBot');

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

  // Do not change match status here — caller is responsible for status transitions
  db.prepare(`UPDATE matches SET home_score=?, away_score=? WHERE id=?`)
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
    const insertInjury = db.prepare(`INSERT OR REPLACE INTO player_injuries (player_id, injury_type, matches_remaining) VALUES (?,?,?)`);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const injDuration = () => Math.random() < 0.25 ? 2 : 1; // 75% = 1 match, 25% = 2 matches
    for (const pid of injuredPlayers) insertInjury.run(pid, pick(injTypes), injDuration());
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
    ? `${homeTeam} победили ${awayTeam} со счётом ${homeScore}–${awayScore}`
    : draw ? `${homeTeam} и ${awayTeam} сыграли вничью ${homeScore}–${awayScore}`
           : `${awayTeam} победили ${homeTeam} со счётом ${awayScore}–${homeScore}`;

  const goals = events.filter(e => e.event_type === 'goal' || e.event_type === 'own_goal');
  const reds  = events.filter(e => e.event_type === 'red_card');
  const inj   = events.filter(e => e.event_type === 'injury');
  let body = result + '.';
  if (goals.length) body += ` Голы: ${goals.map(e => `(${e.minute}')`).join(', ')}.`;
  if (reds.length)  body += ` Удалений: ${reds.length}.`;
  if (inj.length)   body += ` Травм: ${inj.length}.`;

  db.prepare(`INSERT INTO news (title, body, type, match_id) VALUES (?,?,?,?)`)
    .run(`${homeTeam} ${homeScore}–${awayScore} ${awayTeam}`, body, 'match', matchId);

  // Telegram: skip friendly matches
  const friendlyCheck = db.prepare(`SELECT is_friendly FROM matches WHERE id=?`).get(matchId);
  if (friendlyCheck && friendlyCheck.is_friendly) return;

  // Telegram: send match result banner
  const match = db.prepare(`
    SELECT m.status, m.home_team_id, m.away_team_id, m.league_id, m.is_friendly,
      ht.logo_url as home_logo, ht.stadium_url as home_stadium,
      at.logo_url as away_logo,
      lg.name as league_name, lg.logo_url as league_logo
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    LEFT JOIN leagues lg ON m.league_id = lg.id
    WHERE m.id = ?
  `).get(matchId);
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const toUrl = u => u ? (u.startsWith('http') ? u : base + u) : null;

  // Enrich goal events with player names for Telegram caption
  const goalEvents = db.prepare(`
    SELECT e.event_type, e.minute, e.team_id,
      p.name  as player_name,
      p2.name as assist_name
    FROM match_events e
    LEFT JOIN players p  ON e.player_id  = p.id
    LEFT JOIN players p2 ON e.player2_id = p2.id
    WHERE e.match_id = ? AND e.event_type IN ('goal','own_goal')
    ORDER BY e.minute
  `).all(matchId);

  const resultPayload = {
    matchId, homeTeam, awayTeam, homeScore, awayScore,
    homeLogo:      toUrl(match?.home_logo),
    awayLogo:      toUrl(match?.away_logo),
    stadiumUrl:    toUrl(match?.home_stadium),
    homeTeamId:    match?.home_team_id,
    awayTeamId:    match?.away_team_id,
    leagueName:    match?.league_name || null,
    leagueLogoUrl: toUrl(match?.league_logo),
    goalEvents,
  };

  sendMatchResult({ ...resultPayload, status: match?.status || 'finished', events }).catch(() => {});
  sendMatchResultToLive(resultPayload).catch(() => {});
  db.prepare(`UPDATE matches SET tg_result_sent=1 WHERE id=?`).run(matchId);

  // Individual news for each match injury
  const injEvents = events.filter(e => e.event_type === 'injury');
  const injTypes = ['растяжение мышцы', 'травма подколенного сухожилия', 'растяжение связок голеностопа', 'проблема с икрой'];
  for (const ev of injEvents) {
    if (!ev.player_id) continue;
    const player = db.prepare(`SELECT p.name, t.name as team_name FROM players p LEFT JOIN teams t ON p.team_id=t.id WHERE p.id=?`).get(ev.player_id);
    if (!player) continue;
    const injType = injTypes[Math.floor(Math.random() * injTypes.length)];
    db.prepare(`INSERT INTO news (title, body, type, match_id, player_id) VALUES (?,?,?,?,?)`)
      .run(
        `${player.name} получил травму в матче`,
        `${player.name} (${player.team_name}) покинул поле в матче ${homeTeam} ${homeScore}–${awayScore} ${awayTeam} на ${ev.minute}-й минуте. Предварительный диагноз: ${injType}. Игрок пропустит несколько ближайших матчей.`,
        'injury', matchId, ev.player_id
      );
  }
}

function generateTeamMatchNews(matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeScore, awayScore) {
  const db = getDb();
  const homeWon = homeScore > awayScore;
  const draw    = homeScore === awayScore;

  const homeMsg = homeWon
    ? `${homeTeamName} одержали победу дома со счётом ${homeScore}–${awayScore}! Отличная игра команды.`
    : draw
      ? `${homeTeamName} сыграли вничью ${homeScore}–${awayScore}.`
      : `${homeTeamName} потерпели домашнее поражение ${homeScore}–${awayScore}. Тренерскому штабу есть над чем задуматься.`;
  const awayMsg = !homeWon && !draw
    ? `${awayTeamName} вырвали блестящую победу в гостях, обыграв ${homeTeamName} ${awayScore}–${homeScore}!`
    : draw
      ? `${awayTeamName} удержали ничью ${awayScore}–${homeScore} в выездном матче.`
      : `${awayTeamName} уступили ${homeScore}–${awayScore} в гостях.`;

  db.prepare(`INSERT INTO news (title, body, type, match_id, team_id) VALUES (?,?,?,?,?)`)
    .run(`${homeTeamName}: итог матча`, homeMsg, 'team', matchId, homeTeamId);
  db.prepare(`INSERT INTO news (title, body, type, match_id, team_id) VALUES (?,?,?,?,?)`)
    .run(`${awayTeamName}: итог матча`, awayMsg, 'team', matchId, awayTeamId);
}

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
    const home = getLineupInfo(db, match.home_team_id);
    const away = getLineupInfo(db, match.away_team_id);
    const result = simulateMatch(match.home_team_id, match.away_team_id, home.players, away.players, home.zoneMap, away.zoneMap);
    applyMatchResults(match.id, match.home_team_id, match.away_team_id, result);
    db.prepare(`UPDATE matches SET status='finished' WHERE id=?`).run(match.id);
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
    if (p && t) db.prepare(`INSERT INTO news (title, body, type) VALUES (?,?,?)`).run(`Аренда завершена: ${p.name} возвращается`, `${p.name} вернулся в ${t.name} по окончании срока аренды.`, 'transfer');
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

  const home = getLineupInfo(db, homeTeam.id);
  const away = getLineupInfo(db, awayTeam.id);

  const result = simulateMatch(homeTeam.id, awayTeam.id, home.players, away.players, home.zoneMap, away.zoneMap);
  applyMatchResults(matchId, homeTeam.id, awayTeam.id, result);
  db.prepare(`UPDATE matches SET status='finished' WHERE id=?`).run(matchId);
  const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(matchId);
  generateMatchNews(matchId, homeTeam.name, awayTeam.name, result.homeScore, result.awayScore, evRows);
  generateTeamMatchNews(matchId, homeTeam.id, awayTeam.id, homeTeam.name, awayTeam.name, result.homeScore, result.awayScore);
  console.log(`[Scheduler] Auto-match: ${homeTeam.name} ${result.homeScore}–${result.awayScore} ${awayTeam.name}`);
}


function generateRandomPlayerNews() {
  const db = getDb();
  const players = db.prepare(`SELECT p.*, t.name as team_name FROM players p LEFT JOIN teams t ON p.team_id=t.id WHERE p.status='active' ORDER BY RANDOM() LIMIT 10`).all();
  const teams   = db.prepare('SELECT id, name FROM teams ORDER BY RANDOM() LIMIT 10').all();
  if (!players.length || !teams.length) return;

  function pickItem(player) {
    const otherTeam = teams.find(t => t.id !== player.team_id) || teams[0];
    const pool = [
      { title:`${player.name} связывают с переходом в ${otherTeam.name}`, body:`По данным источников, ${otherTeam.name} следят за ${player.name}. Игрок может быть доступен в ближайшее трансферное окно.`, type:'rumor' },
      { title:`${otherTeam.name} готовятся сделать предложение за ${player.name}`, body:`По слухам, ${otherTeam.name} готовят официальное предложение. Личные условия контракта ещё не обсуждались.`, type:'rumor' },
      { title:`Переговоры по контракту ${player.name} зашли в тупик`, body:`Переговоры о продлении соглашения с ${player.name} забуксовали. Источники сообщают, что ${otherTeam.name} внимательно следит за ситуацией.`, type:'rumor' },
      { title:`${player.name} хочет сменить обстановку`, body:`По имеющимся данным, ${player.name} выразил желание получать больше игрового времени. Несколько клубов уже проявили интерес.`, type:'rumor' },
      { title:`Скандал в тренировочном центре с участием ${player.name}`, body:`По данным инсайдеров, у ${player.name} произошёл конфликт с тренерским штабом. Клуб опроверг серьёзность инцидента.`, type:'scandal' },
      { title:`${player.name} оштрафован за нарушение дисциплины`, body:`${player.name} получил штраф от ${player.team_name||'клуба'} за нарушение профессиональных стандартов.`, type:'scandal' },
      { title:`Анализ формы: ${player.name} в ударе`, body:`${player.name} стал одним из ярких исполнителей этого сезона. Эксперты ставят ${player.position?`этого ${player.position}`:'игрока'} в число лучших на своей позиции.`, type:'rumor' },
      { title:`${player.team_name||'Клуб'} готовит новый контракт для ${player.name}`, body:`${player.team_name||'Клуб'} стремится удержать ${player.name} на улучшенных условиях на фоне интереса из-за рубежа.`, type:'rumor' },
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

// ─── simulateLeagueMatchday ────────────────────────────────────────────────────
// Simulates the next unplayed matchday for a league using team lineups + skills
function simulateLeagueMatchday(leagueId) {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(leagueId);
  if (!league) throw new Error(`League ${leagueId} not found`);
  if (league.status !== 'active') throw new Error(`League ${leagueId} is not active`);

  const today = new Date().toISOString().slice(0, 10);

  // Find next unplayed matchday with scheduled_date <= today
  const nextRow = db.prepare(`
    SELECT MIN(matchday) as matchday
    FROM league_schedule
    WHERE league_id=? AND match_id IS NULL AND scheduled_date <= ?
  `).get(leagueId, today);

  if (!nextRow || nextRow.matchday === null) {
    console.log(`[Scheduler] League ${leagueId}: no matchdays due today`);
    return;
  }
  const matchday = nextRow.matchday;

  // Get all schedule rows for this matchday
  const scheduleRows = db.prepare(`
    SELECT ls.*, ht.name AS home_name, at.name AS away_name
    FROM league_schedule ls
    JOIN teams ht ON ls.home_team_id = ht.id
    JOIN teams at ON ls.away_team_id = at.id
    WHERE ls.league_id=? AND ls.matchday=? AND ls.match_id IS NULL
  `).all(leagueId, matchday);

  let matchIndex = 0;
  for (const srow of scheduleRows) {
    // Get lineup starters (slots 1-11) and reserves (slots 12-22)
    const lineupRows = db.prepare(`
      SELECT tl.slot, tl.player_id, tl.position_override,
             p.id, p.name, p.position, p.market_value, p.status
      FROM team_lineups tl
      JOIN players p ON tl.player_id = p.id
      WHERE tl.team_id = ?
      ORDER BY tl.slot ASC
    `);

    const homeLineup = lineupRows.all(srow.home_team_id);
    const awayLineup = lineupRows.all(srow.away_team_id);

    const homeStarters = homeLineup.filter(p => p.slot >= 1 && p.slot <= 11)
      .map(p => ({ ...p, position: p.position_override || p.position }));
    const homeReserves = homeLineup.filter(p => p.slot >= 12)
      .map(p => ({ ...p, position: p.position_override || p.position }));
    const awayStarters = awayLineup.filter(p => p.slot >= 1 && p.slot <= 11)
      .map(p => ({ ...p, position: p.position_override || p.position }));
    const awayReserves = awayLineup.filter(p => p.slot >= 12)
      .map(p => ({ ...p, position: p.position_override || p.position }));

    // If no lineup set, fall back to all active non-injured players
    let homePlayers, awayPlayers, useLineup = false;
    if (homeStarters.length >= 7 && awayStarters.length >= 7) {
      useLineup = true;
    } else {
      homePlayers = db.prepare(`
        SELECT p.* FROM players p
        WHERE p.team_id=? AND p.status='active'
          AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)
      `).all(srow.home_team_id);
      awayPlayers = db.prepare(`
        SELECT p.* FROM players p
        WHERE p.team_id=? AND p.status='active'
          AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)
      `).all(srow.away_team_id);
    }

    // Build skills map
    const allPlayerIds = useLineup
      ? [...homeStarters, ...homeReserves, ...awayStarters, ...awayReserves].map(p => p.player_id)
      : [...(homePlayers||[]), ...(awayPlayers||[])].map(p => p.id);

    const skillsMap = {};
    if (allPlayerIds.length) {
      const placeholders = allPlayerIds.map(() => '?').join(',');
      const skillRows = db.prepare(
        `SELECT * FROM player_skills WHERE player_id IN (${placeholders})`
      ).all(...allPlayerIds);
      for (const sk of skillRows) skillsMap[sk.player_id] = sk;
    }

    // Simulate first so we have the result for the INSERT
    let result;
    if (useLineup) {
      result = simulateMatchWithLineup(
        srow.home_team_id, srow.away_team_id,
        homeStarters, homeReserves,
        awayStarters, awayReserves,
        skillsMap
      );
    } else {
      result = simulateMatch(srow.home_team_id, srow.away_team_id, homePlayers, awayPlayers);
    }

    // Create match record with staggered kick-off using league settings
    const _startTime = league.match_start_time || '16:00';
    const _intervalMin = league.match_interval_minutes || 15;
    const [_sh, _sm] = _startTime.split(':').map(Number);
    const kickoff = new Date();
    kickoff.setHours(_sh, _sm, 0, 0);
    kickoff.setMinutes(kickoff.getMinutes() + matchIndex * _intervalMin);
    const pad2 = n => String(n).padStart(2, '0');
    const matchTimeStr = `${pad2(kickoff.getHours())}:${pad2(kickoff.getMinutes())}`;

    const matchR = db.prepare(`
      INSERT INTO matches (home_team_id, away_team_id, match_date, match_time, status, league_id, matchday, started_at, home_score, away_score)
      VALUES (?,?,?,?,'in_progress',?,?,?,?,?)
    `).run(srow.home_team_id, srow.away_team_id, today, matchTimeStr, leagueId, matchday,
           kickoff.toISOString(), result.homeScore, result.awayScore);
    const matchId = matchR.lastInsertRowid;

    // Apply player/team stat updates immediately (hidden from match view until finished)
    applyMatchResults(matchId, srow.home_team_id, srow.away_team_id, result);
    // generateMatchNews deferred — fired by finalizeExpiredMatches cron after 90s

    // Update league_schedule
    db.prepare('UPDATE league_schedule SET match_id=? WHERE id=?').run(matchId, srow.id);

    // Update league_standings
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

    updateStanding.run(
      homeWon ? 1 : 0, draw ? 1 : 0, (!homeWon && !draw) ? 1 : 0,
      homeScore, awayScore,
      homeWon ? 3 : draw ? 1 : 0,
      leagueId, srow.home_team_id
    );
    updateStanding.run(
      (!homeWon && !draw) ? 1 : 0, draw ? 1 : 0, homeWon ? 1 : 0,
      awayScore, homeScore,
      (!homeWon && !draw) ? 3 : draw ? 1 : 0,
      leagueId, srow.away_team_id
    );

    // Team-specific match news
    const homeTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(srow.home_team_id);
    const awayTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(srow.away_team_id);
    if (homeTeam && awayTeam) {
      const homeMsg = homeWon
        ? `${homeTeam.name} одержали победу дома со счётом ${homeScore}–${awayScore}!`
        : draw ? `${homeTeam.name} сыграли вничью ${homeScore}–${awayScore} в чемпионате.`
               : `${homeTeam.name} потерпели поражение ${homeScore}–${awayScore} в домашнем матче.`;
      const awayMsg = !homeWon && !draw
        ? `${awayTeam.name} вырвали блестящую победу в гостях ${awayScore}–${homeScore}!`
        : draw ? `${awayTeam.name} сыграли вничью ${awayScore}–${homeScore} в гостевом матче.`
               : `${awayTeam.name} проиграли ${awayScore}–${homeScore} в гостях.`;

      db.prepare(`INSERT INTO news (title, body, type, match_id, team_id) VALUES (?,?,?,?,?)`).run(
        `Тур ${matchday}: ${srow.home_name} vs ${srow.away_name}`, homeMsg, 'team', matchId, srow.home_team_id
      );
      db.prepare(`INSERT INTO news (title, body, type, match_id, team_id) VALUES (?,?,?,?,?)`).run(
        `Тур ${matchday}: ${srow.home_name} vs ${srow.away_name}`, awayMsg, 'team', matchId, srow.away_team_id
      );
    }

    console.log(`[Scheduler] League ${leagueId} MD${matchday} [${matchTimeStr}]: ${srow.home_name} ${homeScore}-${awayScore} ${srow.away_name}`);
    matchIndex++;
  }

  // Update current_matchday
  db.prepare('UPDATE leagues SET current_matchday=? WHERE id=?').run(matchday, leagueId);

  // Check if all matchdays done
  const remaining = db.prepare(`
    SELECT COUNT(*) as cnt FROM league_schedule WHERE league_id=? AND match_id IS NULL
  `).get(leagueId);

  if (remaining.cnt === 0) {
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 7);
    db.prepare(`UPDATE leagues SET status='transfer_window', transfer_window_end=? WHERE id=?`)
      .run(windowEnd.toISOString().slice(0, 10), leagueId);
    console.log(`[Scheduler] League ${leagueId}: all matchdays completed, entering transfer window`);
  }
}

function checkUpcomingMatches() {
  try {
    const db = getDb();
    const now = new Date();
    // Build window: notify matches whose kick-off is 28–32 minutes from now
    const lo = new Date(now.getTime() + 28 * 60 * 1000);
    const hi = new Date(now.getTime() + 32 * 60 * 1000);

    const pad = n => String(n).padStart(2, '0');
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    // Collect candidate dates/times in the window (minute precision)
    const candidates = [];
    for (let t = new Date(lo); t <= hi; t = new Date(t.getTime() + 60000)) {
      candidates.push({ date: fmtDate(t), time: fmtTime(t) });
    }
    if (!candidates.length) return;

    const placeholders = candidates.map(() => '(m.match_date=? AND m.match_time=?)').join(' OR ');
    const params = candidates.flatMap(c => [c.date, c.time]);

    const matches = db.prepare(`
      SELECT m.id, m.match_date, m.match_time, m.notified_preview,
        ht.name as home_team, at.name as away_team,
        lg.name as league_name
      FROM matches m
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at ON m.away_team_id = at.id
      LEFT JOIN leagues lg ON m.league_id = lg.id
      WHERE m.status = 'scheduled'
        AND m.is_friendly = 0
        AND m.league_id IS NOT NULL
        AND m.notified_preview IS NULL
        AND (${placeholders})
    `).all(...params);

    for (const m of matches) {
      sendMatchPreview({
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        leagueName: m.league_name || 'Лига',
        matchDate: m.match_date,
        matchTime: m.match_time,
      });
      db.prepare(`UPDATE matches SET notified_preview=1 WHERE id=?`).run(m.id);
    }
  } catch(e) {
    console.warn('[Scheduler] checkUpcomingMatches error:', e.message);
  }
}

let _broadcastBusy = false;
async function broadcastLiveEvents() {
  if (_broadcastBusy) return;
  _broadcastBusy = true;
  try {
    const db = getDb();
    const now = Date.now();

    const liveMatches = db.prepare(`
      SELECT m.id, m.home_team_id, m.away_team_id,
             m.started_at, m.league_id, m.matchday, m.tg_kickoff_sent,
             ht.name as home_name, at.name as away_name,
             lg.name as league_name
      FROM matches m
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at ON m.away_team_id = at.id
      LEFT JOIN leagues lg ON m.league_id = lg.id
      WHERE m.status = 'in_progress'
        AND m.started_at IS NOT NULL
        AND (m.is_friendly IS NULL OR m.is_friendly = 0)
    `).all();

    for (const m of liveMatches) {
      const elapsedMs = now - new Date(m.started_at).getTime();
      if (elapsedMs < 0) continue;
      const elapsedSec = elapsedMs / 1000;

      // Send kickoff message once
      if (!m.tg_kickoff_sent) {
        await sendMatchKickoff({
          homeTeam: m.home_name, awayTeam: m.away_name,
          leagueName: m.league_name, matchday: m.matchday,
        }).catch(() => {});
        db.prepare(`UPDATE matches SET tg_kickoff_sent=1 WHERE id=?`).run(m.id);
      }

      // Fetch all goal events for this match to compute live score at each moment
      const allGoals = db.prepare(`
        SELECT minute, event_type, team_id FROM match_events
        WHERE match_id=? AND event_type IN ('goal','own_goal')
        ORDER BY minute ASC
      `).all(m.id);

      // Send events that have elapsed but haven't been notified yet — sequentially to preserve order
      const pendingEvents = db.prepare(`
        SELECT * FROM match_events
        WHERE match_id=? AND tg_notified=0 AND minute <= ?
        ORDER BY minute ASC
      `).all(m.id, Math.floor(elapsedSec));

      for (const ev of pendingEvents) {
        // Compute live score at the moment of this event
        let liveHome = 0, liveAway = 0;
        for (const g of allGoals) {
          if (g.minute > ev.minute) break;
          if (g.event_type === 'goal') {
            if (g.team_id === m.home_team_id) liveHome++; else liveAway++;
          } else { // own_goal: scored against own team
            if (g.team_id === m.home_team_id) liveAway++; else liveHome++;
          }
        }

        await sendLiveEvent({
          event: ev,
          homeTeam: m.home_name, awayTeam: m.away_name,
          homeScore: liveHome, awayScore: liveAway,
          leagueName: m.league_name,
        }).catch(() => {});
        db.prepare(`UPDATE match_events SET tg_notified=1 WHERE id=?`).run(ev.id);
      }
    }
  } catch(e) {
    console.warn('[Scheduler] broadcastLiveEvents error:', e.message);
  } finally {
    _broadcastBusy = false;
  }
}

function checkAndSendMatchdayStandings(db, leagueId, matchday) {
  try {
    // Check if all matches of this matchday are finished
    const pending = db.prepare(`
      SELECT COUNT(*) as cnt FROM matches
      WHERE league_id=? AND matchday=? AND status NOT IN ('finished')
    `).get(leagueId, matchday);
    if (pending.cnt > 0) return;

    // Check we haven't already sent standings for this matchday
    const league = db.prepare(`SELECT * FROM leagues WHERE id=?`).get(leagueId);
    if (!league || (league.last_tg_standings_matchday || 0) >= matchday) return;

    // Mark as sent
    db.prepare(`UPDATE leagues SET last_tg_standings_matchday=? WHERE id=?`).run(matchday, leagueId);

    // Fetch standings with form
    const standings = db.prepare(`
      SELECT ls.*, t.name AS team_name, t.logo_url,
             ls.goals_for - ls.goals_against AS goal_diff
      FROM league_standings ls
      JOIN teams t ON ls.team_id = t.id
      WHERE ls.league_id = ?
      ORDER BY ls.points DESC, (ls.goals_for - ls.goals_against) DESC, ls.goals_for DESC
    `).all(leagueId);

    const standingsWithForm = standings.map(row => {
      const matches = db.prepare(`
        SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
        FROM league_schedule ls2
        JOIN matches m ON ls2.match_id = m.id
        WHERE ls2.league_id=? AND (ls2.home_team_id=? OR ls2.away_team_id=?)
          AND m.status='finished'
        ORDER BY ls2.matchday DESC LIMIT 5
      `).all(leagueId, row.team_id, row.team_id);
      const form = matches.reverse().map(m => {
        const isHome = m.home_team_id === row.team_id;
        const scored = isHome ? m.home_score : m.away_score;
        const conceded = isHome ? m.away_score : m.home_score;
        return scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';
      });
      return { ...row, form };
    });

    const base = `http://localhost:${process.env.PORT || 3000}`;
    const toUrl = u => u ? (u.startsWith('http') ? u : base + u) : null;

    sendStandingsBanner({
      leagueName: league.name,
      leagueLogoUrl: toUrl(league.logo_url),
      matchday,
      standings: standingsWithForm,
    }).catch(() => {});
  } catch(e) {
    console.warn('[Scheduler] checkAndSendMatchdayStandings error:', e.message);
  }
}

function finalizeExpiredMatches() {
  try {
    const db = getDb();
    const expired = db.prepare(`
      SELECT m.id, m.home_score, m.away_score, m.home_team_id, m.away_team_id,
             m.league_id, m.matchday, m.is_friendly, m.tournament_id
      FROM matches m
      WHERE m.status = 'in_progress'
        AND m.started_at IS NOT NULL
        AND (julianday('now') - julianday(m.started_at)) * 86400 >= 90
    `).all();

    for (const m of expired) {
      const r = db.prepare(`UPDATE matches SET status='finished' WHERE id=? AND status='in_progress'`).run(m.id);
      if (r.changes === 0) continue;

      const ht = db.prepare(`SELECT name, logo_url, stadium_url FROM teams WHERE id=?`).get(m.home_team_id);
      const at = db.prepare(`SELECT name, logo_url FROM teams WHERE id=?`).get(m.away_team_id);
      const evRows = db.prepare(`SELECT * FROM match_events WHERE match_id=?`).all(m.id);

      if (!m.is_friendly) generateMatchNews(m.id, ht.name, at.name, m.home_score, m.away_score, evRows);

      if (m.tournament_id) {
        try { advanceTournamentWinner(m, m.home_score, m.away_score); } catch(e) { console.warn('[Finalizer] tournament advance error:', e.message); }
      }

      // After finalizing a league match, check if the entire matchday is done
      if (m.league_id && m.matchday) {
        checkAndSendMatchdayStandings(db, m.league_id, m.matchday);
      }
    }
  } catch(e) {
    console.warn('[Scheduler] finalizeExpiredMatches error:', e.message);
  }
}

// Simulate a single league_schedule slot — called by cron when its time arrives
function simulateSingleLeagueMatch(db, league, srow) {
  const lineupRows = db.prepare(`
    SELECT tl.slot, tl.player_id, tl.position_override,
           p.id, p.name, p.position, p.market_value, p.status
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ?
    ORDER BY tl.slot ASC
  `);

  const homeLineup = lineupRows.all(srow.home_team_id);
  const awayLineup = lineupRows.all(srow.away_team_id);

  const homeStarters = homeLineup.filter(p => p.slot >= 1 && p.slot <= 11)
    .map(p => ({ ...p, position: p.position_override || p.position }));
  const homeReserves = homeLineup.filter(p => p.slot >= 12)
    .map(p => ({ ...p, position: p.position_override || p.position }));
  const awayStarters = awayLineup.filter(p => p.slot >= 1 && p.slot <= 11)
    .map(p => ({ ...p, position: p.position_override || p.position }));
  const awayReserves = awayLineup.filter(p => p.slot >= 12)
    .map(p => ({ ...p, position: p.position_override || p.position }));

  let homePlayers, awayPlayers, useLineup = false;
  if (homeStarters.length >= 7 && awayStarters.length >= 7) {
    useLineup = true;
  } else {
    homePlayers = db.prepare(`SELECT p.* FROM players p WHERE p.team_id=? AND p.status='active' AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)`).all(srow.home_team_id);
    awayPlayers = db.prepare(`SELECT p.* FROM players p WHERE p.team_id=? AND p.status='active' AND NOT EXISTS (SELECT 1 FROM player_injuries i WHERE i.player_id=p.id AND i.matches_remaining>0)`).all(srow.away_team_id);
  }

  const allPlayerIds = useLineup
    ? [...homeStarters, ...homeReserves, ...awayStarters, ...awayReserves].map(p => p.player_id)
    : [...(homePlayers||[]), ...(awayPlayers||[])].map(p => p.id);
  const skillsMap = {};
  if (allPlayerIds.length) {
    const placeholders = allPlayerIds.map(() => '?').join(',');
    const skillRows = db.prepare(`SELECT * FROM player_skills WHERE player_id IN (${placeholders})`).all(...allPlayerIds);
    for (const sk of skillRows) skillsMap[sk.player_id] = sk;
  }

  const result = useLineup
    ? simulateMatchWithLineup(srow.home_team_id, srow.away_team_id, homeStarters, homeReserves, awayStarters, awayReserves, skillsMap)
    : simulateMatch(srow.home_team_id, srow.away_team_id, homePlayers, awayPlayers);

  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const matchTimeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const today = now.toISOString().slice(0, 10);

  const matchR = db.prepare(`
    INSERT INTO matches (home_team_id, away_team_id, match_date, match_time, status, league_id, matchday, started_at, home_score, away_score)
    VALUES (?,?,?,?,'in_progress',?,?,?,?,?)
  `).run(srow.home_team_id, srow.away_team_id, today, matchTimeStr, league.id, srow.matchday,
         now.toISOString(), result.homeScore, result.awayScore);
  const matchId = matchR.lastInsertRowid;

  applyMatchResults(matchId, srow.home_team_id, srow.away_team_id, result);
  db.prepare('UPDATE league_schedule SET match_id=? WHERE id=?').run(matchId, srow.id);

  const { homeScore, awayScore } = result;
  const homeWon = homeScore > awayScore, draw = homeScore === awayScore;
  db.prepare(`UPDATE league_standings SET played=played+1, won=won+?, drawn=drawn+?, lost=lost+?, goals_for=goals_for+?, goals_against=goals_against+?, points=points+? WHERE league_id=? AND team_id=?`)
    .run(homeWon?1:0, draw?1:0, (!homeWon&&!draw)?1:0, homeScore, awayScore, homeWon?3:draw?1:0, league.id, srow.home_team_id);
  db.prepare(`UPDATE league_standings SET played=played+1, won=won+?, drawn=drawn+?, lost=lost+?, goals_for=goals_for+?, goals_against=goals_against+?, points=points+? WHERE league_id=? AND team_id=?`)
    .run((!homeWon&&!draw)?1:0, draw?1:0, homeWon?1:0, awayScore, homeScore, (!homeWon&&!draw)?3:draw?1:0, league.id, srow.away_team_id);

  db.prepare('UPDATE leagues SET current_matchday=? WHERE id=? AND current_matchday < ?').run(srow.matchday, league.id, srow.matchday);

  const remaining = db.prepare(`SELECT COUNT(*) as cnt FROM league_schedule WHERE league_id=? AND match_id IS NULL`).get(league.id);
  if (remaining.cnt === 0) {
    const windowEnd = new Date(); windowEnd.setDate(windowEnd.getDate() + 7);
    db.prepare(`UPDATE leagues SET status='transfer_window', transfer_window_end=? WHERE id=?`).run(windowEnd.toISOString().slice(0,10), league.id);
    console.log(`[Scheduler] League ${league.id}: all matchdays done, entering transfer window`);
  }

  console.log(`[Scheduler] League ${league.id} MD${srow.matchday}: ${srow.home_name} ${homeScore}-${awayScore} ${srow.away_name} (started_at=${now.toISOString()})`);
}

function checkAndRunLeagueMatchdays() {
  try {
    const db = getDb();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const pad2 = n => String(n).padStart(2, '0');
    const currentTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

    // Find individual schedule slots whose scheduled_time has arrived
    const dueSlots = db.prepare(`
      SELECT ls.id, ls.matchday, ls.home_team_id, ls.away_team_id,
             ht.name AS home_name, at.name AS away_name,
             l.id AS league_id, l.name AS league_name,
             l.match_start_time, l.match_interval_minutes
      FROM league_schedule ls
      JOIN leagues l ON ls.league_id = l.id
      JOIN teams ht ON ls.home_team_id = ht.id
      JOIN teams at ON ls.away_team_id = at.id
      WHERE l.status = 'active'
        AND ls.scheduled_date <= ?
        AND ls.match_id IS NULL
        AND (ls.scheduled_time IS NOT NULL AND ls.scheduled_time <= ?)
      ORDER BY ls.league_id, ls.matchday, ls.id
    `).all(today, currentTime);

    for (const srow of dueSlots) {
      try {
        const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(srow.league_id);
        simulateSingleLeagueMatch(db, league, srow);
      } catch(e) {
        console.warn(`[Scheduler] simulateSingleLeagueMatch ls.id=${srow.id} error:`, e.message);
      }
    }
  } catch(e) {
    console.warn('[Scheduler] checkAndRunLeagueMatchdays error:', e.message);
  }
}

let _finalizeBusy = false;
function finalizeExpiredMatchesSafe() {
  if (_finalizeBusy) return;
  _finalizeBusy = true;
  try { finalizeExpiredMatches(); } finally { _finalizeBusy = false; }
}

function startScheduler() {
  // Every 15 minutes – generate player/team news
  cron.schedule('*/15 * * * *', () => {
    try { generateRandomPlayerNews(); } catch(e) { console.warn('[Scheduler] Auto-news error:', e.message); }
  });

  // Every minute – league matchday auto-sim + previews
  cron.schedule('* * * * *', () => {
    checkAndRunLeagueMatchdays();
    checkUpcomingMatches();
  });

  // Every 5 seconds – live broadcast and match finalization
  setInterval(() => {
    broadcastLiveEvents().catch(e => console.warn('[Scheduler] broadcastLiveEvents error:', e.message));
    finalizeExpiredMatchesSafe();
  }, 5000);

  console.log('[Scheduler] Started: news/15min, league-sim/1min, live-broadcast/5s.');
}

module.exports = { startScheduler, simulateScheduledMatches, applyMatchResults, generateMatchNews, simulateLeagueMatchday };
