'use strict';

const {
  commentaryGoal, commentaryYellow, commentaryRed,
  commentaryInjury, commentarySub, commentaryOwnGoal, commentaryDangerousPlay,
  commentaryPenaltyMiss, commentaryBigSave, commentaryNearMiss,
} = require('./commentaryEngine');

const PASS_ACTIONS = [
  '{from} отдаёт точный пас на {to}',
  '{from} накрывает {to} диагональю в разрез',
  '{from} переводит мяч на {to}',
  '{from} выкатывает на {to} после финта',
  '{from} первым касанием отыгрывает {to}',
  '{from} делает передачу пяткой на {to}',
];
const DRIBBLE_ACTIONS = [
  '{player} уходит от опекуна финтом',
  '{player} прошивает через двух защитников',
  '{player} ускоряется и уходит от прессинга',
  '{player} элегантно обрабатывает мяч',
  '{player} на скорости врывается в штрафную',
];

const ATTACK_POSITIONS = new Set(['Centre-Forward','Striker','Left Winger','Right Winger','Attacking Midfield']);
const MID_POSITIONS    = new Set(['Central Midfield','Defensive Midfield']);
const DEF_POSITIONS    = new Set(['Centre-Back','Left-Back','Right-Back']);
const GK_POSITIONS     = new Set(['Goalkeeper']);

// ─── Market-value based strength ─────────────────────────────────────────────
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
  return {
    attack:   A * 0.55 + M * 0.30 + D * 0.10 + G * 0.05,
    defense:  D * 0.45 + G * 0.30 + M * 0.20 + A * 0.05,
    midfield: M,
  };
}

// ─── Skill-based strength ─────────────────────────────────────────────────────
// players: array of player objects (with .id and .position)
// skillsMap: { player_id: { pace, shooting, passing, defending, physical } }
// Returns {attack, defense, midfield} in 0-1 normalized range
function teamStrengthFromSkills(players, skillsMap) {
  let atkSum = 0, midSum = 0, defSum = 0, gkSum = 0;
  let na = 0, nm = 0, nd = 0, ng = 0;

  for (const p of players) {
    const sk = skillsMap[p.id] || { pace:60, shooting:60, passing:60, defending:60, physical:60 };
    // Normalize skills to 0-1
    const pace = sk.pace / 100;
    const shooting = sk.shooting / 100;
    const passing = sk.passing / 100;
    const defending = sk.defending / 100;
    const physical = sk.physical / 100;

    const pos = p.position || '';
    if (ATTACK_POSITIONS.has(pos)) {
      atkSum += shooting * 0.4 + pace * 0.3 + passing * 0.15 + physical * 0.15;
      na++;
    } else if (MID_POSITIONS.has(pos)) {
      midSum += passing * 0.35 + defending * 0.25 + shooting * 0.2 + physical * 0.2;
      nm++;
    } else if (DEF_POSITIONS.has(pos)) {
      defSum += defending * 0.5 + physical * 0.25 + pace * 0.15 + passing * 0.1;
      nd++;
    } else if (GK_POSITIONS.has(pos)) {
      gkSum += defending * 0.55 + physical * 0.3 + passing * 0.15;
      ng++;
    } else {
      // Default to mid
      midSum += passing * 0.35 + defending * 0.25 + shooting * 0.2 + physical * 0.2;
      nm++;
    }
  }

  const total = (na + nm + nd + ng) || 1;
  const avgVal = (atkSum + midSum + defSum + gkSum) / total;

  const A = na > 0 ? atkSum / na : avgVal;
  const M = nm > 0 ? midSum / nm : avgVal;
  const D = nd > 0 ? defSum / nd : avgVal;
  const G = ng > 0 ? gkSum  / ng : avgVal;

  return {
    attack:   A * 0.55 + M * 0.30 + D * 0.10 + G * 0.05,
    defense:  D * 0.45 + G * 0.30 + M * 0.20 + A * 0.05,
    midfield: M,
  };
}

