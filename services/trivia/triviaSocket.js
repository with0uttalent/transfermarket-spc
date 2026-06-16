const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { getDb } = require('../../database/db');

const COLORS = ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#e67e22'];
const GRID_COLS = 6;
const GRID_ROWS  = 6;
const TOTAL_TERRITORIES = GRID_COLS * GRID_ROWS; // 36
const CAPITAL_LIVES  = 3;
const QUESTION_MS    = 15000;
const SELECT_MS      = 20000;
const RESET_DELAY_MS = 30000; // after game ends, room auto-resets

const GLOBAL_ROOM_CODE = 'MAIN';
const rooms = new Map();

// ── room factory ──────────────────────────────────────────────────────────────
function buildTerritories() {
  const t = {};
  for (let i = 0; i < TOTAL_TERRITORIES; i++) {
    t[i] = { id: i, owner: null, lives: 1, isCapital: false };
  }
  return t;
}

function createRoomObj(code) {
  return {
    code, status: 'waiting', host: null,
    players: [], territories: buildTerritories(),
    phase: 'claim', turnIndex: -1,
    claimsDone: 0, usedQuestionIds: [],
    currentQuestion: null, questionAnswers: {},
    questionTimer: null, selectTimer: null,
    questionDeadline: null, questionParticipants: [],
    awaitingTerritory: null, attackSource: null, attackTarget: null,
    lastResult: null, winner: null,
  };
}

function getGlobalRoom() {
  if (!rooms.has(GLOBAL_ROOM_CODE)) rooms.set(GLOBAL_ROOM_CODE, createRoomObj(GLOBAL_ROOM_CODE));
  return rooms.get(GLOBAL_ROOM_CODE);
}

function resetRoom(room) {
  clearQuestionTimer(room);
  room.status         = 'waiting';
  room.territories    = buildTerritories();
  room.phase          = 'claim';
  room.turnIndex      = -1;
  room.claimsDone     = 0;
  room.usedQuestionIds = [];
  room.currentQuestion = null;
  room.questionAnswers = {};
  room.questionDeadline = null;
  room.questionParticipants = [];
  room.awaitingTerritory = null;
  room.attackSource = null;
  room.attackTarget = null;
  room.lastResult = null;
  room.winner = null;
  for (const p of room.players) {
    p.ready = false;
    p.eliminated = false;
    p.territories = [];
    p.capitalId = null;
    p.capitalLives = CAPITAL_LIVES;
  }
}

// ── questions ─────────────────────────────────────────────────────────────────
function getQuestion(db, usedIds) {
  const exclude = usedIds.length ? `AND id NOT IN (${usedIds.map(() => '?').join(',')})` : '';
  const q = db.prepare(`SELECT * FROM trivia_questions WHERE 1=1 ${exclude} ORDER BY RANDOM() LIMIT 1`).get(...usedIds);
  return q || db.prepare('SELECT * FROM trivia_questions ORDER BY RANDOM() LIMIT 1').get();
}

// ── snapshot ──────────────────────────────────────────────────────────────────
function roomSnapshot(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => ({
      id: p.id, username: p.username, teamName: p.teamName, teamLogo: p.teamLogo,
      color: p.color, ready: p.ready, eliminated: p.eliminated,
      territories: [...p.territories], capitalId: p.capitalId, capitalLives: p.capitalLives,
    })),
    territories: room.territories,
    phase: room.phase,
    turnIndex: room.turnIndex,
    awaitingTerritory: room.awaitingTerritory,
    attackSource: room.attackSource,
    attackTarget: room.attackTarget,
    questionActive: !!room.currentQuestion,
    questionDeadline: room.questionDeadline,
    question: room.currentQuestion ? {
      id: room.currentQuestion.id,
      question: room.currentQuestion.question,
      option_a: room.currentQuestion.option_a,
      option_b: room.currentQuestion.option_b,
      option_c: room.currentQuestion.option_c,
      option_d: room.currentQuestion.option_d,
    } : null,
    // How many players have answered (so UI can show N/M progress)
    answeredCount: Object.keys(room.questionAnswers).length,
    totalParticipants: room.questionParticipants.length,
    answeredPlayers: Object.keys(room.questionAnswers),
    lastResult: room.lastResult || null,
    winner: room.winner || null,
  };
}

