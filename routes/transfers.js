const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const BASE_QUERY = `
  SELECT tr.*,
    p.name as player_name, p.position, p.image_url as player_image,
    ft.name as from_team_name,
    tt.name as to_team_name
  FROM transfers tr
  JOIN players p ON tr.player_id = p.id
  LEFT JOIN teams ft ON tr.from_team_id = ft.id
  LEFT JOIN teams tt ON tr.to_team_id = tt.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { player_id, team_id, limit } = req.query;
  let query = BASE_QUERY;
  const params = [];
  const conditions = [];

  if (player_id) {
    conditions.push('tr.player_id = ?');
    params.push(player_id);
  }
  if (team_id) {
    conditions.push('(tr.from_team_id = ? OR tr.to_team_id = ?)');
    params.push(team_id, team_id);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY tr.transfer_date DESC';
  if (limit) query += ' LIMIT ' + parseInt(limit, 10);

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(BASE_QUERY + ' WHERE tr.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', requireAuth, (req, res) => {
  const { player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes } = req.body;
  if (!player_id) return res.status(400).json({ error: 'player_id required' });
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(player_id, from_team_id || null, to_team_id || null,
    transfer_fee || 0, transfer_date || null, transfer_type || 'permanent', notes || null);

  // Update player's team
  if (to_team_id) {
    db.prepare('UPDATE players SET team_id = ? WHERE id = ?').run(to_team_id, player_id);
    // Recalculate team market values
    const newTeamTotal = db.prepare('SELECT SUM(market_value) as total FROM players WHERE team_id = ?').get(to_team_id);
    db.prepare('UPDATE teams SET market_value = ? WHERE id = ?').run(newTeamTotal.total || 0, to_team_id);
  }
  if (from_team_id) {
    const oldTeamTotal = db.prepare('SELECT SUM(market_value) as total FROM players WHERE team_id = ?').get(from_team_id);
    db.prepare('UPDATE teams SET market_value = ? WHERE id = ?').run(oldTeamTotal.total || 0, from_team_id);
  }

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const { player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes } = req.body;
  if (!player_id) return res.status(400).json({ error: 'player_id required' });
  const db = getDb();
  const result = db.prepare(`
    UPDATE transfers SET player_id=?, from_team_id=?, to_team_id=?, transfer_fee=?, transfer_date=?, transfer_type=?, notes=?
    WHERE id=?
  `).run(player_id, from_team_id || null, to_team_id || null,
    transfer_fee || 0, transfer_date || null, transfer_type || 'permanent', notes || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM transfers WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
