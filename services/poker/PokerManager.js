'use strict';

const { getDb } = require('../../database/db');
const { PokerTable } = require('./PokerTable');

// Manages all poker tables in memory + the lobby (room of up to 20 coaches),
// and bridges abstract chips ↔ real economy (cash budget / players / whole team).
//
// Chip valuation: 1 chip = 1 €. A coach buys in by staking:
//   - cash:   amount taken from transfer budget (escrowed via transfer_budget_spent)
//   - player: a player's market_value becomes chips; on loss player transfers
//   - team:   whole squad market value becomes chips; on bust the team is forfeit
//
// Settlement happens on cash-out (leaving the table): net chip delta vs buy-in
// is converted back. Player/team stakes resolve on bust or cash-out.

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
    if (stake.type === 'cash') {
      const amount = Math.floor(Number(stake.amount));
      if (!Number.isFinite(amount) || amount <= 0) return { error: 'Неверная сумма' };
      const { availableBudget } = require('../betting');
      const free = availableBudget(db, coach.teamId);
      if (amount > free) return { error: `Недостаточно бюджета. Доступно: ${Math.round(free).toLocaleString()} €` };
      return { chips: amount };
    }
    if (stake.type === 'player') {
      const p = db.prepare('SELECT id, name, market_value, team_id FROM players WHERE id=?').get(stake.playerId);
      if (!p || p.team_id !== coach.teamId) return { error: 'Это не ваш игрок' };
      const chips = Math.floor(p.market_value || 0);
      if (chips <= 0) return { error: 'У игрока нулевая стоимость' };
      return { chips, meta: { playerName: p.name } };
    }
    if (stake.type === 'team') {
      const row = db.prepare('SELECT COALESCE(SUM(market_value),0) AS v FROM players WHERE team_id=?').get(coach.teamId);
      const chips = Math.floor(row.v || 0);
      if (chips <= 0) return { error: 'Команда ничего не стоит' };
      return { chips };
    }
    return { error: 'Неизвестный тип ставки' };
  }

  // Commit a buy-in (escrow real economy) and seat the coach.
  buyInAndSeat(table, coach, seatIndex, stake) {
    const db = getDb();
    const val = this.valuateStake(coach, stake);
    if (val.error) return { error: val.error };
    const chips = val.chips;

    // Escrow
    if (stake.type === 'cash') {
      db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?')
        .run(chips, coach.teamId);
    } else if (stake.type === 'player') {
      // Mark player as "staked" — locked from transfers while seated (soft lock via flag table)
      db.prepare('INSERT OR REPLACE INTO poker_player_locks (player_id, coach_id, table_id) VALUES (?,?,?)')
        .run(stake.playerId, coach.coachId, table.id);
    } // team stake: nothing escrowed up front; resolved on outcome

    const seatStake = { type: stake.type, chipsIn: chips, ...stake };
    const res = table.seatPlayer(seatIndex, { ...coach, stake: seatStake }, chips);
    if (res.error) {
      // rollback escrow
      if (stake.type === 'cash') {
        db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent - ? WHERE id=?')
          .run(chips, coach.teamId);
      } else if (stake.type === 'player') {
        db.prepare('DELETE FROM poker_player_locks WHERE player_id=?').run(stake.playerId);
      }
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

    const summary = { type: stake.type, chipsIn: buyIn.chipsIn, finalChips, delta };

    if (stake.type === 'cash') {
      // Release escrow, then apply net result to budget.
      db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent - ? WHERE id=?')
        .run(buyIn.chipsIn, teamId);
      if (delta !== 0) {
        // Positive delta = winnings (reduce spent further / add budget); negative = loss
        db.prepare('UPDATE teams SET transfer_budget = transfer_budget + ? WHERE id=?')
          .run(delta, teamId);
      }
    } else if (stake.type === 'player') {
      db.prepare('DELETE FROM poker_player_locks WHERE player_id=?').run(stake.playerId);
      if (finalChips <= 0) {
        // Player lost — transfer to the biggest winner at the table (or release)
        this._forfeitPlayerToWinner(db, table, stake.playerId, coachId, teamId);
        summary.lostPlayer = true;
      } else if (delta !== 0) {
        // Settle the chip swing in cash on top; player stays.
        db.prepare('UPDATE teams SET transfer_budget = transfer_budget + ? WHERE id=?')
          .run(delta, teamId);
      }
    } else if (stake.type === 'team') {
      if (finalChips <= 0) {
        summary.lostTeam = true; // whole team forfeit — handled by caller/admin flow
      } else if (delta !== 0) {
        db.prepare('UPDATE teams SET transfer_budget = transfer_budget + ? WHERE id=?')
          .run(delta, teamId);
      }
    }

    table.removePlayer(coachId);
    this.buyIns.delete(key);
    this._recordSettlement(db, teamId, stake, summary);
    return { ok: true, summary };
  }

  _forfeitPlayerToWinner(db, table, playerId, loserCoachId, loserTeamId) {
    // Winner = seat with most chips that isn't the loser
    const winner = table.occupiedSeats()
      .filter(x => x.s.coachId !== loserCoachId && x.s.teamId)
      .sort((a, b) => b.s.chips - a.s.chips)[0];
    if (!winner) return;
    const winnerTeamId = winner.s.teamId;
    const player = db.prepare('SELECT name, market_value FROM players WHERE id=?').get(playerId);
    db.prepare('UPDATE players SET team_id=? WHERE id=?').run(winnerTeamId, playerId);
    db.prepare('DELETE FROM team_lineups WHERE player_id=?').run(playerId);
    db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_type, transfer_date)
                VALUES (?,?,?,?,?,date('now'))`)
      .run(playerId, loserTeamId, winnerTeamId, 0, 'poker');
    db.prepare(`INSERT INTO news (title, body, type, player_id, team_id)
                VALUES (?,?,?,?,?)`)
      .run(`🃏 ${player.name} проигран в покер!`,
           `${player.name} переходит в новую команду как ставка, проигранная за покерным столом.`,
           'transfer', playerId, winnerTeamId);
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
