'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireCoach, requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── OVR / rarity helpers ────────────────────────────────────────────────────

function rollOvr() {
  const r = Math.random();
  if (r < 0.00001)  return 90 + Math.floor(Math.random() * 6);  // Icon 90-95 (~0.001%)
  if (r < 0.0041)   return 85 + Math.floor(Math.random() * 5);  // Legendary 85-90 (~0.4%)
  if (r < 0.0291)   return 80 + Math.floor(Math.random() * 5);  // Epic 80-85 (~2.5%)
  if (r < 0.1291)   return 75 + Math.floor(Math.random() * 5);  // Rare 75-80 (~10%)
  if (r < 0.3491)   return 70 + Math.floor(Math.random() * 5);  // Uncommon 70-75 (~22%)
  return 60 + Math.floor(Math.random() * 10);                    // Common 60-70 (~65%)
}

function rarityFromOvr(ovr) {
  if (ovr >= 90) return 'icon';
  if (ovr >= 85) return 'legendary';
  if (ovr >= 80) return 'epic';
  if (ovr >= 75) return 'rare';
  if (ovr >= 70) return 'uncommon';
  return 'common';
}

function valueFromOvr(ovr) {
  const points = [
    [60, 200000], [65, 600000], [70, 1000000], [75, 2000000],
    [80, 4000000], [85, 7000000], [90, 10000000],
  ];
  const lower = Math.floor(ovr / 5) * 5;
  const upper = lower + 5;
  const vLow  = (points.find(p => p[0] === lower) || points[0])[1];
  const vHigh = (points.find(p => p[0] === upper) || points[points.length - 1])[1];
  const t = (ovr - lower) / 5;
  const raw = vLow + (vHigh - vLow) * t;
  return Math.min(10000000, Math.round(raw / 50000) * 50000);
}

const PACK_SLOTS = [
  { key: 'GK',     positions: ['Goalkeeper'],                          role: 'GK'  },
  { key: 'DEF',    positions: ['Centre-Back'],                         role: 'DEF' },
  { key: 'CMF',    positions: ['Defensive Midfield','Central Midfield'], role: 'MID' },
  { key: 'AMF',    positions: ['Attacking Midfield'],                  role: 'MID' },
  { key: 'Winger', positions: ['Left Winger','Right Winger'],          role: 'FWD' },
];

const FIRST_NAMES = [
  'Alejandro','Marcus','Luca','João','Matteo','Pierre','Niko','Emre','Yusuf',
  'Andres','Rafael','Hugo','Jamie','Connor','Ryan','Mateo','Diogo','Kylian',
  'Erling','Declan','Phil','Mason','Pedri','Gavi','Federico','Rodri','Vinicius',
  'Bernardo','Trent','Aaron','Jude','Achraf','Theo','Rafa','Ivan','Patrick',
  'Leroy','Thomas','Joshua','Leon','Nico','Florian','Jamal','Ferran','Ansu',
];

const LAST_NAMES = [
  'Silva','Martinez','Fischer','Oliveira','Rossi','Dupont','Müller','Demir',
  'Yilmaz','Torres','Fernández','Ramos','Diallo','Wilson','O\'Brien','Campbell',
  'García','Costa','Bellingham','Haaland','Rice','Foden','Mount','Chiesa',
  'Rodrigo','Militão','Rashford','Arnold','Santos','Pereira','Alves','Neto',
  'Sousa','Moura','Ribeiro','Carvalho','Mendes','Rodrigues','Lima','Ferreira',
  'Kowalski','Nowak','Wiśniewski','Kaminski','Lewandowski',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function skillsForRole(ovr, role) {
  const v = () => Math.round((Math.random() - 0.5) * 18);
  let pace, shooting, passing, defending, physical;
  if      (role === 'GK')  { pace=ovr-12+v(); shooting=ovr-18+v(); passing=ovr-8+v();  defending=ovr+8+v();  physical=ovr+2+v(); }
  else if (role === 'DEF') { pace=ovr+2+v();  shooting=ovr-14+v(); passing=ovr-4+v();  defending=ovr+12+v(); physical=ovr+10+v(); }
  else if (role === 'MID') { pace=ovr+2+v();  shooting=ovr+2+v();  passing=ovr+12+v(); defending=ovr-4+v();  physical=ovr+v(); }
  else                     { pace=ovr+10+v(); shooting=ovr+16+v(); passing=ovr-4+v();  defending=ovr-18+v(); physical=ovr+4+v(); }
  const clamp = x => Math.min(99, Math.max(25, x));
  return { pace: clamp(pace), shooting: clamp(shooting), passing: clamp(passing), defending: clamp(defending), physical: clamp(physical) };
}

function ageForRole(role) {
  if (role === 'GK')  return ri(22, 35);
  if (role === 'DEF') return ri(20, 32);
  if (role === 'MID') return ri(19, 31);
  return ri(18, 29);
}

function heightForRole(role) {
  if (role === 'GK')  return ri(185, 198);
  if (role === 'DEF') return ri(178, 193);
  if (role === 'MID') return ri(170, 185);
  return ri(170, 188);
}

function generatePackPlayerData(slot) {
  const ovr      = rollOvr();
  const rarity   = rarityFromOvr(ovr);
  const mv       = valueFromOvr(ovr);
  const position = pick(slot.positions);
  const name     = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const age      = ageForRole(slot.role);
  const bYear    = new Date().getFullYear() - age;
  const dob      = `${bYear}-${String(ri(1,12)).padStart(2,'0')}-${String(ri(1,28)).padStart(2,'0')}`;
  const height   = heightForRole(slot.role);
  const skills   = skillsForRole(ovr, slot.role);
  return { name, position, ovr, rarity, mv, dob, height, skills };
}

// ─── GET /packs/my ────────────────────────────────────────────────────────────
router.get('/my', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.status(404).json({ error: 'Coach not found' });

  // Return oldest pending pack first (queue order) + total count
  const pack = db.prepare(`SELECT * FROM player_packs WHERE coach_id=? AND status='pending' ORDER BY created_at ASC LIMIT 1`).get(coach.id);
  if (!pack) return res.json(null);

  const pendingCount = db.prepare(`SELECT COUNT(*) as cnt FROM player_packs WHERE coach_id=? AND status='pending'`).get(coach.id).cnt;

  const players = db.prepare(`
    SELECT pp.id AS pack_player_id, pp.ovr, pp.rarity, pp.kept,
           p.id, p.name, p.position, p.market_value, p.image_url, p.date_of_birth, p.height
    FROM pack_players pp
    JOIN players p ON pp.player_id = p.id
    WHERE pp.pack_id = ?
    ORDER BY pp.id ASC
  `).all(pack.id);

  res.json({ ...pack, players, pending_count: pendingCount });
});

