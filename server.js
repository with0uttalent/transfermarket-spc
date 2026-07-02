require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET env var is not set. Refusing to start.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet({
  contentSecurityPolicy: false, // manage CSP via nginx in production
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
});

// Upload directory. Overridable so containerised deployments can keep user
// uploads on a mounted volume (e.g. UPLOADS_DIR=/data/uploads); the explicit
// static mount keeps '/images/uploads/…' URLs working when the directory
// lives outside public/.
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public/images/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/images/uploads', express.static(uploadsDir));

// Image upload
const multer = require('multer');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('Invalid file type'));
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Invalid MIME type'));
    cb(null, true);
  },
});
const { requireAuth } = require('./middleware/auth');
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/images/uploads/' + req.file.filename });
});

// Liveness probe for Docker/monitoring
app.get('/api/health', (req, res) => res.json({ ok: true }));

// API routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/change-password', loginLimiter);
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/countries',    require('./routes/countries'));
app.use('/api/competitions', require('./routes/competitions'));
app.use('/api/teams',        require('./routes/teams'));
app.use('/api/players',      require('./routes/players'));
app.use('/api/transfers',    require('./routes/transfers'));
app.use('/api/titles',       require('./routes/titles'));
app.use('/api/stats',        require('./routes/stats'));
app.use('/api/banners',      require('./routes/banners'));
app.use('/api/matches',      require('./routes/matches'));
app.use('/api/tournaments',  require('./routes/tournaments'));
app.use('/api/news',         require('./routes/news'));
app.use('/api/loans',        require('./routes/loans'));
app.use('/api/leagues',         require('./routes/leagues'));
app.use('/api/coaches',         require('./routes/coaches'));
app.use('/api/transfer-offers', require('./routes/transfer-offers'));
app.use('/api/lineups',           require('./routes/lineups'));
app.use('/api/match-challenges',  require('./routes/match-challenges'));
app.use('/api/admin',             require('./routes/admin'));
app.use('/api/packs',            require('./routes/packs'));
app.use('/api/free-agents',      require('./routes/free-agents'));
app.use('/api/auctions',         require('./routes/auctions'));
app.use('/api/notifications',    require('./routes/notifications'));
app.use('/api/bets',             require('./routes/bets'));
app.use('/api/poker',            require('./routes/poker'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Wrap express in an HTTP server so socket.io can share the port.
const server = http.createServer(app);

// Real-time poker (WebSocket)
try {
  const { initPokerSocket } = require('./services/poker/pokerSocket');
  initPokerSocket(server);
  console.log('Poker WebSocket initialized');
} catch (e) {
  console.warn('Poker socket failed to start:', e.message);
}

// Triviador (WebSocket)
try {
  const { initTriviaSocket } = require('./services/trivia/triviaSocket');
  initTriviaSocket(server);
  console.log('Triviador WebSocket initialized');
} catch (e) {
  console.warn('Triviador socket failed to start:', e.message);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TransferMarket running on http://localhost:${PORT}`);
  // Start daily scheduler
  try {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  } catch (e) {
    console.warn('Scheduler failed to start:', e.message);
  }
  // Start Telegram bot
  try {
    const { initBot, setEnabled, setNotifSettings, setProxy } = require('./services/telegramBot');
    initBot();
    // Restore saved settings (seed defaults for any missing keys)
    const { getDb } = require('./database/db');
    const db = getDb();
    const NOTIF_DEFAULTS = [
      ['tg_channel_events', '1'], ['tg_channel_results', '1'], ['tg_channel_standings', '1'],
      ['tg_group_results', '1'],  ['tg_group_coach_news', '1'], ['tg_channel_coach_news', '0'],
      ['tg_channel_player_news', '1'],
    ];
    const seed = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?,?)');
    for (const [k, v] of NOTIF_DEFAULTS) seed.run(k, v);
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (map.telegram_enabled !== undefined) setEnabled(map.telegram_enabled === '1');
    if (map.tg_proxy_enabled !== undefined || map.tg_proxy_url !== undefined)
      setProxy(map.tg_proxy_enabled === '1', map.tg_proxy_url || '');
    setNotifSettings({
      channel_events:    map.tg_channel_events      !== '0',
      channel_results:   map.tg_channel_results     !== '0',
      channel_standings: map.tg_channel_standings   !== '0',
      group_results:     map.tg_group_results       !== '0',
      group_coach_news:  map.tg_group_coach_news    !== '0',
      channel_coach_news:  map.tg_channel_coach_news  === '1',
      channel_player_news: map.tg_channel_player_news === '1',
    });
  } catch (e) {
    console.warn('TelegramBot failed to start:', e.message);
  }
});
