require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

async function setup() {
  const db = getDb();

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.log(`Admin user "${username}" already exists.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
  console.log(`Admin user "${username}" created successfully.`);

  // Seed some countries
  const countries = [
    // Western Europe / World
    { name: 'England',      code: 'ENG', flag_emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { name: 'Spain',        code: 'ESP', flag_emoji: '🇪🇸' },
    { name: 'Germany',      code: 'GER', flag_emoji: '🇩🇪' },
    { name: 'France',       code: 'FRA', flag_emoji: '🇫🇷' },
    { name: 'Italy',        code: 'ITA', flag_emoji: '🇮🇹' },
    { name: 'Portugal',     code: 'POR', flag_emoji: '🇵🇹' },
    { name: 'Brazil',       code: 'BRA', flag_emoji: '🇧🇷' },
    { name: 'Argentina',    code: 'ARG', flag_emoji: '🇦🇷' },
    { name: 'Netherlands',  code: 'NED', flag_emoji: '🇳🇱' },
    { name: 'Belgium',      code: 'BEL', flag_emoji: '🇧🇪' },
    { name: 'Croatia',      code: 'CRO', flag_emoji: '🇭🇷' },
    { name: 'Uruguay',      code: 'URU', flag_emoji: '🇺🇾' },
    { name: 'Poland',       code: 'POL', flag_emoji: '🇵🇱' },
    { name: 'Senegal',      code: 'SEN', flag_emoji: '🇸🇳' },
    { name: 'Morocco',      code: 'MAR', flag_emoji: '🇲🇦' },
    { name: 'Serbia',       code: 'SRB', flag_emoji: '🇷🇸' },
    { name: 'Switzerland',  code: 'SUI', flag_emoji: '🇨🇭' },
    { name: 'Denmark',      code: 'DEN', flag_emoji: '🇩🇰' },
    { name: 'Sweden',       code: 'SWE', flag_emoji: '🇸🇪' },
    // CIS — Commonwealth of Independent States
    { name: 'Россия',       code: 'RUS', flag_emoji: '🇷🇺' },
    { name: 'Украина',      code: 'UKR', flag_emoji: '🇺🇦' },
    { name: 'Беларусь',     code: 'BLR', flag_emoji: '🇧🇾' },
    { name: 'Казахстан',    code: 'KAZ', flag_emoji: '🇰🇿' },
    { name: 'Азербайджан',  code: 'AZE', flag_emoji: '🇦🇿' },
    { name: 'Армения',      code: 'ARM', flag_emoji: '🇦🇲' },
    { name: 'Грузия',       code: 'GEO', flag_emoji: '🇬🇪' },
    { name: 'Молдова',      code: 'MDA', flag_emoji: '🇲🇩' },
    { name: 'Кыргызстан',   code: 'KGZ', flag_emoji: '🇰🇬' },
    { name: 'Таджикистан',  code: 'TJK', flag_emoji: '🇹🇯' },
    { name: 'Туркменистан', code: 'TKM', flag_emoji: '🇹🇲' },
    { name: 'Узбекистан',   code: 'UZB', flag_emoji: '🇺🇿' },
    // Балтийские страны (ex-СССР)
    { name: 'Латвия',       code: 'LAT', flag_emoji: '🇱🇻' },
    { name: 'Эстония',      code: 'EST', flag_emoji: '🇪🇪' },
    { name: 'Литва',        code: 'LIT', flag_emoji: '🇱🇹' },
    // Другие постсоветские / русскоязычные регионы
    { name: 'Израиль',      code: 'ISR', flag_emoji: '🇮🇱' },
    { name: 'Финляндия',    code: 'FIN', flag_emoji: '🇫🇮' },
    { name: 'Монголия',     code: 'MNG', flag_emoji: '🇲🇳' },
  ];

  const insertCountry = db.prepare(
    'INSERT OR IGNORE INTO countries (name, code, flag_emoji) VALUES (?, ?, ?)'
  );
  for (const c of countries) {
    insertCountry.run(c.name, c.code, c.flag_emoji);
  }
  console.log('Countries seeded.');
  process.exit(0);
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
