'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireCoach, requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

const POSITION_ORDER = ['Goalkeeper', 'Centre-Back', 'Left-Back', 'Right-Back',
  'Defensive Midfield', 'Central Midfield', 'Attacking Midfield',
  'Left Winger', 'Right Winger', 'Centre-Forward', 'Striker'];

function getMyCoach(db, userId) {
  return db.prepare('SELECT * FROM coaches WHERE user_id=?').get(userId);
}

function canManageTeam(req, db, teamId) {
  if (req.user.role === 'admin') return true;
  const coach = getMyCoach(db, req.user.id);
  return coach && coach.team_id == teamId;
}

// ─── GET /:teamId — get current lineup ───────────────────────────────────────
router.get('/:teamId', (req, res) => {
  const db = getDb();
  const teamId = req.params.teamId;

  const team = db.prepare('SELECT id, name FROM teams WHERE id=?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const lineup = db.prepare(`
    SELECT tl.slot, tl.player_id, tl.position_override, tl.priority_sub,
           p.name AS player_name, p.position, p.shirt_number, p.market_value,
           p.status AS player_status, p.image_url,
           pi.matches_remaining AS injury_matches_remaining,
           pi.injury_type
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    WHERE tl.team_id = ?
    ORDER BY tl.slot ASC
  `).all(teamId);

  res.json({ team_id: parseInt(teamId), team_name: team.name, lineup });
});

// ─── PUT /:teamId — set lineup ────────────────────────────────────────────────
router.put('/:teamId', requireAuth, (req, res) => {
  const db = getDb();
  const teamId = req.params.teamId;

  if (!canManageTeam(req, db, teamId)) {
    return res.status(403).json({ error: 'You can only manage your own team lineup' });
  }

  const team = db.prepare('SELECT id FROM teams WHERE id=?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const { lineup } = req.body;
  if (!Array.isArray(lineup)) {
    return res.status(400).json({ error: 'lineup must be an array of {slot, player_id, position_override?}' });
  }

  // Validate slots (1-22)
  for (const entry of lineup) {
    if (!entry.slot || entry.slot < 1 || entry.slot > 22) {
      return res.status(400).json({ error: `Invalid slot ${entry.slot}. Slots must be between 1 and 22` });
    }
    if (!entry.player_id) {
      return res.status(400).json({ error: 'Each lineup entry must have a player_id' });
    }
    // Validate player belongs to team
    const player = db.prepare('SELECT id, team_id FROM players WHERE id=?').get(entry.player_id);
    if (!player) return res.status(400).json({ error: `Player ${entry.player_id} not found` });
    if (player.team_id != teamId) {
      return res.status(400).json({ error: `Player ${entry.player_id} does not belong to this team` });
    }
  }

  // Check for duplicate slots or player_ids
  const slots = lineup.map(e => e.slot);
  if (new Set(slots).size !== slots.length) {
    return res.status(400).json({ error: 'Duplicate slots in lineup' });
  }
  const playerIds = lineup.map(e => e.player_id);
  if (new Set(playerIds).size !== playerIds.length) {
    return res.status(400).json({ error: 'Duplicate player_ids in lineup' });
  }

  const setLineup = db.transaction(() => {
    // Clear existing lineup
    db.prepare('DELETE FROM team_lineups WHERE team_id=?').run(teamId);

    // Insert new lineup
    const insert = db.prepare(`
      INSERT INTO team_lineups (team_id, player_id, slot, position_override, priority_sub)
      VALUES (?,?,?,?,?)
    `);
    for (const entry of lineup) {
      insert.run(teamId, entry.player_id, entry.slot, entry.position_override || null, entry.priority_sub ? 1 : 0);
    }
  });

  setLineup();

  const updatedLineup = db.prepare(`
    SELECT tl.slot, tl.player_id, tl.position_override, tl.priority_sub,
           p.name AS player_name, p.position, p.shirt_number, p.market_value,
           p.status AS player_status, p.image_url,
           pi.matches_remaining AS injury_matches_remaining,
           pi.injury_type
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    WHERE tl.team_id = ?
    ORDER BY tl.slot ASC
  `).all(teamId);

  res.json({ team_id: parseInt(teamId), lineup: updatedLineup });
});

// ─── POST /:teamId/auto — auto-generate lineup ────────────────────────────────
router.post('/:teamId/auto', requireAuth, (req, res) => {
  const db = getDb();
  const teamId = req.params.teamId;

  if (!canManageTeam(req, db, teamId)) {
    return res.status(403).json({ error: 'You can only manage your own team lineup' });
  }

  const team = db.prepare('SELECT id FROM teams WHERE id=?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  // Get all active non-injured players
  const players = db.prepare(`
    SELECT p.* FROM players p
    WHERE p.team_id = ? AND p.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM player_injuries i WHERE i.player_id = p.id AND i.matches_remaining > 0
      )
    ORDER BY p.market_value DESC
  `).all(teamId);

  // Sort by position order
  const positionPriority = (pos) => {
    const idx = POSITION_ORDER.indexOf(pos);
    return idx === -1 ? 99 : idx;
  };

  players.sort((a, b) => positionPriority(a.position) - positionPriority(b.position));

  const autoLineup = db.transaction(() => {
    db.prepare('DELETE FROM team_lineups WHERE team_id=?').run(teamId);

    const insert = db.prepare(`
      INSERT INTO team_lineups (team_id, player_id, slot, position_override)
      VALUES (?,?,?,?)
    `);

    function posToZone(position) {
      if (!position) return 'MID';
      if (position === 'Goalkeeper') return 'GK';
      if (['Centre-Back','Left-Back','Right-Back'].includes(position)) return 'DEF';
      if (position === 'Defensive Midfield') return 'DMF';
      if (position === 'Central Midfield') return 'MID';
      if (['Attacking Midfield','Left Winger','Right Winger'].includes(position)) return 'AMF';
      if (['Centre-Forward','Striker'].includes(position)) return 'FWD';
      return 'MID';
    }
    let slot = 1;
    for (const player of players) {
      if (slot > 22) break;
      const zone = slot <= 11 ? posToZone(player.position) : null;
      insert.run(teamId, player.id, slot, zone);
      slot++;
    }
  });

  autoLineup();

  const updatedLineup = db.prepare(`
    SELECT tl.slot, tl.player_id, tl.position_override, tl.priority_sub,
           p.name AS player_name, p.position, p.shirt_number, p.market_value,
           p.status AS player_status, p.image_url,
           pi.matches_remaining AS injury_matches_remaining,
           pi.injury_type
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    WHERE tl.team_id = ?
    ORDER BY tl.slot ASC
  `).all(teamId);

  res.json({ team_id: parseInt(teamId), lineup: updatedLineup, auto: true });
});

module.exports = router;