function broadcast(io, room) {
  io.to(room.code).emit('trivia:state', roomSnapshot(room));
}

// ── player helpers ────────────────────────────────────────────────────────────
function activePlayers(room) { return room.players.filter(p => !p.eliminated); }

function advanceTurn(room) {
  const alive = activePlayers(room);
  if (alive.length === 0) return;
  let next = (room.turnIndex + 1) % room.players.length;
  let attempts = 0;
  while (room.players[next].eliminated && attempts < room.players.length) {
    next = (next + 1) % room.players.length;
    attempts++;
  }
  room.turnIndex = next;
}

function checkWin(room) {
  const alive = activePlayers(room);
  if (alive.length === 1) {
    room.status = 'finished';
    room.winner = alive[0].id;
    clearQuestionTimer(room);
    return true;
  }
  if (alive.length === 0) {
    room.status = 'finished';
    room.winner = null;
    return true;
  }
  return false;
}

function clearQuestionTimer(room) {
  if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = null; }
  if (room.selectTimer)   { clearTimeout(room.selectTimer);   room.selectTimer = null; }
}

// ── question resolution ───────────────────────────────────────────────────────
// Timer ALWAYS runs to completion before resolving — no early resolve.
function resolveQuestion(io, room) {
  clearQuestionTimer(room);
  if (!room.currentQuestion) return;

  const correct = room.currentQuestion.correct_option;
  const answers = room.questionAnswers;

  // Fastest correct answer wins
  const correctEntries = Object.entries(answers)
    .filter(([, a]) => a.option === correct)
    .sort(([, a], [, b]) => a.ts - b.ts);

  const winner = correctEntries.length > 0 ? correctEntries[0][0] : null;

  // Build per-player answer map for display (reveal after timer)
  room.lastResult = {
    correct,
    answers: Object.fromEntries(Object.entries(answers).map(([uid, a]) => [uid, a.option])),
    winner,
    questionId: room.currentQuestion.id,
  };
  room.usedQuestionIds.push(room.currentQuestion.id);
  room.currentQuestion = null;
  room.questionAnswers = {};
  room.questionDeadline = null;

  if (room.phase === 'claim') {
    if (winner) {
      room.awaitingTerritory = { playerId: winner, type: 'claim' };
      broadcast(io, room);
      // Auto-pick if only one free territory left
      const free = Object.values(room.territories).filter(t => t.owner === null);
      if (free.length === 1) {
        setTimeout(() => claimTerritory(io, room, winner, free[0].id), 800);
      } else {
        room.selectTimer = setTimeout(() => {
          const f = Object.values(room.territories).filter(t => t.owner === null);
          if (f.length > 0 && room.awaitingTerritory?.playerId === winner) {
            claimTerritory(io, room, winner, f[Math.floor(Math.random() * f.length)].id);
          }
        }, SELECT_MS);
      }
    } else {
      broadcast(io, room);
      setTimeout(() => nextClaimTurn(io, room), 2500);
    }
  } else {
    // War phase: attacker is room.attackSource, defender owns room.attackTarget
    const atk = room.attackSource;
    const def = room.attackTarget !== null ? room.territories[room.attackTarget]?.owner : null;

    if (winner === atk) {
      applyAttackWin(io, room, atk, room.attackTarget);
    } else if (winner === def) {
      broadcast(io, room);
      setTimeout(() => nextWarTurn(io, room), 2500);
    } else {
      // Nobody (or 3rd player) answered correctly — attack fails
      broadcast(io, room);
      setTimeout(() => nextWarTurn(io, room), 2500);
    }
  }
}

