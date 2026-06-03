'use strict';

const { freshShuffledDeck } = require('./deck');
const { evaluateBest, compareEval } = require('./handEvaluator');

// One Texas Hold'em table. Pure game logic — no sockets, no DB.
// Chips are abstract integer units; the caller (PokerManager) maps them to
// real budget / players / whole-team stakes on buy-in and cash-out.
//
// Seats: array of length `maxSeats`; each entry is null or:
//   { coachId, name, avatarUrl, chips, inHand, hasFolded, isAllIn,
//     betThisRound, totalBet, cards: [c,c], sittingOut, autoReady }
//
// States: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

const STAGES = ['preflop', 'flop', 'turn', 'river', 'showdown'];

class PokerTable {
  constructor({ id, name, maxSeats = 9, smallBlind = 100, bigBlind = 200 }) {
    this.id = id;
    this.name = name;
    this.maxSeats = Math.min(maxSeats, 9);
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.seats = new Array(this.maxSeats).fill(null);
    this.state = 'waiting';
    this.dealerPos = -1;
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;       // highest bet in the current round
    this.minRaise = bigBlind;  // minimum raise increment
    this.actingPos = -1;       // seat index whose turn it is
    this.lastAggressorPos = -1;
    this.handId = 0;
    this.handLog = [];
    this.lastResult = null;    // { winners: [...], pot, board, hands }
    this.actionDeadline = 0;   // epoch ms by which acting player must act
  }

  // ── seat management ──────────────────────────────────────────────────────
  seatPlayer(seatIndex, coach, chips) {
    if (seatIndex < 0 || seatIndex >= this.maxSeats) return { error: 'Неверное место' };
    if (this.seats[seatIndex]) return { error: 'Место занято' };
    if (this.seats.some(s => s && s.coachId === coach.coachId)) return { error: 'Вы уже за столом' };
    this.seats[seatIndex] = {
      coachId: coach.coachId,
      name: coach.name,
      avatarUrl: coach.avatarUrl || null,
      teamId: coach.teamId || null,
      chips,
      inHand: false,
      hasFolded: false,
      isAllIn: false,
      betThisRound: 0,
      totalBet: 0,
      cards: [],
      sittingOut: false,
      stake: coach.stake || null, // { type:'cash'|'player'|'team', ... }
    };
    return { ok: true };
  }

  removePlayer(coachId) {
    const idx = this.seats.findIndex(s => s && s.coachId === coachId);
    if (idx === -1) return { error: 'Не за столом' };
    const seat = this.seats[idx];
    // If they're in an active hand, fold them first
    if (seat.inHand && !seat.hasFolded) {
      seat.hasFolded = true;
      if (this.state !== 'waiting' && this.actingPos === idx) this._advanceAction();
    }
    const leaving = this.seats[idx];
    this.seats[idx] = null;
    return { ok: true, seat: leaving };
  }

  occupiedSeats() {
    return this.seats.map((s, i) => ({ s, i })).filter(x => x.s);
  }

  activePlayers() {
    return this.seats.map((s, i) => ({ s, i })).filter(x => x.s && x.s.inHand && !x.s.hasFolded);
  }

  // Players who can still act (not folded, not all-in)
  actionablePlayers() {
    return this.activePlayers().filter(x => !x.s.isAllIn);
  }

  // ── hand lifecycle ───────────────────────────────────────────────────────
  canStartHand() {
    const ready = this.occupiedSeats().filter(x => !x.s.sittingOut && x.s.chips > 0);
    return ready.length >= 2 && this.state === 'waiting';
  }

