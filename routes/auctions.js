'use strict';

const express = require('express');
const { getDb, getCurrentSeason } = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── GET /auctions ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const auctions = db.prepare(`
    SELECT a.id, a.player_id, a.start_bid, a.current_bid, a.bidder_team_id,
           a.start_time, a.end_time, a.status,
           p.name AS player_name, p.position, p.market_value, p.image_url,
           bt.name AS bidder_team_name,
           sk.pace, sk.shooting, sk.passing, sk.defending, sk.physical
    FROM fa_auctions a
    JOIN players p ON a.player_id = p.id
    LEFT JOIN teams bt ON a.bidder_team_id = bt.id
    LEFT JOIN player_skills sk ON sk.player_id = p.id
    WHERE a.status = 'active'
    ORDER BY a.end_time ASC
  `).all();
  res.json(auctions);
});

// ─── GET /auctions/:id ───────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const auctionId = parseInt(req.params.id);

  const auction = db.prepare(`
    SELECT a.id, a.player_id, a.start_bid, a.current_bid, a.bidder_team_id,
           a.start_time, a.end_time, a.status,
           p.name AS player_name, p.position, p.market_value, p.image_url,
           p.ovr_fixed, p.date_of_birth, p.height,
           bt.name AS bidder_team_name
    FROM fa_auctions a
    JOIN players p ON a.player_id = p.id
    LEFT JOIN teams bt ON a.bidder_team_id = bt.id
    WHERE a.id = ?
  `).get(auctionId);

  if (!auction) return res.status(404).json({ error: 'Auction not found' });

  const bids = db.prepare(`
    SELECT b.amount, b.bid_at, t.name AS team_name, t.id AS team_id
    FROM fa_bids b
    JOIN teams t ON b.team_id = t.id
    WHERE b.auction_id = ?
    ORDER BY b.amount DESC
  `).all(auctionId);

  res.json({ ...auction, bids });
});

// ─── POST /auctions/start (admin) ─────────────────────────────────────────────
router.post('/start', requireAdmin, (req, res) => {
  const db = getDb();
  const { player_id, duration_hours = 2 } = req.body;
  if (!player_id) return res.status(400).json({ error: 'player_id required' });

  const player = db.prepare('SELECT * FROM players WHERE id=?').get(player_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (player.status !== 'free_agent' || player.team_id != null) {
    return res.status(400).json({ error: 'Player is not a free agent' });
  }

  // Check if already has an active auction
  const existing = db.prepare(`SELECT id FROM fa_auctions WHERE player_id=? AND status='active'`).get(player_id);
  if (existing) return res.status(400).json({ error: 'Auction already active for this player' });

  const startBid = Math.max(100000, Math.round(player.market_value * 0.5 / 100000) * 100000);
  const now = new Date();
  const endTime = new Date(now.getTime() + duration_hours * 60 * 60 * 1000);

  const r = db.prepare(`INSERT INTO fa_auctions (player_id, start_bid, start_time, end_time, status) VALUES (?,?,?,?,'active')`)
    .run(player_id, startBid, now.toISOString(), endTime.toISOString());

  res.json({ ok: true, auction_id: r.lastInsertRowid });
});

// ─── POST /auctions/:id/bid ───────────────────────────────────────────────────
router.post('/:id/bid', requireAuth, (req, res) => {
  const db        = getDb();
  const auctionId = parseInt(req.params.id);
  const { amount } = req.body;
  if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid bid amount' });

  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Not a coach with a team' });

  const auction = db.prepare('SELECT * FROM fa_auctions WHERE id=?').get(auctionId);
  if (!auction) return res.status(404).json({ error: 'Auction not found' });
  if (auction.status !== 'active') return res.status(400).json({ error: 'Auction is not active' });

  const now = new Date();
  if (new Date(auction.end_time) < now) {
    return res.status(400).json({ error: 'Auction has ended' });
  }

  const minBid = (auction.current_bid || auction.start_bid) + 100000;
  if (amount < minBid) {
    return res.status(400).json({ error: `Minimum bid is ${minBid.toLocaleString()} €` });
  }

  // Check budget — must account for amounts already committed as the leading
  // bidder on OTHER active auctions, otherwise a team could lead several
  // auctions whose combined cost exceeds its budget.
  const team = db.prepare('SELECT transfer_budget, transfer_budget_spent FROM teams WHERE id=?').get(coach.team_id);
  const available = (team?.transfer_budget || 10000000) - (team?.transfer_budget_spent || 0);
  const { committed } = db.prepare(
    `SELECT COALESCE(SUM(current_bid), 0) AS committed
     FROM fa_auctions
     WHERE status='active' AND bidder_team_id=? AND id != ?`
  ).get(coach.team_id, auctionId);
  if (amount + committed > available) {
    const remaining = Math.max(0, available - committed);
    return res.status(400).json({
      error: committed > 0
        ? `Недостаточно средств. Уже зарезервировано ${Math.round(committed).toLocaleString()} € на других аукционах. Доступно: ${Math.round(remaining).toLocaleString()} €`
        : `Недостаточно средств. Доступно: ${Math.round(remaining).toLocaleString()} €`
    });
  }

  db.transaction(() => {
    db.prepare('INSERT INTO fa_bids (auction_id, team_id, amount) VALUES (?,?,?)').run(auctionId, coach.team_id, amount);
    db.prepare('UPDATE fa_auctions SET current_bid=?, bidder_team_id=? WHERE id=?').run(amount, coach.team_id, auctionId);
  })();

  res.json({ ok: true, new_bid: amount });
});

// ─── POST /auctions/finalize-expired (called by scheduler or admin) ───────────
router.post('/finalize-expired', requireAdmin, (req, res) => {
  const db = getDb();
  const count = finalizeExpiredAuctions(db);
  res.json({ ok: true, finalized: count });
});

function finalizeExpiredAuctions(db) {
  const now = new Date().toISOString();
  const expired = db.prepare(`SELECT * FROM fa_auctions WHERE status='active' AND end_time <= ?`).all(now);

  const fmtV = v => v >= 1e6 ? '€'+(v/1e6).toFixed(2)+'M' : v >= 1e3 ? '€'+(v/1e3).toFixed(0)+'K' : '€'+v;

  let count = 0;
  for (const auction of expired) {
    // Determine the winner: highest bidder who can still afford their bid.
    // Walk bids from highest to lowest (one per team) so that if the top
    // bidder can't afford it (e.g. they won other auctions this round), the
    // player goes to the next team that can.
    const teamBids = db.prepare(`
      SELECT team_id, MAX(amount) AS amount
      FROM fa_bids WHERE auction_id=?
      GROUP BY team_id ORDER BY amount DESC
    `).all(auction.id);

    let winner = null;
    for (const tb of teamBids) {
      const team = db.prepare('SELECT transfer_budget, transfer_budget_spent FROM teams WHERE id=?').get(tb.team_id);
      const available = (team?.transfer_budget || 10000000) - (team?.transfer_budget_spent || 0);
      if (tb.amount <= available) { winner = tb; break; }
    }

    if (winner) {
      db.transaction(() => {
        const player = db.prepare('SELECT * FROM players WHERE id=?').get(auction.player_id);
        const currentSeason = getCurrentSeason(db);
        db.prepare(`UPDATE players SET team_id=?, status='active', acquired_season=? WHERE id=?`).run(winner.team_id, currentSeason, auction.player_id);
        db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?').run(winner.amount, winner.team_id);
        // Add to lineup (bench)
        const usedSlots = new Set(db.prepare('SELECT slot FROM team_lineups WHERE team_id=?').all(winner.team_id).map(r => r.slot));
        let slot = 12;
        while (usedSlots.has(slot)) slot++;
        db.prepare('INSERT OR IGNORE INTO team_lineups (team_id, player_id, slot) VALUES (?,?,?)').run(winner.team_id, auction.player_id, slot);
        db.prepare(`UPDATE fa_auctions SET status='won', current_bid=?, bidder_team_id=? WHERE id=?`).run(winner.amount, winner.team_id, auction.id);

        // Insert transfer record
        const today = new Date().toISOString().slice(0, 10);
        db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes) VALUES (?,NULL,?,?,?,'free_agent','FA Auction win')`)
          .run(auction.player_id, winner.team_id, winner.amount, today);

        // Notify winning coach
        const winningCoach = db.prepare('SELECT id FROM coaches WHERE team_id=?').get(winner.team_id);
        if (winningCoach && player) {
          db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`)
            .run(winningCoach.id, 'Игрок выкуплен!', `Вы выиграли аукцион на ${player.name} за ${fmtV(winner.amount)}`, 'auction_win');
        }
      })();
    } else {
      // No bids, or no bidder can afford — expire with no winner
      db.prepare(`UPDATE fa_auctions SET status='expired' WHERE id=?`).run(auction.id);
    }
    count++;
  }
  return count;
}