// ── claim phase ───────────────────────────────────────────────────────────────
function claimTerritory(io, room, playerId, territoryId) {
  clearQuestionTimer(room);
  if (!room.awaitingTerritory || room.awaitingTerritory.playerId !== playerId) return;
  const territory = room.territories[territoryId];
  if (!territory || territory.owner !== null) return;

  territory.owner = playerId;
  const player = room.players.find(p => p.id === playerId);
  if (player) player.territories.push(territoryId);
  room.awaitingTerritory = null;
  room.claimsDone++;

  const free = Object.values(room.territories).filter(t => t.owner === null);
  if (free.length === 0) { startWarPhase(io, room); return; }
  nextClaimTurn(io, room);
}

function nextClaimTurn(io, room) {
  const free = Object.values(room.territories).filter(t => t.owner === null);
  if (free.length === 0) { startWarPhase(io, room); return; }
  // ALL active players answer claim questions — fastest correct answer claims a territory
  const allAlive = activePlayers(room).map(p => p.id);
  askQuestion(io, room, allAlive);
}

// ── war phase ─────────────────────────────────────────────────────────────────
function startWarPhase(io, room) {
  room.phase = 'war';
  room.turnIndex = -1;
  advanceTurn(room);
  broadcast(io, room);
  setTimeout(() => promptAttack(io, room), 1500);
}

function promptAttack(io, room) {
  if (room.status !== 'playing') return;
  const currentPlayer = room.players[room.turnIndex];
  if (!currentPlayer || currentPlayer.eliminated) { advanceTurn(room); promptAttack(io, room); return; }

  room.awaitingTerritory = { playerId: currentPlayer.id, type: 'attack' };
  room.attackSource = currentPlayer.id;
  room.attackTarget = null;
  broadcast(io, room);

  room.selectTimer = setTimeout(() => {
    if (room.awaitingTerritory?.playerId !== currentPlayer.id) return;
    const enemyTerrs = Object.values(room.territories).filter(t => t.owner && t.owner !== currentPlayer.id);
    if (enemyTerrs.length === 0) { nextWarTurn(io, room); return; }
    const target = enemyTerrs[Math.floor(Math.random() * enemyTerrs.length)];
    beginAttack(io, room, currentPlayer.id, target.id);
  }, SELECT_MS);
}

function beginAttack(io, room, attackerId, targetId) {
  clearQuestionTimer(room);
  room.awaitingTerritory = null;
  room.attackTarget = targetId;
  const defOwner = room.territories[targetId]?.owner;
  // War question: attacker + defender (others watch)
  const participants = defOwner ? [attackerId, defOwner] : [attackerId];
  askQuestion(io, room, participants);
}

function nextWarTurn(io, room) {
  if (room.status !== 'playing') return;
  if (checkWin(room)) { broadcast(io, room); return; }
  room.attackSource = null;
  room.attackTarget = null;
  advanceTurn(room);
  broadcast(io, room);
  setTimeout(() => promptAttack(io, room), 1500);
}

function applyAttackWin(io, room, attackerId, targetId) {
  const territory = room.territories[targetId];
  if (!territory) return;

  const prevOwner = territory.owner;
  const prevPlayer = room.players.find(p => p.id === prevOwner);

  territory.owner = attackerId;
  territory.lives = 1;
  territory.isCapital = false;

  if (prevPlayer) {
    prevPlayer.territories = prevPlayer.territories.filter(id => id !== targetId);
    if (prevPlayer.capitalId === targetId) {
      prevPlayer.capitalLives -= 1;
      if (prevPlayer.capitalLives <= 0) {
        prevPlayer.eliminated = true;
        prevPlayer.capitalLives = 0;
        for (const tid of prevPlayer.territories) room.territories[tid].owner = null;
        prevPlayer.territories = [];
        room.lastResult.eliminated = prevOwner;
      } else {
        if (prevPlayer.territories.length > 0) {
          const newCap = prevPlayer.territories[0];
          prevPlayer.capitalId = newCap;
          room.territories[newCap].isCapital = true;
          room.territories[newCap].lives = prevPlayer.capitalLives;
        }
      }
    }
  }

  const atkPlayer = room.players.find(p => p.id === attackerId);
  if (atkPlayer) atkPlayer.territories.push(targetId);
  room.attackSource = null;
  room.attackTarget = null;

  if (checkWin(room)) { broadcast(io, room); scheduleReset(io, room); return; }
  broadcast(io, room);
  setTimeout(() => nextWarTurn(io, room), 2500);
}