// ─── Shared pack generation logic (used by route + scheduler) ────────────────
function generatePackForCoach(db, coachId, countries) {
  const insertPlayer = db.prepare(`INSERT INTO players (name, position, market_value, status, date_of_birth, height, nationality_id, ovr_fixed) VALUES (?,?,?,'in_pack',?,?,?,?)`);
  const insertSkills = db.prepare(`INSERT OR IGNORE INTO player_skills (player_id, pace, shooting, passing, defending, physical) VALUES (?,?,?,?,?,?)`);
  const insertPack   = db.prepare(`INSERT INTO player_packs (coach_id, status) VALUES (?,?)`);
  const insertPackPl = db.prepare(`INSERT INTO pack_players (pack_id, player_id, ovr, rarity) VALUES (?,?,?,?)`);

  db.transaction(() => {
    const packRes = insertPack.run(coachId, 'pending');
    const packId  = packRes.lastInsertRowid;

    for (const slot of PACK_SLOTS) {
      const d     = generatePackPlayerData(slot);
      const natId = countries.length ? pick(countries).id : null;
      const pr    = insertPlayer.run(d.name, d.position, d.mv, d.dob, d.height, natId, d.ovr);
      insertSkills.run(pr.lastInsertRowid, d.skills.pace, d.skills.shooting, d.skills.passing, d.skills.defending, d.skills.physical);
      insertPackPl.run(packId, pr.lastInsertRowid, d.ovr, d.rarity);
    }
  })();
}

// force=true: очищает нераскрытые паки и выдаёт всем заново (ручная выдача)
// force=false: пропускает тренеров с нераскрытым паком (авто-доставка раз в неделю)
function deliverPacksToAllCoaches(db, force = false) {
  const coaches    = db.prepare('SELECT c.id, c.team_id FROM coaches c WHERE c.team_id IS NOT NULL').all();
  const countries  = db.prepare('SELECT id FROM countries').all();
  const checkExisting = db.prepare(`SELECT id FROM player_packs WHERE coach_id=? AND status='pending'`);

  console.log(`[Packs] Delivering to ${coaches.length} coaches (force=${force})`);

  let count = 0;
  for (const coach of coaches) {
    const existing = checkExisting.get(coach.id);

    if (existing) {
      if (!force) {
        console.log(`[Packs] Coach ${coach.id} already has a pending pack — skip`);
        continue;
      }
      // force: удалить нераскрытый пак вместе с его игроками (они ещё in_pack — просто удалятся каскадно)
      db.transaction(() => {
        const packPlayers = db.prepare('SELECT player_id FROM pack_players WHERE pack_id=?').all(existing.id);
        for (const pp of packPlayers) {
          db.prepare(`DELETE FROM players WHERE id=? AND status='in_pack'`).run(pp.player_id);
        }
        db.prepare('DELETE FROM player_packs WHERE id=?').run(existing.id);
      })();
      console.log(`[Packs] Cleared old pending pack for coach ${coach.id}`);
    }

    try {
      generatePackForCoach(db, coach.id, countries);
      count++;
      console.log(`[Packs] Pack generated for coach ${coach.id} (team ${coach.team_id})`);
    } catch(e) {
      console.error(`[Packs] Failed to generate pack for coach ${coach.id}:`, e.message);
    }
  }

  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_pack_delivery', ?)`).run(new Date().toISOString());
  console.log(`[Packs] Done: ${count} packs delivered`);
  return count;
}

