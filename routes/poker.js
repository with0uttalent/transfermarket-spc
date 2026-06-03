'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireCoach, optionalAuth } = require('../middleware/auth');
const { getPokerManager } = require('../services/poker/PokerManager');

const router = express.Router();

function myCoach(db, userId) {
  return db.prepare('SELECT id, name, avatar_url, team_id FROM coaches WHERE user_id=?').get(userId);
}

// ── GET / — lobby: tables + my stake options ─────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  const db = getDb();
  const mgr = getPokerManager();
  const tables = mgr.listTables();

  let me = null, stakeable = null, budget = null, teamValue = null;
  if (req.user) {
    const coach = myCoach(db, req.user.id);
    if (coach && coach.team_id) {
      const { availableBudget } = require('../services/betting');
      budget = Math.round(availableBudget(db, coach.team_id));
      const tv = db.prepare('SELECT COALESCE(SUM(market_value),0) AS v FROM players WHERE team_id=?').get(coach.team_id);
      teamValue = Math.round(tv.v);
      stakeable = db.prepare(`
        SELECT p.id, p.name, p.position, p.image_url, p.market_value
        FROM players p
        WHERE p.team_id = ? AND p.status='active'
          AND p.id NOT IN (SELECT player_id FROM poker_player_locks)
        ORDER BY p.market_value DESC
        LIMIT 40
      `).all(coach.team_id);
      me = { coachId: coach.id, name: coach.name, teamId: coach.team_id, avatarUrl: coach.avatar_url };
    }
  }

  res.json({ tables, me, stakeable, budget, teamValue, room: mgr.roomList() });
});

// ── GET /history — my team's poker settlement history ────────────────────────
router.get('/history', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.json({ history: [] });
  const history = db.prepare(`
    SELECT id, stake_type, chips_in, chips_out, delta, detail, created_at
    FROM poker_settlements WHERE team_id=?
    ORDER BY created_at DESC LIMIT 50
  `).all(coach.team_id);
  res.json({ history });
});

module.exports = router;
