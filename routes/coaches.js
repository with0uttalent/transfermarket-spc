'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAdmin, requireCoach, requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── GET / — list all coaches ─────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const coaches = db.prepare(`
    SELECT c.*, u.username, t.name AS team_name, t.logo_url AS team_logo_url
    FROM coaches c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN teams t ON c.team_id = t.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(coaches);
});

// ─── GET /me — get my coach profile ──────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare(`
    SELECT c.*, u.username, t.name AS team_name, t.logo_url AS team_logo_url
    FROM coaches c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE c.user_id = ?
  `).get(req.user.id);

  if (!coach) return res.status(404).json({ error: 'No coach profile found for your account' });
  res.json(coach);
});

// ─── GET /:id — get coach by id ───────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const coach = db.prepare(`
    SELECT c.*, u.username, t.name AS team_name, t.logo_url AS team_logo_url
    FROM coaches c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!coach) return res.status(404).json({ error: 'Coach not found' });
  res.json(coach);
});

// ─── POST / — create coach (admin only) ──────────────────────────────────────
router.post('/', requireAdmin, (req, res) => {
  const { user_id, team_id, name, age, height, playing_style, description, avatar_url } = req.body;
  if (!user_id || !name) {
    return res.status(400).json({ error: 'user_id and name are required' });
  }

  const db = getDb();
  // Validate user exists
  const user = db.prepare('SELECT id, role FROM users WHERE id=?').get(user_id);
  if (!user) return res.status(400).json({ error: 'User not found' });

  // Check for existing coach record
  const existing = db.prepare('SELECT id FROM coaches WHERE user_id=?').get(user_id);
  if (existing) return res.status(409).json({ error: 'Coach record already exists for this user' });

  // Validate team if provided
  if (team_id) {
    const team = db.prepare('SELECT id FROM teams WHERE id=?').get(team_id);
    if (!team) return res.status(400).json({ error: 'Team not found' });
  }

  const result = db.prepare(`
    INSERT INTO coaches (user_id, team_id, name, avatar_url, age, height, playing_style, description)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(user_id, team_id || null, name, avatar_url || null, age || null, height || null,
         playing_style || '4-4-2', description || null);

  // Set user role to coach
  db.prepare("UPDATE users SET role='coach' WHERE id=?").run(user_id);

  const coach = db.prepare(`
    SELECT c.*, u.username, t.name AS team_name
    FROM coaches c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE c.id=?
  `).get(result.lastInsertRowid);

  res.status(201).json(coach);
});

// ─── PUT /:id — update coach ──────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE id=?').get(req.params.id);
  if (!coach) return res.status(404).json({ error: 'Coach not found' });

  const isAdmin = req.user.role === 'admin';
  const isOwn = coach.user_id === req.user.id;

  if (!isAdmin && !isOwn) {
    return res.status(403).json({ error: 'You can only update your own coach profile' });
  }

  const { name, age, height, playing_style, description, avatar_url,
          team_id, team_name, team_logo_url } = req.body;

  // Admin can reassign coach to any team
  if (isAdmin && team_id !== undefined) {
    const newTeam = db.prepare('SELECT id FROM teams WHERE id=?').get(team_id);
    if (!newTeam) return res.status(400).json({ error: 'Team not found' });
    // Remove old assignment for any other coach on this team
    db.prepare("UPDATE coaches SET team_id=NULL WHERE team_id=? AND id!=?").run(team_id, coach.id);
    db.prepare("UPDATE coaches SET team_id=? WHERE id=?").run(team_id, coach.id);
  }

  // Handle team name change (coach only, during transfer window)
  if ((team_name !== undefined || team_logo_url !== undefined) && coach.team_id) {
    if (!isAdmin) {
      // Check if we're in a transfer window for any active league that includes this team
      const activeLeague = db.prepare(`
        SELECT l.* FROM leagues l
        JOIN league_standings ls ON ls.league_id = l.id
        WHERE ls.team_id = ? AND l.status = 'transfer_window'
        LIMIT 1
      `).get(coach.team_id);

      if (!activeLeague) {
        return res.status(403).json({ error: 'Team name/logo can only be changed during a transfer window' });
      }

      // Check how many times they've changed name this season
      if (coach.season_name_changes >= 1) {
        return res.status(403).json({ error: 'Team name can only be changed once per season' });
      }

      // Apply team name/logo change
      if (team_name !== undefined) {
        db.prepare('UPDATE teams SET name=? WHERE id=?').run(team_name, coach.team_id);
      }
      if (team_logo_url !== undefined) {
        db.prepare('UPDATE teams SET logo_url=? WHERE id=?').run(team_logo_url, coach.team_id);
      }

      // Increment season_name_changes
      db.prepare('UPDATE coaches SET season_name_changes = season_name_changes + 1 WHERE id=?').run(coach.id);
    } else {
      // Admin can always change team name/logo without restrictions
      if (team_name !== undefined) {
        db.prepare('UPDATE teams SET name=? WHERE id=?').run(team_name, coach.team_id);
      }
      if (team_logo_url !== undefined) {
        db.prepare('UPDATE teams SET logo_url=? WHERE id=?').run(team_logo_url, coach.team_id);
      }
    }
  }

  db.prepare(`
    UPDATE coaches
    SET name = COALESCE(?, name),
        age = COALESCE(?, age),
        height = COALESCE(?, height),
        playing_style = COALESCE(?, playing_style),
        description = COALESCE(?, description),
        avatar_url = COALESCE(?, avatar_url)
    WHERE id = ?
  `).run(name || null, age || null, height || null, playing_style || null,
         description || null, avatar_url || null, coach.id);

  const updated = db.prepare(`
    SELECT c.*, u.username, t.name AS team_name, t.logo_url AS team_logo_url
    FROM coaches c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE c.id=?
  `).get(coach.id);

  res.json(updated);
});

// ─── DELETE /:id (admin only) ─────────────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE id=?').get(req.params.id);
  if (!coach) return res.status(404).json({ error: 'Coach not found' });

  db.prepare('DELETE FROM coaches WHERE id=?').run(coach.id);
  // Demote user back to admin role (or keep, admin decides)
  res.json({ message: 'Coach deleted' });
});

// ─── POST /me/news — coach posts team news ────────────────────────────────────
router.post('/me/news', requireCoach, (req, res) => {
  const db = getDb();

  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.status(404).json({ error: 'No coach profile found for your account' });
  if (!coach.team_id) return res.status(400).json({ error: 'Coach is not assigned to a team' });

  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  const result = db.prepare(`
    INSERT INTO news (title, body, type, team_id)
    VALUES (?,?,'team',?)
  `).run(title, body, coach.team_id);

  res.status(201).json({
    id: result.lastInsertRowid,
    title,
    body,
    type: 'team',
    team_id: coach.team_id,
  });
});

module.exports = router;
