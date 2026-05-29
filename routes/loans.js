const express = require('express');
const { getDb, getCurrentSeason, isTradeBanned } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

function getActiveBudget(db, teamId) {
  return db.prepare(`
    SELECT sb.* FROM season_budgets sb
    JOIN leagues l ON sb.league_id = l.id
    WHERE sb.team_id = ? AND l.status IN ('active','transfer_window')
    ORDER BY l.created_at DESC
    LIMIT 1
  `).get(teamId);
}

const BASE = `
  SELECT l.*,
    p.name as player_name, p.position, p.image_url,
    ft.name as from_team_name,
    tt.name as to_team_name
  FROM loans l
  JOIN players p ON l.player_id = p.id
  LEFT JOIN teams ft ON l.from_team_id = ft.id
  LEFT JOIN teams tt ON l.to_team_id = tt.id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  let q = BASE; const p = [];
  if (status) { q += ' WHERE l.status=?'; p.push(status); }
  q += ' ORDER BY l.end_date, l.id';
  res.json(db.prepare(q).all(...p));
});

router.post('/', requireAuth, (req, res) => {
  const { player_id, from_team_id, to_team_id, loan_fee, start_date, end_date } = req.body;
  if (!player_id || !to_team_id) return res.status(400).json({ error: 'player_id and to_team_id required' });
  const db = getDb();

  const player = db.prepare(`SELECT * FROM players WHERE id=?`).get(player_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const actualFromTeam = from_team_id || player.team_id;
  const fee = parseFloat(loan_fee) || 0;

  const r = db.prepare(
    `INSERT INTO loans (player_id, from_team_id, to_team_id, loan_fee, start_date, end_date) VALUES (?,?,?,?,?,?)`
  ).run(player_id, actualFromTeam, to_team_id, fee, start_date || null, end_date || null);

  // Record in transfers table so it appears in transfer history
  db.prepare(
    `INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes)
     VALUES (?,?,?,?,?,'loan',?)`
  ).run(player_id, actualFromTeam, to_team_id, fee, start_date || new Date().toISOString().slice(0,10),
    end_date ? `Loan until ${end_date}` : 'Loan');

  // Move player to loan team
  db.prepare(`UPDATE players SET team_id=? WHERE id=?`).run(to_team_id, player_id);

  // Recalculate squad values
  for (const tid of [actualFromTeam, to_team_id].filter(Boolean)) {
    const tot = db.prepare(`SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?`).get(tid);
    db.prepare(`UPDATE teams SET market_value=? WHERE id=?`).run(tot.t, tid);
  }

  // Generate news
  const fromTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(actualFromTeam);
  const toTeam   = db.prepare('SELECT name FROM teams WHERE id=?').get(to_team_id);
  if (fromTeam && toTeam) {
    const fmtV = v => v > 0 ? (v >= 1e6 ? '€'+(v/1e6).toFixed(2)+'M' : v >= 1e3 ? '€'+(v/1e3).toFixed(0)+'K' : '€'+v) : 'no fee';
    db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(
      `Loan: ${player.name} joins ${toTeam.name}`,
      `${player.name} has joined ${toTeam.name} on loan from ${fromTeam.name}${fee > 0 ? ` for a fee of ${fmtV(fee)}` : ''}.${end_date ? ` Loan runs until ${end_date}.` : ''}`,
      'transfer', player_id
    );
  }

  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/:id/end', requireAuth, (req, res) => {
  const db = getDb();
  const loan = db.prepare(`SELECT * FROM loans WHERE id=?`).get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Not found' });
  if (loan.status === 'ended') return res.status(400).json({ error: 'Loan already ended' });

  db.prepare(`UPDATE loans SET status='ended' WHERE id=?`).run(req.params.id);
  db.prepare(`UPDATE players SET team_id=? WHERE id=?`).run(loan.from_team_id, loan.player_id);

  // Record return transfer
  db.prepare(
    `INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes)
     VALUES (?,?,?,0,?,'loan','Loan return')`
  ).run(loan.player_id, loan.to_team_id, loan.from_team_id, new Date().toISOString().slice(0,10));

  for (const tid of [loan.from_team_id, loan.to_team_id].filter(Boolean)) {
    const tot = db.prepare(`SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?`).get(tid);
    db.prepare(`UPDATE teams SET market_value=? WHERE id=?`).run(tot.t, tid);
  }

  res.json({ message: 'Loan ended, player returned' });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM loans WHERE id=?`).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

// ─── Loan Offers ──────────────────────────────────────────────────────────────

