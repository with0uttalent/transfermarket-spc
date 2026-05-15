'use strict';

const ATTACK_POSITIONS = new Set(['Centre-Forward','Striker','Left Winger','Right Winger','Attacking Midfield']);
const MID_POSITIONS    = new Set(['Central Midfield','Defensive Midfield']);
const DEF_POSITIONS    = new Set(['Centre-Back','Left-Back','Right-Back']);
const GK_POSITIONS     = new Set(['Goalkeeper']);

function playerBase(mv) {
  return Math.log10(Math.max(mv || 500000, 100000)); // ~5–9 range
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
  // Normalise each role; fallback to squad average if role empty
  const A = na > 0 ? atk / na : avg;
  const M = nm > 0 ? mid / nm : avg;
  const D = nd > 0 ? def / nd : avg;
  const G = ng > 0 ? gk  / ng : avg;
  return {
    attack:  A * 0.55 + M * 0.30 + D * 0.10 + G * 0.05,
    defense: D * 0.45 + G * 0.30 + M * 0.20 + A * 0.05,
  };
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand() { return Math.random(); }

/** Simulate a full 90-minute match.
 *  Returns { homeScore, awayScore, events[], playerStats{} }
 */
function simulateMatch(homeTeamId, awayTeamId, homePlayers, awayPlayers) {
  const homeStr = homePlayers.length ? teamStrength(homePlayers) : { attack: 6, defense: 6 };
  const awayStr = awayPlayers.length ? teamStrength(awayPlayers) : { attack: 6, defense: 6 };

  const events = [];
  let homeScore = 0, awayScore = 0;
  let homeRed = 0, awayRed = 0;

  // Working copies (players can be subbed / sent off)
  const homeField = [...homePlayers];
  const awayField = [...awayPlayers];

  // Track per-player stats
  const stats = {};
  const track = (pid) => {
    if (!pid) return;
    if (!stats[pid]) stats[pid] = { goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, rating: 6.0 };
  };

  const yellows = {}; // pid → count

  function addEvent(minute, type, teamId, playerId, player2Id, desc) {
    events.push({ minute, event_type: type, team_id: teamId, player_id: playerId || null, player2_id: player2Id || null, description: desc });
  }

  function tryGoal(minute, isHome) {
    const attackers = isHome ? homeField : awayField;
    const teamId    = isHome ? homeTeamId : awayTeamId;
    if (!attackers.length) return;

    // Prefer forwards/AMs, fallback to anyone
    const fwd = attackers.filter(p => ATTACK_POSITIONS.has(p.position || ''));
    const scorer = fwd.length ? pick(fwd) : pick(attackers);
    const mids   = attackers.filter(p => p.id !== scorer.id && (MID_POSITIONS.has(p.position || '') || ATTACK_POSITIONS.has(p.position || '')));
    const assister = mids.length ? (rand() < 0.7 ? pick(mids) : null) : null;

    // Own-goal chance (~4%)
    const isOwnGoal = rand() < 0.04;
    const defenders = isHome ? awayField : homeField;
    const defTeam   = isHome ? awayTeamId : homeTeamId;

    if (isOwnGoal && defenders.length) {
      const og = pick(defenders);
      track(og.id);
      stats[og.id].rating -= 1.5;
      isHome ? homeScore++ : awayScore++;
      addEvent(minute, 'own_goal', defTeam, og.id, null, `⚽ OWN GOAL! ${og.name} puts it into his own net!`);
      return;
    }

    track(scorer.id);
    stats[scorer.id].goals++;
    stats[scorer.id].rating += 1.2;
    if (assister) { track(assister.id); stats[assister.id].assists++; stats[assister.id].rating += 0.6; }

    isHome ? homeScore++ : awayScore++;
    const assistStr = assister ? ` (Assist: ${assister.name})` : '';
    addEvent(minute, 'goal', teamId, scorer.id, assister?.id || null,
      `⚽ GOAL! ${scorer.name} scores for ${isHome ? 'home' : 'away'} team!${assistStr}`);
  }

  function tryCard(minute, isHome) {
    const field  = isHome ? homeField : awayField;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (!field.length) return;

    // Prefer defenders for fouls
    const defs = field.filter(p => DEF_POSITIONS.has(p.position || '') || MID_POSITIONS.has(p.position || ''));
    const player = defs.length ? pick(defs) : pick(field);
    track(player.id);

    yellows[player.id] = (yellows[player.id] || 0) + 1;
    if (yellows[player.id] >= 2) {
      stats[player.id].red_cards++;
      stats[player.id].rating -= 2;
      addEvent(minute, 'red_card', teamId, player.id, null,
        `🟥 RED CARD! ${player.name} receives a second yellow and is sent off!`);
      removePlayer(player, isHome);
      isHome ? homeRed++ : awayRed++;
      delete yellows[player.id];
    } else {
      stats[player.id].yellow_cards++;
      stats[player.id].rating -= 0.3;
      addEvent(minute, 'yellow_card', teamId, player.id, null,
        `🟨 Yellow card for ${player.name}`);
    }
  }

  function tryDirectRed(minute, isHome) {
    const field  = isHome ? homeField : awayField;
    const teamId = isHome ? homeTeamId : awayTeamId;
    if (field.length <= 8) return;
    const player = pick(field);
    track(player.id);
    stats[player.id].red_cards++;
    stats[player.id].rating -= 2.5;
    addEvent(minute, 'red_card', teamId, player.id, null,
      `🟥 RED CARD! ${player.name} is sent off for dangerous play!`);
    removePlayer(player, isHome);
    isHome ? homeRed++ : awayRed++;
  }

  function removePlayer(player, isHome) {
    const arr = isHome ? homeField : awayField;
    const idx = arr.findIndex(p => p.id === player.id);
    if (idx !== -1) arr.splice(idx, 1);
  }

  const subsDone = { home: 0, away: 0 };

  for (let m = 1; m <= 90; m++) {
    // Effective strength after red cards
    const hAtkEff = homeStr.attack  * Math.pow(0.88, homeRed) * 1.08; // home advantage
    const hDefEff = homeStr.defense * Math.pow(0.85, homeRed);
    const aAtkEff = awayStr.attack  * Math.pow(0.88, awayRed);
    const aDefEff = awayStr.defense * Math.pow(0.85, awayRed);

    const RATE = 0.0115;
    const hGoalP = RATE * (hAtkEff / (aDefEff + 4.5));
    const aGoalP = RATE * (aAtkEff / (hDefEff + 4.5));

    if (rand() < hGoalP) tryGoal(m, true);
    if (rand() < aGoalP) tryGoal(m, false);

    // Yellow cards: ~2 per team per match ≈ 0.022/min
    if (rand() < 0.022) tryCard(m, rand() < 0.5);

    // Direct red: very rare
    if (rand() < 0.0008) tryDirectRed(m, rand() < 0.5);

    // Substitutions: 55–75 min, max 3 each
    if (m >= 55 && m <= 80) {
      if (subsDone.home < 3 && rand() < 0.045 && homeField.length > 8) {
        const playerOff = pick(homeField);
        const bench = homePlayers.filter(p => !homeField.find(f => f.id === p.id));
        if (bench.length) {
          const playerOn = pick(bench);
          addEvent(m, 'substitution', homeTeamId, playerOn.id, playerOff.id,
            `🔄 Substitution: ${playerOn.name} replaces ${playerOff.name}`);
          removePlayer(playerOff, true);
          homeField.push(playerOn);
          subsDone.home++;
        }
      }
      if (subsDone.away < 3 && rand() < 0.045 && awayField.length > 8) {
        const playerOff = pick(awayField);
        const bench = awayPlayers.filter(p => !awayField.find(f => f.id === p.id));
        if (bench.length) {
          const playerOn = pick(bench);
          addEvent(m, 'substitution', awayTeamId, playerOn.id, playerOff.id,
            `🔄 Substitution: ${playerOn.name} replaces ${playerOff.name}`);
          removePlayer(playerOff, false);
          awayField.push(playerOn);
          subsDone.away++;
        }
      }
    }
  }

  events.sort((a, b) => a.minute - b.minute);

  // Finalize ratings
  for (const p of [...homePlayers, ...awayPlayers]) {
    if (!stats[p.id]) stats[p.id] = { goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, rating: 6.0 };
  }
  // GKs of winning/losing team get rating boost/penalty
  const homeWon = homeScore > awayScore;
  const draw    = homeScore === awayScore;
  for (const p of homePlayers) {
    if (GK_POSITIONS.has(p.position || '')) {
      stats[p.id].rating += homeWon ? 0.8 : draw ? 0.2 : (awayScore > 3 ? -1.5 : -0.5);
    }
  }
  for (const p of awayPlayers) {
    if (GK_POSITIONS.has(p.position || '')) {
      stats[p.id].rating += !homeWon && !draw ? 0.8 : draw ? 0.2 : (homeScore > 3 ? -1.5 : -0.5);
    }
  }
  // Clamp ratings
  for (const s of Object.values(stats)) {
    s.rating = Math.min(10, Math.max(3, s.rating));
  }

  // Market value delta per player (percentage)
  const mvDeltas = {};
  for (const [pid, s] of Object.entries(stats)) {
    let delta = 0;
    delta += s.goals * 1.2;
    delta += s.assists * 0.5;
    delta -= s.yellow_cards * 0.4;
    delta -= s.red_cards * 2.5;
    if (s.goals >= 3) delta += 3.5; // hat-trick bonus
    mvDeltas[pid] = delta; // percentage points
  }

  return { homeScore, awayScore, events, playerStats: stats, mvDeltas };
}

/** Generate a knockout bracket for a given array of seeded team IDs.
 *  Returns array of { homeTeamId, awayTeamId } for the first round.
 *  Null entries mean a BYE (team advances automatically).
 */
function generateBracketRound1(teamIds) {
  let size = 1;
  while (size < teamIds.length) size *= 2;
  const padded = [...teamIds];
  while (padded.length < size) padded.push(null); // null = BYE

  // Standard seeding order: 1v(n), n/2+1 v n/2, ...
  function order(n) {
    if (n === 1) return [0];
    const prev = order(n / 2);
    const result = [];
    for (const i of prev) result.push(i, n - 1 - i);
    return result;
  }
  const positions = order(size).map(i => padded[i]);

  const matches = [];
  for (let i = 0; i < positions.length; i += 2) {
    matches.push({ homeTeamId: positions[i], awayTeamId: positions[i + 1] });
  }
  return matches;
}

function roundName(totalRounds, roundIndex) {
  const remaining = totalRounds - roundIndex;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semi-Finals';
  if (remaining === 2) return 'Quarter-Finals';
  if (remaining === 3) return 'Round of 16';
  if (remaining === 4) return 'Round of 32';
  return `Round ${roundIndex + 1}`;
}

module.exports = { simulateMatch, generateBracketRound1, roundName };
