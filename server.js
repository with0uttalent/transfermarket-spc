require('dotenv').config();
const express = require('express');
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
app.use('/api/lineups',         require('./routes/lineups'));
app.use('/api/admin',           require('./routes/admin'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
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
    const { initBot } = require('./services/telegramBot');
    initBot();
  } catch (e) {
    console.warn('TelegramBot failed to start:', e.message);
  }
});
