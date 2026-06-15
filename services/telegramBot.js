'use strict';

const { createCanvas, loadImage } = require('canvas');
const fetch  = require('node-fetch');
const FormData = require('form-data');

const TOKEN           = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID         = process.env.TELEGRAM_CHAT_ID;
const LIVE_CHANNEL_ID = process.env.TELEGRAM_LIVE_CHANNEL_ID;

let _enabled = true; // master switch
let _proxyEnabled = false;
let _proxyUrl = process.env.TELEGRAM_PROXY || '';
let _agent = null;

function _rebuildAgent() {
  _agent = null;
  if (!_proxyEnabled || !_proxyUrl) return;
  try {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    _agent = new SocksProxyAgent(_proxyUrl);
  } catch (e) {
    console.warn('[TelegramBot] Failed to create proxy agent:', e.message);
  }
}

function setProxy(enabled, url) {
  _proxyEnabled = !!enabled;
  if (url !== undefined) _proxyUrl = url || '';
  _rebuildAgent();
  console.log(`[TelegramBot] Proxy ${_proxyEnabled ? 'enabled: ' + _proxyUrl : 'disabled'}`);
}

function getProxySettings() {
  return { proxy_enabled: _proxyEnabled, proxy_url: _proxyUrl };
}

function _fetchOpts(extra) {
  return _agent ? { agent: _agent, ...extra } : { ...extra };
}

// Per-type notification flags
const _notif = {
  channel_events:    true,  // live events (goals, cards…) → channel
  channel_results:   true,  // match result banner → channel
  channel_standings: true,  // standings table after matchday → channel
  group_results:     true,  // match result banner → group
  group_coach_news:  true,  // coach statements → group
  channel_coach_news: false, // coach statements → channel (off by default)
  channel_player_news: false, // transfer rumors / player news → channel (off by default)
};

function setEnabled(val)          { _enabled = !!val; }
function isEnabled()              { return _enabled; }
function setNotifSettings(s)      { Object.assign(_notif, s); }
function getNotifSettings()       { return { ..._notif }; }

let _updateOffset = 0;

function initBot() {
  if (!TOKEN || !CHAT_ID) {
    console.log('[TelegramBot] No TOKEN/CHAT_ID — disabled.');
    return;
  }
  console.log('[TelegramBot] Ready.');
  startPolling();
}

