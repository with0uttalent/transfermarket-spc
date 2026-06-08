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

// Poker card skins. Visuals are rendered entirely client-side and only the
// purchasing coach sees their own equipped skin. Suits (масти) are NEVER
// changed — skins only restyle colour, card back (рубашка) and pattern.
const CARD_SKINS_CATALOG = [
  { key: 'skin_midnight', name: 'Полночь',       emoji: '🌌', price: 300000,  desc: 'Тёмно-синяя ночь с золотыми мастями' },
  { key: 'skin_emerald',  name: 'Изумруд',       emoji: '💚', price: 350000,  desc: 'Зелёное сукно казино' },
  { key: 'skin_crimson',  name: 'Багровый люкс', emoji: '🥀', price: 400000,  desc: 'Красный бархат премиум' },
  { key: 'skin_gold',     name: 'Чёрное золото', emoji: '🏆', price: 750000,  desc: 'VIP: чёрные карты с золотом' },
  { key: 'skin_neon',     name: 'Неон',          emoji: '🌃', price: 500000,  desc: 'Киберпанк со свечением' },
  { key: 'skin_ocean',    name: 'Океан',         emoji: '🌊', price: 300000,  desc: 'Морская глубина' },
  { key: 'skin_royal',    name: 'Королевский',   emoji: '👑', price: 1200000, desc: 'Фиолетовый бархат с вензелем' },
];

// Look up a catalog item across both categories, returning its category.
function findCosmetic(key) {
  const hat = COSMETICS_CATALOG.find(c => c.key === key);
  if (hat) return { item: hat, category: 'avatar' };
  const skin = CARD_SKINS_CATALOG.find(c => c.key === key);
  if (skin) return { item: skin, category: 'cardskin' };
  return null;
}

function myCoach(db, userId) {
  return db.prepare('SELECT id, name, avatar_url, team_id FROM coaches WHERE user_id=?').get(userId);
}

// Returns the coach's equipped card-skin key, or 'classic' default.
function equippedCardSkin(db, coachId) {
  const row = db.prepare(
    "SELECT item_key FROM coach_cosmetics WHERE coach_id=? AND category='cardskin' AND equipped=1"
  ).get(coachId);
  return row ? row.item_key : 'classic';
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
      me = {
        coachId: coach.id, name: coach.name, teamId: coach.team_id, avatarUrl: coach.avatar_url,
        cardSkin: equippedCardSkin(db, coach.id),
      };
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
  // Card skins: 'classic' is the free default (always owned, equipped when no skin set).
  const anySkinEquipped = CARD_SKINS_CATALOG.some(s => ownedMap[s.key] === 1);
  const cardSkins = [
    { key: 'classic', name: 'Классика', emoji: '🂡', price: 0, desc: 'Стандартный вид карт', owned: true, equipped: !anySkinEquipped },
    ...CARD_SKINS_CATALOG.map(item => ({
      ...item,
      owned: item.key in ownedMap,
      equipped: ownedMap[item.key] === 1,
    })),
  ];
  res.json({ catalog, cardSkins, budget });
});

// ── POST /shop/buy ─────────────────────────────────────────────────────────────
router.post('/shop/buy', requireCoach, (req, res) => {
  const db = getDb();
  const { itemKey } = req.body;
  const found = findCosmetic(itemKey);
  if (!found) return res.status(400).json({ error: 'Предмет не найден' });
  const { item, category } = found;
  const coach = myCoach(db, req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'Нет команды' });
  const already = db.prepare('SELECT id FROM coach_cosmetics WHERE coach_id=? AND item_key=?').get(coach.id, itemKey);
  if (already) return res.status(400).json({ error: 'Уже куплено' });
  const { availableBudget } = require('../services/betting');
  const free = availableBudget(db, coach.team_id);
  if (free < item.price) return res.status(400).json({ error: 'Недостаточно средств' });
  db.prepare('UPDATE teams SET transfer_budget_spent=transfer_budget_spent+? WHERE id=?').run(item.price, coach.team_id);
  db.prepare('INSERT INTO coach_cosmetics (coach_id, item_key, category) VALUES (?,?,?)').run(coach.id, itemKey, category);
  res.json({ ok: true });
});

// ── POST /shop/equip ─────────────────────────────────────────────────────────
router.post('/shop/equip', requireCoach, (req, res) => {
  const db = getDb();
  const { itemKey } = req.body; // null/'classic' to unequip within a category
  let { category } = req.body;
  const coach = myCoach(db, req.user.id);
  if (!coach) return res.status(403).json({ error: 'Нет доступа' });

  // 'classic' is the free default card skin: equipping it just clears the category.
  const isDefaultSkin = itemKey === 'classic';
  if (itemKey && !isDefaultSkin) {
    const found = findCosmetic(itemKey);
    if (!found) return res.status(400).json({ error: 'Предмет не найден' });
    category = found.category;
  }
  if (!category) category = 'avatar';

  // Unequip everything in this category, then equip the chosen item (if any).
  db.prepare('UPDATE coach_cosmetics SET equipped=0 WHERE coach_id=? AND category=?').run(coach.id, category);
  if (itemKey && !isDefaultSkin) {
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
