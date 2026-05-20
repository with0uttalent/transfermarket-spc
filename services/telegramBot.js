'use strict';

const { createCanvas, loadImage } = require('canvas');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fetch  = require('node-fetch');
const FormData = require('form-data');

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY   = 'socks5://l0x4hWRoT9:008xL8CEph@158.160.16.143:35665';

let agent = null;
let _enabled = true; // runtime toggle; persisted via app_settings in DB

function setEnabled(val) { _enabled = !!val; }
function isEnabled()     { return _enabled; }

function initBot() {
  if (!TOKEN || !CHAT_ID) {
    console.log('[TelegramBot] No TOKEN/CHAT_ID — disabled.');
    return;
  }
  agent = new SocksProxyAgent(PROXY);
  console.log('[TelegramBot] Ready.');
}

// ── Raw Telegram API calls ────────────────────────────────────────────────────
async function tgSendPhoto(photoBuffer, caption) {
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('photo', photoBuffer, { filename: 'match.png', contentType: 'image/png' });
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    method: 'POST', body: form, agent,
  });
  return res.json();
}

async function tgSendMessage(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    agent,
  });
  return res.json();
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

async function generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status, stadiumUrl, leagueName, leagueLogoUrl) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background: stadium photo or gradient fallback
  const stadiumImg = await tryLoadImage(stadiumUrl);
  if (stadiumImg) {
    // Draw stadium covering full canvas
    const sx = stadiumImg.width, sy = stadiumImg.height;
    const scale = Math.max(W / sx, H / sy);
    const dw = sx * scale, dh = sy * scale;
    ctx.drawImage(stadiumImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    // Dark overlay so text is readable
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0,   '#0d1b2a');
    grad.addColorStop(0.5, '#1a3350');
    grad.addColorStop(1,   '#0d1b2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Subtle vignette
  const vig = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.9);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Logo circles
  const drawLogoCircle = async (img, cx, cy, r) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (img) { ctx.clip(); ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2); }
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
  ctx.shadowColor = 'rgba(22,163,74,0.6)';
  ctx.shadowBlur = 24;
  ctx.fillText(`${homeScore}  –  ${awayScore}`, W / 2, H / 2 + 20);
  ctx.shadowBlur = 0;

  // Status badge
  const badgeLabel = ({ finished: 'ЗАВЕРШЁН', overtime: 'ОВЕРТАЙМ', penalties: 'ПЕНАЛЬТИ' }[status] || 'ФИНАЛ').toUpperCase();
  const badgeW = 130, badgeH = 28;
  const bx = W / 2 - badgeW / 2, by = H / 2 + 38;
  roundRect(ctx, bx, by, badgeW, badgeH, 14);
  ctx.fillStyle = '#16a34a';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(badgeLabel, W / 2, by + 19);

  // League strip at top (if league info provided)
  if (leagueName) {
    const stripH = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, stripH);
    // Thin accent line
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, stripH - 1, W, 1);

    const leagueImg = await tryLoadImage(leagueLogoUrl);
    let textX = W / 2;
    if (leagueImg) {
      const logoSize = 22;
      const logoX = W / 2 - 80;
      ctx.save();
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, stripH / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(leagueImg, logoX, (stripH - logoSize) / 2, logoSize, logoSize);
      ctx.restore();
      textX = logoX + logoSize + 8;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = leagueImg ? 'left' : 'center';
    ctx.fillText(leagueName, textX, stripH / 2 + 5);
    ctx.textAlign = 'center';
  }

  return canvas.toBuffer('image/png');
}

// ── Event formatting ──────────────────────────────────────────────────────────
const EV_ICON = {
  goal: '⚽', own_goal: '🥅', yellow_card: '🟨', red_card: '🟥',
  penalty_miss: '❌', injury: '🚑', substitution: '🔄', save: '🧤', near_miss: '🎯',
};

function formatEvents(events) {
  return events
    .filter(e => EV_ICON[e.event_type])
    .map(e => {
      const icon = EV_ICON[e.event_type];
      const min  = e.minute ? `${e.minute}'` : '';
      const desc = (e.description || '').replace(/[⚽🥅🟨🟥❌🚑🔄🧤🎯🔵🟡⏱]/gu, '').trim();
      return `${icon} ${min} ${desc}`.trim();
    })
    .join('\n');
}

function escTg(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Public API ────────────────────────────────────────────────────────────────
async function sendMatchResult({ matchId, homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, stadiumUrl, homeTeamId, awayTeamId, status, goalEvents, leagueName, leagueLogoUrl }) {
  if (!agent || !_enabled) return;
  try {
    const imgBuf = await generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status, stadiumUrl, leagueName, leagueLogoUrl);

    const homeGoals = (goalEvents || []).filter(e => e.team_id === homeTeamId);
    const awayGoals = (goalEvents || []).filter(e => e.team_id === awayTeamId);
    const homeStr = homeGoals.map(g => `${escTg(g.player_name || '?')} ${g.minute}'`).join(', ');
    const awayStr = awayGoals.map(g => `${g.minute}' ${escTg(g.player_name || '?')}`).join(', ');
    const goalsLine = (homeStr || awayStr) ? `\n${homeStr}  ⚽  ${awayStr}` : '';

    const leaguePrefix = leagueName ? `🏅 <i>${escTg(leagueName)}</i>\n` : '';
    const caption = `${leaguePrefix}🏟 <b>${escTg(homeTeam)} ${homeScore} – ${awayScore} ${escTg(awayTeam)}</b>${goalsLine}`.slice(0, 1024);
    const photoResult = await tgSendPhoto(imgBuf, caption);
    if (!photoResult.ok) console.warn('[TelegramBot] sendPhoto failed:', photoResult.description);
  } catch (err) {
    console.warn('[TelegramBot] sendMatchResult error:', err.message);
  }
}

async function sendCoachNews({ coachName, teamName, title, body }) {
  if (!agent || !_enabled) return;
  try {
    const text = `📢 <b>Тренер ${escTg(teamName)}</b> — <i>${escTg(coachName)}</i> — заявил:\n\n<b>${escTg(title)}</b>\n\n${escTg(body)}`;
    const result = await tgSendMessage(text);
    if (!result.ok) console.warn('[TelegramBot] sendMessage failed:', result.description);
  } catch (err) {
    console.warn('[TelegramBot] sendCoachNews error:', err.message);
  }
}

module.exports = { initBot, sendMatchResult, sendCoachNews, setEnabled, isEnabled, generateMatchBanner };
