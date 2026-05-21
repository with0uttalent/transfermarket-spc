'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireCoach } = require('../middleware/auth');

const router = express.Router();

function myCoach(db, userId) {
  return db.prepare('SELECT * FROM coaches WHERE user_id=?').get(userId);
}

// GET / — list challenges for my team (incoming pending + all outgoing)
router.get('/', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.json({ incoming: [], outgoing: [] });

  const incoming = db.prepare(`
    SELECT mc.*, t.name as from_team_name, t.logo_url as from_team_logo
    FROM match_challenges mc
    JOIN teams t ON mc.from_team_id = t.id
    WHERE mc.to_team_id = ? AND mc.status = 'pending'
    ORDER BY mc.created_at DESC
  `).all(coach.team_id);

  const outgoing = db.prepare(`
    SELECT mc.*, t.name as to_team_name, t.logo_url as to_team_logo
    FROM match_challenges mc
    JOIN teams t ON mc.to_team_id = t.id
    WHERE mc.from_team_id = ? AND mc.status IN ('pending','accepted','declined')
    ORDER BY mc.created_at DESC
    LIMIT 20
  `).all(coach.team_id);

  res.json({ incoming, outgoing });
});

// POST / — send a challenge to another team
router.post('/', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.status(400).json({ error: 'Нет команды' });

  const { to_team_id, message } = req.body;
  if (!to_team_id) return res.status(400).json({ error: 'to_team_id обязателен' });
  if (Number(to_team_id) === coach.team_id) return res.status(400).json({ error: 'Нельзя вызвать свою команду' });

  const toTeam = db.prepare('SELECT id, name FROM teams WHERE id=?').get(to_team_id);
  if (!toTeam) return res.status(404).json({ error: 'Команда не найдена' });

  // Check that the target team has a coach
  const toCoach = db.prepare('SELECT id FROM coaches WHERE team_id=?').get(to_team_id);
  if (!toCoach) return res.status(400).json({ error: 'У этой команды нет тренера' });

  // Prevent duplicate pending challenge
  const existing = db.prepare(
    `SELECT id FROM match_challenges WHERE from_team_id=? AND to_team_id=? AND status='pending'`
  ).get(coach.team_id, to_team_id);
  if (existing) return res.status(409).json({ error: 'Вызов уже отправлен и ожидает ответа' });

  const r = db.prepare(
    `INSERT INTO match_challenges (from_team_id, to_team_id, message) VALUES (?,?,?)`
  ).run(coach.team_id, to_team_id, message || null);

  res.status(201).json({ id: r.lastInsertRowid, from_team_id: coach.team_id, to_team_id, status: 'pending' });
});

// PUT /:id/accept
router.put('/:id/accept', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Нет команды' });

  const challenge = db.prepare('SELECT * FROM match_challenges WHERE id=?').get(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Вызов не найден' });
  if (challenge.to_team_id !== coach.team_id) return res.status(403).json({ error: 'Это не ваш вызов' });
  if (challenge.status !== 'pending') return res.status(400).json({ error: 'Вызов уже обработан' });

  // Create the friendly match
  const today = new Date().toISOString().substring(0, 10);
  const matchResult = db.prepare(
    `INSERT INTO matches (home_team_id, away_team_id, match_date, is_friendly) VALUES (?,?,?,1)`
  ).run(challenge.from_team_id, challenge.to_team_id, today);

  db.prepare(
    `UPDATE match_challenges SET status='accepted', match_id=? WHERE id=?`
  ).run(matchResult.lastInsertRowid, challenge.id);

  const fromTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(challenge.from_team_id);
  const toTeam   = db.prepare('SELECT name FROM teams WHERE id=?').get(challenge.to_team_id);
  db.prepare(`INSERT INTO news (title, body, type, match_id) VALUES (?,?,?,?)`)
    .run(
      `Товарищеский матч: ${fromTeam.name} vs ${toTeam.name}`,
      `${toTeam.name} приняли вызов на товарищеский матч от ${fromTeam.name}.`,
      'match', matchResult.lastInsertRowid
    );

  res.json({ match_id: matchResult.lastInsertRowid, status: 'accepted' });
});

// PUT /:id/decline
router.put('/:id/decline', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Нет команды' });

  const challenge = db.prepare('SELECT * FROM match_challenges WHERE id=?').get(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Вызов не найден' });
  if (challenge.to_team_id !== coach.team_id) return res.status(403).json({ error: 'Это не ваш вызов' });
  if (challenge.status !== 'pending') return res.status(400).json({ error: 'Вызов уже обработан' });

  db.prepare(`UPDATE match_challenges SET status='declined' WHERE id=?`).run(challenge.id);
  res.json({ status: 'declined' });
});

// DELETE /:id — sender cancels their own pending challenge
router.delete('/:id', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Нет команды' });

  const challenge = db.prepare('SELECT * FROM match_challenges WHERE id=?').get(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Вызов не найден' });
  if (challenge.from_team_id !== coach.team_id && challenge.to_team_id !== coach.team_id) return res.status(403).json({ error: 'Не ваш вызов' });

  db.prepare('DELETE FROM match_challenges WHERE id=?').run(challenge.id);
  res.json({ ok: true });
});

module.exports = router;
