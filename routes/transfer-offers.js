'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAdmin, requireCoach, requireAuth } = require('../middleware/auth');

const router = express.Router();

function fmtV(v) {
  if (!v || v === 0) return 'undisclosed';
  if (v >= 1e9) return '€' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '€' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '€' + (v / 1e3).toFixed(0) + 'K';
  return '€' + v;
}

// Get coach record for the current user, returns null if none
function getMyCoach(db, userId) {
  return db.prepare('SELECT * FROM coaches WHERE user_id=?').get(userId);
}

// Get active league budget for a team
function getActiveBudget(db, teamId) {
  return db.prepare(`
    SELECT sb.* FROM season_budgets sb
    JOIN leagues l ON sb.league_id = l.id
    WHERE sb.team_id = ? AND l.status IN ('active','transfer_window')
    ORDER BY l.created_at DESC
    LIMIT 1
  `).get(teamId);
}

// ─── GET / — list offers ──────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const isAdmin = req.user.role === 'admin';
  const { status, type } = req.query;

  let where = [];
  const params = [];

  if (!isAdmin) {
    const coach = getMyCoach(db, req.user.id);
    if (!coach || !coach.team_id) {
      return res.status(403).json({ error: 'No team associated with your coach account' });
    }

    if (type === 'received') {
      where.push('o.to_team_id = ?');
      params.push(coach.team_id);
    } else if (type === 'sent') {
      where.push('o.from_team_id = ?');
      params.push(coach.team_id);
    } else {
      // All offers involving coach's team
      where.push('(o.from_team_id = ? OR o.to_team_id = ?)');
      params.push(coach.team_id, coach.team_id);
    }
  }

  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const offers = db.prepare(`
    SELECT o.*,
           ft.name AS from_team_name,
           tt.name AS to_team_name,
           p.name AS player_name, p.position, p.market_value AS player_market_value,
           o.swap_player_id,
           p2.name AS swap_player_name
    FROM transfer_offers o
    JOIN teams ft ON o.from_team_id = ft.id
    JOIN teams tt ON o.to_team_id = tt.id
    JOIN players p ON o.player_id = p.id
    LEFT JOIN players p2 ON o.swap_player_id = p2.id
    ${whereClause}
    ORDER BY o.created_at DESC
  `).all(...params);

  res.json(offers);
});

// ─── POST / — submit offer ────────────────────────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const isAdmin = req.user.role === 'admin';
  const { to_team_id, player_id, offer_type, amount, loan_months, message, swap_player_id } = req.body;

  let from_team_id = req.body.from_team_id;

  if (!isAdmin) {
    const coach = getMyCoach(db, req.user.id);
    if (!coach || !coach.team_id) {
      return res.status(403).json({ error: 'No team associated with your coach account' });
    }
    from_team_id = coach.team_id;
  }

  if (!from_team_id || !to_team_id || !player_id) {
    return res.status(400).json({ error: 'from_team_id, to_team_id, and player_id are required' });
  }

  if (from_team_id == to_team_id) {
    return res.status(400).json({ error: 'Cannot make an offer to your own team' });
  }

  const validTypes = ['buy', 'loan', 'swap'];
  const offerType = offer_type || 'buy';
  if (!validTypes.includes(offerType)) {
    return res.status(400).json({ error: 'offer_type must be buy, loan, or swap' });
  }

  const player = db.prepare('SELECT * FROM players WHERE id=?').get(player_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Player must belong to the selling team
  if (player.team_id != to_team_id) {
    return res.status(400).json({ error: 'Player does not belong to the specified selling team' });
  }

  // Cannot offer for your own player
  if (player.team_id == from_team_id) {
    return res.status(400).json({ error: 'Cannot make an offer for your own player' });
  }

  // Player must not already have a pending offer
  const pendingOffer = db.prepare(`
    SELECT id FROM transfer_offers WHERE player_id=? AND status='pending'
  `).get(player_id);
  if (pendingOffer) {
    return res.status(400).json({ error: 'Player already has a pending transfer offer' });
  }

  const offerAmount = parseFloat(amount) || 0;

  if (offerType === 'swap') {
    if (!swap_player_id) return res.status(400).json({ error: 'swap_player_id required for swap offers' });
    const swapPlayer = db.prepare('SELECT * FROM players WHERE id=?').get(swap_player_id);
    if (!swapPlayer) return res.status(404).json({ error: 'Swap player not found' });
    if (swapPlayer.team_id != from_team_id) return res.status(400).json({ error: 'Swap player must belong to your team' });
    // Check for pending offer on swap player
    const pendingSwap = db.prepare(`SELECT id FROM transfer_offers WHERE player_id=? AND status='pending'`).get(swap_player_id);
    if (pendingSwap) return res.status(400).json({ error: 'Swap player already has a pending offer' });
    // Budget check: if amount > 0, from_team pays
    if (!isAdmin && offerAmount > 0) {
      const buyingTeam = db.prepare('SELECT transfer_budget, transfer_budget_spent FROM teams WHERE id=?').get(from_team_id);
      const totalBudget = buyingTeam ? (buyingTeam.transfer_budget || 10000000) : 10000000;
      const spent = buyingTeam ? (buyingTeam.transfer_budget_spent || 0) : 0;
      const available = totalBudget - spent;
      if (offerAmount > available) {
        return res.status(400).json({ error: `Недостаточно бюджета. Доступно: ${fmtV(available)}, запрошено: ${fmtV(offerAmount)}` });
      }
    }
  }

  if (offerType === 'buy') {
    // Amount must be >= market value
    if (offerAmount < (player.market_value || 0)) {
      return res.status(400).json({
        error: `Offer amount (${fmtV(offerAmount)}) must be at least player's market value (${fmtV(player.market_value)})`,
      });
    }

    // Enforce team transfer budget (coaches only — admins bypass)
    if (!isAdmin) {
      const buyingTeam = db.prepare('SELECT transfer_budget, transfer_budget_spent FROM teams WHERE id=?').get(from_team_id);
      const totalBudget = buyingTeam ? (buyingTeam.transfer_budget || 10000000) : 10000000;
      const spent = buyingTeam ? (buyingTeam.transfer_budget_spent || 0) : 0;
      const available = totalBudget - spent;
      if (offerAmount > available) {
        return res.status(400).json({
          error: `Недостаточно бюджета. Доступно: ${fmtV(available)}, запрошено: ${fmtV(offerAmount)}`,
        });
      }
    }
  } else if (offerType === 'loan') {
    if (offerAmount < 0) {
      return res.status(400).json({ error: 'Loan fee cannot be negative' });
    }
  }

  const result = db.prepare(`
    INSERT INTO transfer_offers
      (from_team_id, to_team_id, player_id, offer_type, amount, loan_months, message, status, swap_player_id)
    VALUES (?,?,?,?,?,?,?,'pending',?)
  `).run(from_team_id, to_team_id, player_id, offerType, offerAmount, loan_months || 6, message || null, swap_player_id || null);

  const offer = db.prepare('SELECT * FROM transfer_offers WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(offer);
});

