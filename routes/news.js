const express = require('express');
const { getDb } = require('../database/db');
const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare(`
    SELECT n.*,
      m.home_score, m.away_score,
      ht.name as home_team_name, at.name as away_team_name,
      t.name as tournament_name
    FROM news n
    LEFT JOIN matches m ON n.match_id = m.id
    LEFT JOIN teams ht ON m.home_team_id = ht.id
    LEFT JOIN teams at ON m.away_team_id = at.id
    LEFT JOIN tournaments t ON n.tournament_id = t.id
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM news`).get().c;
  res.json({ rows, total });
});

module.exports = router;