async function tgGetUpdates() {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${_updateOffset}&timeout=5`,
      _fetchOpts({})
    );
    const data = await res.json();
    if (!data.ok || !data.result.length) return;
    for (const upd of data.result) {
      _updateOffset = upd.update_id + 1;
      const text = (upd.message?.text || '').trim().toLowerCase();
      const replyTo = upd.message.chat.id;
      if (text === '/table' || text === 'table') {
        handleTableCommand(replyTo).catch(e => console.warn('[Bot] table cmd error:', e.message));
      } else if (text === '/schedule' || text === 'schedule') {
        handleScheduleCommand(replyTo).catch(e => console.warn('[Bot] schedule cmd error:', e.message));
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

async function handleScheduleCommand(chatId) {
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
      // Show next 3 unplayed matchdays
      const upcomingMatchdays = db.prepare(`
        SELECT DISTINCT ls.matchday
        FROM league_schedule ls
        WHERE ls.league_id = ? AND ls.match_id IS NULL
        ORDER BY ls.matchday ASC
        LIMIT 3
      `).all(league.id).map(r => r.matchday);

      if (!upcomingMatchdays.length) {
        await tgSendMessageTo(chatId, `<b>${escTg(league.name)}</b>\nВсе туры сыграны ✅`);
        continue;
      }

      let msg = `📅 <b>${escTg(league.name)}</b> · Расписание\n`;
      for (const md of upcomingMatchdays) {
        const slots = db.prepare(`
          SELECT ls.matchday, ls.scheduled_date, ls.scheduled_time,
                 ht.name AS home_name, at.name AS away_name
          FROM league_schedule ls
          JOIN teams ht ON ls.home_team_id = ht.id
          JOIN teams at ON ls.away_team_id = at.id
          WHERE ls.league_id = ? AND ls.matchday = ?
          ORDER BY ls.id ASC
        `).all(league.id, md);

        if (!slots.length) continue;
        const date = slots[0].scheduled_date || '–';
        msg += `\n<b>Тур ${md}</b> · ${date}\n`;
        for (const s of slots) {
          const time = s.scheduled_time || '–';
          msg += `  ${time} МСК  ${escTg(s.home_name)} — ${escTg(s.away_name)}\n`;
        }
      }
      await tgSendMessageTo(chatId, msg.trim());
    }
  } catch(e) {
    console.warn('[Bot] handleScheduleCommand error:', e.message);
  }
}

async function tgSendMessageTo(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ..._fetchOpts({}),
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
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
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, _fetchOpts({ method: 'POST', body: form }));
  return res.json();
}

async function tgSendMessage(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ..._fetchOpts({}),
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
  return res.json();
}

// ── Image generation ──────────────────────────────────────────────────────────
const W = 1280, H = 640;

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

// homeGoals / awayGoals: array of { player_name, minute }
async function generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status, stadiumUrl, leagueName, leagueLogoUrl, homeGoals = [], awayGoals = []) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── 1. Background: stadium photo ──────────────────────────────────────────
  const stadiumImg = await tryLoadImage(stadiumUrl);
  if (stadiumImg) {
    const sx = stadiumImg.width, sy = stadiumImg.height;
    const scale = Math.max(W / sx, H / sy);
    const dw = sx * scale, dh = sy * scale;
    // Anchor to bottom so the pitch/grass is visible
    ctx.drawImage(stadiumImg, (W - dw) / 2, H - dh, dw, dh);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a0f1a');
    grad.addColorStop(1, '#1a2840');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Gradient overlay: very dark at top, lightens toward pitch, dark again at bottom
  const overGrad = ctx.createLinearGradient(0, 0, 0, H);
  overGrad.addColorStop(0,    'rgba(0,0,0,0.82)');
  overGrad.addColorStop(0.38, 'rgba(0,0,0,0.45)');
  overGrad.addColorStop(0.72, 'rgba(0,0,0,0.30)');
  overGrad.addColorStop(1,    'rgba(0,0,0,0.70)');
  ctx.fillStyle = overGrad;
  ctx.fillRect(0, 0, W, H);

  // ── 2. League badge at top-centre ─────────────────────────────────────────
  if (leagueName) {
    const pillH = 46, pillR = 23;
    const leagueImg = await tryLoadImage(leagueLogoUrl);
    const logoSz = 28, gap = 10;
    ctx.font = 'bold 17px sans-serif';
    const textW = ctx.measureText(leagueName.toUpperCase()).width;
    const totalInner = leagueImg ? logoSz + gap + textW : textW;
    const pillW = totalInner + 56;
    const px = (W - pillW) / 2, py = 28;

    // Pill background
    roundRect(ctx, px, py, pillW, pillH, pillR);
    ctx.fillStyle = 'rgba(8,10,20,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const contentX = px + (pillW - totalInner) / 2;
    const midY = py + pillH / 2;

    if (leagueImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(contentX + logoSz / 2, midY, logoSz / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(leagueImg, contentX, midY - logoSz / 2, logoSz, logoSz);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'left';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText(leagueName.toUpperCase(), contentX + logoSz + gap, midY + 6);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'center';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText(leagueName.toUpperCase(), W / 2, midY + 6);
    }
  }

  // ── 3. Main dark card ─────────────────────────────────────────────────────
  // Card geometry
  const GOALS_ROWS = Math.max(homeGoals.length, awayGoals.length, 1);
  const GOALS_ROW_H = 28;
  const SCORE_H = 200;
  const BOTTOM_H = 34 + GOALS_ROWS * GOALS_ROW_H + 20; // padding + rows + padding
  const CARD_H = SCORE_H + BOTTOM_H;
  const CARD_W = W - 140;
  const CARD_X = 70;
  const CARD_Y = (H - CARD_H) / 2 + 10;
  const CARD_R = 24;

  // Outer card (dark)
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R);
  ctx.fillStyle = 'rgba(8,10,20,0.88)';
  ctx.fill();

  // Divider: lighter tinted section for goal scorers, clipped to card corners
  const divY = CARD_Y + SCORE_H;
  ctx.save();
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, CARD_R);
  ctx.clip();
  ctx.fillStyle = 'rgba(240,244,248,0.10)';
  ctx.fillRect(CARD_X, divY, CARD_W, BOTTOM_H);
  ctx.restore();

  // ── 4. Team logos (white rounded squares) ─────────────────────────────────
  const homeImg = await tryLoadImage(homeLogo);
  const awayImg = await tryLoadImage(awayLogo);
  const LOGO_BOX = 120, LOGO_R = 18;
  const logoY = CARD_Y + (SCORE_H - LOGO_BOX) / 2 - 10;
  const homeLX = CARD_X + 54, awayLX = CARD_X + CARD_W - 54 - LOGO_BOX;

  const drawLogoBox = (img, bx, by) => {
    ctx.save();
    roundRect(ctx, bx, by, LOGO_BOX, LOGO_BOX, LOGO_R);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (img) {
      ctx.clip();
      const pad = 8;
      ctx.drawImage(img, bx + pad, by + pad, LOGO_BOX - pad * 2, LOGO_BOX - pad * 2);
    }
    ctx.restore();
  };
  drawLogoBox(homeImg, homeLX, logoY);
  drawLogoBox(awayImg, awayLX, logoY);

  // ── 5. Score ──────────────────────────────────────────────────────────────
  const scoreY = CARD_Y + SCORE_H / 2 + 26;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 100px sans-serif';
  ctx.fillText(`${homeScore}  –  ${awayScore}`, W / 2, scoreY);

  // ── 6. Status badge (FT / OT / PEN) ──────────────────────────────────────
  const badgeLabel = ({ finished: 'FT', overtime: 'OT', penalties: 'PEN' }[status] || 'FT');
  const FTW = 64, FTH = 34, FTR = 10;
  const ftx = W / 2 - FTW / 2, fty = divY + (BOTTOM_H - FTH) / 2;
  roundRect(ctx, ftx, fty, FTW, FTH, FTR);
  ctx.fillStyle = '#1a2840';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(badgeLabel, W / 2, fty + FTH / 2 + 5);

  // ── 7. Goal scorers ───────────────────────────────────────────────────────
  const goalStartY = divY + 18;
  const COL_W = CARD_W / 2 - 50; // column width for each team

  // Home goals (right-aligned, left half)
  ctx.font = '500 16px sans-serif';
  homeGoals.forEach((g, i) => {
    const line = `${g.minute}' ${g.player_name || ''}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(line, W / 2 - 44, goalStartY + i * GOALS_ROW_H + 16);
  });

  // Away goals (left-aligned, right half)
  awayGoals.forEach((g, i) => {
    const line = `${g.minute}' ${g.player_name || ''}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(line, W / 2 + 44, goalStartY + i * GOALS_ROW_H + 16);
  });

  // ── 8. Advertising perimeter board strip ──────────────────────────────────
  if (leagueName) {
    const adH = 32;
    const adY = H - adH;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, adY, W, adH);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    const repeat = leagueName.toUpperCase();
    const step = 220;
    for (let x = step / 2; x < W; x += step) {
      ctx.fillText(`⬡ ${repeat}`, x, adY + adH / 2 + 5);
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
  if (!LIVE_CHANNEL_ID || !_enabled) return;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ..._fetchOpts({}),
    body: JSON.stringify({ chat_id: LIVE_CHANNEL_ID, text, parse_mode: 'HTML' }),
  });
  return res.json();
}

async function tgSendPhotoToLive(photoBuffer, caption) {
  if (!LIVE_CHANNEL_ID || !_enabled) return;
  const form = new FormData();
  form.append('chat_id', LIVE_CHANNEL_ID);
  form.append('photo', photoBuffer, { filename: 'match.png', contentType: 'image/png' });
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, _fetchOpts({ method: 'POST', body: form }));
  return res.json();
}

async function sendMatchKickoff({ homeTeam, awayTeam, leagueName, matchday }) {
  if (!LIVE_CHANNEL_ID || !_enabled) return;
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
  if (!LIVE_CHANNEL_ID || !_enabled || !_notif.channel_events) return;
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
  if (!LIVE_CHANNEL_ID || !_enabled || !_notif.channel_results) return;
  try {
    const homeGoals = (goalEvents || []).filter(e => e.team_id === homeTeamId);
    const awayGoals = (goalEvents || []).filter(e => e.team_id === awayTeamId);
    const imgBuf = await generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, 'finished', stadiumUrl, leagueName, leagueLogoUrl, homeGoals, awayGoals);
    const leaguePrefix = leagueName ? `🏅 <i>${escTg(leagueName)}</i>\n` : '';
    const caption = `${leaguePrefix}<b>МАТЧ ЗАВЕРШЁН\n${escTg(homeTeam)} ${homeScore} – ${awayScore} ${escTg(awayTeam)}</b>`.slice(0, 1024);
    await tgSendPhotoToLive(imgBuf, caption);
  } catch(err) {
    console.warn('[TelegramBot] sendMatchResultToLive error:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
async function sendMatchResult({ matchId, homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, stadiumUrl, homeTeamId, awayTeamId, status, goalEvents, leagueName, leagueLogoUrl }) {
  if (!_enabled || !_notif.group_results) return;
  try {
    const homeGoals = (goalEvents || []).filter(e => e.team_id === homeTeamId);
    const awayGoals = (goalEvents || []).filter(e => e.team_id === awayTeamId);
    const imgBuf = await generateMatchBanner(homeTeam, awayTeam, homeScore, awayScore, homeLogo, awayLogo, status, stadiumUrl, leagueName, leagueLogoUrl, homeGoals, awayGoals);

    const leaguePrefix = leagueName ? `🏅 <i>${escTg(leagueName)}</i>\n` : '';
    const caption = `${leaguePrefix}🏟 <b>${escTg(homeTeam)} ${homeScore} – ${awayScore} ${escTg(awayTeam)}</b>`.slice(0, 1024);
    const photoResult = await tgSendPhoto(imgBuf, caption);
    if (!photoResult.ok) console.warn('[TelegramBot] sendPhoto failed:', photoResult.description);
  } catch (err) {
    console.warn('[TelegramBot] sendMatchResult error:', err.message);
  }
}

async function sendCoachNews({ coachName, teamName, title, body }) {
  if (!_enabled) return;
  if (!_notif.group_coach_news && !_notif.channel_coach_news) return;
  try {
    const text = `📢 <b>Тренер ${escTg(teamName)}</b> — <i>${escTg(coachName)}</i> — заявил:\n\n<b>${escTg(title)}</b>\n\n${escTg(body)}`;
    if (_notif.group_coach_news) {
      const result = await tgSendMessage(text);
      if (!result.ok) console.warn('[TelegramBot] sendCoachNews group failed:', result.description);
    }
    if (_notif.channel_coach_news) {
      await tgSendMessageToLive(text);
    }
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

// ── Standings banner ──────────────────────────────────────────────────────────
async function generateStandingsBanner(leagueName, leagueLogoUrl, matchday, standings) {
  const SW = 800;
  const ROW_H = 42;
  const HEADER_H = 62;
  const COL_H = 32;
  const FOOTER_H = 30;
  const SH = HEADER_H + COL_H + ROW_H * standings.length + FOOTER_H;
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const toUrl = u => u ? (u.startsWith('http') ? u : base + u) : null;

  const canvas = createCanvas(SW, SH);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, SW, SH);

  // Header bar
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, SW, HEADER_H);

  // League logo
  const leagueImg = await tryLoadImage(leagueLogoUrl);
  let textX = 20;
  if (leagueImg) {
    const ls = 38;
    ctx.save();
    ctx.beginPath();
    ctx.arc(20 + ls / 2, HEADER_H / 2, ls / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(leagueImg, 20, (HEADER_H - ls) / 2, ls, ls);
    ctx.restore();
    textX = 20 + ls + 12;
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(leagueName, textX, HEADER_H / 2 - 9);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`Тур ${matchday} · Итоговая таблица`, textX, HEADER_H / 2 + 11);

  // Column header row
  const colY = HEADER_H;
  ctx.fillStyle = '#e9eef4';
  ctx.fillRect(0, colY, SW, COL_H);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, colY + COL_H - 1, SW, 1);

  const COLS = [
    { label: '#',     cx: 20,  w: 28,  align: 'center' },
    { label: 'КЛУБ',  cx: 58,  w: 210, align: 'left'   },
    { label: 'И',     cx: 302, w: 36,  align: 'center' },
    { label: 'В',     cx: 338, w: 36,  align: 'center' },
    { label: 'Н',     cx: 374, w: 36,  align: 'center' },
    { label: 'П',     cx: 410, w: 36,  align: 'center' },
    { label: 'ЗГ',    cx: 446, w: 36,  align: 'center' },
    { label: 'ПГ',    cx: 482, w: 36,  align: 'center' },
    { label: 'РГ',    cx: 518, w: 36,  align: 'center' },
    { label: 'ОЧ',    cx: 564, w: 46,  align: 'center' },
    { label: 'ФОРМА', cx: 622, w: 162, align: 'center' },
  ];

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 11px sans-serif';
  for (const c of COLS) {
    ctx.textAlign = c.align;
    ctx.fillText(c.label, c.align === 'left' ? c.cx : c.cx + c.w / 2, colY + COL_H / 2 + 4);
  }

  // Team rows
  const totalTeams = standings.length;
  const CL_SPOTS   = Math.min(2, totalTeams);
  const EU_SPOTS   = Math.min(4, totalTeams);
  const REL_SPOTS  = Math.min(3, totalTeams);

  for (let i = 0; i < standings.length; i++) {
    const s = standings[i];
    const ry = HEADER_H + COL_H + i * ROW_H;
    const pos = i + 1;

    // Row bg
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(0, ry, SW, ROW_H);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, ry + ROW_H - 1, SW, 1);

    // Zone strip (left 4px)
    if (pos <= CL_SPOTS) ctx.fillStyle = '#3b82f6';
    else if (pos <= EU_SPOTS) ctx.fillStyle = '#f97316';
    else if (pos > totalTeams - REL_SPOTS) ctx.fillStyle = '#ef4444';
    else ctx.fillStyle = 'transparent';
    if (pos <= CL_SPOTS || pos <= EU_SPOTS || pos > totalTeams - REL_SPOTS) {
      ctx.fillRect(0, ry, 4, ROW_H);
    }

    // Position
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(pos), 34, ry + ROW_H / 2);

    // Team logo
    const teamImg = await tryLoadImage(toUrl(s.logo_url));
    const ls = 26, lx = 58, ly = ry + (ROW_H - ls) / 2;
    if (teamImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx + ls / 2, ry + ROW_H / 2, ls / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(teamImg, lx, ly, ls, ls);
      ctx.restore();
    } else {
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(lx + ls / 2, ry + ROW_H / 2, ls / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Team name (truncate if needed)
    ctx.fillStyle = '#1e293b';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    let name = s.team_name || '';
    while (name.length > 1 && ctx.measureText(name).width > 168) name = name.slice(0, -1);
    if (name !== s.team_name) name += '…';
    ctx.fillText(name, lx + ls + 8, ry + ROW_H / 2 + 1);

    // Numeric stats
    const gd = s.goals_for - s.goals_against;
    const stats = [
      { val: s.played,       cx: 302 + 18 },
      { val: s.won,          cx: 338 + 18 },
      { val: s.drawn,        cx: 374 + 18 },
      { val: s.lost,         cx: 410 + 18 },
      { val: s.goals_for,    cx: 446 + 18 },
      { val: s.goals_against, cx: 482 + 18 },
      { val: gd >= 0 ? `+${gd}` : String(gd), cx: 518 + 18 },
    ];
    ctx.fillStyle = '#475569';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    for (const st of stats) ctx.fillText(String(st.val), st.cx, ry + ROW_H / 2 + 1);

    // Points — bold blue
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(String(s.points), 564 + 23, ry + ROW_H / 2 + 1);

    // Form badges
    const form = s.form || [];
    const bw = 22, bh = 22, bg = 3;
    const totalBadgeW = form.length * bw + (form.length - 1) * bg;
    let bx = 622 + (162 - totalBadgeW) / 2;
    for (const f of form) {
      const by = ry + (ROW_H - bh) / 2;
      ctx.fillStyle = f === 'W' ? '#16a34a' : f === 'D' ? '#94a3b8' : '#dc2626';
      roundRect(ctx, bx, by, bw, bh, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f, bx + bw / 2, by + bh / 2 + 1);
      bx += bw + bg;
    }
  }

  // Footer legend
  const fy = HEADER_H + COL_H + standings.length * ROW_H;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, fy, SW, FOOTER_H);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, fy, SW, 1);

  const legend = [
    { color: '#3b82f6', label: 'Лига чемпионов' },
    { color: '#f97316', label: 'Еврокубки' },
    { color: '#ef4444', label: 'Вылет' },
  ];
  let lx2 = 16;
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'middle';
  for (const l of legend) {
    ctx.fillStyle = l.color;
    ctx.fillRect(lx2, fy + 8, 12, 14);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(l.label, lx2 + 16, fy + FOOTER_H / 2);
    lx2 += 16 + ctx.measureText(l.label).width + 20;
  }

  return canvas.toBuffer('image/png');
}

async function sendStandingsBanner({ leagueName, leagueLogoUrl, matchday, standings }) {
  if (!LIVE_CHANNEL_ID || !_enabled || !_notif.channel_standings) return;
  try {
    const imgBuf = await generateStandingsBanner(leagueName, leagueLogoUrl, matchday, standings);
    const caption = `📊 <b>${escTg(leagueName)}</b> · Тур ${matchday} завершён`;
    await tgSendPhotoToLive(imgBuf, caption);
  } catch(err) {
    console.warn('[TelegramBot] sendStandingsBanner error:', err.message);
  }
}

async function sendPlayerNews({ title, body, type }) {
  if (!LIVE_CHANNEL_ID || !_enabled || !_notif.channel_player_news) return;
  try {
    const icon = type === 'scandal' ? '🔥' : '📰';
    const text = `${icon} <b>${escTg(title)}</b>\n\n${escTg(body)}`;
    await tgSendMessageToLive(text);
  } catch (err) {
    console.warn('[TelegramBot] sendPlayerNews error:', err.message);
  }
}

module.exports = { initBot, sendMatchResult, sendCoachNews, sendMatchPreview, sendMatchKickoff, sendLiveEvent, sendMatchResultToLive, sendStandingsBanner, sendPlayerNews, setEnabled, isEnabled, setNotifSettings, getNotifSettings, setProxy, getProxySettings, generateMatchBanner };
