'use strict';

// One-off backfill for leagues that entered transfer_window under the old
// code path (before the champion-on-window-entry fix) and so never got
// their champion crowned / banner posted. Safe to run multiple times:
// awardLeagueChampion is idempotent per league+season title.
//
// Usage: node scripts/backfill-champion.js [leagueId]
// With no leagueId, backfills every league currently in transfer_window.

const { getDb } = require('../database/db');
const { enterTransferWindow } = require('../services/leagueSeason');

const db = getDb();
const leagueIdArg = process.argv[2];

const leagues = leagueIdArg
  ? db.prepare('SELECT * FROM leagues WHERE id=?').all(Number(leagueIdArg))
  : db.prepare("SELECT * FROM leagues WHERE status='transfer_window'").all();

if (leagues.length === 0) {
  console.log('No matching leagues found.');
  process.exit(0);
}

for (const league of leagues) {
  console.log(`League ${league.id} (${league.name}, season ${league.season}): checking...`);
  const champion = enterTransferWindow(db, league.id);
  if (champion) {
    console.log(`  -> Crowned champion: ${champion.team_name} (${champion.points} pts)`);
  } else {
    console.log('  -> No change (champion already awarded, or no standings yet).');
  }
}
