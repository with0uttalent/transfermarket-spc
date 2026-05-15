'use strict';

const ATTACK_POSITIONS = new Set(['Centre-Forward','Striker','Left Winger','Right Winger','Attacking Midfield']);
const MID_POSITIONS    = new Set(['Central Midfield','Defensive Midfield']);
const DEF_POSITIONS    = new Set(['Centre-Back','Left-Back','Right-Back']);
const GK_POSITIONS     = new Set(['Goalkeeper']);

function playerBase(mv) {
  return Math.log10(Math.max(mv || 500000, 100000));
}

function teamStrength(players) {
  let atk = 0, mid = 0, def = 0, gk = 0;
  let na = 0, nm = 0, nd = 0, ng = 0;
  for (const p of players) {
    const b = playerBase(p.market_value);
    const pos = p.position || '';
    if (ATTACK_POSITIONS.has(pos)) { atk += b; na++; }
    else if (MID_POSITIONS.has(pos)) { mid += b; nm++; }
    else if (DEF_POSITIONS.has(pos)) { def += b; nd++; }
    else if (GK_POSITIONS.has(pos)) { gk += b; ng++; }
    else { mid += b; nm++; }
  }
  const n = players.length || 1;
  const avg = (atk + mid + def + gk) / n;
  const A = na > 0 ? atk / na : avg;
  const M = nm > 0 ? mid / nm : avg;
  const D = nd > 0 ? def / nd : avg;
  const G = ng > 0 ? gk  / ng : avg;
  return { attack: A * 0.55 + M * 0.30 + D * 0.10 + G * 0.05, defense: D * 0.45 + G * 0.30 + M * 0.20 + A * 0.05, midfield: M };
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand() { return Math.random(); }
function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// ─── Commentary ───────────────────────────────────────────────
const COMMENTARY = {
  goal: [
    '— What a finish! The stadium erupts!',
    '— He absolutely rifles it into the top corner! Unstoppable!',
    '— Cool as you like, he slots it home! Clinical!',
    '— The net is bulging! The keeper had absolutely no chance!',
    '— Brilliant! A moment of pure class from a quality player!',
    '— He makes it look so easy! What a talent!',
    '— Right in the top corner! That is world class!',
    '— Sensational strike! The crowd goes absolutely wild!',
    '— He pounces on the chance and buries it! Lethal!',
    '— A wonderful goal! The fans are on their feet!',
  ],
  own_goal: [
    '— Oh no! A nightmare moment for the defender!',
    '— A cruel deflection wrong-foots the goalkeeper! Disaster!',
    '— He will want to forget that in a hurry!',
  ],
  yellow_card: [
    '— The referee reaches into his pocket. That was always going to be a booking.',
    '— Reckless challenge! He is lucky it was only a yellow card!',
    '— A completely unnecessary foul. No complaints from the player.',
    '— He has been warned now. One more and he walks!',
    '— The referee is not in the mood for cynical play today.',
  ],
  red_card: [
    '— OFF HE GOES! His team is reduced to ten men!',
    '— The referee did not hesitate! That tackle was absolutely dangerous!',
    '— A straight red card! No arguments — that was reckless!',
    '— He has let his team down badly. The manager will be furious!',
    '— Ten men now. A huge moment in this match!',
  ],
  substitution: [
    '— Fresh legs coming on. The manager wants to change the dynamic.',
    '— A tactical switch from the dugout. Can the substitute make an impact?',
    '— The manager is not happy with what he is seeing and makes a change.',
    '— Energy injection from the bench as the game enters its final stages.',
  ],
  injury: [
    '— A player is down! The physios are rushing onto the pitch!',
    '— There is a stoppage in play — he needs treatment on the field!',
    '— That looks painful! He is signalling to the bench for help!',
    '— Play is stopped. The medical team are assessing the situation.',
  ],
};

function generateMatchFullStats(homeStr, awayStr, homeScore, awayScore) {
  const hMid = homeStr.midfield || 6;
  const aMid = awayStr.midfield || 6;
  const rawPoss = Math.round(100 * hMid / (hMid + aMid));
  const homePoss = Math.min(68, Math.max(32, rawPoss));
  const homeShots = Math.max(homeScore + 2, homeScore * ri(3, 5) + ri(3, 7));
  const awayShots = Math.max(awayScore + 2, awayScore * ri(3, 5) + ri(3, 7));
  return {
    possession_home: homePoss, possession_away: 100 - homePoss,
    shots_home: homeShots, shots_away: awayShots,
    shots_on_target_home: Math.min(homeShots, homeScore + ri(1, 4)),
    shots_on_target_away: Math.min(awayShots, awayScore + ri(1, 4)),
    corners_home: ri(2, 9), corners_away: ri(2, 9),
    fouls_home: ri(8, 18), fouls_away: ri(8, 18),
    offsides_home: ri(0, 5), offsides_away: ri(0, 5),
  };
}

function simulateMatch(homeTeamId, awayTeamId, homePlayers, awayPlayers) {
  const homeStr = homePlayers.length ? teamStrength(homePlayers) : { attack: 6, defense: 6, midfield: 6 };
  const awayStr = awayPlayers.length ? teamStrength(awayPlayers) : { attack: 6, defense: 6, midfield: 6 };

  const events = [];
  let homeScore = 0, awayScore = 0;
  let homeRed = 0, awayRed = 0;

  const homeField = [...homePlayers];
  const awayField = [...awayPlayers];
  const injuredPlayers = []; // player IDs injured during this match

  const stats = {};
  const track = (pid) => { if (!pid) return; if (!stats[pid]) stats[pid] = { goals:0, assists:0, yellow_cards:0, red_cards:0, rating:6.0, injured:false }; };
  const yellows = {};

  function addEvent(minute, type, teamId, playerId, player2Id, desc) {
    events.push({ minute, event_type:type, team_id:teamId, player_id:playerId||null, player2_id:player2Id||null, description:desc });
  }

  function tryGoal(minute, isHome) {
    const attackers = isHome ? homeField : awayField;
    const teamId    = isHome ? homeTeamId : awayTeamId;
    if (!attackers.length) return;
    const fwd = attackers.filter(p => ATTACK_POSITIONS.has(p.position || ''));
    const scorer = fwd.length ? pick(fwd) : pick(attackers);
    const mids = attackers.filter(p => p.id !== scorer.id && (MID_POSITIONS.has(p.position||'') || ATTACK_POSITIONS.has(p.position||'')));
    const assister = mids.length ? (rand() < 0.7 ? pick(mids) : null) : null;
    const isOwnGoal = rand() < 0.04;
    const defenders = isHome ? awayField : homeField;
    const defTeam   = isHome ? awayTeamId : homeTeamId;
    const commentary = pick(COMMENTARY.goal);
    if (isOwnGoal && defenders.length) {
      const og = pick(defenders);
      track(og.id); stats[og.id].rating -= 1.8;
      isHome ? homeScore++ : awayScore++;
      addEvent(minute, 'own_goal', defTeam, og.id, null, `⚽ OWN GOAL! ${og.name} puts it into his own net! ${pick(COMMENTARY.own_goal)}`);
      return;
    }
    track(scorer.id); stats[scorer.id].goals++; stats[scorer.id].rating += 1.5;
    if (assister) { track(assister.id); stats[assister.id].assists++; stats[assister.id].rating += 0.8; }
    isHome ? homeScore++ : awayScore++;
    const assistStr = assister ? ` (Assist: ${assister.name})` : '';
    addEvent(minute, 'goal', teamId, scorer.id, assister?.id||null,
      `⚽ GOAL! ${scorer.name} scores for ${isHome?'home':'away'} team!${assistStr} ${commentary}`);
  }

  function tryCard(minute, isHome) {
    const field  = isHome ? homeField : awayField;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (!field.length) return;
    const defs = field.filter(p => DEF_POSITIONS.has(p.position||'') || MID_POSITIONS.has(p.position||''));
    const player = defs.length ? pick(defs) : pick(field);
    track(player.id);
    yellows[player.id] = (yellows[player.id] || 0) + 1;
    if (yellows[player.id] >= 2) {
      stats[player.id].red_cards++; stats[player.id].rating -= 2.5;
      addEvent(minute, 'red_card', teamId, player.id, null,
        `🟥 RED CARD! ${player.name} receives a second yellow! ${pick(COMMENTARY.red_card)}`);
      removePlayer(player, isHome);
      isHome ? homeRed++ : awayRed++;
      delete yellows[player.id];
    } else {
      stats[player.id].yellow_cards++; stats[player.id].rating -= 0.4;
      addEvent(minute, 'yellow_card', teamId, player.id, null,
        `🟨 Yellow card for ${player.name}. ${pick(COMMENTARY.yellow_card)}`);
    }
  }

  function tryDirectRed(minute, isHome) {
    const field  = isHome ? homeField : awayField;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (field.length <= 8) return;
    const player = pick(field);
    track(player.id); stats[player.id].red_cards++; stats[player.id].rating -= 3;
    addEvent(minute, 'red_card', teamId, player.id, null,
      `🟥 RED CARD! ${player.name} is sent off for dangerous play! ${pick(COMMENTARY.red_card)}`);
    removePlayer(player, isHome);
    isHome ? homeRed++ : awayRed++;
  }

  function tryInjury(minute, isHome) {
    const field  = isHome ? homeField : awayField;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (field.length <= 7) return;
    const player = pick(field);
    track(player.id); stats[player.id].injured = true; stats[player.id].rating -= 1.5;
    const injTypes = ['muscle strain','hamstring injury','ankle sprain','knock','calf problem'];
    addEvent(minute, 'injury', teamId, player.id, null,
      `🚑 ${player.name} is down injured with a ${pick(injTypes)}! ${pick(COMMENTARY.injury)}`);
    injuredPlayers.push(player.id);
    removePlayer(player, isHome);
  }

  function removePlayer(player, isHome) {
    const arr = isHome ? homeField : awayField;
    const idx = arr.findIndex(p => p.id === player.id);
    if (idx !== -1) arr.splice(idx, 1);
  }

  const subsDone = { home:0, away:0 };

  for (let m = 1; m <= 90; m++) {
    const hAtkEff = homeStr.attack  * Math.pow(0.88, homeRed) * 1.08;
    const hDefEff = homeStr.defense * Math.pow(0.85, homeRed);
    const aAtkEff = awayStr.attack  * Math.pow(0.88, awayRed);
    const aDefEff = awayStr.defense * Math.pow(0.85, awayRed);
    const RATE = 0.0115;
    if (rand() < RATE * (hAtkEff / (aDefEff + 4.5))) tryGoal(m, true);
    if (rand() < RATE * (aAtkEff / (hDefEff + 4.5))) tryGoal(m, false);
    if (rand() < 0.022) tryCard(m, rand() < 0.5);
    if (rand() < 0.0008) tryDirectRed(m, rand() < 0.5);
    // Injury: ~1.2 per match on average
    if (m % 15 === 0 && rand() < 0.20) tryInjury(m, rand() < 0.5);
    if (m >= 55 && m <= 82) {
      if (subsDone.home < 3 && rand() < 0.045 && homeField.length > 8) {
        const off = pick(homeField);
        const bench = homePlayers.filter(p => !homeField.find(f => f.id === p.id));
        if (bench.length) {
          const on = pick(bench);
          addEvent(m, 'substitution', homeTeamId, on.id, off.id,
            `🔄 Substitution: ${on.name} replaces ${off.name}. ${pick(COMMENTARY.substitution)}`);
          removePlayer(off, true); homeField.push(on); subsDone.home++;
        }
      }
      if (subsDone.away < 3 && rand() < 0.045 && awayField.length > 8) {
        const off = pick(awayField);
        const bench = awayPlayers.filter(p => !awayField.find(f => f.id === p.id));
        if (bench.length) {
          const on = pick(bench);
          addEvent(m, 'substitution', awayTeamId, on.id, off.id,
            `🔄 Substitution: ${on.name} replaces ${off.name}. ${pick(COMMENTARY.substitution)}`);
          removePlayer(off, false); awayField.push(on); subsDone.away++;
        }
      }
    }
  }

  events.sort((a, b) => a.minute - b.minute);

  for (const p of [...homePlayers, ...awayPlayers]) {
    if (!stats[p.id]) stats[p.id] = { goals:0, assists:0, yellow_cards:0, red_cards:0, rating:6.0, injured:false };
  }
  const homeWon = homeScore > awayScore, draw = homeScore === awayScore;
  for (const p of homePlayers) {
    if (GK_POSITIONS.has(p.position||'')) {
      stats[p.id].rating += homeWon ? 1.0 : draw ? 0.2 : (awayScore > 3 ? -2 : -0.8);
    }
    if (!stats[p.id].injured) stats[p.id].rating += homeWon ? 0.2 : draw ? 0 : -0.2;
  }
  for (const p of awayPlayers) {
    if (GK_POSITIONS.has(p.position||'')) {
      stats[p.id].rating += !homeWon&&!draw ? 1.0 : draw ? 0.2 : (homeScore > 3 ? -2 : -0.8);
    }
    if (!stats[p.id].injured) stats[p.id].rating += !homeWon&&!draw ? 0.2 : draw ? 0 : -0.2;
  }
  for (const s of Object.values(stats)) s.rating = Math.min(10, Math.max(3, s.rating));

  // ── Market value deltas (much more dynamic) ──────────────────
  const mvDeltas = {};
  for (const [pid, s] of Object.entries(stats)) {
    let delta = 0;
    delta += s.goals   * ri(35, 55) / 10;    // +3.5–5.5% per goal
    delta += s.assists * ri(15, 25) / 10;    // +1.5–2.5% per assist
    delta -= s.yellow_cards * ri(5, 10) / 10; // -0.5–1%
    delta -= s.red_cards    * ri(50, 80) / 10; // -5–8%
    if (s.goals >= 3) delta += ri(80, 120) / 10; // hat-trick +8–12%
    if (s.goals === 2) delta += ri(25, 40) / 10;  // brace +2.5–4%
    if (s.rating >= 9) delta += ri(30, 50) / 10;  // MOTM +3–5%
    else if (s.rating >= 8) delta += ri(15, 25) / 10;
    else if (s.rating < 5)  delta -= ri(15, 25) / 10; // poor game
    if (s.injured) delta -= ri(40, 70) / 10;  // injury -4–7%
    // Random volatility ±1%
    delta += (Math.random() - 0.5) * 2;
    mvDeltas[pid] = delta;
  }

  // ── Skill deltas ──────────────────────────────────────────────
  const skillDeltas = {};
  for (const [pid, s] of Object.entries(stats)) {
    const d = { pace:0, shooting:0, passing:0, defending:0, physical:0 };
    if (s.goals >= 1) { d.shooting += ri(1, 3); d.pace += ri(0, 1); }
    if (s.assists >= 1) { d.passing += ri(1, 2); }
    if (s.rating >= 8.5) { const k = ['pace','shooting','passing','defending','physical']; d[pick(k)] += ri(1,2); d[pick(k)] += 1; }
    else if (s.rating < 5) { const k = ['pace','shooting','passing','defending','physical']; d[pick(k)] -= 1; }
    if (s.red_cards >= 1) d.physical -= 2;
    if (s.yellow_cards >= 1) d.physical -= 1;
    if (s.injured) { d.pace -= ri(1,2); d.physical -= ri(1,2); }
    skillDeltas[pid] = d;
  }

  const matchStats = generateMatchFullStats(homeStr, awayStr, homeScore, awayScore);
  return { homeScore, awayScore, events, playerStats: stats, mvDeltas, matchStats, injuredPlayers, skillDeltas };
}

function generateBracketRound1(teamIds) {
  let size = 1;
  while (size < teamIds.length) size *= 2;
  const padded = [...teamIds];
  while (padded.length < size) padded.push(null);
  function order(n) { if (n === 1) return [0]; const prev = order(n/2); const r=[]; for (const i of prev) r.push(i, n-1-i); return r; }
  const positions = order(size).map(i => padded[i]);
  const matches = [];
  for (let i = 0; i < positions.length; i += 2) matches.push({ homeTeamId:positions[i], awayTeamId:positions[i+1] });
  return matches;
}

function roundName(totalRounds, roundIndex) {
  const r = totalRounds - roundIndex;
  if (r === 0) return 'Final';
  if (r === 1) return 'Semi-Finals';
  if (r === 2) return 'Quarter-Finals';
  if (r === 3) return 'Round of 16';
  if (r === 4) return 'Round of 32';
  return `Round ${roundIndex + 1}`;
}

module.exports = { simulateMatch, generateBracketRound1, roundName, generateMatchFullStats };
