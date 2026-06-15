const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const BASE_QUERY = `
  SELECT t.*,
    co.name as country_name, co.flag_emoji,
    comp.name as competition_name,
    comp.logo_url as competition_logo_url,
    comp.trophy_url as competition_trophy_url
  FROM teams t
  LEFT JOIN countries co ON t.country_id = co.id
  LEFT JOIN competitions comp ON t.competition_id = comp.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { search, competition_id } = req.query;
  let query = BASE_QUERY;
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push('(t.name LIKE ? OR t.short_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (competition_id) {
    conditions.push('t.competition_id = ?');
    params.push(competition_id);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY t.market_value DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const team = db.prepare(BASE_QUERY + ' WHERE t.id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Not found' });

  const players = db.prepare(`
    SELECT p.*, co.name as nationality_name, co.flag_emoji,
      ps.pace, ps.shooting, ps.passing, ps.defending, ps.physical,
      pi.matches_remaining AS injury_matches_remaining,
      pi.injury_type,
      CASE WHEN ln.id IS NOT NULL THEN 1 ELSE 0 END AS on_loan,
      ln.from_team_id AS loan_from_team_id,
      ft.name AS loan_from_team_name,
      0 AS on_loan_out, NULL AS loan_to_team_id, NULL AS loan_to_team_name, NULL AS loan_to_team_logo
    FROM players p
    LEFT JOIN countries co ON p.nationality_id = co.id
    LEFT JOIN player_skills ps ON ps.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    LEFT JOIN loans ln ON ln.player_id = p.id AND ln.status = 'active' AND ln.to_team_id = p.team_id
    LEFT JOIN teams ft ON ft.id = ln.from_team_id
    WHERE p.team_id = ?
    ORDER BY p.market_value DESC
  `).all(req.params.id);

  // Players loaned OUT from this team (they moved to borrowing team but still "belong" here)
  const loanedOut = db.prepare(`
    SELECT p.*, co.name as nationality_name, co.flag_emoji,
      ps.pace, ps.shooting, ps.passing, ps.defending, ps.physical,
      pi.matches_remaining AS injury_matches_remaining,
      pi.injury_type,
      0 AS on_loan,
      NULL AS loan_from_team_id, NULL AS loan_from_team_name,
      1 AS on_loan_out,
      tt.id AS loan_to_team_id, tt.name AS loan_to_team_name, tt.logo_url AS loan_to_team_logo
    FROM loans ln
    JOIN players p ON ln.player_id = p.id
    LEFT JOIN countries co ON p.nationality_id = co.id
    LEFT JOIN player_skills ps ON ps.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    JOIN teams tt ON tt.id = ln.to_team_id
    WHERE ln.from_team_id = ? AND ln.status = 'active'
    ORDER BY p.market_value DESC
  `).all(req.params.id);

  const allPlayers = [...players, ...loanedOut];

  // Group by competition/tournament so a tournament win shows as a single trophy,
  // even if older data stored one row per participating player.
  const titles = db.prepare(`
    SELECT ti.*,
      comp.name as competition_name,
      COALESCE(ti.trophy_url, comp.trophy_url) as trophy_url,
      comp.logo_url as competition_logo_url
    FROM titles ti
    LEFT JOIN competitions comp ON ti.competition_id = comp.id
    WHERE ti.team_id = ?
    GROUP BY COALESCE(ti.competition_id, ti.tournament_id, ti.id), ti.title_name, ti.year
    ORDER BY ti.year DESC
  `).all(req.params.id);

  const transfers = db.prepare(`
    SELECT tr.*,
      p.name as player_name,
      ft.name as from_team_name,
      tt.name as to_team_name
    FROM transfers tr
    JOIN players p ON tr.player_id = p.id
    LEFT JOIN teams ft ON tr.from_team_id = ft.id
    LEFT JOIN teams tt ON tr.to_team_id = tt.id
    WHERE tr.from_team_id = ? OR tr.to_team_id = ?
    ORDER BY tr.transfer_date DESC
    LIMIT 20
  `).all(req.params.id, req.params.id);

  res.json({ ...team, players: allPlayers, titles, transfers });
});

router.post('/', requireAdmin, (req, res) => {
  const { name, short_name, country_id, competition_id, founded, stadium, logo_url, market_value } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO teams (name, short_name, country_id, competition_id, founded, stadium, logo_url, market_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, short_name || null, country_id || null, competition_id || null,
    founded || null, stadium || null, logo_url || null, market_value || 0);
  res.status(201).json({ id: result.lastInsertRowid, name });
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, short_name, country_id, competition_id, founded, stadium, logo_url, market_value, stadium_url, about_text, team_photo_url, color_primary, color_secondary, color_pattern, goal_banner_url, kit_home_url, kit_away_url, kit_third_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare(`
    UPDATE teams SET name=?, short_name=?, country_id=?, competition_id=?, founded=?, stadium=?, logo_url=?, market_value=?, stadium_url=?, about_text=?, team_photo_url=?, color_primary=?, color_secondary=?, color_pattern=?, goal_banner_url=?, kit_home_url=?, kit_away_url=?, kit_third_url=?
    WHERE id=?
  `).run(name, short_name || null, country_id || null, competition_id || null,
    founded || null, stadium || null, logo_url || null, market_value || 0, stadium_url || null,
    about_text || null, team_photo_url || null,
    color_primary || null, color_secondary || null, color_pattern || 'none',
    goal_banner_url || null, kit_home_url || null, kit_away_url || null, kit_third_url || null,
    req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id), name });
});

router.patch('/:id/about', requireAuth, (req, res) => {
  const db = getDb();
  const id = req.params.id;
  const { about_text, team_photo_url } = req.body;
  // Coaches may only edit their own team's about section
  if (req.user.role !== 'admin') {
    const coach = db.prepare('SELECT team_id FROM coaches WHERE user_id=?').get(req.user.id);
    if (!coach || coach.team_id != id) return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('UPDATE teams SET about_text=?, team_photo_url=? WHERE id=?')
    .run(about_text || null, team_photo_url || null, id);
  res.json({ ok: true });
});

// PATCH /:id/visuals — coach updates team visual fields (logo, banners, kits etc.)
router.patch('/:id/visuals', requireAuth, (req, res) => {
  const db = getDb();
  const id = req.params.id;
  if (req.user.role !== 'admin') {
    const coach = db.prepare('SELECT team_id FROM coaches WHERE user_id=?').get(req.user.id);
    if (!coach || coach.team_id != id) return res.status(403).json({ error: 'Forbidden' });
  }
  const allowed = ['logo_url', 'goal_banner_url', 'team_photo_url', 'stadium_url', 'kit_home_url', 'kit_away_url', 'kit_third_url'];
  const updates = [];
  const values = [];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field}=?`);
      values.push(req.body[field] || null);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields provided' });
  values.push(id);
  db.prepare(`UPDATE teams SET ${updates.join(',')} WHERE id=?`).run(...values);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM teams WHERE id=?').get(id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM league_schedule WHERE home_team_id=? OR away_team_id=?').run(id, id);
      // loans.to_team_id is NOT NULL, so SET NULL FK won't work — delete the rows instead
      db.prepare('DELETE FROM loans WHERE to_team_id=? OR from_team_id=?').run(id, id);
      db.prepare('DELETE FROM teams WHERE id=?').run(id);
    })();
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Team delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
