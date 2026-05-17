const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireCoach } = require('../middleware/auth');

const router = express.Router();

const BASE_QUERY = `
  SELECT p.*,
    co.name as nationality_name, co.flag_emoji,
    t.name as team_name, t.id as team_id
  FROM players p
  LEFT JOIN countries co ON p.nationality_id = co.id
  LEFT JOIN teams t ON p.team_id = t.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { search, team_id, position, status } = req.query;
  let query = BASE_QUERY;
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push('p.name LIKE ?');
    params.push(`%${search}%`);
  }
  if (team_id) {
    conditions.push('p.team_id = ?');
    params.push(team_id);
  }
  if (position) {
    conditions.push('p.position = ?');
    params.push(position);
  }
  if (status) {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY p.market_value DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const player = db.prepare(BASE_QUERY + ' WHERE p.id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Not found' });

  const transfers = db.prepare(`
    SELECT tr.*,
      ft.name as from_team_name,
      tt.name as to_team_name
    FROM transfers tr
    LEFT JOIN teams ft ON tr.from_team_id = ft.id
    LEFT JOIN teams tt ON tr.to_team_id = tt.id
    WHERE tr.player_id = ?
    ORDER BY tr.transfer_date DESC
  `).all(req.params.id);

  const titles = db.prepare(`
    SELECT ti.*, comp.name as competition_name, t.name as team_name
    FROM titles ti
    LEFT JOIN competitions comp ON ti.competition_id = comp.id
    LEFT JOIN teams t ON ti.team_id = t.id
    WHERE ti.player_id = ?
    ORDER BY ti.year DESC
  `).all(req.params.id);

  const marketHistory = db.prepare(`
    SELECT market_value, recorded_at
    FROM market_value_history
    WHERE player_id = ?
    ORDER BY recorded_at ASC
    LIMIT 20
  `).all(req.params.id);

  res.json({ ...player, transfers, titles, market_value_history: marketHistory });
});

router.post('/', requireAuth, (req, res) => {
  const { name, date_of_birth, nationality_id, position, sub_position, foot, height, team_id, shirt_number, market_value, image_url, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO players (name, date_of_birth, nationality_id, position, sub_position, foot, height, team_id, shirt_number, market_value, image_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, date_of_birth || null, nationality_id || null, position || null,
    sub_position || null, foot || null, height || null, team_id || null,
    shirt_number || null, market_value || 0, image_url || null, status || 'active');

  if (market_value > 0) {
    db.prepare('INSERT INTO market_value_history (player_id, market_value) VALUES (?, ?)').run(result.lastInsertRowid, market_value);
  }

  res.status(201).json({ id: result.lastInsertRowid, name });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, date_of_birth, nationality_id, position, sub_position, foot, height, team_id, shirt_number, market_value, image_url, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = getDb();

  const existing = db.prepare('SELECT market_value FROM players WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const result = db.prepare(`
    UPDATE players SET name=?, date_of_birth=?, nationality_id=?, position=?, sub_position=?, foot=?, height=?, team_id=?, shirt_number=?, market_value=?, image_url=?, status=?
    WHERE id=?
  `).run(name, date_of_birth || null, nationality_id || null, position || null,
    sub_position || null, foot || null, height || null, team_id || null,
    shirt_number || null, market_value || 0, image_url || null, status || 'active', req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

  // Record market value history if changed
  if (market_value !== undefined && market_value !== existing.market_value) {
    db.prepare('INSERT INTO market_value_history (player_id, market_value) VALUES (?, ?)').run(req.params.id, market_value);
  }

  // Update team's total market value
  if (team_id) {
    const total = db.prepare('SELECT SUM(market_value) as total FROM players WHERE team_id = ?').get(team_id);
    db.prepare('UPDATE teams SET market_value = ? WHERE id = ?').run(total.total || 0, team_id);
  }

  res.json({ id: Number(req.params.id), name });
});

// ─── PATCH /:id — coach edits name/nationality of own team's player ───────────
router.patch('/:id', requireCoach, (req, res) => {
  const db = getDb();
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Not found' });

  if (req.user.role !== 'admin') {
    const coach = db.prepare('SELECT team_id FROM coaches WHERE user_id=?').get(req.user.id);
    if (!coach || coach.team_id !== player.team_id) {
      return res.status(403).json({ error: 'You can only edit players on your own team' });
    }
  }

  const { name, nationality_id } = req.body;
  if (name !== undefined && !name) return res.status(400).json({ error: 'Name cannot be empty' });
  const newName = name !== undefined ? name : player.name;
  const newNat  = nationality_id !== undefined ? (nationality_id || null) : player.nationality_id;
  db.prepare('UPDATE players SET name=?, nationality_id=? WHERE id=?').run(newName, newNat, player.id);

  // Re-fetch to return updated record
  const updated = db.prepare(`SELECT p.*, co.name as nationality_name, co.flag_emoji FROM players p LEFT JOIN countries co ON p.nationality_id=co.id WHERE p.id=?`).get(player.id);
  res.json(updated);
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM players WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

router.get('/:id/skills', (req, res) => {
  const db = getDb();
  let skills = db.prepare(`SELECT * FROM player_skills WHERE player_id=?`).get(req.params.id);
  if (!skills) {
    // Lazy initialize skills for this player
    const player = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
    if (!player) return res.status(404).json({ error: 'Not found' });
    const mv   = player.market_value || 500000;
    const base = Math.min(88, Math.max(38, Math.round(52 + (Math.log10(Math.max(mv, 100000)) - 5) * 13)));
    const v    = () => Math.round((Math.random() - 0.5) * 22);
    const pos  = player.position || '';
    let pace, shooting, passing, defending, physical;
    if (pos === 'Goalkeeper') {
      pace = base-12+v(); shooting = base-18+v(); passing = base-8+v(); defending = base+8+v(); physical = base+2+v();
    } else if (['Centre-Back','Left-Back','Right-Back'].includes(pos)) {
      pace = base+2+v(); shooting = base-14+v(); passing = base-4+v(); defending = base+12+v(); physical = base+10+v();
    } else if (pos === 'Defensive Midfield') {
      pace = base-4+v(); shooting = base-10+v(); passing = base+8+v(); defending = base+10+v(); physical = base+4+v();
    } else if (['Central Midfield','Attacking Midfield'].includes(pos)) {
      pace = base+2+v(); shooting = base+2+v(); passing = base+12+v(); defending = base-8+v(); physical = base+v();
    } else if (['Left Winger','Right Winger'].includes(pos)) {
      pace = base+14+v(); shooting = base+4+v(); passing = base+6+v(); defending = base-14+v(); physical = base-8+v();
    } else {
      pace = base+10+v(); shooting = base+16+v(); passing = base-4+v(); defending = base-18+v(); physical = base+4+v();
    }
    const clamp = x => Math.min(99, Math.max(25, x));
    db.prepare(`INSERT INTO player_skills (player_id, pace, shooting, passing, defending, physical) VALUES (?,?,?,?,?,?)`)
      .run(player.id, clamp(pace), clamp(shooting), clamp(passing), clamp(defending), clamp(physical));
    skills = db.prepare(`SELECT * FROM player_skills WHERE player_id=?`).get(req.params.id);
  }
  // Also include injury status
  const injury = db.prepare(`SELECT * FROM player_injuries WHERE player_id=? AND matches_remaining>0`).get(req.params.id);
  res.json({ ...skills, injury: injury || null });
});

router.get('/:id/career-stats', (req, res) => {
  const db = getDb();
  const agg = db.prepare(`
    SELECT
      COUNT(*) as matches_played,
      SUM(goals) as total_goals,
      SUM(assists) as total_assists,
      SUM(yellow_cards) as total_yellow_cards,
      SUM(red_cards) as total_red_cards,
      AVG(rating) as avg_rating,
      MAX(rating) as best_rating
    FROM player_match_stats WHERE player_id = ?
  `).get(req.params.id);

  const achCounts = db.prepare(`
    SELECT achievement_type, COUNT(*) as cnt
    FROM player_achievements WHERE player_id = ?
    GROUP BY achievement_type
  `).all(req.params.id);

  const achMap = {};
  for (const a of achCounts) achMap[a.achievement_type] = a.cnt;

  res.json({
    matches_played: agg?.matches_played || 0,
    total_goals:    agg?.total_goals || 0,
    total_assists:  agg?.total_assists || 0,
    total_yellow_cards: agg?.total_yellow_cards || 0,
    total_red_cards:    agg?.total_red_cards || 0,
    avg_rating:     agg?.avg_rating ? parseFloat(agg.avg_rating.toFixed(2)) : null,
    best_rating:    agg?.best_rating ? parseFloat(agg.best_rating.toFixed(2)) : null,
    hat_tricks:       achMap.hat_trick || 0,
    braces:           achMap.brace || 0,
    motm_awards:      achMap.man_of_the_match || 0,
    clean_sheets:     achMap.clean_sheet || 0,
    tournament_wins:  achMap.tournament_winner || 0,
  });
});

router.get('/:id/achievements', (req, res) => {
  const db = getDb();
  const achievements = db.prepare(`
    SELECT pa.*,
      m.match_date, m.home_score, m.away_score,
      ht.name as home_team_name, at.name as away_team_name,
      t.name as tournament_name
    FROM player_achievements pa
    LEFT JOIN matches m ON pa.match_id = m.id
    LEFT JOIN teams ht ON m.home_team_id = ht.id
    LEFT JOIN teams at ON m.away_team_id = at.id
    LEFT JOIN tournaments t ON pa.tournament_id = t.id
    WHERE pa.player_id = ?
    ORDER BY pa.created_at DESC
  `).all(req.params.id);
  res.json(achievements);
});

router.get('/:id/match-stats', (req, res) => {
  const db = getDb();
  const stats = db.prepare(`
    SELECT pms.*,
      m.match_date, m.home_score, m.away_score, m.status,
      ht.name as home_team_name, at.name as away_team_name
    FROM player_match_stats pms
    JOIN matches m ON pms.match_id = m.id
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    WHERE pms.player_id = ?
    ORDER BY m.match_date DESC
    LIMIT 20
  `).all(req.params.id);
  res.json(stats);
});

module.exports = router;
