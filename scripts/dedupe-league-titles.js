'use strict';

// One-off cleanup that brings existing league-champion data in line with the
// tournament-style model:
//   - Exactly ONE team-level title per league win (player_id NULL, league_id set).
//   - Each squad member gets a 'league_winner' player_achievement (league_id set),
//     which surfaces that same team trophy on the player's profile.
//
// Historically leagues stored a per-player title row for every squad member
// (all carrying team_id), and the /next-season crash (e881edc) re-awarded on
// every retry, so a champion accumulated dozens of identical title rows. This
// script repairs that:
//   1. Per-player league-champion titles -> league_winner achievements, rows deleted.
//   2. Team-level league titles deduped to one per (team, title, season).
//   3. league_id + trophy_url backfilled on the kept team title and achievements.
//
// Safe to run multiple times. Usage: node scripts/dedupe-league-titles.js

const { getDb } = require('../database/db');

const db = getDb();
const leagues = db.prepare('SELECT id, name, trophy_url FROM leagues').all();
const leagueFor = (name) => leagues.find(l => name.startsWith(`${l.name} Champion Season`));

const tx = db.transaction(() => {
  // 1. Per-player league-champion titles -> achievements, then delete the rows.
  const playerTitles = db.prepare(`
    SELECT id, player_id, title_name, season FROM titles
    WHERE title_name LIKE '%Champion Season%' AND player_id IS NOT NULL
  `).all().filter(t => leagueFor(t.title_name));

  const hasAch = db.prepare(`
    SELECT 1 FROM player_achievements
    WHERE player_id=? AND achievement_type='league_winner' AND league_id=? LIMIT 1
  `);
  const insAch = db.prepare(`
    INSERT INTO player_achievements (player_id, achievement_type, description, league_id) VALUES (?,?,?,?)
  `);
  const delTitle = db.prepare('DELETE FROM titles WHERE id=?');

  let achCreated = 0, playerRowsRemoved = 0;
  for (const t of playerTitles) {
    const lg = leagueFor(t.title_name);
    if (lg && !hasAch.get(t.player_id, lg.id)) {
      const seasonNum = String(t.season || '').replace(/^Season /, '');
      insAch.run(t.player_id, 'league_winner', `Чемпион ${lg.name} (сезон ${seasonNum})`, lg.id);
      achCreated++;
    }
    delTitle.run(t.id);
    playerRowsRemoved++;
  }
  console.log(`Created ${achCreated} league_winner achievement(s); removed ${playerRowsRemoved} per-player title row(s).`);

  // 2. Dedupe team-level titles to one per (team, title, season); set league_id + trophy_url.
  const groups = db.prepare(`
    SELECT title_name, season, team_id, MIN(id) AS keep_id, COUNT(*) AS cnt
    FROM titles
    WHERE title_name LIKE '%Champion Season%' AND player_id IS NULL
    GROUP BY title_name, season, team_id
  `).all().filter(g => leagueFor(g.title_name));

  const delDup = db.prepare(`
    DELETE FROM titles
    WHERE title_name=? AND season=? AND team_id=? AND player_id IS NULL AND id<>?
  `);
  const updKept = db.prepare('UPDATE titles SET league_id=?, trophy_url=COALESCE(trophy_url, ?) WHERE id=?');

  let removed = 0;
  for (const g of groups) {
    const lg = leagueFor(g.title_name);
    removed += delDup.run(g.title_name, g.season, g.team_id, g.keep_id).changes;
    updKept.run(lg.id, lg.trophy_url || null, g.keep_id);
  }
  console.log(`Deduped ${groups.length} team-title group(s); removed ${removed} duplicate row(s); set league_id + trophy_url on kept rows.`);
});

tx();
console.log('Done.');
