'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireCoach, optionalAuth } = require('../middleware/auth');
const betting = require('../services/betting');

const router = express.Router();

const VALID_OUTCOMES = ['home', 'draw', 'away'];

// Bets open only once the coaches' lineups are locked — i.e. from
// LINEUP_LOCK_HOURS before kickoff until the match starts. Must match the
// value used in routes/lineups.js.
const LINEUP_LOCK_HOURS = 12;

// SQLite expression for a match's kickoff datetime (local wall-clock).
const KICKOFF_SQL = `datetime(m.match_date || ' ' || COALESCE(substr(m.match_time,1,5),'16:00') || ':00')`;

function getMyCoach(db, userId) {
  return db.prepare('SELECT * FROM coaches WHERE user_id=?').get(userId);
}

// ─── GET / — bettable matches with live odds (+ my open bets if coach) ────────
router.get('/', optionalAuth, (req, res) => {
  const db = getDb();

  // Only matches whose lineups are already locked (kickoff − 12h ≤ now) and
  // that haven't kicked off yet are open for betting.
  const matches = db.prepare(`
    SELECT m.id, m.home_team_id, m.away_team_id, m.match_date, m.match_time, m.matchday, m.league_id,
           ht.name AS home_team_name, ht.logo_url AS home_logo,
           at.name AS away_team_name, at.logo_url AS away_logo,
           lg.name AS league_name
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    LEFT JOIN leagues lg ON m.league_id = lg.id
    WHERE m.status = 'scheduled' AND m.league_id IS NOT NULL
      AND ${KICKOFF_SQL} > datetime('now','localtime')
      AND ${KICKOFF_SQL} <= datetime('now','localtime','+${LINEUP_LOCK_HOURS} hours')
    ORDER BY m.match_date ASC, m.match_time ASC
    LIMIT 60
  `).all();

  // My open bets keyed by match
  let myBets = {};
  let myCoach = null;
  if (req.user) {
    myCoach = getMyCoach(db, req.user.id);
    if (myCoach) {
      const rows = db.prepare(`SELECT * FROM bets WHERE coach_id=? AND status='open'`).all(myCoach.id);
      for (const b of rows) {
        (myBets[b.match_id] = myBets[b.match_id] || []).push({ outcome: b.outcome, amount: b.amount, odds: b.odds });
      }
    }
  }

  const result = matches.map(m => {
    const odds = betting.currentOdds(db, m);
    return { ...m, odds, my_bets: myBets[m.id] || [] };
  });

  const free = myCoach && myCoach.team_id ? betting.availableBudget(db, myCoach.team_id) : null;
  res.json({ matches: result, free_budget: free, min_bet: betting.MIN_BET, is_coach: !!myCoach });
});

// ─── GET /mine — my bet history ───────────────────────────────────────────────
router.get('/mine', requireCoach, (req, res) => {
  const db = getDb();
  const coach = getMyCoach(db, req.user.id);
  if (!coach) return res.status(404).json({ error: 'Coach profile not found' });

  const bets = db.prepare(`
    SELECT b.*, m.match_date, m.match_time, m.status AS match_status,
           m.home_score, m.away_score,
           ht.name AS home_team_name, ht.logo_url AS home_logo,
           at.name AS away_team_name, at.logo_url AS away_logo,
           lg.name AS league_name
    FROM bets b
    JOIN matches m ON b.match_id = m.id
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    LEFT JOIN leagues lg ON m.league_id = lg.id
    WHERE b.coach_id = ?
    ORDER BY b.created_at DESC
    LIMIT 100
  `).all(coach.id);

  const free = coach.team_id ? betting.availableBudget(db, coach.team_id) : 0;
  res.json({ bets, free_budget: free });
});

// ─── POST / — place a bet ─────────────────────────────────────────────────────
router.post('/', requireCoach, (req, res) => {
  const db = getDb();
  const coach = getMyCoach(db, req.user.id);
  if (!coach) return res.status(404).json({ error: 'Coach profile not found' });
  if (!coach.team_id) return res.status(400).json({ error: 'У вас нет команды для ставок' });

  const { match_id, outcome } = req.body;
  const amount = Math.round(Number(req.body.amount));

  if (!VALID_OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Неверный исход' });
  if (!Number.isFinite(amount) || amount < betting.MIN_BET) {
    return res.status(400).json({ error: `Минимальная ставка — ${betting.MIN_BET.toLocaleString()} €` });
  }

  const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(match_id);
  if (!match) return res.status(404).json({ error: 'Матч не найден' });
  if (match.status !== 'scheduled') return res.status(400).json({ error: 'Ставки на этот матч закрыты' });
  if (!match.league_id) return res.status(400).json({ error: 'Ставки доступны только на матчи лиги' });

  // Match must not have kicked off yet
  const kickoff = new Date(`${match.match_date}T${(match.match_time || '16:00').slice(0, 5)}:00`);
  const now = new Date();
  if (!isNaN(kickoff.getTime())) {
    if (now >= kickoff) {
      return res.status(400).json({ error: 'Матч уже начался — ставки закрыты' });
    }
    // Bets open only after lineups are locked (kickoff − LINEUP_LOCK_HOURS).
    const opensAt = new Date(kickoff.getTime() - LINEUP_LOCK_HOURS * 3600 * 1000);
    if (now < opensAt) {
      const opens = opensAt.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return res.status(400).json({
        error: `Ставки откроются после блокировки составов — за ${LINEUP_LOCK_HOURS} ч до матча (с ${opens}).`,
      });
    }
  }

  // No arbitrage: can't bet on a different outcome of a match you've already
  // bet on (only the same outcome may be topped up).
  const existing = db.prepare(
    `SELECT DISTINCT outcome FROM bets WHERE match_id=? AND coach_id=? AND status='open'`
  ).all(match_id, coach.id);
  if (existing.some(b => b.outcome !== outcome)) {
    const label = { home: 'победу хозяев', draw: 'ничью', away: 'победу гостей' };
    return res.status(400).json({
      error: `Вы уже поставили на ${label[existing[0].outcome]} в этом матче. Ставить на другой исход нельзя.`,
    });
  }

  const free = betting.availableBudget(db, coach.team_id);
  if (amount > free) {
    return res.status(400).json({ error: `Недостаточно средств. Доступно: ${Math.round(free).toLocaleString()} €` });
  }

  const odds = betting.currentOdds(db, match)[outcome];

  const placed = db.transaction(() => {
    db.prepare(`INSERT INTO bets (match_id, coach_id, team_id, outcome, amount, odds) VALUES (?,?,?,?,?,?)`)
      .run(match_id, coach.id, coach.team_id, outcome, amount, odds);
    db.prepare(`UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?`)
      .run(amount, coach.team_id);
  });
  placed();

  res.json({ ok: true, odds, potential_payout: Math.round(amount * odds), free_budget: betting.availableBudget(db, coach.team_id) });
});

module.exports = router;
