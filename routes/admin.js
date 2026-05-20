'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const telegramBot = require('../services/telegramBot');

const router = express.Router();

// ─── App settings ─────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Sync runtime state
  settings.telegram_enabled = telegramBot.isEnabled() ? '1' : '0';
  res.json(settings);
});

router.put('/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const { telegram_enabled } = req.body;
  if (telegram_enabled !== undefined) {
    const val = telegram_enabled ? '1' : '0';
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)').run('telegram_enabled', val);
    telegramBot.setEnabled(telegram_enabled);
  }
  res.json({ ok: true });
});

// ─── Name pools for player generation ───────────────────────────────────────
const FIRST_NAMES = [
  'Alejandro','Marcus','Luca','João','Matteo','Pierre','Niko','Emre','Yusuf',
  'Andres','Rafael','Hugo','Serge','Jamie','Connor','Ryan','Mateo','Diogo',
  'Kylian','Erling','Declan','Phil','Mason','Pedri','Gavi','Federico','Rodri',
  'Vinicius','Bernardo','Trent','Aaron','Jude','Achraf','Theo','Rafa','Ivan',
  'Patrick','Leroy','Thomas','Joshua','Leon','Nico','Florian','Jamal','Ferran',
  'Ansu','Xavi','Gerard','Roberto','Sergio','Carlos','Diego','Luis','Angel',
];

const LAST_NAMES = [
  'Silva','Martinez','Fischer','Oliveira','Rossi','Dupont','Müller','Demir',
  'Yilmaz','Torres','Fernández','Ramos','Diallo','Wilson','O\'Brien','Campbell',
  'García','Costa','Bellingham','Haaland','Rice','Foden','Mount','Gavi',
  'Pedri','Chiesa','Rodrigo','Militão','Rashford','Arnold','Wan-Bissaka',
  'Achraf','Hernández','Leão','Santos','Pereira','Alves','Neto','Sousa',
  'Moura','Ribeiro','Carvalho','Mendes','Rodrigues','Lima','Ferreira','Gomes',
  'Kowalski','Nowak','Wiśniewski','Wójcik','Kowalczyk','Kaminski','Lewandowski',
];

const POSITIONS_BY_ROLE = {
  GK:  ['Goalkeeper'],
  DEF: ['Centre-Back','Centre-Back','Left-Back','Right-Back'],
  MID: ['Defensive Midfield','Central Midfield','Central Midfield','Attacking Midfield'],
  FWD: ['Left Winger','Right Winger','Centre-Forward'],
};