// GET /loans/offers — returns loan offers for current coach's team (incoming + outgoing)
router.get('/offers', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.json([]);

  const offers = db.prepare(`
    SELECT lo.*,
      p.name as player_name, p.position, p.image_url, p.market_value,
      ft.name as from_team_name, ft.logo_url as from_team_logo,
      tt.name as to_team_name, tt.logo_url as to_team_logo
    FROM loan_offers lo
    JOIN players p ON lo.player_id = p.id
    LEFT JOIN teams ft ON lo.from_team_id = ft.id
    LEFT JOIN teams tt ON lo.to_team_id = tt.id
    WHERE lo.from_team_id = ? OR lo.to_team_id = ?
    ORDER BY lo.created_at DESC
  `).all(coach.team_id, coach.team_id);

  res.json(offers);
});

// POST /loans/offers — create a loan offer
router.post('/offers', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'No team' });

  const { player_id, target_team_id, offer_type, loan_fee, message } = req.body;
  if (!player_id || !target_team_id) return res.status(400).json({ error: 'player_id and target_team_id required' });
  if (!['loan_in', 'loan_out'].includes(offer_type)) return res.status(400).json({ error: 'offer_type must be loan_in or loan_out' });

  const player = db.prepare('SELECT * FROM players WHERE id=?').get(player_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Block if player is already on an active loan
  const existingLoan = db.prepare(`SELECT id FROM loans WHERE player_id=? AND status='active'`).get(player_id);
  if (existingLoan) {
    return res.status(400).json({ error: 'Этот игрок уже находится в аренде' });
  }

  let from_team_id, to_team_id;
  if (offer_type === 'loan_in') {
    // Coach wants to borrow player FROM target_team
    from_team_id = parseInt(target_team_id);
    to_team_id = coach.team_id;
    if (player.team_id !== from_team_id) return res.status(400).json({ error: 'Player does not belong to target team' });
  } else {
    // Coach wants to send own player TO target_team
    from_team_id = coach.team_id;
    to_team_id = parseInt(target_team_id);
    if (player.team_id !== coach.team_id) return res.status(400).json({ error: 'Player does not belong to your team' });
    // Trade ban applies to loan_out (can't send away a just-acquired player)
    const currentSeason = getCurrentSeason(db);
    if (isTradeBanned(player, currentSeason)) {
      return res.status(400).json({ error: `Торговый бан — ${player.name} должен отыграть минимум один сезон прежде чем его можно отдать в аренду` });
    }
  }

  const fee = parseFloat(loan_fee) || 0;
  const r = db.prepare(`
    INSERT INTO loan_offers (from_team_id, to_team_id, player_id, offer_type, loan_fee, message)
    VALUES (?,?,?,?,?,?)
  `).run(from_team_id, to_team_id, player_id, offer_type, fee, message || null);

  // Notify the receiving team's coach
  const receivingTeamId = offer_type === 'loan_in' ? from_team_id : to_team_id;
  const receivingCoach = db.prepare('SELECT id FROM coaches WHERE team_id=?').get(receivingTeamId);
  if (receivingCoach) {
    const myTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(coach.team_id);
    const notifTitle = offer_type === 'loan_in' ? 'Запрос на аренду' : 'Предложение аренды';
    const notifBody = offer_type === 'loan_in'
      ? `${myTeam?.name} хочет взять ${player.name} в аренду`
      : `${myTeam?.name} предлагает ${player.name} в аренду`;
    db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
      receivingCoach.id, notifTitle, notifBody, 'loan_offer'
    );
  }

  res.status(201).json({ id: r.lastInsertRowid, ok: true });
});

