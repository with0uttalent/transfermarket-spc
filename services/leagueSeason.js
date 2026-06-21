'use strict';

// Centralised end-of-season logic shared by the API routes and the scheduler.
// When a league plays its final fixture it enters a transfer window; at that
// moment the champion is crowned — title, "season ended" news, homepage
// banner and a coach notification. The award is idempotent so the several
// code paths that can trigger the transition never crown a champion twice.

// The transfer window is a formality (nothing auto-closes it — an admin
// starts the next season manually), but it shows as a two-week window.
const TRANSFER_WINDOW_DAYS = 14;

// Crown the league champion for its CURRENT season. Idempotent: if the title
// for this league+season already exists it does nothing and returns null.
// Returns the champion row ({ team_id, team_name, points }) when it awards.
//
// Statements run sequentially (no transaction wrapper) to match the original
// behaviour and stay safe to call from code paths that may already hold one —
// better-sqlite3 is synchronous, so the check-then-insert can't interleave.
function awardLeagueChampion(db, league) {
  const titleName = `${league.name} Champion Season ${league.season}`;

  const already = db.prepare(
    `SELECT 1 FROM titles WHERE title_name=? AND player_id IS NULL LIMIT 1`
  ).get(titleName);
  if (already) return null;

  const champion = db.prepare(`
    SELECT ls.team_id, t.name AS team_name, ls.points
    FROM league_standings ls
    JOIN teams t ON ls.team_id = t.id
    WHERE ls.league_id = ?
    ORDER BY ls.points DESC, (ls.goals_for - ls.goals_against) DESC, ls.goals_for DESC
    LIMIT 1
  `).get(league.id);
  if (!champion) return null;

  const year = new Date().getFullYear();
  const season = `Season ${league.season}`;
  const trophyUrl = league.trophy_url || null;

  // ONE team-level title (player_id NULL). Like tournaments, individual squad
  // members get a player_achievement instead of a per-player title row — a
  // per-player title would make the team's trophy count balloon to the squad
  // size on the club page.
  db.prepare(`INSERT INTO titles (team_id, title_name, season, year, trophy_url) VALUES (?,?,?,?,?)`)
    .run(champion.team_id, titleName, season, year, trophyUrl);

  // Achievement for each current squad member
  const champPlayers = db.prepare(`SELECT id FROM players WHERE team_id=?`).all(champion.team_id);
  const insertAch = db.prepare(`INSERT INTO player_achievements (player_id, achievement_type, description) VALUES (?,?,?)`);
  for (const cp of champPlayers) {
    insertAch.run(cp.id, 'league_winner', `Чемпион ${league.name} (сезон ${league.season})`);
  }

  // Season-ended / champion news
  db.prepare(`INSERT INTO news (title, body, type) VALUES (?,?,?)`).run(
    `${champion.team_name} — чемпион ${league.name}!`,
    `${champion.team_name} завоевали титул ${league.name} в сезоне ${league.season}, набрав ${champion.points} очков. Поздравляем команду и тренерский штаб!`,
    'transfer'
  );

  // Homepage champion banner
  const champTeam = db.prepare('SELECT logo_url FROM teams WHERE id=?').get(champion.team_id);
  const champData = {
    team_id: champion.team_id,
    team_name: champion.team_name,
    league_id: league.id,
    league_name: league.name,
    season: league.season,
    points: champion.points,
    logo_url: champTeam ? champTeam.logo_url : null,
  };
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('league_champion', ?)`)
    .run(JSON.stringify(champData));

  // Notify the champion's coach
  const champCoach = db.prepare('SELECT id FROM coaches WHERE team_id=?').get(champion.team_id);
  if (champCoach) {
    db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`)
      .run(champCoach.id, '🏆 Вы чемпион!', `${champion.team_name} завоевали титул ${league.name} в сезоне ${league.season} с ${champion.points} очками!`, 'champion');
  }

  return champion;
}

// Move a league into its post-season transfer window AND crown the champion.
// Idempotent and safe to call from any of the several code paths that detect
// "all fixtures played": the status/date are only set on the first transition,
// and the champion award is itself idempotent.
function enterTransferWindow(db, leagueId) {
  const league = db.prepare('SELECT * FROM leagues WHERE id=?').get(leagueId);
  if (!league) return null;

  if (league.status !== 'transfer_window') {
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + TRANSFER_WINDOW_DAYS);
    db.prepare(`UPDATE leagues SET status='transfer_window', transfer_window_end=? WHERE id=?`)
      .run(windowEnd.toISOString().slice(0, 10), leagueId);
  }

  return awardLeagueChampion(db, league);
}

module.exports = { awardLeagueChampion, enterTransferWindow, TRANSFER_WINDOW_DAYS };
