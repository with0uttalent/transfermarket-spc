'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { createCanvas, loadImage } = require('canvas');
const { SocksProxyAgent } = require('socks-proxy-agent');

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY   = 'socks5://l0x4hWRoT9:008xL8CEph@158.160.16.143:35665';

let bot = null;

function initBot() {
  if (!TOKEN || !CHAT_ID) {
    console.log('[TelegramBot] No TOKEN/CHAT_ID — disabled.');
    return;
  }
  bot = new TelegramBot(TOKEN, {
    request: { agent: new SocksProxyAgent(PROXY) },
  });
  console.log('[TelegramBot] Ready.');
}

// ── Image generation ──────────────────────────────────────────────────────────
const W = 800, H = 360;

async function tryLoadImage(url) {
  if (!url) return null;
  try { return await loadImage(url); } catch { return null; }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0,   '#0d1b2a');
  grad.addColorStop(0.5, '#1a3350');
  grad.addColorStop(1,   '#0d1b2a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle pitch lines overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Center glow
  const glow = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, 260);
  glow.addColorStop(0, 'rgba(22,163,74,0.18)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Team logo circles
  const drawLogoCircle = async (img, cx, cy, r) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (img) {
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
  };

  const homeImg = await tryLoadImage(homeLogo);
  const awayImg = await tryLoadImage(awayLogo);
  await drawLogoCircle(homeImg, 160, H / 2 - 20, 80);
  await drawLogoCircle(awayImg, W - 160, H / 2 - 20, 80);

  // Team names
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(homeTeam, 160, H - 48);
  ctx.fillText(awayTeam, W - 160, H - 48);

  // Score
  ctx.font = 'bold 88px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(22,163,74,0.6)';
  ctx.shadowBlur = 24;
  ctx.fillText(`${homeScore}  –  ${awayScore}`, W / 2, H / 2 + 20);
  ctx.shadowBlur = 0;

  // Status badge
  const badgeLabel = ({ finished: 'ЗАВЕРШЁН', overtime: 'ОВЕРТАЙМ', penalties: 'ПЕНАЛЬТИ' }[status] || status || 'ФИНАЛ').toUpperCase();
  const badgeW = 120, badgeH = 28;
  const bx = W / 2 - badgeW / 2, by = H / 2 + 38;
  roundRect(ctx, bx, by, badgeW, badgeH, 14);
  ctx.fillStyle = '#16a34a';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(badgeLabel, W / 2, by + 19);

  // Divider lines from logos to center
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(260, H/2 - 20); ctx.lineTo(W/2 - 80, H/2 - 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 260, H/2 - 20); ctx.lineTo(W/2 + 80, H/2 - 20); ctx.stroke();

  return canvas.toBuffer('image/png');
}

// ── Event formatting ──────────────────────────────────────────────────────────
const EV_ICON = {
  goal:         '⚽',
  own_goal:     '🥅',
  yellow_card:  '🟨',
  red_card:     '🟥',
  penalty_miss: '❌',
  injury:       '🚑',
  substitution: '🔄',
  save:         '🧤',
  near_miss:    '🎯',
  buildup:      null, // skip
};

function formatEvents(events) {
  const lines = [];
  for (const e of events) {
    const icon = EV_ICON[e.event_type];
    if (icon === null) continue; // skip buildup
    if (!icon) continue;
    const min = e.minute ? `${e.minute}'` : '';
    // Extract short description
    const desc = e.description
      ? e.description.replace(/[⚽🥅🟨🟥❌🚑🔄🧤🎯🔵🟡]/gu, '').trim()
      : '';
    lines.push(`${icon} ${min} ${desc}`.trim());
  }
  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

async function sendMatchResult({ matchId, homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status, events }) {
  if (!bot) return;
  try {
    const imgBuf  = await generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status);
    const evText  = formatEvents(events || []);
    const caption = `🏟 <b>${escTg(homeTeam)} ${homeScore} – ${awayScore} ${escTg(awayTeam)}</b>\n\n${evText}`.slice(0, 1024);
    await bot.sendPhoto(CHAT_ID, imgBuf, { caption, parse_mode: 'HTML' });
  } catch (err) {
    console.warn('[TelegramBot] sendMatchResult error:', err.message);
  }
}

async function sendCoachNews({ coachName, teamName, title, body }) {
  if (!bot) return;
  try {
    const text = `📢 <b>Тренер ${escTg(teamName)}</b> — <i>${escTg(coachName)}</i> — заявил:\n\n<b>${escTg(title)}</b>\n\n${escTg(body)}`;
    await bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.warn('[TelegramBot] sendCoachNews error:', err.message);
  }
}

function escTg(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { initBot, sendMatchResult, sendCoachNews };
