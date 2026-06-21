'use strict';

// One-off cleanup for the duplicate league-champion titles created before the
// /next-season crash fix (e881edc): each retry re-awarded the title with no
// idempotency check, so a champion ended up with dozens of identical titles.
//
// For every (team_id, player_id, title_name, season) group this keeps the
// lowest id and deletes the rest. It also backfills trophy_url from the
// matching league when the kept title has none.
//
// Safe to run multiple times. Usage: node scripts/dedupe-league-titles.js

const { getDb } = require('../database/db');

const db = getDb();

// Find duplicate groups (same team/player/title/season). player_id NULL is
// treated as its own group via the IFNULL key.
const dupes = db.prepare(`
  SELECT title_name, season, team_id, IFNULL(player_id, -1) AS pkey,
         COUNT(*) AS cnt, MIN(id) AS keep_id
  FROM titles
  WHERE title_name LIKE '%Champion Season%'
  GROUP BY title_name, season, team_id, pkey
  HAVING cnt > 1
`).all();

let removed = 0;
const delStmt = db.prepare(`
  DELETE FROM titles
  WHERE title_name=? AND season=? AND team_id=? AND IFNULL(player_id,-1)=? AND id<>?
`);

const tx = db.transaction(() => {
  for (const g of dupes) {
    const r = delStmt.run(g.title_name, g.season, g.team_id, g.pkey, g.keep_id);
    removed += r.changes;
    console.log(`  ${g.title_name} (season ${g.season}, team ${g.team_id}, player ${g.pkey === -1 ? 'NONE' : g.pkey}): removed ${r.changes} duplicate(s)`);
  }
});
tx();

console.log(`Removed ${removed} duplicate title row(s) across ${dupes.length} group(s).`);

// Backfill trophy_url from the owning league for league-champion titles.
const titlesNeedingTrophy = db.prepare(`
  SELECT id, title_name FROM titles
  WHERE title_name LIKE '%Champion Season%' AND (trophy_url IS NULL OR trophy_url='')
`).all();

const leagues = db.prepare('SELECT id, name, trophy_url FROM leagues').all();
let backfilled = 0;
const updTrophy = db.prepare('UPDATE titles SET trophy_url=? WHERE id=?');

for (const t of titlesNeedingTrophy) {
  // title_name format: "<league name> Champion Season <n>"
  const league = leagues.find(l => t.title_name.startsWith(`${l.name} Champion Season`));
  if (league && league.trophy_url) {
    updTrophy.run(league.trophy_url, t.id);
    backfilled++;
  }
}

console.log(`Backfilled trophy_url on ${backfilled} title row(s).`);
