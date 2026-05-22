'use strict';

const { createCanvas, loadImage } = require('canvas');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fetch  = require('node-fetch');
const FormData = require('form-data');

const TOKEN           = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID         = process.env.TELEGRAM_CHAT_ID;
const LIVE_CHANNEL_ID = process.env.TELEGRAM_LIVE_CHANNEL_ID;
const PROXY           = 'socks5://l0x4hWRoT9:008xL8CEph@158.160.16.143:35665';

let agent = null;
let _enabled = true; // runtime toggle; persisted via app_settings in DB

function setEnabled(val) { _enabled = !!val; }
function isEnabled()     { return _enabled; }

let _updateOffset = 0;

function initBot() {
  if (!TOKEN || !CHAT_ID) {
    console.log('[TelegramBot] No TOKEN/CHAT_ID — disabled.');
    return;
  }
  agent = new SocksProxyAgent(PROXY);
  console.log('[TelegramBot] Ready.');
  startPolling();
}

async function tgGetUpdates() {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${_updateOffset}&timeout=5`,
      { agent }
    );
    const data = await res.json();
    if (!data.ok || !data.result.length) return;
    for (const upd of data.result) {
      _updateOffset = upd.update_id + 1;
      const text = (upd.message?.text || '').trim().toLowerCase();
      if (text === '/table' || text === 'table') {
        const replyTo = upd.message.chat.id;
        handleTableCommand(replyTo).catch(e => console.warn('[Bot] table cmd error:', e.message));
      }
    }
  } catch { /* network errors are fine */ }
}

function startPolling() {
  setInterval(tgGetUpdates, 3000);
}

async function handleTableCommand(chatId) {
  try {
    const { getDb } = require('../database/db');
    const db = getDb();

    const leagues = db.prepare(
      `SELECT id, name, current_matchday, total_matchdays FROM leagues WHERE status='active' ORDER BY id`
    ).all();

    if (!leagues.length) {
      await tgSendMessageTo(chatId, '⚽ Нет активных лиг.');
      return;
    }

    for (const league of leagues) {
      const rows = db.prepare(`
        SELECT ls.points, ls.played, ls.won, ls.drawn, ls.lost,
               ls.goals_for, ls.goals_against,
               ls.goals_for - ls.goals_against AS gd,
               t.name AS team_name
        FROM league_standings ls
        JOIN teams t ON ls.team_id = t.id
        WHERE ls.league_id = ?
        ORDER BY ls.points DESC, gd DESC, ls.goals_for DESC
      `).all(league.id);

      if (!rows.length) continue;

      const maxName = Math.min(16, Math.max(...rows.map(r => r.team_name.length)));
      const trunc = s => s.length > maxName ? s.slice(0, maxName - 1) + '…' : s.padEnd(maxName);
      const num = (n, w = 2) => String(n).padStart(w);

      const header = `# ${'Клуб'.padEnd(maxName)}  P  W  D  L  GF GA GD PTS`;
      const divider = '─'.repeat(header.length);
      const lines = rows.map((r, i) =>
        `${num(i+1)}. ${trunc(r.team_name)} ${num(r.played)} ${num(r.won)} ${num(r.drawn)} ${num(r.lost)} ${num(r.goals_for)} ${num(r.goals_against)} ${String(r.gd >= 0 ? '+'+r.gd : r.gd).padStart(3)} ${num(r.points, 3)}`
      );

      const md = `${league.name}\nТур ${league.current_matchday || 0}/${league.total_matchdays || '?'}\n\n<pre>${header}\n${divider}\n${lines.join('\n')}</pre>`;
      await tgSendMessageTo(chatId, md);
    }
  } catch(e) {
    console.warn('[Bot] handleTableCommand error:', e.message);
  }
}

async function tgSendMessageTo(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    agent,
  });
  return res.json();
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
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, stripH - 1, W, 1);

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 14px sans-serif';

    const leagueImg = await tryLoadImage(leagueLogoUrl);
    const logoSize = 22;
    const gap = 8;
    const textWidth = ctx.measureText(leagueName).width;

    if (leagueImg) {
      const totalWidth = logoSize + gap + textWidth;
      const startX = (W - totalWidth) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(startX + logoSize / 2, stripH / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(leagueImg, startX, (stripH - logoSize) / 2, logoSize, logoSize);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.fillText(leagueName, startX + logoSize + gap, stripH / 2 + 5);
      ctx.textAlign = 'center';
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(leagueName, W / 2, stripH / 2 + 5);
    }
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

// ── Live channel helpers ──────────────────────────────────────────────────────
async function tgSendMessageToLive(text) {
  if (!LIVE_CHANNEL_ID || !agent || !_enabled) return;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: LIVE_CHANNEL_ID, text, parse_mode: 'HTML' }),
    agent,
  });
  return res.json();
}

