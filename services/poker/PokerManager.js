'use strict';

const { getDb } = require('../../database/db');
const { PokerTable } = require('./PokerTable');

// Manages all poker tables in memory + the lobby (room of up to 20 coaches),
// and bridges abstract chips ↔ real economy (transfer budget only).
//
// Chip valuation: 1 chip = 1 €. A coach buys in from their transfer budget
// (escrowed via transfer_budget_spent). Settlement on cash-out.

class PokerManager {
  constructor() {
    this.tables = new Map();      // tableId → PokerTable
    this.buyIns = new Map();      // `${tableId}:${coachId}` → { stake, chipsIn }
    this.roomMembers = new Map(); // coachId → { name, avatarUrl, teamId }
    this.io = null;
    this._seedDefaultTables();
  }

  setIo(io) { this.io = io; }

  _seedDefaultTables() {
    this.createTable({ name: '🏟️ Стадион Арена', smallBlind: 100, bigBlind: 200 });
    this.createTable({ name: '⚽ Кубковая ложа', smallBlind: 500, bigBlind: 1000 });
    this.createTable({ name: '🏆 VIP Финал', smallBlind: 2500, bigBlind: 5000 });
  }

  createTable({ name, smallBlind = 100, bigBlind = 200, maxSeats = 9 }) {
    const id = 'tbl_' + Math.random().toString(36).slice(2, 9);
    const table = new PokerTable({ id, name, maxSeats, smallBlind, bigBlind });
    this.tables.set(id, table);
    return table;
  }

  listTables() {
    return [...this.tables.values()].map(t => ({
      id: t.id,
      name: t.name,
      smallBlind: t.smallBlind,
      bigBlind: t.bigBlind,
      maxSeats: t.maxSeats,
      seated: t.occupiedSeats().length,
      state: t.state,
      pot: t.pot,
    }));
  }

  getTable(id) { return this.tables.get(id); }

  // ── room presence ──────────────────────────────────────────────────────
  joinRoom(coach) {
    if (this.roomMembers.size >= 20 && !this.roomMembers.has(coach.coachId)) {
      return { error: 'Комната заполнена (макс. 20 тренеров)' };
    }
    this.roomMembers.set(coach.coachId, {
      coachId: coach.coachId, name: coach.name, avatarUrl: coach.avatarUrl, teamId: coach.teamId,
    });
    return { ok: true };
  }

  leaveRoom(coachId) { this.roomMembers.delete(coachId); }

  roomList() { return [...this.roomMembers.values()]; }

  // ── stake valuation ──────────────────────────────────────────────────────
  // Returns { chips, error } for a requested stake without committing.
  valuateStake(coach, stake) {
    const db = getDb();
    if (stake.type !== 'cash') return { error: 'Только денежные ставки из трансферного бюджета' };
    const amount = Math.floor(Number(stake.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Неверная сумма' };
    const { availableBudget } = require('../betting');
    const free = availableBudget(db, coach.teamId);
    if (amount > free) return { error: `Недостаточно бюджета. Доступно: ${Math.round(free).toLocaleString()} €` };
    return { chips: amount };
  }

  // Commit a buy-in (escrow transfer budget) and seat the coach.
  buyInAndSeat(table, coach, seatIndex, stake) {
    const db = getDb();
    const val = this.valuateStake(coach, stake);
    if (val.error) return { error: val.error };
    const chips = val.chips;

    db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?')
      .run(chips, coach.teamId);

    const seatStake = { type: 'cash', chipsIn: chips, amount: chips };
    const res = table.seatPlayer(seatIndex, { ...coach, stake: seatStake }, chips);
    if (res.error) {
      db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent - ? WHERE id=?')
        .run(chips, coach.teamId);
      return { error: res.error };
    }
    this.buyIns.set(`${table.id}:${coach.coachId}`, { stake: seatStake, chipsIn: chips });
    return { ok: true, chips };
  }

  // Cash out a seated coach: convert net chip result back to the economy.
  cashOut(table, coachId) {
    const db = getDb();
    const key = `${table.id}:${coachId}`;
    const buyIn = this.buyIns.get(key);
    const idx = table.seats.findIndex(s => s && s.coachId === coachId);
    if (idx === -1 || !buyIn) return { error: 'Не за столом' };
    const seat = table.seats[idx];
    const finalChips = seat.chips;
    const delta = finalChips - buyIn.chipsIn;
    const stake = buyIn.stake;
    const coach = this.roomMembers.get(coachId) || { teamId: seat.teamId };
    const teamId = seat.teamId || coach.teamId;

    const summary = { type: 'cash', chipsIn: buyIn.chipsIn, finalChips, delta };

    // Release escrow, then apply net result to budget.
    db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent - ? WHERE id=?')
      .run(buyIn.chipsIn, teamId);
    if (delta !== 0) {
      db.prepare('UPDATE teams SET transfer_budget = transfer_budget + ? WHERE id=?')
        .run(delta, teamId);
    }

    table.removePlayer(coachId);
    this.buyIns.delete(key);
    this._recordSettlement(db, teamId, stake, summary);
    return { ok: true, summary };
  }

  _recordSettlement(db, teamId, stake, summary) {
    try {
      db.prepare(`INSERT INTO poker_settlements (team_id, stake_type, chips_in, chips_out, delta, detail)
                  VALUES (?,?,?,?,?,?)`)
        .run(teamId, stake.type, summary.chipsIn, summary.finalChips, summary.delta,
             JSON.stringify(summary));
    } catch (e) { /* table may not exist yet on first boot */ }
  }
}

let _instance = null;
function getPokerManager() {
  if (!_instance) _instance = new PokerManager();
  return _instance;
}

module.exports = { getPokerManager, PokerManager };
