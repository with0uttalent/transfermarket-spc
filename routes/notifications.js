'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET / — returns notifications for current coach, unread first
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT id FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.json([]);

  const notifs = db.prepare(`
    SELECT * FROM coach_notifications
    WHERE coach_id = ?
    ORDER BY read ASC, created_at DESC
    LIMIT 50
  `).all(coach.id);

  res.json(notifs);
});

// GET /unread-count — returns just the unread count
router.get('/unread-count', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT id FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.json({ count: 0 });

  const row = db.prepare(`SELECT COUNT(*) as count FROM coach_notifications WHERE coach_id=? AND read=0`).get(coach.id);
  res.json({ count: row.count });
});

// POST /read-all — marks all as read for current coach
router.post('/read-all', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT id FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.json({ ok: true });

  db.prepare('UPDATE coach_notifications SET read=1 WHERE coach_id=?').run(coach.id);
  res.json({ ok: true });
});

// POST /:id/read — marks one notification as read
router.post('/:id/read', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT id FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.status(403).json({ error: 'Not a coach' });

  db.prepare('UPDATE coach_notifications SET read=1 WHERE id=? AND coach_id=?').run(req.params.id, coach.id);
  res.json({ ok: true });
});

module.exports = router;