// ── ask question ──────────────────────────────────────────────────────────────
function askQuestion(io, room, participantIds) {
  clearQuestionTimer(room);
  const db = getDb();
  const q = getQuestion(db, room.usedQuestionIds);
  if (!q) return;

  room.currentQuestion = q;
  room.questionAnswers = {};
  room.questionDeadline = Date.now() + QUESTION_MS;
  room.questionParticipants = participantIds;
  broadcast(io, room);

  // Timer ALWAYS runs to completion — no early resolve
  room.questionTimer = setTimeout(() => resolveQuestion(io, room), QUESTION_MS);
}

// ── capitals placement ────────────────────────────────────────────────────────
function spreadCapitals(n) {
  const positions = { 1:[17], 2:[6,29], 3:[2,17,33], 4:[1,4,31,34], 5:[0,5,17,30,35], 6:[0,5,12,23,30,35] };
  return positions[n] || positions[6].slice(0, n);
}

// ── game start (extracted so auto-start can call it) ──────────────────────────
function startGame(io, room) {
  const readyPlayers = room.players.filter(p => p.ready);
  if (readyPlayers.length < 2) return;

  room.players = readyPlayers;
  const capPositions = spreadCapitals(room.players.length);
  room.players.forEach((p, i) => {
    const capId = capPositions[i];
    p.capitalId = capId;
    p.capitalLives = CAPITAL_LIVES;
    p.territories = [capId];
    room.territories[capId].owner = p.id;
    room.territories[capId].isCapital = true;
    room.territories[capId].lives = CAPITAL_LIVES;
  });

  room.status = 'playing';
  room.phase = 'claim';
  room.turnIndex = -1;
  broadcast(io, room);
  setTimeout(() => nextClaimTurn(io, room), 1500);
}