function startDailyAuctions(db) {
  const now = new Date();
  const endTime = new Date(now);
  endTime.setHours(17, 0, 0, 0);
  if (endTime <= now) endTime.setDate(endTime.getDate() + 1); // safety: past 17:00

  const freeAgents = db.prepare(`
    SELECT p.id, p.market_value
    FROM players p
    WHERE p.status = 'free_agent' AND p.team_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM fa_auctions a WHERE a.player_id = p.id AND a.status = 'active'
      )
  `).all();

  let count = 0;
  for (const p of freeAgents) {
    const startBid = Math.max(100000, Math.round(p.market_value * 0.5 / 100000) * 100000);
    try {
      // Remove old expired/won record — UNIQUE constraint on player_id blocks re-auction otherwise
      db.prepare(`DELETE FROM fa_auctions WHERE player_id=? AND status IN ('expired','won')`).run(p.id);
      db.prepare(`INSERT OR IGNORE INTO fa_auctions (player_id, start_bid, start_time, end_time, status) VALUES (?,?,?,?,'active')`)
        .run(p.id, startBid, now.toISOString(), endTime.toISOString());
      count++;
    } catch { /* already has active auction */ }
  }

  console.log(`[Auctions] Daily window opened at ${now.toISOString()}: ${count} auctions started (ends 17:00)`);
  return count;
}

function cleanupStaleFreeAgents(db) {
  // Delete free agents with no active auction who have been in the pool for 3+ days
  const stale = db.prepare(`
    SELECT p.id FROM players p
    WHERE p.status = 'free_agent'
      AND p.team_id IS NULL
      AND p.free_agent_since IS NOT NULL
      AND (julianday('now') - julianday(p.free_agent_since)) >= 3
      AND NOT EXISTS (
        SELECT 1 FROM fa_auctions a WHERE a.player_id = p.id AND a.status = 'active'
      )
  `).all();

  if (!stale.length) return 0;

  for (const p of stale) {
    db.prepare(`UPDATE fa_auctions SET status='expired' WHERE player_id=? AND status='active'`).run(p.id);
    db.prepare('DELETE FROM players WHERE id=?').run(p.id);
  }

  console.log(`[Auctions] Cleaned up ${stale.length} stale free agent(s) (3+ days, no bids)`);
  return stale.length;
}

module.exports = router;
module.exports.finalizeExpiredAuctions = finalizeExpiredAuctions;
module.exports.startDailyAuctions = startDailyAuctions;
module.exports.cleanupStaleFreeAgents = cleanupStaleFreeAgents;
