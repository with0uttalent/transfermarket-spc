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

const LINEUP_LOCK_HOURS = 12;

// Returns lock info for a team's next upcoming league match. The starting XI is
// frozen from LINEUP_LOCK_HOURS before kickoff (so it can't be changed once
// betting is in full swing). Returns { locked, kickoff, lockedAt, opponent } or
// { locked:false } if no imminent match.
function lineupLockInfo(db, teamId) {
  // Earliest unplayed league fixture involving this team.
  const row = db.prepare(`
    SELECT ls.scheduled_date AS d,
           COALESCE(ls.scheduled_time, l.match_start_time, '16:00') AS t,
           ls.home_team_id, ls.away_team_id,
           ht.name AS home_name, at.name AS away_name
    FROM league_schedule ls
    JOIN leagues l ON ls.league_id = l.id
    JOIN teams ht ON ls.home_team_id = ht.id
    JOIN teams at ON ls.away_team_id = at.id
    WHERE l.status = 'active'
      AND ls.match_id IS NULL
      AND (ls.home_team_id = ? OR ls.away_team_id = ?)
      AND ls.scheduled_date IS NOT NULL
    ORDER BY ls.scheduled_date ASC, t ASC
    LIMIT 1
  `).get(teamId, teamId);

  if (!row) return { locked: false };

  const kickoff = new Date(`${row.d}T${(row.t || '16:00').slice(0, 5)}:00`);
  if (isNaN(kickoff.getTime())) return { locked: false };

  const lockedAt = new Date(kickoff.getTime() - LINEUP_LOCK_HOURS * 3600 * 1000);
  const locked = Date.now() >= lockedAt.getTime();
  const opponent = row.home_team_id == teamId ? row.away_name : row.home_name;

  return {
    locked,
    kickoff: kickoff.toISOString(),
    lockedAt: lockedAt.toISOString(),
    opponent,
    lock_hours: LINEUP_LOCK_HOURS,
  };
}

