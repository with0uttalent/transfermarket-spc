const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Public: active banners grouped by position
router.get('/public', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM banners WHERE active=1 ORDER BY position, sort_order, id`).all();
  const result = { left: [], right: [] };
  for (const r of rows) (result[r.position] || []).push(r);
  res.json(result);
});

// Admin: all banners
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT * FROM banners ORDER BY position, sort_order, id`).all());
});

router.post('/', requireAuth, (req, res) => {
  const { position, title, image_url, link_url, active, sort_order } = req.body;
  if (!position) return res.status(400).json({ error: 'position required' });
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO banners (position,title,image_url,link_url,active,sort_order) VALUES (?,?,?,?,?,?)`
  ).run(position, title||null, image_url||null, link_url||null, active===false?0:1, sort_order||0);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const { position, title, image_url, link_url, active, sort_order } = req.body;
  const db = getDb();
  const r = db.prepare(
    `UPDATE banners SET position=?,title=?,image_url=?,link_url=?,active=?,sort_order=? WHERE id=?`
  ).run(position||'left', title||null, image_url||null, link_url||null, active===false?0:1, sort_order||0, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM banners WHERE id=?`).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