// ─── Zone-aware strength (uses lineup zone assignments + market value) ─────────
function teamStrengthWithZones(players, zoneMap) {
  if (!players.length) return { attack: 6, defense: 6, midfield: 6 };

  const b = p => Math.log10(Math.max(p.market_value || 500000, 100000));
  const groups = { GK:[], DEF:[], DMF:[], MID:[], AMF:[], FWD:[] };
  for (const p of players) {
    const z = zoneMap[p.id] || 'MID';
    (groups[z] = groups[z] || []).push(p);
  }

  const avgOf = arr => arr.length ? arr.reduce((s, p) => s + b(p), 0) / arr.length : null;
  const overall = players.reduce((s, p) => s + b(p), 0) / players.length;

  const G  = avgOf(groups.GK)  ?? overall * 0.70;
  const D  = avgOf(groups.DEF) ?? overall * 0.65;
  const DM = avgOf(groups.DMF) ?? overall * 0.85;
  const M  = avgOf(groups.MID) ?? overall;
  const AM = avgOf(groups.AMF) ?? overall * 0.85;
  const F  = avgOf(groups.FWD) ?? overall * 0.65;

  // Penalties for missing key zones
  const hasGK  = groups.GK.length  > 0 ? 1.0 : 0.60;
  const hasDef = (groups.DEF.length + groups.DMF.length) >= 2 ? 1.0
               : (groups.DEF.length + groups.DMF.length) === 1 ? 0.80 : 0.55;
  const hasFwd = (groups.FWD.length + groups.AMF.length) > 0 ? 1.0 : 0.50;
  const hasMid = (groups.MID.length + groups.DMF.length + groups.AMF.length) >= 2 ? 1.0 : 0.80;

  return {
    attack:   (F*0.45 + AM*0.30 + M*0.15 + DM*0.05 + D*0.03 + G*0.02) * hasFwd * hasMid,
    defense:  (G*0.30 + D*0.40 + DM*0.20 + M*0.10) * hasGK * hasDef,
    midfield: DM*0.30 + M*0.40 + AM*0.30,
  };
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand() { return Math.random(); }
function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// ─── Match simulation core ────────────────────────────────────────────────────
// useSkillRate: if true uses RATE=0.016 offset=0.5, else RATE=0.0115 offset=4.5
function simulateMatchCore(
  homeTeamId, awayTeamId,
  homeField, awayField,
  homeStr, awayStr,
  allHomePlayers, allAwayPlayers,
  useSkillRate = false
) {
  const events = [];
  let homeScore = 0, awayScore = 0;
  let homeRed = 0, awayRed = 0;

  const activeHome = [...homeField];
  const activeAway = [...awayField];
  const injuredPlayers = [];

  const stats = {};
  const track = (pid) => {
    if (!pid) return;
    if (!stats[pid]) stats[pid] = { goals:0, assists:0, yellow_cards:0, red_cards:0, rating:6.0, injured:false };
  };
  const yellows = {};

  function addEvent(minute, type, teamId, playerId, player2Id, desc) {
    events.push({ minute, event_type:type, team_id:teamId, player_id:playerId||null, player2_id:player2Id||null, description:desc });
  }

  function addBuildupSequence(minute, attackers, teamId, excludeId, maxCount=3) {
    const passers = attackers.filter(p => p.id !== excludeId);
    const buildCount = ri(1, maxCount);
    const buildMinStart = Math.max(1, minute - buildCount);
    for (let b = 0; b < buildCount; b++) {
      const bMin = buildMinStart + b;
      if (bMin >= minute) break;
      if (rand() < 0.5 && passers.length >= 2) {
        const from = pick(passers);
        const to = pick(passers.filter(p => p.id !== from.id));
        const tmpl = pick(PASS_ACTIONS);
        addEvent(bMin, 'buildup', teamId, from.id, to.id,
          `🔵 ${tmpl.replace('{from}', from.name).replace('{to}', to.name)}`);
      } else if (passers.length) {
        const player = pick(passers);
        const tmpl = pick(DRIBBLE_ACTIONS);
        addEvent(bMin, 'buildup', player.team_id || teamId, player.id, null,
          `🟡 ${tmpl.replace('{player}', player.name)}`);
      }
    }
  }

  function tryGoal(minute, isHome) {
    const attackers = isHome ? activeHome : activeAway;
    const teamId    = isHome ? homeTeamId : awayTeamId;
    if (!attackers.length) return;
    const fwd = attackers.filter(p => ATTACK_POSITIONS.has(p.position || ''));
    const scorer = fwd.length ? pick(fwd) : pick(attackers);
    const mids = attackers.filter(p => p.id !== scorer.id && (MID_POSITIONS.has(p.position||'') || ATTACK_POSITIONS.has(p.position||'')));
    const assister = mids.length ? (rand() < 0.7 ? pick(mids) : null) : null;
    const isOwnGoal = rand() < 0.04;
    const defenders = isHome ? activeAway : activeHome;
    const defTeam   = isHome ? awayTeamId : homeTeamId;

    if (isOwnGoal && defenders.length) {
      const og = pick(defenders);
      track(og.id); stats[og.id].rating -= 1.8;
      isHome ? homeScore++ : awayScore++;
      const desc = `⚽ АВТОГОЛ! ${og.name} забивает в свои ворота! ${commentaryOwnGoal(og.name)}`;
      addEvent(minute, 'own_goal', defTeam, og.id, null, desc);
      return;
    }

    addBuildupSequence(minute, attackers, teamId, scorer.id);

    track(scorer.id); stats[scorer.id].goals++; stats[scorer.id].rating += 1.5;
    if (assister) { track(assister.id); stats[assister.id].assists++; stats[assister.id].rating += 0.8; }
    isHome ? homeScore++ : awayScore++;
    const assistStr = assister ? ` (Ассист: ${assister.name})` : '';
    const goalComm = commentaryGoal(scorer.name, assister ? assister.name : null);
    addEvent(minute, 'goal', teamId, scorer.id, assister?.id||null,
      `⚽ ГОЛ! ${scorer.name} забивает!${assistStr} ${goalComm}`);
  }

  function removePlayer(player, isHome) {
    const arr = isHome ? activeHome : activeAway;
    const idx = arr.findIndex(p => p.id === player.id);
    if (idx !== -1) arr.splice(idx, 1);
  }

  function tryCard(minute, isHome) {
    const field  = isHome ? activeHome : activeAway;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (!field.length) return;
    const defs = field.filter(p => DEF_POSITIONS.has(p.position||'') || MID_POSITIONS.has(p.position||''));
    const player = defs.length ? pick(defs) : pick(field);
    track(player.id);
    yellows[player.id] = (yellows[player.id] || 0) + 1;
    if (yellows[player.id] >= 2) {
      stats[player.id].red_cards++; stats[player.id].rating -= 2.5;
      addEvent(minute, 'red_card', teamId, player.id, null,
        `🟥 КРАСНАЯ КАРТОЧКА! ${player.name} получает вторую жёлтую! ${commentaryRed(player.name)}`);
      removePlayer(player, isHome);
      isHome ? homeRed++ : awayRed++;
      delete yellows[player.id];
    } else {
      stats[player.id].yellow_cards++; stats[player.id].rating -= 0.4;
      addEvent(minute, 'yellow_card', teamId, player.id, null,
        `🟨 Жёлтая карточка: ${player.name}. ${commentaryYellow(player.name)}`);
    }
  }

  function tryDirectRed(minute, isHome) {
    const field  = isHome ? activeHome : activeAway;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (field.length <= 8) return;
    const player = pick(field);
    track(player.id); stats[player.id].red_cards++; stats[player.id].rating -= 3;
    addEvent(minute, 'red_card', teamId, player.id, null,
      `🟥 КРАСНАЯ КАРТОЧКА! ${player.name} удалён за грубую игру! ${commentaryDangerousPlay(player.name)}`);
    removePlayer(player, isHome);
    isHome ? homeRed++ : awayRed++;
  }

  function tryInjury(minute, isHome) {
    const field  = isHome ? activeHome : activeAway;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (field.length <= 7) return;
    const player = pick(field);
    track(player.id); stats[player.id].injured = true; stats[player.id].rating -= 1.5;
    addEvent(minute, 'injury', teamId, player.id, null,
      `🚑 ${player.name} травмирован! ${commentaryInjury(player.name)}`);
    injuredPlayers.push(player.id);
    removePlayer(player, isHome);
  }

  const subsDone = { home:0, away:0 };

  // Reserves for substitutions
  const homeReserves = allHomePlayers.filter(p => !activeHome.find(f => f.id === p.id));
  const awayReserves = allAwayPlayers.filter(p => !activeAway.find(f => f.id === p.id));

  const RATE   = useSkillRate ? 0.018  : 0.013;
  const OFFSET = useSkillRate ? 0.5    : 4.5;

  function tryPenalty(minute, isHome) {
    const attackers = isHome ? activeHome : activeAway;
    const teamId    = isHome ? homeTeamId : awayTeamId;
    if (!attackers.length) return;
    const fwd = attackers.filter(p => ATTACK_POSITIONS.has(p.position||''));
    const taker = fwd.length ? pick(fwd) : pick(attackers);
    track(taker.id);
    const scored = rand() < 0.76;
    if (scored) {
      stats[taker.id].goals++; stats[taker.id].rating += 1.2;
      isHome ? homeScore++ : awayScore++;
      addEvent(minute, 'goal', teamId, taker.id, null,
        `⚽ ПЕНАЛЬТИ! ${taker.name} уверенно реализует! ${commentaryGoal(taker.name, null)}`);
    } else {
      stats[taker.id].rating -= 0.8;
      addEvent(minute, 'penalty_miss', teamId, taker.id, null,
        `❌ Пенальти не забит! ${taker.name} — промах! ${commentaryPenaltyMiss(taker.name)}`);
    }
  }

  function tryBigSave(minute, isHome) {
    const defenders = isHome ? activeAway : activeHome;
    const teamId    = isHome ? awayTeamId : homeTeamId;
    const gks = defenders.filter(p => GK_POSITIONS.has(p.position||''));
    const gk = gks.length ? gks[0] : null;
    if (!gk) return;
    track(gk.id); stats[gk.id].rating += 0.5;
    addEvent(minute, 'save', teamId, gk.id, null,
      `🧤 ${gk.name} делает блестящий сейв! ${commentaryBigSave(gk.name)}`);
  }

  function tryNearMiss(minute, isHome) {
    const attackers = isHome ? activeHome : activeAway;
    const teamId    = isHome ? homeTeamId : awayTeamId;
    if (!attackers.length) return;
    const fwd = attackers.filter(p => ATTACK_POSITIONS.has(p.position||''));
    const shooter = fwd.length ? pick(fwd) : pick(attackers);
    if (rand() < 0.6) addBuildupSequence(minute, attackers, teamId, shooter.id, 2);
    track(shooter.id);
    addEvent(minute, 'near_miss', teamId, shooter.id, null,
      `🎯 Почти гол! ${shooter.name} — удар в штангу/перекладину! ${commentaryNearMiss(shooter.name)}`);
  }

  for (let m = 1; m <= 90; m++) {
    const hAtkEff = homeStr.attack  * Math.pow(0.88, homeRed) * 1.08;
    const hDefEff = homeStr.defense * Math.pow(0.85, homeRed);
    const aAtkEff = awayStr.attack  * Math.pow(0.88, awayRed);
    const aDefEff = awayStr.defense * Math.pow(0.85, awayRed);

    if (rand() < RATE * (hAtkEff / (aDefEff + OFFSET))) tryGoal(m, true);
    if (rand() < RATE * (aAtkEff / (hDefEff + OFFSET))) tryGoal(m, false);
    if (rand() < 0.008) tryPenalty(m, rand() < 0.5);
    if (rand() < 0.028) tryCard(m, rand() < 0.5);
    if (rand() < 0.0012) tryDirectRed(m, rand() < 0.5);
    if (m % 45 === 0 && rand() < 0.12) tryInjury(m, rand() < 0.5);
    if (rand() < 0.022) tryBigSave(m, rand() < 0.5);
    if (rand() < 0.018) tryNearMiss(m, rand() < 0.5);

    if (m >= 55 && m <= 82) {
      if (subsDone.home < 3 && rand() < 0.055 && activeHome.length > 8) {
        const off = pick(activeHome);
        const bench = homeReserves.filter(p => !activeHome.find(f => f.id === p.id));
        if (bench.length) {
          // prefer priority_sub players
          const priority = bench.filter(p => p.priority_sub);
          const on = priority.length ? priority[0] : pick(bench);
          addEvent(m, 'substitution', homeTeamId, on.id, off.id,
            `🔄 Замена: ${commentarySub(on.name, off.name)}`);
          removePlayer(off, true); activeHome.push(on); subsDone.home++;
        }
      }
      if (subsDone.away < 3 && rand() < 0.055 && activeAway.length > 8) {
        const off = pick(activeAway);
        const bench = awayReserves.filter(p => !activeAway.find(f => f.id === p.id));
        if (bench.length) {
          // prefer priority_sub players
          const priority = bench.filter(p => p.priority_sub);
          const on = priority.length ? priority[0] : pick(bench);
          addEvent(m, 'substitution', awayTeamId, on.id, off.id,
            `🔄 Замена: ${commentarySub(on.name, off.name)}`);
          removePlayer(off, false); activeAway.push(on); subsDone.away++;
        }
      }
    }
  }

  events.sort((a, b) => a.minute - b.minute);

  const allPlayers = [...allHomePlayers, ...allAwayPlayers];
  for (const p of allPlayers) {
    if (!stats[p.id]) stats[p.id] = { goals:0, assists:0, yellow_cards:0, red_cards:0, rating:6.0, injured:false };
  }

  const homeWon = homeScore > awayScore, draw = homeScore === awayScore;
  for (const p of allHomePlayers) {
    if (GK_POSITIONS.has(p.position||'')) {
      stats[p.id].rating += homeWon ? 1.0 : draw ? 0.2 : (awayScore > 3 ? -2 : -0.8);
    }
    if (!stats[p.id].injured) stats[p.id].rating += homeWon ? 0.2 : draw ? 0 : -0.2;
  }
  for (const p of allAwayPlayers) {
    if (GK_POSITIONS.has(p.position||'')) {
      stats[p.id].rating += !homeWon&&!draw ? 1.0 : draw ? 0.2 : (homeScore > 3 ? -2 : -0.8);
    }
    if (!stats[p.id].injured) stats[p.id].rating += !homeWon&&!draw ? 0.2 : draw ? 0 : -0.2;
  }
  for (const s of Object.values(stats)) s.rating = Math.min(10, Math.max(3, s.rating));

  // Market value deltas
  const mvDeltas = {};
  for (const [pid, s] of Object.entries(stats)) {
    let delta = 0;
    delta += s.goals   * ri(35, 55) / 10;
    delta += s.assists * ri(15, 25) / 10;
    delta -= s.yellow_cards * ri(5, 10) / 10;
    delta -= s.red_cards    * ri(50, 80) / 10;
    if (s.goals >= 3) delta += ri(80, 120) / 10;
    if (s.goals === 2) delta += ri(25, 40) / 10;
    if (s.rating >= 9) delta += ri(30, 50) / 10;
    else if (s.rating >= 8) delta += ri(15, 25) / 10;
    else if (s.rating < 5)  delta -= ri(15, 25) / 10;
    if (s.injured) delta -= ri(40, 70) / 10;
    delta += (Math.random() - 0.5) * 2;
    mvDeltas[pid] = delta;
  }

  // Skill deltas
  const skillDeltas = {};
  for (const [pid, s] of Object.entries(stats)) {
    const d = { pace:0, shooting:0, passing:0, defending:0, physical:0 };
    if (s.goals >= 1) { d.shooting += ri(1, 3); d.pace += ri(0, 1); }
    if (s.assists >= 1) { d.passing += ri(1, 2); }
    if (s.rating >= 8.5) {
      const k = ['pace','shooting','passing','defending','physical'];
      d[pick(k)] += ri(1,2); d[pick(k)] += 1;
    } else if (s.rating < 5) {
      const k = ['pace','shooting','passing','defending','physical'];
      d[pick(k)] -= 1;
    }
    if (s.red_cards >= 1) d.physical -= 2;
    if (s.yellow_cards >= 1) d.physical -= 1;
    if (s.injured) { d.pace -= ri(1,2); d.physical -= ri(1,2); }
    skillDeltas[pid] = d;
  }

  // Defender / GK skill growth
  const homeCleanSheet = awayScore === 0;
  const awayCleanSheet = homeScore === 0;
  for (const p of [...allHomePlayers, ...allAwayPlayers]) {
    if (!skillDeltas[p.id]) skillDeltas[p.id] = { pace:0, shooting:0, passing:0, defending:0, physical:0 };
    const pos = p.position || '';
    const isHome = allHomePlayers.some(hp => hp.id === p.id);
    const cs = isHome ? homeCleanSheet : awayCleanSheet;
    if (DEF_POSITIONS.has(pos) || GK_POSITIONS.has(pos)) {
      if (cs) {
        skillDeltas[p.id].defending += ri(1, 2);
        if (GK_POSITIONS.has(pos)) skillDeltas[p.id].physical += ri(0, 1);
      }
      const s = stats[p.id];
      if (s && s.rating >= 7.5) skillDeltas[p.id].defending += 1;
      if (rand() < 0.25) skillDeltas[p.id].physical += 1;
    }
  }

  const matchStats = generateMatchFullStats(homeStr, awayStr, homeScore, awayScore);
  return { homeScore, awayScore, events, playerStats: stats, mvDeltas, matchStats, injuredPlayers, skillDeltas };
}

// ─── generateMatchFullStats ───────────────────────────────────────────────────
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

// ─── simulateMatch — market-value based, optional zone maps ──────────────────
function simulateMatch(homeTeamId, awayTeamId, homePlayers, awayPlayers, homeZoneMap, awayZoneMap) {
  const homeStr = homeZoneMap && Object.keys(homeZoneMap).length
    ? teamStrengthWithZones(homePlayers, homeZoneMap)
    : homePlayers.length ? teamStrength(homePlayers) : { attack: 6, defense: 6, midfield: 6 };
  const awayStr = awayZoneMap && Object.keys(awayZoneMap).length
    ? teamStrengthWithZones(awayPlayers, awayZoneMap)
    : awayPlayers.length ? teamStrength(awayPlayers) : { attack: 6, defense: 6, midfield: 6 };

  return simulateMatchCore(
    homeTeamId, awayTeamId,
    [...homePlayers], [...awayPlayers],
    homeStr, awayStr,
    homePlayers, awayPlayers,
    false
  );
}

// ─── simulateMatchWithLineup — skill-based ────────────────────────────────────
// homeStarters/awayStarters: slots 1-11 player objects
// homeReserves/awayReserves: slots 12-22 player objects
// playerSkillsMap: { player_id: { pace, shooting, passing, defending, physical } }
function simulateMatchWithLineup(
  homeTeamId, awayTeamId,
  homeStarters, homeReserves,
  awayStarters, awayReserves,
  playerSkillsMap
) {
  const skillsMap = playerSkillsMap || {};

  const homeAll = [...homeStarters, ...homeReserves];
  const awayAll = [...awayStarters, ...awayReserves];

  const homeStr = homeStarters.length
    ? teamStrengthFromSkills(homeStarters, skillsMap)
    : { attack: 0.6, defense: 0.6, midfield: 0.6 };
  const awayStr = awayStarters.length
    ? teamStrengthFromSkills(awayStarters, skillsMap)
    : { attack: 0.6, defense: 0.6, midfield: 0.6 };

  return simulateMatchCore(
    homeTeamId, awayTeamId,
    [...homeStarters], [...awayStarters],
    homeStr, awayStr,
    homeAll, awayAll,
    true // use skill rate
  );
}

// ─── Tournament bracket helpers ───────────────────────────────────────────────
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

module.exports = {
  simulateMatch,
  simulateMatchWithLineup,
  generateBracketRound1,
  roundName,
  generateMatchFullStats,
  teamStrengthFromSkills,
  teamStrengthWithZones,
};
