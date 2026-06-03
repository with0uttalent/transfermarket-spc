'use strict';

const SUITS = ['h', 'd', 'c', 's']; // hearts, diamonds, clubs, spades
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

// Fisher-Yates shuffle with Math.random (sufficient for a play-money game).
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function freshShuffledDeck() {
  return shuffle(makeDeck());
}

// Card → short label, e.g. {rank:14,suit:'s'} → 'As'
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
function cardLabel(card) {
  const r = RANK_LABEL[card.rank] || String(card.rank);
  return r + card.suit;
}

module.exports = { makeDeck, shuffle, freshShuffledDeck, cardLabel, SUITS, RANKS };