// Guard for mutating routes: blocks coaches (not admins) within the lock window.
function assertLineupUnlocked(req, db, teamId, res) {
  if (req.user.role === 'admin') return true;
  const info = lineupLockInfo(db, teamId);
  if (info.locked) {
    const ko = new Date(info.kickoff).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    res.status(403).json({
      error: `Состав заблокирован за ${LINEUP_LOCK_HOURS} ч до матча (${info.opponent}, ${ko}). Изменить расстановку уже нельзя.`,
      lineup_locked: true,
      lock: info,
    });
    return false;
  }
  return true;
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
           COALESCE(p.stamina, 100) AS stamina,
           pi.matches_remaining AS injury_matches_remaining,
           pi.injury_type
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    WHERE tl.team_id = ?
    ORDER BY tl.slot ASC
  `).all(teamId);

  // Manual infirmary (lazaret) players — resting, excluded from match squads.
  const infirmary = db.prepare(`
    SELECT pi.player_id, pi.added_at,
           p.name AS player_name, p.position, p.shirt_number, p.market_value,
           p.image_url, COALESCE(p.stamina, 100) AS stamina,
           pinj.matches_remaining AS injury_matches_remaining, pinj.injury_type
    FROM player_infirmary pi
    JOIN players p ON pi.player_id = p.id
    LEFT JOIN player_injuries pinj ON pinj.player_id = p.id AND pinj.matches_remaining > 0
    WHERE pi.team_id = ? AND p.team_id = ?
    ORDER BY pi.added_at DESC
  `).all(teamId, teamId);

  res.json({ team_id: parseInt(teamId), team_name: team.name, lineup, infirmary, lock: lineupLockInfo(db, teamId) });
});

// ─── POST /:teamId/infirmary — move a player into the lazaret ─────────────────
// Resting players recover stamina and are NOT called up (starters or subs).
router.post('/:teamId/infirmary', requireAuth, (req, res) => {
  const db = getDb();
  const teamId = req.params.teamId;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'You can only manage your own team' });

  const playerId = req.body.player_id;
  const player = db.prepare('SELECT id, team_id FROM players WHERE id=?').get(playerId);
  if (!player || player.team_id != teamId) return res.status(404).json({ error: 'Player not on this team' });

  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO player_infirmary (player_id, team_id) VALUES (?,?)').run(playerId, teamId);
    // Remove from the active lineup so the slot-based starter/sub queries skip them.
    db.prepare('DELETE FROM team_lineups WHERE team_id=? AND player_id=?').run(teamId, playerId);
  })();

  res.json({ ok: true });
});

// ─── DELETE /:teamId/infirmary/:playerId — recall a player from the lazaret ───
router.delete('/:teamId/infirmary/:playerId', requireAuth, (req, res) => {
  const db = getDb();
  const { teamId, playerId } = req.params;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'You can only manage your own team' });

  const r = db.prepare('DELETE FROM player_infirmary WHERE team_id=? AND player_id=?').run(teamId, playerId);
  if (!r.changes) return res.status(404).json({ error: 'Player not in infirmary' });
  res.json({ ok: true });
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

  if (!assertLineupUnlocked(req, db, teamId, res)) return;

  const { lineup } = req.body;
  if (!Array.isArray(lineup)) {
    return res.status(400).json({ error: 'lineup must be an array of {slot, player_id, position_override?}' });
  }

  // Validate slots and filter out stale players (transferred away)
  const validLineup = [];
  for (const entry of lineup) {
    if (!entry.slot || entry.slot < 1 || !entry.player_id) continue;
    const player = db.prepare('SELECT id, team_id FROM players WHERE id=?').get(entry.player_id);
    if (!player || player.team_id != teamId) continue; // skip stale entries silently
    validLineup.push(entry);
  }
  // Replace lineup with validated entries
  lineup.length = 0;
  lineup.push(...validLineup);

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

  if (!assertLineupUnlocked(req, db, teamId, res)) return;

  // Get all active non-injured players, excluding those resting in the lazaret
  const players = db.prepare(`
    SELECT p.* FROM players p
    WHERE p.team_id = ? AND p.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM player_injuries i WHERE i.player_id = p.id AND i.matches_remaining > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM player_infirmary pi WHERE pi.player_id = p.id
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

    // Build zone buckets sorted by market_value desc
    const buckets = { GK: [], DEF: [], DMF: [], MID: [], AMF: [], FWD: [] };
    for (const p of players) {
      const z = posToZone(p.position);
      buckets[z].push(p);
    }

    // Slot capacity per zone on the pitch (5×5 grid + 1 GK)
    const zoneSlots = { GK: 1, DEF: 5, DMF: 5, MID: 5, AMF: 5, FWD: 5 };
    const zoneOrder = ['GK', 'DEF', 'DMF', 'MID', 'AMF', 'FWD'];

    // Greedily fill 11 starters: pick best available from natural zone,
    // then fill remaining slots from any leftover players
    const starters = [];
    const usedIds = new Set();

    // First pass: pick from natural zones respecting pitch limits
    const startersByZone = { GK: [], DEF: [], DMF: [], MID: [], AMF: [], FWD: [] };
    let totalStarters = 0;
    for (const zone of zoneOrder) {
      const cap = zone === 'GK' ? 1 : Math.min(zoneSlots[zone], buckets[zone].length);
      const picked = buckets[zone].slice(0, cap);
      for (const p of picked) {
        if (totalStarters < 11) {
          startersByZone[zone].push(p);
          usedIds.add(p.id);
          totalStarters++;
        }
      }
    }

    // If fewer than 11 starters, pull from remaining players (any zone)
    if (totalStarters < 11) {
      for (const p of players) {
        if (usedIds.has(p.id)) continue;
        if (totalStarters >= 11) break;
        const z = posToZone(p.position);
        startersByZone[z].push(p);
        usedIds.add(p.id);
        totalStarters++;
      }
    }

    // Assign specific pitch slot IDs (GK-1, DEF-1..5, etc.)
    let slotNum = 1;
    for (const zone of zoneOrder) {
      const zonePlayers = startersByZone[zone];
      zonePlayers.forEach((p, i) => {
        const pitchSlotId = zone === 'GK' ? 'GK-1' : `${zone}-${i + 1}`;
        insert.run(teamId, p.id, slotNum, pitchSlotId);
        slotNum++;
      });
    }

    // Remaining players go to bench (slots 12+)
    let benchSlot = 12;
    for (const p of players) {
      if (usedIds.has(p.id)) continue;
      insert.run(teamId, p.id, benchSlot, null);
      benchSlot++;
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

// ─── GET /:teamId/presets — list presets ──────────────────────────────────────
router.get('/:teamId/presets', requireAuth, (req, res) => {
  const db = getDb();
  const teamId = req.params.teamId;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'Forbidden' });
  const presets = db.prepare(`
    SELECT lp.id, lp.name, lp.created_at,
           COUNT(lps.id) AS slot_count,
           SUM(CASE WHEN lps.slot <= 11 THEN 1 ELSE 0 END) AS starter_count
    FROM lineup_presets lp
    LEFT JOIN lineup_preset_slots lps ON lps.preset_id = lp.id
    WHERE lp.team_id = ?
    GROUP BY lp.id ORDER BY lp.created_at DESC
  `).all(teamId);
  res.json(presets);
});

