'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── GET /free-agents ─────────────────────────────────────────────────────────
// Returns all free agent players with their overall (from skills) and rarity (from pack_players if applicable)
router.get('/', (req, res) => {
  const db = getDb();
  const players = db.prepare(`
    SELECT p.id, p.name, p.position, p.market_value, p.image_url, p.date_of_birth, p.height,
           c.flag_emoji, c.name AS nationality_name,
           sk.pace, sk.shooting, sk.passing, sk.defending, sk.physical,
           pp.rarity,
           (
             SELECT CAST(ROUND(
               CASE p.position
                 WHEN 'Goalkeeper' THEN (sk.defending*0.3 + sk.passing*0.15 + sk.physical*0.2 + sk.pace*0.1 + sk.shooting*0.05 + 20)
                 WHEN 'Centre-Back' THEN (sk.defending*0.35 + sk.physical*0.25 + sk.passing*0.15 + sk.pace*0.15 + sk.shooting*0.1)
                 WHEN 'Left-Back' THEN (sk.defending*0.3 + sk.pace*0.25 + sk.physical*0.2 + sk.passing*0.15 + sk.shooting*0.1)
                 WHEN 'Right-Back' THEN (sk.defending*0.3 + sk.pace*0.25 + sk.physical*0.2 + sk.passing*0.15 + sk.shooting*0.1)
                 WHEN 'Defensive Midfield' THEN (sk.defending*0.3 + sk.passing*0.25 + sk.physical*0.2 + sk.pace*0.1 + sk.shooting*0.15)
                 WHEN 'Central Midfield' THEN (sk.passing*0.3 + sk.shooting*0.2 + sk.pace*0.2 + sk.defending*0.15 + sk.physical*0.15)
                 WHEN 'Attacking Midfield' THEN (sk.shooting*0.3 + sk.passing*0.25 + sk.pace*0.2 + sk.physical*0.1 + sk.defending*0.15)
                 WHEN 'Left Winger' THEN (sk.pace*0.3 + sk.shooting*0.3 + sk.passing*0.2 + sk.physical*0.1 + sk.defending*0.1)
                 WHEN 'Right Winger' THEN (sk.pace*0.3 + sk.shooting*0.3 + sk.passing*0.2 + sk.physical*0.1 + sk.defending*0.1)
                 ELSE (sk.shooting*0.35 + sk.pace*0.25 + sk.passing*0.15 + sk.physical*0.15 + sk.defending*0.1)
               END
             ) AS INTEGER)
             FROM player_skills sk2 WHERE sk2.player_id = p.id
           ) AS overall
    FROM players p
    LEFT JOIN countries c ON p.nationality_id = c.id
    LEFT JOIN player_skills sk ON sk.player_id = p.id
    LEFT JOIN pack_players pp ON pp.player_id = p.id
    WHERE p.status = 'free_agent' AND p.team_id IS NULL
    ORDER BY overall DESC, p.market_value DESC
  `).all();

  res.json(players);
});

// ─── POST /free-agents/:id/sell ───────────────────────────────────────────────
// Coach sells their own player at 60% of market value
router.post('/:id/sell', requireAuth, (req, res) => {
  const db       = getDb();
  const playerId = parseInt(req.params.id);

  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Not a coach with a team' });

  const player = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (player.team_id !== coach.team_id) return res.status(403).json({ error: 'Player not on your team' });

  const price = Math.round(player.market_value * 0.6 / 50000) * 50000;

  db.transaction(() => {
    // Remove from team lineup
    db.prepare('DELETE FROM team_lineups WHERE team_id=? AND player_id=?').run(coach.team_id, playerId);
    // Set player as free agent
    db.prepare(`UPDATE players SET team_id=NULL, status='free_agent' WHERE id=?`).run(playerId);
    // Add sale income to transfer budget
    db.prepare('UPDATE teams SET transfer_budget = transfer_budget + ? WHERE id=?').run(price, coach.team_id);
    // Start auction for the player
    const now = new Date();
    // Auction ends at 17:00 today (or 2h from now if past 15:00)
    const endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const startBid = Math.max(100000, price);
    try {
      db.prepare(`INSERT OR IGNORE INTO fa_auctions (player_id, start_bid, start_time, end_time, status) VALUES (?,?,?,?,'active')`)
        .run(playerId, startBid, now.toISOString(), endTime.toISOString());
    } catch { /* already has auction */ }
  })();

  res.json({ ok: true, price });
});

// ─── DELETE /free-agents/:id (admin) ──────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const db       = getDb();
  const playerId = parseInt(req.params.id);

  const player = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (player.status !== 'free_agent' && player.status !== 'in_pack') {
    return res.status(400).json({ error: 'Player is not a free agent' });
  }

  db.transaction(() => {
    db.prepare(`UPDATE fa_auctions SET status='expired' WHERE player_id=? AND status='active'`).run(playerId);
    db.prepare('DELETE FROM players WHERE id=?').run(playerId);
  })();

  res.json({ ok: true });
});

// ─── DELETE /free-agents (admin) — clear all ──────────────────────────────────
router.delete('/', requireAdmin, (req, res) => {
  const db = getDb();

  db.transaction(() => {
    // Expire all active auctions for free agents
    db.prepare(`
      UPDATE fa_auctions SET status='expired'
      WHERE status='active'
        AND player_id IN (SELECT id FROM players WHERE status='free_agent')
    `).run();
    // Delete all free agents (and in_pack players that haven't been assigned)
    db.prepare(`DELETE FROM players WHERE status='free_agent' AND team_id IS NULL`).run();
    db.prepare(`DELETE FROM players WHERE status='in_pack'`).run();
  })();

  res.json({ ok: true });
});

module.exports = router;
