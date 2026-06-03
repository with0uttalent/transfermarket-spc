'use strict';

// Texas Hold'em hand evaluation.
// Cards are { rank: 2..14, suit: 'h'|'d'|'c'|'s' }. Rank 14 = Ace.
// Evaluates the best 5-card hand from any 5-7 cards.

const HAND_RANKS = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10,
};

const HAND_NAMES_RU = {
  1: 'Старшая карта',
  2: 'Пара',
  3: 'Две пары',
  4: 'Тройка',
  5: 'Стрит',
  6: 'Флеш',
  7: 'Фулл-хаус',
  8: 'Каре',
  9: 'Стрит-флеш',
  10: 'Роял-флеш',
};

// Return all k-combinations of an array.
function combinations(arr, k) {
  const result = [];
  const combo = [];
  (function helper(start) {
    if (combo.length === k) { result.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1);
      combo.pop();
    }
  })(0);
  return result;
}

// Evaluate exactly 5 cards → { rank, tiebreakers: [...] } where higher is better.
function eval5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  // Count rank frequencies
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  // Sort ranks by (count desc, rank desc)
  const byCount = Object.keys(counts).map(Number).sort((a, b) => {
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return b - a;
  });
  const countVals = byCount.map(r => counts[r]).sort((a, b) => b - a);

  // Straight detection (Ace can be low: A-2-3-4-5)
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length >= 5) {
    for (let i = 0; i <= uniq.length - 5; i++) {
      if (uniq[i] - uniq[i + 4] === 4) { straightHigh = uniq[i]; break; }
    }
    // Wheel: A,5,4,3,2
    if (!straightHigh && uniq.includes(14) && uniq.includes(5) && uniq.includes(4) && uniq.includes(3) && uniq.includes(2)) {
      straightHigh = 5;
    }
  }
  const isStraight = straightHigh > 0;

  if (isStraight && isFlush) {
    if (straightHigh === 14) return { rank: HAND_RANKS.ROYAL_FLUSH, tiebreakers: [14] };
    return { rank: HAND_RANKS.STRAIGHT_FLUSH, tiebreakers: [straightHigh] };
  }
  if (countVals[0] === 4) {
    const quad = byCount[0];
    const kicker = byCount.find(r => counts[r] === 1);
    return { rank: HAND_RANKS.FOUR_OF_A_KIND, tiebreakers: [quad, kicker] };
  }
  if (countVals[0] === 3 && countVals[1] === 2) {
    return { rank: HAND_RANKS.FULL_HOUSE, tiebreakers: [byCount[0], byCount[1]] };
  }
  if (isFlush) {
    return { rank: HAND_RANKS.FLUSH, tiebreakers: ranks };
  }
  if (isStraight) {
    return { rank: HAND_RANKS.STRAIGHT, tiebreakers: [straightHigh] };
  }
  if (countVals[0] === 3) {
    const trips = byCount[0];
    const kickers = byCount.filter(r => counts[r] === 1).sort((a, b) => b - a);
    return { rank: HAND_RANKS.THREE_OF_A_KIND, tiebreakers: [trips, ...kickers] };
  }
  if (countVals[0] === 2 && countVals[1] === 2) {
    const pairs = byCount.filter(r => counts[r] === 2).sort((a, b) => b - a);
    const kicker = byCount.find(r => counts[r] === 1);
    return { rank: HAND_RANKS.TWO_PAIR, tiebreakers: [pairs[0], pairs[1], kicker] };
  }
  if (countVals[0] === 2) {
    const pair = byCount.find(r => counts[r] === 2);
    const kickers = byCount.filter(r => counts[r] === 1).sort((a, b) => b - a);
    return { rank: HAND_RANKS.PAIR, tiebreakers: [pair, ...kickers] };
  }
  return { rank: HAND_RANKS.HIGH_CARD, tiebreakers: ranks };
}

// Compare two evaluated hands. >0 if a beats b, <0 if b beats a, 0 if tie.
function compareEval(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] || 0;
    const bv = b.tiebreakers[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Best 5-card hand out of 5-7 cards.
function evaluateBest(cards) {
  if (cards.length < 5) throw new Error('Need at least 5 cards');
  const combos = cards.length === 5 ? [cards] : combinations(cards, 5);
  let best = null;
  let bestCards = null;
  for (const c of combos) {
    const e = eval5(c);
    if (!best || compareEval(e, best) > 0) { best = e; bestCards = c; }
  }
  return {
    rank: best.rank,
    name: HAND_NAMES_RU[best.rank],
    tiebreakers: best.tiebreakers,
    cards: bestCards,
  };
}

module.exports = { evaluateBest, compareEval, eval5, HAND_RANKS, HAND_NAMES_RU };