// ─── POST /:teamId/presets — save current lineup as preset ───────────────────
router.post('/:teamId/presets', requireAuth, (req, res) => {
  const db = getDb();
  const teamId = req.params.teamId;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'Forbidden' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Preset name is required' });

  const currentLineup = db.prepare('SELECT * FROM team_lineups WHERE team_id=?').all(teamId);
  if (!currentLineup.length) return res.status(400).json({ error: 'Lineup is empty' });

  const save = db.transaction(() => {
    const preset = db.prepare('INSERT INTO lineup_presets (team_id, name) VALUES (?,?)').run(teamId, name);
    const pid = preset.lastInsertRowid;
    const ins = db.prepare('INSERT INTO lineup_preset_slots (preset_id, player_id, slot, position_override, priority_sub) VALUES (?,?,?,?,?)');
    for (const s of currentLineup) ins.run(pid, s.player_id, s.slot, s.position_override || null, s.priority_sub || 0);
    return pid;
  });

  const presetId = save();
  res.json({ id: presetId, name, ok: true });
});

// ─── PUT /:teamId/presets/:presetId — rename preset ──────────────────────────
router.put('/:teamId/presets/:presetId', requireAuth, (req, res) => {
  const db = getDb();
  const { teamId, presetId } = req.params;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'Forbidden' });
  const preset = db.prepare('SELECT id FROM lineup_presets WHERE id=? AND team_id=?').get(presetId, teamId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE lineup_presets SET name=? WHERE id=?').run(name, presetId);
  res.json({ ok: true });
});

// ─── DELETE /:teamId/presets/:presetId — delete preset ───────────────────────
router.delete('/:teamId/presets/:presetId', requireAuth, (req, res) => {
  const db = getDb();
  const { teamId, presetId } = req.params;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'Forbidden' });
  const preset = db.prepare('SELECT id FROM lineup_presets WHERE id=? AND team_id=?').get(presetId, teamId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  db.prepare('DELETE FROM lineup_presets WHERE id=?').run(presetId);
  res.json({ ok: true });
});

// ─── POST /:teamId/presets/:presetId/apply — apply preset to lineup ──────────
router.post('/:teamId/presets/:presetId/apply', requireAuth, (req, res) => {
  const db = getDb();
  const { teamId, presetId } = req.params;
  if (!canManageTeam(req, db, teamId)) return res.status(403).json({ error: 'Forbidden' });
  if (!assertLineupUnlocked(req, db, teamId, res)) return;
  const preset = db.prepare('SELECT id FROM lineup_presets WHERE id=? AND team_id=?').get(presetId, teamId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const slots = db.prepare('SELECT * FROM lineup_preset_slots WHERE preset_id=?').all(presetId);

  // Only keep entries for players still on this team, active, and not in the infirmary
  const teamPlayerIds = new Set(
    db.prepare("SELECT id FROM players WHERE team_id=? AND status='active'").all(teamId).map(p => p.id)
  );
  const infirmaryIds = new Set(
    db.prepare('SELECT player_id FROM player_infirmary WHERE team_id=?').all(teamId).map(p => p.player_id)
  );

  const apply = db.transaction(() => {
    db.prepare('DELETE FROM team_lineups WHERE team_id=?').run(teamId);
    const ins = db.prepare('INSERT INTO team_lineups (team_id, player_id, slot, position_override, priority_sub) VALUES (?,?,?,?,?)');
    for (const s of slots) {
      if (!teamPlayerIds.has(s.player_id)) continue;
      if (infirmaryIds.has(s.player_id)) continue; // skip resting players
      ins.run(teamId, s.player_id, s.slot, s.position_override || null, s.priority_sub || 0);
    }
  });
  apply();

  const updatedLineup = db.prepare(`
    SELECT tl.slot, tl.player_id, tl.position_override, tl.priority_sub,
           p.name AS player_name, p.position, p.shirt_number, p.market_value,
           p.status AS player_status, p.image_url,
           COALESCE(p.stamina, 100) AS stamina,
           pi.matches_remaining AS injury_matches_remaining, pi.injury_type
    FROM team_lineups tl
    JOIN players p ON tl.player_id = p.id
    LEFT JOIN player_injuries pi ON pi.player_id = p.id AND pi.matches_remaining > 0
    WHERE tl.team_id = ? ORDER BY tl.slot ASC
  `).all(teamId);

  res.json({ team_id: parseInt(teamId), lineup: updatedLineup });
});

module.exports = router;