// ── socket init ───────────────────────────────────────────────────────────────
function initTriviaSocket(server) {
  const io = new Server(server, {
    path: '/trivia-socket',
    cors: { origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000', credentials: true },
  });

  function authUser(token) {
    if (!token) return null;
    try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
  }

  io.on('connection', socket => {
    let user = null;

    socket.on('trivia:auth', ({ token }) => {
      const payload = authUser(token);
      if (!payload) { socket.emit('trivia:error', { message: 'Auth failed' }); return; }
      const db = getDb();
      const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(payload.id);
      const team  = coach ? db.prepare('SELECT name,logo_url FROM teams WHERE id=?').get(coach.team_id) : null;
      user = {
        id: String(payload.id),
        username: payload.username,
        role: payload.role,
        teamId: coach?.team_id || null,
        teamName: team?.name || payload.username,
        teamLogo: team?.logo_url || null,
      };
      socket.emit('trivia:authed', { user });
      // Send current room state so lobby can show player count
      const room = getGlobalRoom();
      socket.emit('trivia:room_preview', { playerCount: room.players.length, status: room.status });
    });

    // Join the single global room
    socket.on('trivia:join', () => {
      if (!user) return;
      const room = getGlobalRoom();
      if (room.status !== 'waiting') {
        socket.emit('trivia:error', { message: 'Игра уже идёт, подождите окончания' });
        return;
      }
      if (room.players.length >= 6) {
        socket.emit('trivia:error', { message: 'Зал заполнен (макс. 6 игроков)' });
        return;
      }
      joinRoom(io, socket, room, user);
    });

    socket.on('trivia:ready', () => {
      if (!user) return;
      const room = findRoomByPlayer(user.id);
      if (!room || room.status !== 'waiting') return;
      const p = room.players.find(pp => pp.id === user.id);
      if (!p) return;
      p.ready = !p.ready;
      broadcast(io, room);

      // Auto-start when ALL players are ready (min 2)
      const allReady = room.players.length >= 2 && room.players.every(pp => pp.ready);
      if (allReady) {
        setTimeout(() => {
          // Double-check still valid
          if (room.status === 'waiting' && room.players.length >= 2 && room.players.every(pp => pp.ready)) {
            startGame(io, room);
          }
        }, 1000); // 1s countdown so players see "all ready"
      }
    });

    socket.on('trivia:answer', ({ option }) => {
      if (!user) return;
      const room = findRoomByPlayer(user.id);
      if (!room || !room.currentQuestion) return;
      if (room.questionAnswers[user.id]) return; // already answered
      // Only participants can answer (all alive in claim, attacker+defender in war)
      if (room.questionParticipants.length > 0 && !room.questionParticipants.includes(user.id)) return;
      room.questionAnswers[user.id] = { option, ts: Date.now() };
      // Broadcast so everyone sees the answered count going up — but NO early resolve
      broadcast(io, room);
    });

    socket.on('trivia:select_territory', ({ territoryId }) => {
      if (!user) return;
      const room = findRoomByPlayer(user.id);
      if (!room || !room.awaitingTerritory) return;
      if (room.awaitingTerritory.playerId !== user.id) return;

      if (room.awaitingTerritory.type === 'claim') {
        const t = room.territories[territoryId];
        if (!t || t.owner !== null) { socket.emit('trivia:error', { message: 'Территория уже занята' }); return; }
        claimTerritory(io, room, user.id, territoryId);
      } else if (room.awaitingTerritory.type === 'attack') {
        const t = room.territories[territoryId];
        if (!t || t.owner === user.id || !t.owner) { socket.emit('trivia:error', { message: 'Выберите вражескую территорию' }); return; }
        beginAttack(io, room, user.id, territoryId);
      }
    });

    socket.on('trivia:leave', () => leaveRoom(io, socket, user));
    socket.on('disconnect', () => leaveRoom(io, socket, user));
  });
}

// ── room helpers ──────────────────────────────────────────────────────────────
function joinRoom(io, socket, room, user) {
  const existing = room.players.find(p => p.id === user.id);
  if (!existing) {
    const colorIdx = room.players.length % COLORS.length;
    room.players.push({
      id: user.id, username: user.username,
      teamName: user.teamName, teamLogo: user.teamLogo,
      color: COLORS[colorIdx], ready: false, eliminated: false,
      territories: [], capitalId: null, capitalLives: CAPITAL_LIVES,
    });
  }
  socket.join(room.code);
  socket.emit('trivia:joined');
  broadcast(io, room);
}

function findRoomByPlayer(userId) {
  for (const room of rooms.values()) {
    if (room.players.find(p => p.id === userId)) return room;
  }
  return null;
}

function leaveRoom(io, socket, user) {
  if (!user) return;
  const room = findRoomByPlayer(user.id);
  if (!room) return;
  socket.leave(room.code);

  if (room.status === 'waiting') {
    room.players = room.players.filter(p => p.id !== user.id);
    broadcast(io, room);
  } else if (room.status === 'playing') {
    const p = room.players.find(pp => pp.id === user.id);
    if (p && !p.eliminated) {
      p.eliminated = true;
      for (const tid of p.territories) room.territories[tid].owner = null;
      p.territories = [];
      if (checkWin(room)) {
        broadcast(io, room);
        scheduleReset(io, room);
      } else {
        broadcast(io, room);
      }
    }
  } else if (room.status === 'finished') {
    room.players = room.players.filter(p => p.id !== user.id);
    broadcast(io, room);
  }
}

function scheduleReset(io, room) {
  setTimeout(() => {
    if (room.status === 'finished') {
      resetRoom(room);
      broadcast(io, room);
    }
  }, RESET_DELAY_MS);
}

module.exports = { initTriviaSocket };
