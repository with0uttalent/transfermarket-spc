const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM countries ORDER BY name').all();
  res.json(rows);
});

router.post('/', requireAuth, (req, res) => {
  const { name, code, flag_emoji } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare('INSERT INTO countries (name, code, flag_emoji) VALUES (?, ?, ?)').run(name, code || null, flag_emoji || null);
  res.status(201).json({ id: result.lastInsertRowid, name, code, flag_emoji });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, code, flag_emoji } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare('UPDATE countries SET name=?, code=?, flag_emoji=? WHERE id=?').run(name, code || null, flag_emoji || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id), name, code, flag_emoji });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE teams SET country_id=NULL WHERE country_id=?').run(req.params.id);
  db.prepare('UPDATE players SET nationality_id=NULL WHERE nationality_id=?').run(req.params.id);
  db.prepare('UPDATE competitions SET country_id=NULL WHERE country_id=?').run(req.params.id);
  const result = db.prepare('DELETE FROM countries WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