  startHand() {
    if (!this.canStartHand()) return { error: 'Недостаточно игроков' };
    this.handId++;
    this.handLog = [];
    this.lastResult = null;
    this.deck = freshShuffledDeck();
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    // Reset seats for the hand
    for (const { s } of this.occupiedSeats()) {
      const eligible = !s.sittingOut && s.chips > 0;
      s.inHand = eligible;
      s.hasFolded = false;
      s.isAllIn = false;
      s.betThisRound = 0;
      s.totalBet = 0;
      s.cards = [];
    }

    const players = this.activePlayers();
    // Advance dealer button to next eligible seat
    this.dealerPos = this._nextOccupied(this.dealerPos, players.map(p => p.i));

    // Blinds (heads-up: dealer is SB)
    const order = this._seatOrderFrom(this.dealerPos, players.map(p => p.i));
    let sbPos, bbPos;
    if (players.length === 2) {
      sbPos = this.dealerPos;
      bbPos = order[1];
    } else {
      sbPos = order[1];
      bbPos = order[2];
    }
    this._postBlind(sbPos, this.smallBlind);
    this._postBlind(bbPos, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.lastAggressorPos = bbPos;

    // Deal 2 hole cards each
    for (let round = 0; round < 2; round++) {
      for (const { s } of players) s.cards.push(this.deck.pop());
    }

    this.state = 'preflop';
    // First to act preflop: seat after BB
    this.actingPos = this._nextActionable(bbPos);
    this._setDeadline();
    this._log(`Раздача #${this.handId} началась`);
    return { ok: true };
  }

  _postBlind(pos, amount) {
    const s = this.seats[pos];
    const post = Math.min(amount, s.chips);
    s.chips -= post;
    s.betThisRound = post;
    s.totalBet = post;
    this.pot += post;
    if (s.chips === 0) s.isAllIn = true;
  }

  // ── player actions ───────────────────────────────────────────────────────
  // action: 'fold' | 'check' | 'call' | 'raise' | 'allin'
  act(coachId, action, amount = 0) {
    const idx = this.actingPos;
    if (idx < 0) return { error: 'Сейчас не время действий' };
    const seat = this.seats[idx];
    if (!seat || seat.coachId !== coachId) return { error: 'Сейчас не ваш ход' };
    if (!seat.inHand || seat.hasFolded || seat.isAllIn) return { error: 'Вы не можете действовать' };

    const toCall = this.currentBet - seat.betThisRound;

    switch (action) {
      case 'fold':
        seat.hasFolded = true;
        this._log(`${seat.name} сбросил`);
        break;

      case 'check':
        if (toCall > 0) return { error: 'Нельзя чек — есть ставка' };
        this._log(`${seat.name} чек`);
        break;

      case 'call': {
        if (toCall <= 0) return { error: 'Нечего уравнивать' };
        const pay = Math.min(toCall, seat.chips);
        seat.chips -= pay;
        seat.betThisRound += pay;
        seat.totalBet += pay;
        this.pot += pay;
        if (seat.chips === 0) seat.isAllIn = true;
        this._log(`${seat.name} уравнял ${pay}`);
        break;
      }

      case 'raise': {
        // amount = total bet this round the player wants to make
        const target = Math.floor(amount);
        const raiseBy = target - this.currentBet;
        if (target <= this.currentBet) return { error: 'Рейз должен быть больше текущей ставки' };
        if (raiseBy < this.minRaise && (seat.chips > target - seat.betThisRound)) {
          return { error: `Минимальный рейз: до ${this.currentBet + this.minRaise}` };
        }
        const pay = target - seat.betThisRound;
        if (pay > seat.chips) return { error: 'Недостаточно фишек' };
        seat.chips -= pay;
        seat.betThisRound += pay;
        seat.totalBet += pay;
        this.pot += pay;
        this.minRaise = raiseBy;
        this.currentBet = target;
        this.lastAggressorPos = idx;
        if (seat.chips === 0) seat.isAllIn = true;
        this._log(`${seat.name} рейз до ${target}`);
        break;
      }

      case 'allin': {
        const pay = seat.chips;
        const total = seat.betThisRound + pay;
        seat.chips = 0;
        seat.betThisRound = total;
        seat.totalBet += pay;
        this.pot += pay;
        seat.isAllIn = true;
        if (total > this.currentBet) {
          const raiseBy = total - this.currentBet;
          if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
          this.currentBet = total;
          this.lastAggressorPos = idx;
        }
        this._log(`${seat.name} ва-банк ${total}`);
        break;
      }

      default:
        return { error: 'Неизвестное действие' };
    }

    // Did the hand end by everyone folding?
    if (this.activePlayers().length === 1) {
      this._endHandByFold();
      return { ok: true, handEnded: true };
    }

    this._advanceAction();
    return { ok: true };
  }

  // Move to next actionable player, or advance the betting round.
  _advanceAction() {
    // If no one can still act (all all-in), run remaining streets to showdown.
    if (this.actionablePlayers().length === 0) {
      this._runOutAndShowdown();
      return;
    }

    const next = this._nextActionable(this.actingPos);
    // Round is complete when action returns to the aggressor (or everyone matched)
    if (this._isRoundComplete(next)) {
      this._nextStage();
    } else {
      this.actingPos = next;
      this._setDeadline();
    }
  }

  _isRoundComplete(nextPos) {
    const actms = this.actionablePlayers();
    if (actms.length === 0) return true;
    // Everyone still in has matched the current bet?
    const allMatched = this.activePlayers().every(
      x => x.s.isAllIn || x.s.betThisRound === this.currentBet
    );
    // Action has returned to the last aggressor
    if (allMatched && nextPos === this.lastAggressorPos) return true;
    // Special preflop case: BB option — handled because lastAggressor=BB initially
    if (allMatched && this.lastAggressorPos === -1) return true;
    return false;
  }

  _nextStage() {
    // Reset per-round bets
    for (const { s } of this.activePlayers()) s.betThisRound = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastAggressorPos = -1;

    const stageIdx = STAGES.indexOf(this.state);
    const nextStage = STAGES[stageIdx + 1];

    if (nextStage === 'flop') {
      this.deck.pop(); // burn
      this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.state = 'flop';
      this._log('Флоп');
    } else if (nextStage === 'turn') {
      this.deck.pop();
      this.community.push(this.deck.pop());
      this.state = 'turn';
      this._log('Тёрн');
    } else if (nextStage === 'river') {
      this.deck.pop();
      this.community.push(this.deck.pop());
      this.state = 'river';
      this._log('Ривер');
    } else {
      this._showdown();
      return;
    }

    // First to act post-flop: first active seat left of dealer
    this.actingPos = this._nextActionable(this.dealerPos);
    // If nobody can act (all all-in), run it out
    if (this.actionablePlayers().length === 0) {
      this._runOutAndShowdown();
      return;
    }
    this.lastAggressorPos = this.actingPos; // round completes when it returns here with all matched
    this._setDeadline();
  }

  _runOutAndShowdown() {
    // Deal remaining community cards with burns, then showdown.
    while (this.community.length < 5) {
      this.deck.pop();
      this.community.push(this.deck.pop());
    }
    this.state = 'river';
    this._showdown();
  }

  _showdown() {
    this.state = 'showdown';
    this.actingPos = -1;
    const contenders = this.activePlayers();

    // Evaluate each contender's best hand
    const evaluated = contenders.map(({ s, i }) => ({
      pos: i,
      seat: s,
      eval: evaluateBest([...s.cards, ...this.community]),
    }));

    // Build side pots based on totalBet levels
    const pots = this._buildPots();

    const payouts = {}; // pos → chips won
    const potResults = [];
    for (const pot of pots) {
      const eligible = evaluated.filter(e => pot.eligible.includes(e.pos));
      if (eligible.length === 0) continue;
      // Find best among eligible
      let best = eligible[0];
      const winners = [best];
      for (let k = 1; k < eligible.length; k++) {
        const cmp = compareEval(eligible[k].eval, best.eval);
        if (cmp > 0) { best = eligible[k]; winners.length = 0; winners.push(best); }
        else if (cmp === 0) winners.push(eligible[k]);
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const w of winners) {
        let won = share;
        if (remainder > 0) { won += 1; remainder--; }
        payouts[w.pos] = (payouts[w.pos] || 0) + won;
      }
      potResults.push({
        amount: pot.amount,
        winners: winners.map(w => ({ pos: w.pos, name: w.seat.name, hand: w.eval.name })),
      });
    }

    // Apply payouts
    for (const posStr of Object.keys(payouts)) {
      const pos = Number(posStr);
      this.seats[pos].chips += payouts[pos];
    }

    this.lastResult = {
      handId: this.handId,
      board: this.community.slice(),
      pots: potResults,
      payouts,
      revealed: evaluated.map(e => ({
        pos: e.pos, coachId: e.seat.coachId, name: e.seat.name,
        cards: e.seat.cards, hand: e.eval.name,
        combo: e.eval.cards, // the 5 cards that make this player's best hand
      })),
    };
    for (const pr of potResults) {
      this._log(`Банк ${pr.amount}: ${pr.winners.map(w => `${w.name} (${w.hand})`).join(', ')}`);
    }
    this.state = 'waiting';
  }

  // Construct main + side pots from players' totalBet contributions.
  _buildPots() {
    const contenders = this.activePlayers();
    // All players who put money in (including folded) contribute to pots,
    // but only non-folded are eligible to win.
    const allIn = this.occupiedSeats()
      .filter(x => x.s.totalBet > 0)
      .map(x => ({ pos: x.i, totalBet: x.s.totalBet, folded: x.s.hasFolded }));

    const pots = [];
    let prevLevel = 0;
    const levels = [...new Set(allIn.map(p => p.totalBet))].sort((a, b) => a - b);
    for (const level of levels) {
      const contributing = allIn.filter(p => p.totalBet >= level);
      const amount = (level - prevLevel) * contributing.length;
      if (amount > 0) {
        const eligible = contributing.filter(p => !p.folded).map(p => p.pos);
        pots.push({ amount, eligible });
      }
      prevLevel = level;
    }
    // Merge consecutive pots with identical eligibility for cleaner display
    const merged = [];
    for (const p of pots) {
      const last = merged[merged.length - 1];
      if (last && JSON.stringify(last.eligible) === JSON.stringify(p.eligible)) {
        last.amount += p.amount;
      } else merged.push({ ...p });
    }
    return merged;
  }

  _endHandByFold() {
    const winner = this.activePlayers()[0];
    if (winner) {
      winner.s.chips += this.pot;
      this.lastResult = {
        handId: this.handId,
        board: this.community.slice(),
        pots: [{ amount: this.pot, winners: [{ pos: winner.i, name: winner.s.name, hand: 'все сбросили' }] }],
        payouts: { [winner.i]: this.pot },
        revealed: [],
        byFold: true,
      };
      this._log(`${winner.s.name} забирает банк ${this.pot} (все сбросили)`);
    }
    this.actingPos = -1;
    this.state = 'waiting';
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  _seatOrderFrom(startPos, positions) {
    // Returns positions ordered clockwise starting AT startPos
    const sorted = positions.slice().sort((a, b) => a - b);
    const startIdx = sorted.indexOf(startPos);
    if (startIdx === -1) return sorted;
    return [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
  }

  _nextOccupied(fromPos, positions) {
    const sorted = positions.slice().sort((a, b) => a - b);
    for (let off = 1; off <= this.maxSeats; off++) {
      const p = (fromPos + off) % this.maxSeats;
      if (sorted.includes(p)) return p;
    }
    return sorted[0];
  }

  _nextActionable(fromPos) {
    for (let off = 1; off <= this.maxSeats; off++) {
      const p = (fromPos + off + this.maxSeats) % this.maxSeats;
      const s = this.seats[p];
      if (s && s.inHand && !s.hasFolded && !s.isAllIn) return p;
    }
    return -1;
  }

  _setDeadline(seconds = 25) {
    this.actionDeadline = Date.now() + seconds * 1000;
  }

  _log(msg) {
    this.handLog.push({ t: Date.now(), msg });
  }

  // Public snapshot for a specific viewer (hides others' hole cards).
  snapshotFor(coachId) {
    const showdown = this.state === 'showdown' || (this.lastResult && this.state === 'waiting');
    return {
      id: this.id,
      name: this.name,
      maxSeats: this.maxSeats,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      state: this.state,
      dealerPos: this.dealerPos,
      community: this.community,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      actingPos: this.actingPos,
      actionDeadline: this.actionDeadline,
      handId: this.handId,
      lastResult: this.lastResult,
      seats: this.seats.map((s, i) => {
        if (!s) return null;
        const me = s.coachId === coachId;
        const reveal = me || (this.lastResult &&
          this.lastResult.revealed?.some(r => r.pos === i));
        return {
          pos: i,
          coachId: s.coachId,
          name: s.name,
          avatarUrl: s.avatarUrl,
          chips: s.chips,
          inHand: s.inHand,
          hasFolded: s.hasFolded,
          isAllIn: s.isAllIn,
          betThisRound: s.betThisRound,
          sittingOut: s.sittingOut,
          stake: s.stake,
          cards: reveal ? s.cards : (s.inHand && !s.hasFolded ? [{ hidden: true }, { hidden: true }] : []),
          isMe: me,
        };
      }),
    };
  }
}

module.exports = { PokerTable, STAGES };