// 11 starter slots: 1 GK, 4 DEF, 4 MID, 3 FWD (4-4-2/4-3-3 hybrid)
const STARTER_TEMPLATE = [
  'GK',
  'DEF','DEF','DEF','DEF',
  'MID','MID','MID','MID',
  'FWD','FWD',  // 11 starters
];
// 11 reserve slots
const RESERVE_TEMPLATE = [
  'GK',
  'DEF','DEF','DEF',
  'MID','MID','MID',
  'FWD','FWD','FWD','FWD',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function generatePlayerName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function positionForRole(role) {
  return pick(POSITIONS_BY_ROLE[role]);
}

function marketValueForPosition(role, avgMv, isStarter) {
  const base = avgMv * 1e6;
  const factor = isStarter ? (1.0 + Math.random() * 0.8) : (0.3 + Math.random() * 0.5);
  const roleMultiplier = role === 'FWD' ? 1.3 : role === 'MID' ? 1.1 : role === 'GK' ? 0.8 : 1.0;
  const raw = base * factor * roleMultiplier;
  return Math.round(raw / 50000) * 50000;  // round to nearest 50K
}

const NATIONALITIES_BY_REGION = [
  // Europe
  'Испания','Германия','Франция','Англия','Италия','Португалия','Нидерланды',
  'Бельгия','Хорватия','Австрия','Швейцария','Дания','Швеция','Норвегия','Польша',
  // South America
  'Бразилия','Аргентина','Уругвай','Колумбия','Чили','Эквадор',
  // Africa
  'Сенегал','Нигерия','Камерун','Кот-д\'Ивуар','Марокко','Гана','Египет',
  // Other
  'США','Мексика','Япония','Южная Корея','Австралия',
];

function ageForRole(role) {
  if (role === 'GK')  return ri(22, 35);
  if (role === 'DEF') return ri(20, 32);
  if (role === 'MID') return ri(19, 31);
  return ri(18, 29); // FWD
}

function heightForRole(role) {
  if (role === 'GK')  return ri(185, 198);
  if (role === 'DEF') return ri(178, 193);
  if (role === 'MID') return ri(170, 185);
  return ri(170, 188); // FWD
}

// ─── POST /admin/generate-team ──────────────────────────────────────────────
router.post('/generate-team', requireAdmin, (req, res) => {
  const { name, short_name, avg_market_value_m = 5, country_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const db = getDb();

  // Create team
  const teamResult = db.prepare(`
    INSERT INTO teams (name, short_name, country_id, market_value)
    VALUES (?, ?, ?, 0)
  `).run(name.trim(), short_name || name.trim().substring(0, 8).toUpperCase(), country_id || null);
  const teamId = teamResult.lastInsertRowid;

  // Generate players
  const players = [];
  let totalValue = 0;
  let slot = 1;

  const allRoles = [
    ...STARTER_TEMPLATE.map(r => ({ role: r, isStarter: true })),
    ...RESERVE_TEMPLATE.map(r => ({ role: r, isStarter: false })),
  ];

  // Load countries for random nationality assignment
  const countries = db.prepare('SELECT id FROM countries').all();

  const insertPlayer = db.prepare(`
    INSERT INTO players (name, position, team_id, market_value, status, date_of_birth, height, nationality_id)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  const insertSkills = db.prepare(`
    INSERT OR IGNORE INTO player_skills (player_id, pace, shooting, passing, defending, physical)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertLineup = db.prepare(`
    INSERT OR REPLACE INTO team_lineups (team_id, player_id, slot)
    VALUES (?, ?, ?)
  `);

  for (const { role, isStarter } of allRoles) {
    const pos = positionForRole(role);
    const pname = generatePlayerName();
    const mv = marketValueForPosition(role, avg_market_value_m, isStarter);
    totalValue += mv;

    const age = ageForRole(role);
    const birthYear = new Date().getFullYear() - age;
    const birthMonth = ri(1, 12).toString().padStart(2, '0');
    const birthDay = ri(1, 28).toString().padStart(2, '0');
    const dob = `${birthYear}-${birthMonth}-${birthDay}`;
    const height = heightForRole(role);
    const natId = countries.length ? pick(countries).id : null;

    const pr = insertPlayer.run(pname, pos, teamId, mv, dob, height, natId);
    const playerId = pr.lastInsertRowid;

    // Generate skills based on position and value
    const base = Math.min(88, Math.max(38, Math.round(52 + (Math.log10(Math.max(mv, 100000)) - 5) * 13)));
    const v = () => Math.round((Math.random() - 0.5) * 18);
    let pace, shooting, passing, defending, physical;
    if (role === 'GK')       { pace=base-12+v(); shooting=base-18+v(); passing=base-8+v();  defending=base+8+v();  physical=base+2+v(); }
    else if (role === 'DEF') { pace=base+2+v();  shooting=base-14+v(); passing=base-4+v();  defending=base+12+v(); physical=base+10+v(); }
    else if (role === 'MID') { pace=base+2+v();  shooting=base+2+v();  passing=base+12+v(); defending=base-4+v();  physical=base+v(); }
    else                     { pace=base+10+v(); shooting=base+16+v(); passing=base-4+v();  defending=base-18+v(); physical=base+4+v(); }
    const clamp = x => Math.min(99, Math.max(25, x));
    insertSkills.run(playerId, clamp(pace), clamp(shooting), clamp(passing), clamp(defending), clamp(physical));
    insertLineup.run(teamId, playerId, slot);
    slot++;

    players.push({ id: playerId, name: pname, position: pos, market_value: mv, slot: slot - 1, age, height });
  }

  // Update team market value
  db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(totalValue, teamId);

  const team = db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);
  res.status(201).json({ team, players });
});

module.exports = router;
