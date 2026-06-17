const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'transfermarket.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    seedTriviaQuestions(db);
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS countries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT,
      flag_emoji TEXT
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      country_id INTEGER,
      type TEXT DEFAULT 'league',
      logo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      country_id INTEGER,
      competition_id INTEGER,
      founded INTEGER,
      stadium TEXT,
      logo_url TEXT,
      market_value REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE SET NULL,
      FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date_of_birth DATE,
      nationality_id INTEGER,
      position TEXT,
      sub_position TEXT,
      foot TEXT,
      height INTEGER,
      team_id INTEGER,
      shirt_number INTEGER,
      market_value REAL DEFAULT 0,
      image_url TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (nationality_id) REFERENCES countries(id) ON DELETE SET NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      from_team_id INTEGER,
      to_team_id INTEGER,
      transfer_fee REAL DEFAULT 0,
      transfer_date DATE,
      transfer_type TEXT DEFAULT 'permanent',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (from_team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (to_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS titles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      player_id INTEGER,
      competition_id INTEGER,
      title_name TEXT NOT NULL,
      season TEXT,
      year INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS market_value_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      market_value REAL NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    -- ── New tables (v2) ───────────────────────────────────────

    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position TEXT NOT NULL CHECK(position IN ('left','right')),
      title TEXT,
      image_url TEXT,
      link_url TEXT,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      home_team_id INTEGER NOT NULL,
      away_team_id INTEGER NOT NULL,
      home_score INTEGER DEFAULT 0,
      away_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'scheduled',
      match_date DATE,
      tournament_id INTEGER,
      tournament_round INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS match_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      minute INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      team_id INTEGER,
      player_id INTEGER,
      player2_id INTEGER,
      description TEXT,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL,
      FOREIGN KEY (player2_id) REFERENCES players(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS player_match_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      goals INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      yellow_cards INTEGER DEFAULT 0,
      red_cards INTEGER DEFAULT 0,
      minutes_played INTEGER DEFAULT 90,
      rating REAL DEFAULT 6.0,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      achievement_type TEXT NOT NULL,
      description TEXT,
      match_id INTEGER,
      tournament_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'setup',
      current_round INTEGER DEFAULT 0,
      total_rounds INTEGER DEFAULT 0,
      bracket_data TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      seed INTEGER DEFAULT 0,
      eliminated INTEGER DEFAULT 0,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      from_team_id INTEGER,
      to_team_id INTEGER NOT NULL,
      loan_fee REAL DEFAULT 0,
      start_date DATE,
      end_date DATE,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (from_team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (to_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      type TEXT DEFAULT 'match',
      match_id INTEGER,
      tournament_id INTEGER,
      player_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS match_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL UNIQUE,
      possession_home REAL DEFAULT 50,
      possession_away REAL DEFAULT 50,
      shots_home INTEGER DEFAULT 0,
      shots_away INTEGER DEFAULT 0,
      shots_on_target_home INTEGER DEFAULT 0,
      shots_on_target_away INTEGER DEFAULT 0,
      corners_home INTEGER DEFAULT 0,
      corners_away INTEGER DEFAULT 0,
      fouls_home INTEGER DEFAULT 0,
      fouls_away INTEGER DEFAULT 0,
      offsides_home INTEGER DEFAULT 0,
      offsides_away INTEGER DEFAULT 0,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS player_skills (
      player_id INTEGER PRIMARY KEY,
      pace INTEGER DEFAULT 60,
      shooting INTEGER DEFAULT 60,
      passing INTEGER DEFAULT 60,
      defending INTEGER DEFAULT 60,
      physical INTEGER DEFAULT 60,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_injuries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      injury_type TEXT NOT NULL DEFAULT 'muscle strain',
      matches_remaining INTEGER DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Premier League',
      season INTEGER NOT NULL DEFAULT 1,
      status TEXT DEFAULT 'setup',
      current_matchday INTEGER DEFAULT 0,
      total_matchdays INTEGER DEFAULT 0,
      start_date DATE,
      end_date DATE,
      transfer_window_end DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS league_standings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      played INTEGER DEFAULT 0,
      won INTEGER DEFAULT 0,
      drawn INTEGER DEFAULT 0,
      lost INTEGER DEFAULT 0,
      goals_for INTEGER DEFAULT 0,
      goals_against INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      UNIQUE(league_id, team_id),
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS league_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      matchday INTEGER NOT NULL,
      home_team_id INTEGER NOT NULL,
      away_team_id INTEGER NOT NULL,
      match_id INTEGER,
      scheduled_date DATE,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (home_team_id) REFERENCES teams(id),
      FOREIGN KEY (away_team_id) REFERENCES teams(id),
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS coaches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      team_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      age INTEGER,
      height INTEGER,
      playing_style TEXT DEFAULT '4-4-2',
      description TEXT,
      season_name_changes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS team_lineups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      position_override TEXT,
      UNIQUE(team_id, player_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS transfer_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_team_id INTEGER NOT NULL,
      to_team_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      offer_type TEXT DEFAULT 'buy',
      amount REAL DEFAULT 0,
      loan_months INTEGER DEFAULT 6,
      status TEXT DEFAULT 'pending',
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME,
      FOREIGN KEY (from_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (to_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS season_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL,
      total_budget REAL DEFAULT 0,
      spent REAL DEFAULT 0,
      income REAL DEFAULT 0,
      UNIQUE(team_id, league_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
    );
  `);

  // Idempotent column additions for existing databases
  const migrations = [
    `ALTER TABLE news ADD COLUMN player_id INTEGER`,
    `ALTER TABLE news ADD COLUMN team_id INTEGER`,
    `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin'`,
    `ALTER TABLE teams ADD COLUMN stadium_url TEXT`,
    `ALTER TABLE matches ADD COLUMN league_id INTEGER`,
    `ALTER TABLE matches ADD COLUMN matchday INTEGER DEFAULT 0`,
    `ALTER TABLE news ADD COLUMN author_name TEXT`,
    `ALTER TABLE team_lineups ADD COLUMN priority_sub INTEGER DEFAULT 0`,
    `ALTER TABLE teams ADD COLUMN about_text TEXT`,
    `ALTER TABLE teams ADD COLUMN team_photo_url TEXT`,
    `ALTER TABLE matches ADD COLUMN match_time TEXT DEFAULT '15:00'`,
    `ALTER TABLE competitions ADD COLUMN trophy_url TEXT`,
    `ALTER TABLE players ADD COLUMN contract_until DATE`,
    `ALTER TABLE players ADD COLUMN birthplace TEXT`,
    `ALTER TABLE players ADD COLUMN national_team TEXT`,
    `ALTER TABLE players ADD COLUMN national_caps INTEGER DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN national_goals INTEGER DEFAULT 0`,
    `ALTER TABLE teams ADD COLUMN transfer_budget REAL DEFAULT 10000000`,
    `ALTER TABLE teams ADD COLUMN transfer_budget_spent REAL DEFAULT 0`,
    `ALTER TABLE leagues ADD COLUMN trophy_url TEXT`,
    `ALTER TABLE leagues ADD COLUMN logo_url TEXT`,
    `ALTER TABLE tournaments ADD COLUMN bye_winners TEXT`,
    `ALTER TABLE transfer_offers ADD COLUMN swap_player_id INTEGER`,
    `ALTER TABLE tournaments ADD COLUMN trophy_url TEXT`,
    `ALTER TABLE titles ADD COLUMN tournament_id INTEGER`,
    `ALTER TABLE titles ADD COLUMN trophy_url TEXT`,
    `ALTER TABLE matches ADD COLUMN ot_type TEXT`,
    `ALTER TABLE matches ADD COLUMN ot_home INTEGER DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN ot_away INTEGER DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN pen_home INTEGER DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN pen_away INTEGER DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN is_friendly INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS match_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_team_id INTEGER NOT NULL,
      to_team_id   INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      match_id     INTEGER,
      message      TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (to_team_id)   REFERENCES teams(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE matches ADD COLUMN started_at TEXT`,
    `ALTER TABLE matches ADD COLUMN notified_preview INTEGER DEFAULT NULL`,
    `ALTER TABLE teams ADD COLUMN color_primary TEXT`,
    `ALTER TABLE teams ADD COLUMN color_secondary TEXT`,
    `ALTER TABLE teams ADD COLUMN color_pattern TEXT DEFAULT 'none'`,
    `ALTER TABLE teams ADD COLUMN goal_banner_url TEXT`,
    `ALTER TABLE teams ADD COLUMN kit_home_url TEXT`,
    `ALTER TABLE teams ADD COLUMN kit_away_url TEXT`,
    `ALTER TABLE teams ADD COLUMN kit_third_url TEXT`,
    `ALTER TABLE matches ADD COLUMN tg_kickoff_sent INTEGER DEFAULT 0`,
    `ALTER TABLE matches ADD COLUMN tg_result_sent INTEGER DEFAULT 0`,
    `ALTER TABLE leagues ADD COLUMN last_tg_standings_matchday INTEGER DEFAULT 0`,
    `ALTER TABLE match_events ADD COLUMN tg_notified INTEGER DEFAULT 0`,
    `ALTER TABLE leagues ADD COLUMN match_start_time TEXT DEFAULT '16:00'`,
    `ALTER TABLE leagues ADD COLUMN match_interval_minutes INTEGER DEFAULT 15`,
    `ALTER TABLE league_schedule ADD COLUMN scheduled_time TEXT`,
    `ALTER TABLE leagues ADD COLUMN match_interval_minutes INTEGER DEFAULT 15`,
    `ALTER TABLE players ADD COLUMN ovr_fixed INTEGER`,
    `CREATE TABLE IF NOT EXISTS player_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      opened_at DATETIME,
      FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS pack_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      ovr INTEGER NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      kept INTEGER DEFAULT 0,
      FOREIGN KEY (pack_id) REFERENCES player_packs(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS fa_auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      start_bid REAL NOT NULL,
      current_bid REAL,
      bidder_team_id INTEGER,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (bidder_team_id) REFERENCES teams(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS fa_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      bid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (auction_id) REFERENCES fa_auctions(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE players ADD COLUMN free_agent_since DATETIME`,
    `CREATE TABLE IF NOT EXISTS coach_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      type TEXT DEFAULT 'info',
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS loan_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_team_id INTEGER NOT NULL,
      to_team_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      offer_type TEXT NOT NULL DEFAULT 'loan_in',
      loan_fee REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (to_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE players ADD COLUMN acquired_season INTEGER DEFAULT 0`,
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('current_season', '1')`,
    `ALTER TABLE players ADD COLUMN stamina INTEGER DEFAULT 100`,
    `CREATE TABLE IF NOT EXISTS lineup_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS lineup_preset_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      position_override TEXT,
      priority_sub INTEGER DEFAULT 0,
      FOREIGN KEY (preset_id) REFERENCES lineup_presets(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS lineup_preset_infirmary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES lineup_presets(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS poker_player_locks (
      player_id INTEGER PRIMARY KEY,
      coach_id INTEGER NOT NULL,
      table_id TEXT NOT NULL,
      locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS poker_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      stake_type TEXT NOT NULL,
      chips_in REAL DEFAULT 0,
      chips_out REAL DEFAULT 0,
      delta REAL DEFAULT 0,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      coach_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      amount REAL NOT NULL,
      odds REAL NOT NULL,
      status TEXT DEFAULT 'open',
      payout REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      settled_at DATETIME,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
    // Tournament scheduling fields
    `ALTER TABLE tournaments ADD COLUMN round_match_time TEXT DEFAULT '18:00'`,
    `ALTER TABLE tournaments ADD COLUMN round_interval_days INTEGER DEFAULT 1`,
    // BYE teams stored per-round so they show in the bracket
    `CREATE TABLE IF NOT EXISTS tournament_byes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      round INTEGER NOT NULL,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
    // Manual infirmary (lazaret): players a coach has benched to rest/recover.
    // They are excluded from match squads (starters + subs) until recalled.
    `CREATE TABLE IF NOT EXISTS player_infirmary (
      player_id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
    // Seasonal tournament OVR boost (resets each season).
    `ALTER TABLE players ADD COLUMN tournament_ovr_boost INTEGER DEFAULT 0`,
    // Cosmetics shop: avatar accessories purchasable with team budget.
    `CREATE TABLE IF NOT EXISTS coach_cosmetics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      equipped INTEGER DEFAULT 0,
      bought_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(coach_id, item_key),
      FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE
    )`,
    // Cosmetic category: 'avatar' (hats) vs 'cardskin' (poker card themes).
    // Lets each category be equipped independently.
    `ALTER TABLE coach_cosmetics ADD COLUMN category TEXT DEFAULT 'avatar'`,
    // Triviador: trivia question bank
    `CREATE TABLE IF NOT EXISTS trivia_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL CHECK(correct_option IN ('a','b','c','d')),
      category TEXT DEFAULT 'football',
      difficulty INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `ALTER TABLE trivia_questions ADD COLUMN tiebreaker_question TEXT`,
    `ALTER TABLE trivia_questions ADD COLUMN tiebreaker_answer TEXT`,
    // Telegram bot: link a coach's account to their personal chat so they can
    // get notifications and place bets through the bot.
    `ALTER TABLE coaches ADD COLUMN telegram_chat_id TEXT`,
    `CREATE TABLE IF NOT EXISTS telegram_link_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      coach_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE
    )`,
  ];
  for (const m of migrations) {
    try { db.exec(m); } catch { /* column already exists */ }
  }
}

function seedTriviaQuestions(db) {
  let bank;
  try { bank = require('./triviaQuestions'); } catch { bank = []; }
  if (!Array.isArray(bank) || bank.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO trivia_questions
     (question,option_a,option_b,option_c,option_d,correct_option,category,difficulty,tiebreaker_question,tiebreaker_answer)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  // Additive seeding: only insert questions whose text isn't already present.
  const exists = db.prepare('SELECT 1 FROM trivia_questions WHERE question=?');
  const tx = db.transaction(() => {
    for (const q of bank) {
      if (!exists.get(q[0])) insert.run(q[0],q[1],q[2],q[3],q[4],q[5],q[6],q[7],q[8]||null,q[9]||null);
    }
  });
  tx();
}

function getCurrentSeason(db) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key='current_season'").get();
  return row ? parseInt(row.value) : 1;
}

function isTradeBanned(player, currentSeason) {
  return (player.acquired_season || 0) >= currentSeason;
}

module.exports = { getDb, getCurrentSeason, isTradeBanned, seedTriviaQuestions };