// POST /loans/offers/:id/accept — accept a loan offer
router.post('/offers/:id/accept', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'No team' });

  const offer = db.prepare('SELECT * FROM loan_offers WHERE id=?').get(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer is not pending' });

  // Determine who can accept: the team that would be lending the player
  const lendingTeamId = offer.from_team_id;
  if (coach.team_id !== lendingTeamId) return res.status(403).json({ error: 'Only the lending team can accept' });

  // Determine end date: active league transfer_window_end or +180 days
  const activeLeague = db.prepare(`SELECT transfer_window_end FROM leagues WHERE status='active' ORDER BY created_at DESC LIMIT 1`).get();
  const today = new Date().toISOString().slice(0, 10);
  let endDate;
  if (activeLeague && activeLeague.transfer_window_end) {
    endDate = activeLeague.transfer_window_end;
  } else {
    const d = new Date();
    d.setDate(d.getDate() + 180);
    endDate = d.toISOString().slice(0, 10);
  }

  db.transaction(() => {
    // Create actual loan
    const loanR = db.prepare(`
      INSERT INTO loans (player_id, from_team_id, to_team_id, loan_fee, start_date, end_date)
      VALUES (?,?,?,?,?,?)
    `).run(offer.player_id, offer.from_team_id, offer.to_team_id, offer.loan_fee, today, endDate);

    // Record in transfers
    db.prepare(`INSERT INTO transfers (player_id, from_team_id, to_team_id, transfer_fee, transfer_date, transfer_type, notes) VALUES (?,?,?,?,?,'loan',?)`)
      .run(offer.player_id, offer.from_team_id, offer.to_team_id, offer.loan_fee, today, `Аренда до ${endDate}`);

    // Move player to to_team_id
    db.prepare('UPDATE players SET team_id=? WHERE id=?').run(offer.to_team_id, offer.player_id);

    // Transfer loan fee: deduct from borrowing team (to_team), credit to lending team (from_team)
    if (offer.loan_fee > 0) {
      db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?')
        .run(offer.loan_fee, offer.to_team_id);
      const borrowBudget = getActiveBudget(db, offer.to_team_id);
      if (borrowBudget) {
        db.prepare('UPDATE season_budgets SET spent = spent + ? WHERE id=?')
          .run(offer.loan_fee, borrowBudget.id);
      }
      const lendBudget = getActiveBudget(db, offer.from_team_id);
      if (lendBudget) {
        db.prepare('UPDATE season_budgets SET income = income + ? WHERE id=?')
          .run(offer.loan_fee, lendBudget.id);
      }
    }

    // Update offer status
    db.prepare(`UPDATE loan_offers SET status='accepted' WHERE id=?`).run(offer.id);

    // Clear pending offers for same player
    db.prepare(`UPDATE loan_offers SET status='cancelled' WHERE player_id=? AND status='pending' AND id!=?`).run(offer.player_id, offer.id);

    // Recalculate values
    for (const tid of [offer.from_team_id, offer.to_team_id].filter(Boolean)) {
      const tot = db.prepare(`SELECT COALESCE(SUM(market_value),0) as t FROM players WHERE team_id=?`).get(tid);
      db.prepare(`UPDATE teams SET market_value=? WHERE id=?`).run(tot.t, tid);
    }

    const player = db.prepare('SELECT name FROM players WHERE id=?').get(offer.player_id);
    const fromTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(offer.from_team_id);
    const toTeam = db.prepare('SELECT name FROM teams WHERE id=?').get(offer.to_team_id);

    // Notify both coaches
    const fmtV = v => v > 0 ? (v >= 1e6 ? '€'+(v/1e6).toFixed(2)+'M' : '€'+(v/1e3).toFixed(0)+'K') : 'бесплатно';
    // Notify requesting coach (to_team)
    const toCoach = db.prepare('SELECT id FROM coaches WHERE team_id=?').get(offer.to_team_id);
    if (toCoach) {
      db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
        toCoach.id, 'Аренда одобрена!',
        `${fromTeam?.name} одобрил аренду ${player?.name} за ${fmtV(offer.loan_fee)} до ${endDate}`,
        'loan_accepted'
      );
    }
    // Notify lending coach
    db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
      coach.id, 'Аренда оформлена',
      `${player?.name} отправлен в аренду в ${toTeam?.name} до ${endDate}`,
      'loan_accepted'
    );

    // Generate news
    if (player && fromTeam && toTeam) {
      db.prepare(`INSERT INTO news (title, body, type, player_id) VALUES (?,?,?,?)`).run(
        `Аренда: ${player.name} переходит в ${toTeam.name}`,
        `${player.name} переходит в ${toTeam.name} на правах аренды из ${fromTeam.name}. Аренда действует до ${endDate}.`,
        'transfer', offer.player_id
      );
    }
  })();

  res.json({ ok: true });
});

// POST /loans/offers/:id/reject — reject a loan offer
router.post('/offers/:id/reject', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'No team' });

  const offer = db.prepare('SELECT * FROM loan_offers WHERE id=?').get(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer is not pending' });

  // Lending team can reject
  if (coach.team_id !== offer.from_team_id) return res.status(403).json({ error: 'Only the lending team can reject' });

  db.prepare(`UPDATE loan_offers SET status='rejected' WHERE id=?`).run(offer.id);

  // Notify offering coach
  const offeringCoach = db.prepare('SELECT id FROM coaches WHERE team_id=?').get(offer.to_team_id);
  if (offeringCoach) {
    const player = db.prepare('SELECT name FROM players WHERE id=?').get(offer.player_id);
    db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
      offeringCoach.id, 'Аренда отклонена',
      `Запрос на аренду ${player?.name} был отклонён`,
      'loan_rejected'
    );
  }

  res.json({ ok: true });
});

module.exports = router;
