'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireCoach, optionalAuth } = require('../middleware/auth');
const { getPokerManager } = require('../services/poker/PokerManager');

const router = express.Router();

const COSMETICS_CATALOG = [
  { key: 'cap',        name: 'Кепка',            emoji: '🧢', price: 200000 },
  { key: 'tophat',     name: 'Цилиндр',           emoji: '🎩', price: 500000 },
  { key: 'crown',      name: 'Корона',            emoji: '👑', price: 1500000 },
  { key: 'wreath',     name: 'Лавровый венок',    emoji: '🌿', price: 300000 },
  { key: 'sunglasses', name: 'Очки',              emoji: '🕶️', price: 250000 },
  { key: 'halo',       name: 'Нимб',              emoji: '😇', price: 750000 },
  { key: 'cowboy',     name: 'Ковбойская шляпа',  emoji: '🤠', price: 400000 },
  { key: 'partyhat',   name: 'Праздничный колпак', emoji: '🎉', price: 150000 },
  { key: 'pirate',     name: 'Пиратская шляпа',   emoji: '☠️', price: 600000 },
  { key: 'diamond',    name: 'Бриллиант',         emoji: '💎', price: 2000000 },
  { key: 'fire',       name: 'Пламя',             emoji: '🔥', price: 350000 },
  { key: 'star',       name: 'Золотая звезда',    emoji: '⭐', price: 450000 },
];

function myCoach(db, userId) {
  return db.prepare('SELECT id, name, avatar_url, team_id FROM coaches WHERE user_id=?').get(userId);
}

// ── GET / — lobby: tables + my stake options ─────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  const db = getDb();
  const mgr = getPokerManager();
  const tables = mgr.listTables();

  let me = null, budget = null, teamValue = null;
  if (req.user) {
    const coach = myCoach(db, req.user.id);
    if (coach && coach.team_id) {
      const { availableBudget } = require('../services/betting');
      budget = Math.round(availableBudget(db, coach.team_id));
      const tv = db.prepare('SELECT COALESCE(SUM(market_value),0) AS v FROM players WHERE team_id=?').get(coach.team_id);
      teamValue = Math.round(tv.v);
      me = { coachId: coach.id, name: coach.name, teamId: coach.team_id, avatarUrl: coach.avatar_url };
    }
  }

  res.json({ tables, me, budget, teamValue, room: mgr.roomList() });
});

// ── GET /shop ─────────────────────────────────────────────────────────────────
router.get('/shop', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach) return res.status(403).json({ error: 'Нет доступа' });
  const { availableBudget } = require('../services/betting');
  const budget = coach.team_id ? Math.round(availableBudget(db, coach.team_id)) : 0;
  const owned = db.prepare('SELECT item_key, equipped FROM coach_cosmetics WHERE coach_id=?').all(coach.id);
  const ownedMap = Object.fromEntries(owned.map(r => [r.item_key, r.equipped]));
  const catalog = COSMETICS_CATALOG.map(item => ({
    ...item,
    owned: item.key in ownedMap,
    equipped: ownedMap[item.key] === 1,
  }));
  res.json({ catalog, budget });
});

// ── POST /shop/buy ─────────────────────────────────────────────────────────────
router.post('/shop/buy', requireCoach, (req, res) => {
  const db = getDb();
  const { itemKey } = req.body;
  const item = COSMETICS_CATALOG.find(c => c.key === itemKey);
  if (!item) return res.status(400).json({ error: 'Предмет не найден' });
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Нет команды' });
  const already = db.prepare('SELECT id FROM coach_cosmetics WHERE coach_id=? AND item_key=?').get(coach.id, itemKey);
  if (already) return res.status(400).json({ error: 'Уже куплено' });
  const { availableBudget } = require('../services/betting');
  const free = availableBudget(db, coach.team_id);
  if (free < item.price) return res.status(400).json({ error: 'Недостаточно средств' });
  db.prepare('UPDATE teams SET transfer_budget_spent=transfer_budget_spent+? WHERE id=?').run(item.price, coach.team_id);
  db.prepare('INSERT INTO coach_cosmetics (coach_id, item_key) VALUES (?,?)').run(coach.id, itemKey);
  res.json({ ok: true });
});

// ── POST /shop/equip ─────────────────────────────────────────────────────────
router.post('/shop/equip', requireCoach, (req, res) => {
  const db = getDb();
  const { itemKey } = req.body; // null to unequip all
  const coach = myCoach(db, req.user.id);
  if (!coach) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('UPDATE coach_cosmetics SET equipped=0 WHERE coach_id=?').run(coach.id);
  if (itemKey) {
    const owned = db.prepare('SELECT id FROM coach_cosmetics WHERE coach_id=? AND item_key=?').get(coach.id, itemKey);
    if (!owned) return res.status(400).json({ error: 'Предмет не куплен' });
    db.prepare('UPDATE coach_cosmetics SET equipped=1 WHERE coach_id=? AND item_key=?').run(coach.id, itemKey);
  }
  res.json({ ok: true });
});

// ── GET /history — my team's poker settlement history ────────────────────────
router.get('/history', requireCoach, (req, res) => {
  const db = getDb();
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.json({ history: [] });
  const history = db.prepare(`
    SELECT id, stake_type, chips_in, chips_out, delta, detail, created_at
    FROM poker_settlements WHERE team_id=?
    ORDER BY created_at DESC LIMIT 50
  `).all(coach.team_id);
  res.json({ history });
});

module.exports = router;
