require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Upload directory
const uploadsDir = path.join(__dirname, 'public/images/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Image upload
const multer = require('multer');
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg','.jpeg','.png','.gif','.webp','.svg'].includes(ext))
      return cb(new Error('Invalid file type'));
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
const { requireAuth } = require('./middleware/auth');
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/images/uploads/' + req.file.filename });
});

// API routes
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
    const { initBot, setEnabled, setNotifSettings } = require('./services/telegramBot');
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
