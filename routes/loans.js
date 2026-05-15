const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

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

module.exports = router;