async function tgSendPhotoToLive(photoBuffer, caption) {
  if (!LIVE_CHANNEL_ID || !agent || !_enabled) return;
  const form = new FormData();
  form.append('chat_id', LIVE_CHANNEL_ID);
  form.append('photo', photoBuffer, { filename: 'match.png', contentType: 'image/png' });
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    method: 'POST', body: form, agent,
  });
  return res.json();
}

async function sendMatchKickoff({ homeTeam, awayTeam, leagueName, matchday }) {
  if (!LIVE_CHANNEL_ID || !agent || !_enabled) return;
  try {
    const leagueLine = leagueName ? `\n🏆 <i>${escTg(leagueName)}</i>${matchday ? ` · Тур ${matchday}` : ''}` : '';
    const text = `🟢 <b>МАТЧ НАЧАЛСЯ!</b>${leagueLine}\n\n⚽ <b>${escTg(homeTeam)}</b> vs <b>${escTg(awayTeam)}</b>`;
    await tgSendMessageToLive(text);
  } catch(err) {
    console.warn('[TelegramBot] sendMatchKickoff error:', err.message);
  }
}

const LIVE_EV_ICON = {
  goal: '⚽', own_goal: '🥅', yellow_card: '🟨', red_card: '🟥',
  penalty_miss: '❌', injury: '🚑', substitution: '🔄',
};

async function sendLiveEvent({ event, homeTeam, awayTeam, homeScore, awayScore, leagueName }) {
  if (!LIVE_CHANNEL_ID || !agent || !_enabled) return;
  if (!LIVE_EV_ICON[event.event_type]) return;
  try {
    const icon = LIVE_EV_ICON[event.event_type];
    const minuteStr = event.minute ? `${event.minute}'` : '';
    const desc = (event.description || '').replace(/[⚽🥅🟨🟥❌🚑🔄🧤🎯🔵🟡⏱]/gu, '').trim();
    const leaguePfx = leagueName ? `<i>${escTg(leagueName)}</i> · ` : '';
    const text = `${icon} ${minuteStr} ${leaguePfx}<b>${escTg(homeTeam)} ${homeScore}–${awayScore} ${escTg(awayTeam)}</b>\n${escTg(desc)}`;
    await tgSendMessageToLive(text);
  } catch(err) {
    console.warn('[TelegramBot] sendLiveEvent error:', err.message);
  }
}

async function sendMatchResultToLive({ matchId, homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, stadiumUrl, homeTeamId, awayTeamId, leagueName, leagueLogoUrl, goalEvents }) {
  if (!LIVE_CHANNEL_ID || !agent || !_enabled) return;
  try {
    const imgBuf = await generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, 'finished', stadiumUrl, leagueName, leagueLogoUrl);
    const homeGoals = (goalEvents || []).filter(e => e.team_id === homeTeamId);
    const awayGoals = (goalEvents || []).filter(e => e.team_id === awayTeamId);
    const homeStr = homeGoals.map(g => `${escTg(g.player_name || '?')} ${g.minute}'`).join(', ');
    const awayStr = awayGoals.map(g => `${g.minute}' ${escTg(g.player_name || '?')}`).join(', ');
    const goalsLine = (homeStr || awayStr) ? `\n${homeStr}  ⚽  ${awayStr}` : '';
    const leaguePrefix = leagueName ? `🏅 <i>${escTg(leagueName)}</i>\n` : '';
    const caption = `${leaguePrefix}<b>МАТЧ ЗАВЕРШЁН\n${escTg(homeTeam)} ${homeScore} – ${awayScore} ${escTg(awayTeam)}</b>${goalsLine}`.slice(0, 1024);
    await tgSendPhotoToLive(imgBuf, caption);
  } catch(err) {
    console.warn('[TelegramBot] sendMatchResultToLive error:', err.message);
  }
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

async function sendMatchPreview({ homeTeam, awayTeam, leagueName, matchDate, matchTime }) {
  if (!_enabled || !TOKEN || !CHAT_ID) return;
  try {
    const timeStr = matchTime ? matchTime.slice(0, 5) : '–';
    const text =
      `⚽ <b>Скоро матч!</b>\n\n` +
      `🏟 <b>${homeTeam}</b> vs <b>${awayTeam}</b>\n` +
      `🏆 ${leagueName}\n` +
      `🕐 Сегодня в ${timeStr}`;
    await tgSendMessage(text);
  } catch(err) {
    console.warn('[TelegramBot] sendMatchPreview error:', err.message);
  }
}

module.exports = { initBot, sendMatchResult, sendCoachNews, sendMatchPreview, sendMatchKickoff, sendLiveEvent, sendMatchResultToLive, setEnabled, isEnabled, generateMatchBanner };
