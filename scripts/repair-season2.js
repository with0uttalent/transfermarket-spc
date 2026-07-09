'use strict';

// One-off repair for leagues broken by the season-rollover bug.
//
// What happened: /next-season regenerated the schedule, but last season's
// finished matches (not yet tied to a season) were picked up by the scheduler's
// reconcile self-heal and re-applied to the fresh slots. Result: standings
// showed last season's table, every slot got "played", the league bounced
// straight back into transfer_window and the champion was crowned for the
// season that had just started.
//
// This script, per league:
//   1. Stamps matches.season (matches started before the league's current
//      start_date belong to the previous season).
//   2. Unlinks schedule slots that point at matches from another season.
//   3. Rebuilds standings from the correctly-linked matches of the current
//      season only (in the broken case: all zeros).
//   4. Fixes current_matchday and, if the league was wrongly bounced into
//      transfer_window while unplayed fixtures remain, sets it back to active.
//   5. Removes the wrongly-awarded current-season champion artifacts: title,
//      player achievements, news, homepage banner, coach notification.
//      (Last season's title is left untouched.)
//
// Safe to run multiple times. Usage:
//   node scripts/repair-season2.js [leagueId]

const { getDb } = require('../database/db');

const db = getDb();
const leagueIdArg = process.argv[2];

const leagues = leagueIdArg
  ? db.prepare('SELECT * FROM leagues WHERE id=?').all(Number(leagueIdArg))
  : db.prepare('SELECT * FROM leagues').all();

const tx = db.transaction((league) => {
  const prevSeason = league.season - 1;

  // 1. Stamp seasons on this league's matches that don't have one yet.
  const stampedOld = db.prepare(`
    UPDATE matches SET season=?
    WHERE league_id=? AND season IS NULL
      AND (started_at IS NOT NULL AND substr(started_at,1,10) < ?)
  `).run(prevSeason, league.id, league.start_date || '9999-12-31').changes;
  const stampedNew = db.prepare(`
    UPDATE matches SET season=?
    WHERE league_id=? AND season IS NULL
  `).run(league.season, league.id).changes;
  console.log(`  matches stamped: ${stampedOld} -> season ${prevSeason}, ${stampedNew} -> season ${league.season}`);

  // 2. Unlink slots that point at matches from another season.
  const unlinked = db.prepare(`
    UPDATE league_schedule SET match_id=NULL
    WHERE league_id=? AND match_id IN (
      SELECT m.id FROM matches m WHERE m.league_id=? AND m.season <> ?
    )
  `).run(league.id, league.id, league.season).changes;
  console.log(`  schedule slots unlinked: ${unlinked}`);

  // 3. Rebuild standings from correctly-linked current-season matches.
  db.prepare(`
    UPDATE league_standings
    SET played=0, won=0, drawn=0, lost=0, goals_for=0, goals_against=0, points=0
    WHERE league_id=?
  `).run(league.id);
  const linked = db.prepare(`
    SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
    FROM league_schedule ls JOIN matches m ON m.id = ls.match_id
    WHERE ls.league_id=?
  `).all(league.id);
  const upd = db.prepare(`
    UPDATE league_standings SET played=played+1, won=won+?, drawn=drawn+?, lost=lost+?,
      goals_for=goals_for+?, goals_against=goals_against+?, points=points+?
    WHERE league_id=? AND team_id=?
  `);
  for (const m of linked) {
    const hw = m.home_score > m.away_score, dr = m.home_score === m.away_score;
    upd.run(hw?1:0, dr?1:0, (!hw&&!dr)?1:0, m.home_score, m.away_score, hw?3:dr?1:0, league.id, m.home_team_id);
    upd.run((!hw&&!dr)?1:0, dr?1:0, hw?1:0, m.away_score, m.home_score, (!hw&&!dr)?3:dr?1:0, league.id, m.away_team_id);
  }
  console.log(`  standings rebuilt from ${linked.length} current-season match(es)`);

  // 4. Fix matchday counter and status.
  const mdRow = db.prepare(`
    SELECT COALESCE(MAX(ls.matchday),0) AS md
    FROM league_schedule ls WHERE ls.league_id=? AND ls.match_id IS NOT NULL
  `).get(league.id);
  db.prepare('UPDATE leagues SET current_matchday=? WHERE id=?').run(mdRow.md, league.id);

  const unplayed = db.prepare(
    'SELECT COUNT(*) AS cnt FROM league_schedule WHERE league_id=? AND match_id IS NULL'
  ).get(league.id).cnt;
  if (league.status === 'transfer_window' && unplayed > 0) {
    db.prepare(`UPDATE leagues SET status='active', transfer_window_end=NULL WHERE id=?`).run(league.id);
    console.log(`  status: transfer_window -> active (${unplayed} fixtures still to play), matchday=${mdRow.md}`);
  }

  // 5. Remove wrongly-awarded CURRENT-season champion artifacts.
  const titleName = `${league.name} Champion Season ${league.season}`;
  const delTitles = db.prepare(`DELETE FROM titles WHERE title_name=?`).run(titleName).changes;
  const delAch = db.prepare(
    `DELETE FROM player_achievements WHERE achievement_type='league_winner' AND league_id=? AND description LIKE ?`
  ).run(league.id, `%(сезон ${league.season})`).changes;
  const delNews = db.prepare(
    `DELETE FROM news WHERE body LIKE ?`
  ).run(`%завоевали титул ${league.name} в сезоне ${league.season},%`).changes;
  const delNotif = db.prepare(
    `DELETE FROM coach_notifications WHERE type='champion' AND body LIKE ?`
  ).run(`%${league.name} в сезоне ${league.season}%`).changes;

  let delBanner = 0;
  const bannerRow = db.prepare("SELECT value FROM app_settings WHERE key='league_champion'").get();
  if (bannerRow) {
    try {
      const b = JSON.parse(bannerRow.value);
      if (b.league_id === league.id && b.season === league.season) {
        db.prepare("DELETE FROM app_settings WHERE key='league_champion'").run();
        delBanner = 1;
      }
    } catch { /* malformed — leave it */ }
  }
  if (delTitles || delAch || delNews || delNotif || delBanner) {
    console.log(`  removed season-${league.season} artifacts: titles=${delTitles}, achievements=${delAch}, news=${delNews}, notifications=${delNotif}, banner=${delBanner}`);
  }
});

for (const league of leagues) {
  console.log(`League ${league.id} (${league.name}), season ${league.season}, status=${league.status}:`);
  tx(league);
}
console.log('Done.');
