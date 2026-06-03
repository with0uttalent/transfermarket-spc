'use strict';

const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { getDb } = require('../../database/db');
const { getPokerManager } = require('./PokerManager');

// Resolve a socket's authenticated coach from its JWT.
function authCoach(token) {
  if (!token) return null;
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
  const db = getDb();
  const coach = db.prepare('SELECT id, name, avatar_url, team_id FROM coaches WHERE user_id=?').get(payload.id);
  if (!coach) {
    // Admins without a coach profile may still spectate; block table play.
    return { coachId: null, userId: payload.id, role: payload.role, name: payload.username || 'Admin', teamId: null };
  }
  return {
    coachId: coach.id,
    userId: payload.id,
    role: payload.role,
    name: coach.name,
    avatarUrl: coach.avatar_url,
    teamId: coach.team_id,
  };
}

function initPokerSocket(httpServer) {
  const io = new Server(httpServer, { path: '/socket.io', cors: { origin: '*' } });
  const mgr = getPokerManager();
  mgr.setIo(io);

  // Broadcast a table's per-viewer snapshot to everyone watching it.
  function broadcastTable(table) {
    if (!table) return;
    const room = io.sockets.adapter.rooms.get('table:' + table.id);
    if (!room) return;
    for (const sid of room) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      const cid = sock.data.coach?.coachId;
      sock.emit('table:state', table.snapshotFor(cid));
    }
  }

  function broadcastLobby() {
    io.to('lobby').emit('lobby:tables', mgr.listTables());
    io.to('lobby').emit('lobby:room', mgr.roomList());
  }

  // Auto-advance: start hands when ready, enforce action timeouts.
  setInterval(() => {
    for (const table of mgr.tables.values()) {
      let changed = false;
      // Start a new hand if idle and ≥2 ready players
      if (table.state === 'waiting' && table.canStartHand()) {
        // brief pause between hands
        if (!table._nextHandAt) table._nextHandAt = Date.now() + 4000;
        if (Date.now() >= table._nextHandAt) {
          table._nextHandAt = 0;
          table.startHand();
          changed = true;
        }
      } else {
        table._nextHandAt = 0;
      }
      // Action timeout → auto fold/check
      if (table.actingPos >= 0 && table.actionDeadline && Date.now() > table.actionDeadline) {
        const seat = table.seats[table.actingPos];
        if (seat) {
          const toCall = table.currentBet - seat.betThisRound;
          table.act(seat.coachId, toCall > 0 ? 'fold' : 'check');
          changed = true;
        }
      }
      if (changed) broadcastTable(table);
    }
  }, 1000);

  io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const coach = authCoach(token);
    socket.data.coach = coach;

    // ── lobby ────────────────────────────────────────────────────────────
    socket.on('lobby:join', () => {
      socket.join('lobby');
      if (coach && coach.coachId) mgr.joinRoom(coach);
      socket.emit('lobby:tables', mgr.listTables());
      broadcastLobby();
    });

    socket.on('lobby:leave', () => {
      socket.leave('lobby');
      if (coach && coach.coachId) mgr.leaveRoom(coach.coachId);
      broadcastLobby();
    });

    // ── table view ─────────────────────────────────────────────────────────
    socket.on('table:watch', ({ tableId }) => {
      const table = mgr.getTable(tableId);
      if (!table) return socket.emit('poker:error', { error: 'Стол не найден' });
      socket.join('table:' + tableId);
      socket.data.tableId = tableId;
      socket.emit('table:state', table.snapshotFor(coach?.coachId));
    });

    socket.on('table:unwatch', ({ tableId }) => {
      socket.leave('table:' + tableId);
      if (socket.data.tableId === tableId) socket.data.tableId = null;
    });

    // ── sit down with a stake ───────────────────────────────────────────────
    socket.on('table:sit', ({ tableId, seatIndex, stake }) => {
      const table = mgr.getTable(tableId);
      if (!table) return socket.emit('poker:error', { error: 'Стол не найден' });
      if (!coach || !coach.coachId) return socket.emit('poker:error', { error: 'Только тренеры могут садиться за стол' });
      if (!coach.teamId) return socket.emit('poker:error', { error: 'У вас нет команды' });
      const res = mgr.buyInAndSeat(table, coach, seatIndex, stake);
      if (res.error) return socket.emit('poker:error', { error: res.error });
      socket.emit('table:sat', { tableId, chips: res.chips });
      broadcastTable(table);
      broadcastLobby();
    });

    // ── leave / cash out ─────────────────────────────────────────────────────
    socket.on('table:leave', ({ tableId }) => {
      const table = mgr.getTable(tableId);
      if (!table || !coach?.coachId) return;
      const res = mgr.cashOut(table, coach.coachId);
      if (res.error) return socket.emit('poker:error', { error: res.error });
      socket.emit('table:left', { tableId, summary: res.summary });
      broadcastTable(table);
      broadcastLobby();
    });

    // ── gameplay action ──────────────────────────────────────────────────────
    socket.on('table:action', ({ tableId, action, amount }) => {
      const table = mgr.getTable(tableId);
      if (!table || !coach?.coachId) return;
      const res = table.act(coach.coachId, action, amount);
      if (res.error) return socket.emit('poker:error', { error: res.error });
      broadcastTable(table);
    });

    socket.on('disconnect', () => {
      // Leave the lobby room; keep seat (chips) so a reconnect can resume.
      if (coach && coach.coachId) {
        mgr.leaveRoom(coach.coachId);
        broadcastLobby();
      }
    });
  });

  return io;
}

module.exports = { initPokerSocket };
