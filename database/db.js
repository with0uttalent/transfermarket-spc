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
  ];
  for (const m of migrations) {
    try { db.exec(m); } catch { /* column already exists */ }
  }
}

function seedTriviaQuestions(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM trivia_questions').get().c;
  if (count > 0) return;
  const insert = db.prepare(`INSERT INTO trivia_questions (question,option_a,option_b,option_c,option_d,correct_option,category,difficulty) VALUES (?,?,?,?,?,?,?,?)`);
  const qs = [
    ['Сколько раз Реал Мадрид выигрывал Лигу Чемпионов?','12','14','15','16','b','football',2],
    ['Кто является рекордсменом по голам в истории Лиги Чемпионов?','Месси','Рауль','Роналду','Мюллер','c','football',1],
    ['В каком году сборная Бразилии выиграла первый Чемпионат мира?','1950','1958','1962','1970','b','football',2],
    ['Сколько раз Лионель Месси выигрывал «Золотой мяч»?','6','7','8','9','c','football',1],
    ['Какой клуб носит прозвище «Красные Дьяволы»?','Ливерпуль','Манчестер Юнайтед','Байер Леверкузен','Атлетик Бильбао','b','football',1],
    ['Какой стране принадлежит клуб «Аякс»?','Бельгии','Дании','Нидерландам','Германии','c','football',1],
    ['Кто забил «Гол века» на ЧМ-1986?','Пеле','Роналдо','Марадона','Зидан','c','football',1],
    ['В каком городе находится стадион «Камп Ноу»?','Мадрид','Барселона','Валенсия','Севилья','b','football',1],
    ['Сколько игроков в футбольной команде на поле?','9','10','11','12','c','football',1],
    ['Какой клуб выиграл первый розыгрыш Кубка Европейских Чемпионов (1955/56)?','Барселона','Реал Мадрид','Милан','Бенфика','b','football',3],
    ['Как называется правило, запрещающее игрокам находиться ближе к воротам соперника, чем мяч и предпоследний защитник?','Фол','Пенальти','Офсайд','Угловой','c','football',1],
    ['В каком году прошёл первый Чемпионат мира по футболу?','1926','1928','1930','1934','c','football',2],
    ['Кто стал лучшим бомбардиром ЧМ-2022 в Катаре?','Мбаппе','Месси','Экамби','Олмо','a','football',2],
    ['Какой клуб называют «Ювентус»?','Старая Дама','Красная Фурия','Золотое Поколение','Скуадра Адзурра','a','football',1],
    ['Какой вратарь сыграл больше всего матчей в Лиге Чемпионов?','Буффон','Де Хеа','Касильяс','Нойер','c','football',2],
    ['Сколько жёлтых карточек нужно получить для автоматической дисквалификации на большинстве турниров?','1','2','3','4','b','football',1],
    ['Как называется удар мяча от земли по воздуху без отскока?','Чип','Волей','Финт','Шип','b','football',1],
    ['Какая страна проводила ЧМ-2018?','Китай','США','Германия','Россия','d','football',1],
    ['Кто первым забил 5 голов в одном матче Лиги Чемпионов?','Луис Гарсия','Ван Нистелрой','Марко ван Бастен','Джереми','c','football',3],
    ['Какая сборная носит прозвище «Скуадра Адзурра»?','Испания','Португалия','Италия','Аргентина','c','football',1],
    ['Сколько длится дополнительное время в футболе (стандарт)?','20 минут','30 минут','25 минут','15 минут','b','football',1],
    ['Какой клуб имеет самую большую коллекцию трофеев Ла Лиги?','Барселона','Атлетико','Реал Мадрид','Валенсия','c','football',1],
    ['Кто тренировал сборную Германии при победе на ЧМ-2014?','Клинсманн','Лёв','Флик','Хитцфельд','b','football',2],
    ['Как называется тактическое построение 4-4-2?','Ромб','Флет','Пирамида','Линия','b','football',2],
    ['В каком году основан ФК «Ливерпуль»?','1878','1892','1900','1905','b','football',3],
    ['Как называется чемпионат Германии по футболу?','Примера','Серия А','Бундеслига','Премьер-лига','c','football',1],
    ['Какой мяч используется в футзале?','Лёгкий','Тяжёлый','С пониженным отскоком','Надувной','c','football',2],
    ['Какой игрок первым перешёл за 100 миллионов евро?','Зидан','Роналду (Р7)','Фигу','Гарет Бейл','c','football',3],
    ['Что означает VAR в футболе?','Video Assistant Referee','Visual Arena Review','Virtual Action Replay','Video Area Rule','a','football',1],
    ['Сколько команд участвует в финальном турнире Евро-2024?','16','20','24','32','c','football',2],
    ['Кто забил «Золотой гол» в финале Евро-2000?','Трезеге','Анри','Виейра','Зидан','a','football',2],
    ['В каком городе расположен стадион «Сантьяго Бернабеу»?','Барселона','Мадрид','Лиссабон','Лондон','b','football',1],
    ['Как зовут вратаря, остановившего пять пенальти на одном ЧМ?','Гордон Бэнкс','Ладислав Мазурки','Ран Шехман','Ожен Стиелике','a','football',3],
    ['Что такое «хет-трик»?','2 гола в матче','3 гола в матче','4 гола в матче','Пенальти','b','football',1],
    ['Какой клуб выиграл Лигу Чемпионов в сезоне 2021/22?','Манчестер Сити','ПСЖ','Ливерпуль','Реал Мадрид','d','football',2],
    ['Кто является рекордсменом по голам в истории сборной Португалии?','Луиш Фигу','Руй Коста','Криштиану Роналду','Эйсебиу','c','football',1],
    ['Какой трофей вручают лучшему молодому игроку ЧМ?','Серебряная бутса','Золотой мяч','Приз Лучшего молодого игрока','Кубок Стэнли','c','football',1],
    ['В каком году Россия последний раз квалифицировалась на ЧМ?','2014','2018','2010','2006','b','football',2],
    ['Как называется стадион ФК «Манчестер Юнайтед»?','Стэмфорд Бридж','Энфилд','Олд Траффорд','Этихад','c','football',1],
    ['Сколько ударов в серии пенальти дается каждой команде изначально?','3','4','5','6','c','football',1],
  ];
  const ins = db.transaction(() => { for (const q of qs) insert.run(...q); });
  ins();
}

function getCurrentSeason(db) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key='current_season'").get();
  return row ? parseInt(row.value) : 1;
}

function isTradeBanned(player, currentSeason) {
  return (player.acquired_season || 0) >= currentSeason;
}

module.exports = { getDb, getCurrentSeason, isTradeBanned, seedTriviaQuestions };