// ─── POST /packs/generate (admin, всегда force) ───────────────────────────────
router.post('/generate', requireAdmin, (req, res) => {
  const db    = getDb();
  const count = deliverPacksToAllCoaches(db, true);
  res.json({ ok: true, count });
});

// ─── POST /packs/test (admin — no DB changes) ─────────────────────────────────
router.post('/test', requireAdmin, (req, res) => {
  const players = PACK_SLOTS.map(slot => {
    const d = generatePackPlayerData(slot);
    return {
      id: Math.floor(Math.random() * 10000),
      name: d.name,
      position: d.position,
      ovr: d.ovr,
      rarity: d.rarity,
      market_value: d.mv,
      image_url: null,
    };
  });
  res.json({ players });
});

// ─── POST /packs/:id/pick ─────────────────────────────────────────────────────
router.post('/:id/pick', requireAuth, (req, res) => {
  const db    = getDb();
  const packId = parseInt(req.params.id);
  const { player_id } = req.body;
  if (!player_id) return res.status(400).json({ error: 'player_id required' });

  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach) return res.status(403).json({ error: 'Not a coach' });
  if (!coach.team_id) return res.status(400).json({ error: 'Coach has no team' });

  const pack = db.prepare(`SELECT * FROM player_packs WHERE id=? AND coach_id=? AND status='pending'`).get(packId, coach.id);
  if (!pack) return res.status(404).json({ error: 'Pack not found or already opened' });

  const packPlayers = db.prepare('SELECT * FROM pack_players WHERE pack_id=?').all(packId);
  const chosen = packPlayers.find(pp => pp.player_id == player_id);
  if (!chosen) return res.status(400).json({ error: 'Player not in this pack' });

  db.transaction(() => {
    // Mark pack as opened
    db.prepare(`UPDATE player_packs SET status='opened', opened_at=CURRENT_TIMESTAMP WHERE id=?`).run(packId);

    // Assign chosen player to coach's team
    db.prepare(`UPDATE players SET team_id=?, status='active' WHERE id=?`).run(coach.team_id, player_id);
    db.prepare('UPDATE pack_players SET kept=1 WHERE pack_id=? AND player_id=?').run(packId, player_id);

    // Add chosen player to team lineup (bench)
    const usedSlots = new Set(db.prepare('SELECT slot FROM team_lineups WHERE team_id=?').all(coach.team_id).map(r => r.slot));
    let slot = 12;
    while (usedSlots.has(slot)) slot++;
    db.prepare('INSERT OR IGNORE INTO team_lineups (team_id, player_id, slot) VALUES (?,?,?)').run(coach.team_id, player_id, slot);

    // Move unchosen players from 'in_pack' to 'free_agent' (auction starts at next 13:00 window)
    const others = packPlayers.filter(pp => pp.player_id != player_id);
    const now = new Date().toISOString();
    for (const pp of others) {
      db.prepare(`UPDATE players SET status='free_agent', free_agent_since=? WHERE id=?`).run(now, pp.player_id);
    }
  })();

  res.json({ ok: true });
});

// ─── POST /packs/buy (coach buys a pack for €1M) ─────────────────────────────
router.post('/buy', requireAuth, (req, res) => {
  const db = getDb();
  const coach = db.prepare('SELECT * FROM coaches WHERE user_id=?').get(req.user.id);
  if (!coach || !coach.team_id) return res.status(403).json({ error: 'No team' });

  const team = db.prepare('SELECT transfer_budget, transfer_budget_spent FROM teams WHERE id=?').get(coach.team_id);
  const available = (team.transfer_budget || 0) - (team.transfer_budget_spent || 0);
  const PACK_PRICE = 1000000;

  if (available < PACK_PRICE) return res.status(400).json({ error: 'Недостаточно средств (нужно €1M)' });

  // Deduct budget
  db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?').run(PACK_PRICE, coach.team_id);

  const countries = db.prepare('SELECT id FROM countries').all();
  generatePackForCoach(db, coach.id, countries);

  res.json({ ok: true });
});

// ─── POST /packs/generate-for-coach (admin, single coach) ────────────────────
router.post('/generate-for-coach', requireAdmin, (req, res) => {
  const db = getDb();
  const { coach_id } = req.body;
  if (!coach_id) return res.status(400).json({ error: 'coach_id required' });

  const coach = db.prepare('SELECT * FROM coaches WHERE id=?').get(coach_id);
  if (!coach) return res.status(404).json({ error: 'Coach not found' });

  const existing = db.prepare(`SELECT id FROM player_packs WHERE coach_id=? AND status='pending'`).get(coach_id);
  if (existing) return res.status(400).json({ error: 'Coach already has a pending pack' });

  const countries = db.prepare('SELECT id FROM countries').all();
  generatePackForCoach(db, coach_id, countries);

  res.json({ ok: true });
});

module.exports = router;
module.exports.deliverPacksToAllCoaches = deliverPacksToAllCoaches;