// ─── PUT /:id/accept ──────────────────────────────────────────────────────────
router.put('/:id/accept', requireAuth, (req, res) => {
  const db = getDb();
  const offer = db.prepare('SELECT * FROM transfer_offers WHERE id=?').get(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer is not pending' });

  const isAdmin = req.user.role === 'admin';

  if (!isAdmin) {
    const coach = getMyCoach(db, req.user.id);
    if (!coach || coach.team_id != offer.to_team_id) {
      return res.status(403).json({ error: 'Only the selling team coach or admin can accept offers' });
    }
  }

  const player = db.prepare('SELECT * FROM players WHERE id=?').get(offer.player_id);
  const fromTeam = db.prepare('SELECT * FROM teams WHERE id=?').get(offer.from_team_id);
  const toTeam = db.prepare('SELECT * FROM teams WHERE id=?').get(offer.to_team_id);
  const now = new Date().toISOString().slice(0, 10);

  const executeTransfer = db.transaction(() => {
    if (offer.offer_type === 'buy') {
      // Update player team
      db.prepare('UPDATE players SET team_id=? WHERE id=?').run(offer.from_team_id, offer.player_id);

      // Insert transfer record
      db.prepare(`
        INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type)
        VALUES (?,?,?,?,?,'permanent')
      `).run(offer.player_id, offer.to_team_id, offer.from_team_id, offer.amount, now);

      // Deduct from buying team's transfer budget
      db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?')
        .run(offer.amount, offer.from_team_id);

      // Update season_budgets for buying team (spent) if active league exists
      const buyBudget = getActiveBudget(db, offer.from_team_id);
      if (buyBudget) {
        db.prepare('UPDATE season_budgets SET spent = spent + ? WHERE id=?')
          .run(offer.amount, buyBudget.id);
      }

      // Update season_budgets for selling team (income)
      const sellBudget = getActiveBudget(db, offer.to_team_id);
      if (sellBudget) {
        db.prepare('UPDATE season_budgets SET income = income + ? WHERE id=?')
          .run(offer.amount, sellBudget.id);
      }

      // Recalculate team market values
      for (const tid of [offer.from_team_id, offer.to_team_id]) {
        const tot = db.prepare('SELECT COALESCE(SUM(market_value),0) AS t FROM players WHERE team_id=?').get(tid);
        db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(tot.t, tid);
      }

      // News
      db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(
        `Трансфер: ${player.name} переходит в ${fromTeam.name}`,
        `${player.name} завершил переход на постоянной основе из ${toTeam.name} в ${fromTeam.name} за ${fmtV(offer.amount)}.`,
        'transfer',
        player.id
      );

    } else if (offer.offer_type === 'swap') {
      // Move player_id: to_team → from_team
      db.prepare('UPDATE players SET team_id=? WHERE id=?').run(offer.from_team_id, offer.player_id);
      // Move swap_player_id: from_team → to_team
      db.prepare('UPDATE players SET team_id=? WHERE id=?').run(offer.to_team_id, offer.swap_player_id);
      // Cash top-up: if amount > 0, from_team pays to_team
      if (offer.amount > 0) {
        db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?')
          .run(offer.amount, offer.from_team_id);
      } else if (offer.amount < 0) {
        // to_team pays from_team
        db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?')
          .run(Math.abs(offer.amount), offer.to_team_id);
      }
      // Transfer records
      const now2 = new Date().toISOString().slice(0, 10);
      db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type) VALUES (?,?,?,?,?,'permanent')`).run(offer.player_id, offer.to_team_id, offer.from_team_id, 0, now2);
      db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type) VALUES (?,?,?,?,?,'permanent')`).run(offer.swap_player_id, offer.from_team_id, offer.to_team_id, 0, now2);
      // Recalculate market values
      for (const tid of [offer.from_team_id, offer.to_team_id]) {
        const tot = db.prepare('SELECT COALESCE(SUM(market_value),0) AS t FROM players WHERE team_id=?').get(tid);
        db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(tot.t, tid);
      }
      const swapP = db.prepare('SELECT name FROM players WHERE id=?').get(offer.swap_player_id);
      const cashStr = offer.amount > 0 ? ` + доплата ${fmtV(offer.amount)}` : offer.amount < 0 ? ` + доплата ${fmtV(Math.abs(offer.amount))} обратно` : '';
      db.prepare(`INSERT INTO news (title, body, type) VALUES (?,?,?)`).run(
        `Обмен: ${player.name} ↔ ${swapP ? swapP.name : 'неизвестно'}`,
        `${fromTeam.name} и ${toTeam.name} обменялись игроками: ${player.name} перешёл в ${fromTeam.name}, ${swapP ? swapP.name : 'игрок'} — в ${toTeam.name}${cashStr}.`,
        'transfer'
      );
    } else if (offer.offer_type === 'loan') {
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + (offer.loan_months || 6));
      const endDateStr = endDate.toISOString().slice(0, 10);

      // Create loan record
      db.prepare(`
        INSERT INTO loans (player_id, from_team_id, to_team_id, loan_fee, start_date, end_date, status)
        VALUES (?,?,?,?,?,?,'active')
      `).run(offer.player_id, offer.to_team_id, offer.from_team_id, offer.amount, now, endDateStr);

      // Update player team to loaning team
      db.prepare('UPDATE players SET team_id=? WHERE id=?').run(offer.from_team_id, offer.player_id);

      // Insert transfer record for loan
      db.prepare(`
        INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type)
        VALUES (?,?,?,?,?,'loan')
      `).run(offer.player_id, offer.to_team_id, offer.from_team_id, offer.amount, now);

      // News
      db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(
        `Аренда: ${player.name} переходит в ${fromTeam.name}`,
        `${player.name} присоединился к ${fromTeam.name} на правах аренды из ${toTeam.name} сроком на ${offer.loan_months || 6} мес.`,
        'transfer',
        player.id
      );
    }

    // Set offer status
    db.prepare(`
      UPDATE transfer_offers SET status='accepted', responded_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(offer.id);
  });

  executeTransfer();

  const updated = db.prepare('SELECT * FROM transfer_offers WHERE id=?').get(offer.id);
  res.json({ message: 'Offer accepted', offer: updated });
});

// ─── PUT /:id/reject ──────────────────────────────────────────────────────────
router.put('/:id/reject', requireAuth, (req, res) => {
  const db = getDb();
  const offer = db.prepare('SELECT * FROM transfer_offers WHERE id=?').get(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer is not pending' });

  const isAdmin = req.user.role === 'admin';

  if (!isAdmin) {
    const coach = getMyCoach(db, req.user.id);
    if (!coach || coach.team_id != offer.to_team_id) {
      return res.status(403).json({ error: 'Only the selling team coach or admin can reject offers' });
    }
  }

  db.prepare(`UPDATE transfer_offers SET status='rejected', responded_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(offer.id);

  res.json({ message: 'Offer rejected' });
});

// ─── PUT /:id/cancel ──────────────────────────────────────────────────────────
router.put('/:id/cancel', requireAuth, (req, res) => {
  const db = getDb();
  const offer = db.prepare('SELECT * FROM transfer_offers WHERE id=?').get(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer is not pending' });

  const isAdmin = req.user.role === 'admin';

  if (!isAdmin) {
    const coach = getMyCoach(db, req.user.id);
    if (!coach || coach.team_id != offer.from_team_id) {
      return res.status(403).json({ error: 'Only the buying team coach or admin can cancel offers' });
    }
  }

  db.prepare(`UPDATE transfer_offers SET status='cancelled', responded_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(offer.id);

  res.json({ message: 'Offer cancelled' });
});

// ─── DELETE /:id (admin only) ─────────────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const offer = db.prepare('SELECT id FROM transfer_offers WHERE id=?').get(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  db.prepare('DELETE FROM transfer_offers WHERE id=?').run(offer.id);
  res.json({ message: 'Offer deleted' });
});

module.exports = router;
