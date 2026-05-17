'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

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

  const insertPlayer = db.prepare(`
    INSERT INTO players (name, position, team_id, market_value, status)
    VALUES (?, ?, ?, ?, 'active')
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

    const pr = insertPlayer.run(pname, pos, teamId, mv);
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

    players.push({ id: playerId, name: pname, position: pos, market_value: mv, slot: slot - 1 });
  }

  // Update team market value
  db.prepare('UPDATE teams SET market_value=? WHERE id=?').run(totalValue, teamId);

  const team = db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);
  res.status(201).json({ team, players });
});

module.exports = router;
