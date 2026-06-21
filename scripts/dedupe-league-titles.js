'use strict';

// One-off cleanup for the league-champion titles created before the fixes:
//   1. The /next-season crash (e881edc) re-awarded titles on every retry with
//      no idempotency check -> dozens of identical team titles.
//   2. Leagues used to insert a per-player title row for every squad member,
//      which (all carrying team_id) made the club's trophy count balloon to
//      the squad size. Tournaments only ever create ONE team-level title and
//      give players an achievement instead — leagues now match that.
//
// This script brings existing data in line with the new behaviour:
//   - Converts each per-player league-champion title into a 'league_winner'
//     player_achievement (skipping players that already have one).
//   - Deletes all per-player league-champion title rows.
//   - Dedupes the remaining team-level titles to one row per
//     (team_id, title_name, season), keeping the lowest id.
//   - Backfills trophy_url from the owning league.
//
// Safe to run multiple times. Usage: node scripts/dedupe-league-titles.js

const { getDb } = require('../database/db');

const db = getDb();
const leagues = db.prepare('SELECT id, name, trophy_url FROM leagues').all();
const isLeagueTitle = (name) => leagues.some(l => name.startsWith(`${l.name} Champion Season`));

const tx = db.transaction(() => {
  // 1. Per-player league-champion titles -> achievements, then delete the rows.
  const playerTitles = db.prepare(`
    SELECT id, player_id, title_name, season FROM titles
    WHERE title_name LIKE '%Champion Season%' AND player_id IS NOT NULL
  `).all().filter(t => isLeagueTitle(t.title_name));

  const hasAch = db.prepare(`
    SELECT 1 FROM player_achievements
    WHERE player_id=? AND achievement_type='league_winner' AND description=? LIMIT 1
  `);
  const insAch = db.prepare(`
    INSERT INTO player_achievements (player_id, achievement_type, description) VALUES (?,?,?)
  `);
  const delTitle = db.prepare('DELETE FROM titles WHERE id=?');

  let achCreated = 0, playerRowsRemoved = 0;
  const seenAch = new Set();
  for (const t of playerTitles) {
    const desc = `Чемпион ${t.title_name.replace(/ Champion Season \d+$/, '')} (сезон ${t.season.replace(/^Season /, '')})`;
    const dedupeKey = `${t.player_id}|${desc}`;
    if (!seenAch.has(dedupeKey) && !hasAch.get(t.player_id, desc)) {
      insAch.run(t.player_id, 'league_winner', desc);
      seenAch.add(dedupeKey);
      achCreated++;
    }
    delTitle.run(t.id);
    playerRowsRemoved++;
  }
  console.log(`Created ${achCreated} league_winner achievement(s); removed ${playerRowsRemoved} per-player title row(s).`);

  // 2. Dedupe remaining team-level titles to one per (team, title, season).
  const dupes = db.prepare(`
    SELECT title_name, season, team_id, COUNT(*) AS cnt, MIN(id) AS keep_id
    FROM titles
    WHERE title_name LIKE '%Champion Season%' AND player_id IS NULL
    GROUP BY title_name, season, team_id
    HAVING cnt > 1
  `).all().filter(g => isLeagueTitle(g.title_name));

  const delDup = db.prepare(`
    DELETE FROM titles
    WHERE title_name=? AND season=? AND team_id=? AND player_id IS NULL AND id<>?
  `);
  let removed = 0;
  for (const g of dupes) {
    const r = delDup.run(g.title_name, g.season, g.team_id, g.keep_id);
    removed += r.changes;
    console.log(`  ${g.title_name} (season ${g.season}, team ${g.team_id}): removed ${r.changes} duplicate(s)`);
  }
  console.log(`Removed ${removed} duplicate team-title row(s) across ${dupes.length} group(s).`);

  // 3. Backfill trophy_url from the owning league.
  const need = db.prepare(`
    SELECT id, title_name FROM titles
    WHERE title_name LIKE '%Champion Season%' AND (trophy_url IS NULL OR trophy_url='')
  `).all();
  const updTrophy = db.prepare('UPDATE titles SET trophy_url=? WHERE id=?');
  let backfilled = 0;
  for (const t of need) {
    const league = leagues.find(l => t.title_name.startsWith(`${l.name} Champion Season`));
    if (league && league.trophy_url) { updTrophy.run(league.trophy_url, t.id); backfilled++; }
  }
  console.log(`Backfilled trophy_url on ${backfilled} title row(s).`);
});

tx();
console.log('Done.');
