const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const BASE_QUERY = `
  SELECT c.*, co.name as country_name, co.flag_emoji
  FROM competitions c
  LEFT JOIN countries co ON c.country_id = co.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(BASE_QUERY + ' ORDER BY c.name').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const comp = db.prepare(BASE_QUERY + ' WHERE c.id = ?').get(req.params.id);
  if (!comp) return res.status(404).json({ error: 'Not found' });

  const teams = db.prepare(`
    SELECT t.*, co.name as country_name, co.flag_emoji
    FROM teams t
    LEFT JOIN countries co ON t.country_id = co.id
    WHERE t.competition_id = ?
    ORDER BY t.market_value DESC
  `).all(req.params.id);

  const titles = db.prepare(`
    SELECT ti.*, t.name as team_name
    FROM titles ti
    LEFT JOIN teams t ON ti.team_id = t.id
    WHERE ti.competition_id = ?
    ORDER BY ti.year DESC
  `).all(req.params.id);

  res.json({ ...comp, teams, titles });
});

router.post('/', requireAuth, (req, res) => {
  const { name, country_id, type, logo_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO competitions (name, country_id, type, logo_url) VALUES (?, ?, ?, ?)'
  ).run(name, country_id || null, type || 'league', logo_url || null);
  res.status(201).json({ id: result.lastInsertRowid, name, country_id, type, logo_url });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, country_id, type, logo_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare(
    'UPDATE competitions SET name=?, country_id=?, type=?, logo_url=? WHERE id=?'
  ).run(name, country_id || null, type || 'league', logo_url || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id), name, country_id, type, logo_url });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM competitions WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
