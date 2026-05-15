const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const BASE_QUERY = `
  SELECT ti.*,
    t.name as team_name,
    p.name as player_name,
    comp.name as competition_name
  FROM titles ti
  LEFT JOIN teams t ON ti.team_id = t.id
  LEFT JOIN players p ON ti.player_id = p.id
  LEFT JOIN competitions comp ON ti.competition_id = comp.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { team_id, player_id } = req.query;
  let query = BASE_QUERY;
  const params = [];
  const conditions = [];

  if (team_id) {
    conditions.push('ti.team_id = ?');
    params.push(team_id);
  }
  if (player_id) {
    conditions.push('ti.player_id = ?');
    params.push(player_id);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY ti.year DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

router.post('/', requireAuth, (req, res) => {
  const { team_id, player_id, competition_id, title_name, season, year } = req.body;
  if (!title_name) return res.status(400).json({ error: 'title_name required' });
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO titles (team_id, player_id, competition_id, title_name, season, year)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(team_id || null, player_id || null, competition_id || null, title_name, season || null, year || null);
  res.status(201).json({ id: result.lastInsertRowid, title_name });
});

router.put('/:id', requireAuth, (req, res) => {
  const { team_id, player_id, competition_id, title_name, season, year } = req.body;
  if (!title_name) return res.status(400).json({ error: 'title_name required' });
  const db = getDb();
  const result = db.prepare(`
    UPDATE titles SET team_id=?, player_id=?, competition_id=?, title_name=?, season=?, year=?
    WHERE id=?
  `).run(team_id || null, player_id || null, competition_id || null, title_name, season || null, year || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id), title_name });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM titles WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
