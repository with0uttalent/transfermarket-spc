/* ═══════════════════════════════════════════════════════════
   TransferMarket SPA  (v5)
   ═══════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────
function decodeJWT(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { return {}; }
}
const _stored = localStorage.getItem('tm_token');
const _payload = _stored ? decodeJWT(_stored) : {};
const State = {
  token: _stored || null,
  user: _payload.username || null,
  role: _payload.role || null,
  coachProfile: null,
};

// ─── API ─────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (State.token) opts.headers.Authorization = 'Bearer ' + State.token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const GET  = p       => api('GET',    p);
const POST = (p, b)  => api('POST',   p, b);
const PUT  = (p, b)  => api('PUT',    p, b);
const DEL  = p       => api('DELETE', p);

// ─── Toast ───────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── Formatters ──────────────────────────────────────────────
function fmtValue(v) {
  if (!v || v === 0) return '–';
  if (v >= 1e9) return '€' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '€' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '€' + (v / 1e3).toFixed(0) + 'K';
  return '€' + v;
}
function fmtValueTM(v) {
  if (!v || v === 0) return '–';
  if (v >= 1e9) return (v / 1e9).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' млрд €';
  if (v >= 1e6) return (v / 1e6).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' млн €';
  if (v >= 1e3) return (v / 1e3).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' тыс. €';
  return v + ' €';
}
function fmtDate(d) {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}
function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
}
function posBadge(pos) {
  if (!pos) return '';
  const map = { 'Goalkeeper':'GK','Centre-Back':'DEF','Left-Back':'DEF','Right-Back':'DEF','Defensive Midfield':'MID','Central Midfield':'MID','Attacking Midfield':'MID','Left Winger':'FWD','Right Winger':'FWD','Centre-Forward':'FWD','Striker':'FWD' };
  const key = map[pos] || pos.substring(0,3).toUpperCase();
  const cls = key==='GK'?'pos-GK':key==='DEF'?'pos-DEF':key==='MID'?'pos-MID':key==='FWD'?'pos-FWD':'pos-default';
  return `<span class="pos ${cls}">${pos}</span>`;
}
const ZONE_LABEL = { GK:'ВРТ', DEF:'ЗАЩ', DMF:'ОПН', MID:'ПОЛ', AMF:'АТА', FWD:'НАП' };
const ZONE_FULL  = { GK:'Вратарь', DEF:'Защитник', DMF:'Опорный', MID:'Полузащитник', AMF:'Атакующий', FWD:'Нападающий' };
const ZONE_COLOR = { GK:'#f39c12', DEF:'#3498db', DMF:'#9b59b6', MID:'#27ae60', AMF:'#16a085', FWD:'#e74c3c' };
function zoneBadge(zone, player) {
  if (!zone) return '';
  const label = ZONE_LABEL[zone] || zone;
  const color = ZONE_COLOR[zone] || '#888';
  const ovr = player ? calcOverall(player, zone) : null;
  const fullName = ZONE_FULL[zone] || zone;
  const titleTxt = ovr !== null ? `${fullName} · OVR на позиции: ${ovr}` : fullName;
  const ovrTxt = ovr !== null ? ` ${ovr}` : '';
  return `<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 5px;border-radius:4px;font-size:10px;font-weight:800;color:#fff;background:${color};letter-spacing:.3px;cursor:default" title="${titleTxt}">${label}<span style="font-size:9px;opacity:.75">${ovrTxt}</span></span>`;
}
function ttypeBadge(t) {
  const cls = {permanent:'ttype-permanent',loan:'ttype-loan',free:'ttype-free',youth:'ttype-youth'}[t]||'ttype-free';
  return `<span class="ttype ${cls}">${t||'transfer'}</span>`;
}
function avatarEl(url, name, large) {
  const cls = large ? 'avatar-lg' : 'avatar';
  const phCls = large ? 'avatar-placeholder-lg' : 'avatar-placeholder';
  const initials = (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  if (url) return `<img src="${url}" class="${cls}" alt="${escHtml(name)}" onerror="this.style.display='none'">`;
  return `<div class="${phCls}">${initials}</div>`;
}
function avatarElXL(url, name) {
  const initials = (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  if (url) return `<img src="${escHtml(url)}" class="avatar-xl" alt="${escHtml(name)}" onerror="this.style.display='none'">`;
  return `<div class="avatar-placeholder-xl">${initials}</div>`;
}
function teamLogoXL(url, name) {
  if (url) return `<img src="${escHtml(url)}" class="team-logo-xl" alt="${escHtml(name)}" onerror="this.style.display='none'">`;
  return `<div class="team-logo-placeholder-xl">${(name||'?').substring(0,3).toUpperCase()}</div>`;
}
function teamLogoEl(url, name) {
  if (url) return `<img src="${url}" class="team-logo" alt="${escHtml(name)}" onerror="this.style.display='none'">`;
  return `<div class="team-logo-placeholder">${(name||'?').substring(0,3).toUpperCase()}</div>`;
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function eventIcon(type) {
  return {goal:'⚽',own_goal:'⚽',yellow_card:'🟨',red_card:'🟥',substitution:'🔄',penalty:'⚽',penalty_miss:'❌',penalty_awarded:'🚨',var_review:'📺',injury:'🚑',save:'🧤',near_miss:'🎯',buildup:'🔵',free_kick:'🟡',corner_kick:'🚩'}[type]||'📋';
}
function newsIcon(type) {
  return {match:'⚽',tournament:'🏆',transfer:'🔄',rumor:'💬',injury:'🏥',scandal:'⚠️',team:'🏟️'}[type]||'📰';
}
// Position category for pitch placement
function posCategory(pos) {
  if (!pos) return 'CM';
  if (pos === 'Goalkeeper') return 'GK';
  if (['Centre-Back','Left-Back','Right-Back'].includes(pos)) return 'DEF';
  if (pos === 'Defensive Midfield') return 'CDM';
  if (['Central Midfield','Left Midfield','Right Midfield'].includes(pos)) return 'CM';
  if (pos === 'Attacking Midfield') return 'CAM';
  if (['Left Winger','Right Winger','Centre-Forward','Striker'].includes(pos)) return 'FWD';
  return 'CM';
}
const PITCH_ROW_Y_HOME = { GK:90, DEF:75, CDM:62, CM:49, CAM:35, FWD:18 };
const PITCH_ROW_Y_AWAY = { GK:10, DEF:25, CDM:38, CM:51, CAM:65, FWD:82 };
function pitchCoords(pos, idxInRow, countInRow, isAway) {
  const cat = posCategory(pos);
  const y = (isAway ? PITCH_ROW_Y_AWAY : PITCH_ROW_Y_HOME)[cat] || 50;
  const x = countInRow === 1 ? 50 : 10 + 80 * (idxInRow / (countInRow - 1));
  return { x, y };
}
// ─── Flexible pitch builder zones ────────────────────────────────────────────
const PITCH_ZONES = [
  { id: 'FWD', y: 10, label: 'НАП' },
  { id: 'AMF', y: 24, label: 'АТП' },
  { id: 'MID', y: 38, label: 'ПОЛ' },
  { id: 'DMF', y: 53, label: 'ОПЗ' },
  { id: 'DEF', y: 68, label: 'ЗАЩ' },
  { id: 'GK',  y: 84, label: 'ВРТ' },
];

const ALL_ZONES = ['GK','DEF','DMF','MID','AMF','FWD'];

// 5 uniform circles per row — simple grid layout
const _ROWS = [
  { zone:'FWD', y:12 },
  { zone:'AMF', y:26 },
  { zone:'MID', y:41 },
  { zone:'DMF', y:56 },
  { zone:'DEF', y:71 },
];
const _5X = [10, 27.5, 50, 72.5, 90]; // 5 evenly spaced x positions

const PITCH_SLOTS = [
  { id:'GK-1', x:50, y:86, zone:'GK', label:'' },
  ..._ROWS.flatMap(r => _5X.map((x,i) => ({ id:`${r.zone}-${i+1}`, x, y:r.y, zone:r.zone, label:'' }))),
];

function slotToZone(slotId) {
  if (!slotId) return 'MID';
  if (ALL_ZONES.includes(slotId)) return slotId;
  return PITCH_SLOTS.find(s => s.id === slotId)?.zone || 'MID';
}

function posToZone(position) {
  if (!position) return 'MID';
  if (position === 'Goalkeeper') return 'GK';
  if (['Centre-Back','Left-Back','Right-Back'].includes(position)) return 'DEF';
  if (position === 'Defensive Midfield') return 'DMF';
  if (position === 'Central Midfield') return 'MID';
  if (['Attacking Midfield','Left Winger','Right Winger'].includes(position)) return 'AMF';
  if (['Centre-Forward','Striker'].includes(position)) return 'FWD';
  return 'MID';
}

function computeFormation(lineup) {
  const starters = lineup.filter(s => s.slot >= 1 && s.slot <= 11);
  const cnt = { GK:0, DEF:0, DMF:0, MID:0, AMF:0, FWD:0 };
  for (const s of starters) {
    const z = slotToZone(s.position_override) || posToZone((_pitchState.players||[]).find(p=>p.id===s.player_id)?.position);
    if (z in cnt) cnt[z]++;
  }
  return [cnt.DEF, cnt.DMF, cnt.MID, cnt.AMF, cnt.FWD].filter(c => c > 0).join('-') || '–';
}

// Position penalty factor (1.0 = no penalty)
const ZONE_PENALTY = {
  GK:  { GK:1.00, DEF:0.80, DMF:0.65, MID:0.55, AMF:0.50, FWD:0.45 },
  DEF: { GK:0.80, DEF:1.00, DMF:0.88, MID:0.75, AMF:0.65, FWD:0.55 },
  DMF: { GK:0.65, DEF:0.88, DMF:1.00, MID:0.90, AMF:0.80, FWD:0.68 },
  MID: { GK:0.55, DEF:0.75, DMF:0.90, MID:1.00, AMF:0.90, FWD:0.75 },
  AMF: { GK:0.50, DEF:0.65, DMF:0.80, MID:0.90, AMF:1.00, FWD:0.88 },
  FWD: { GK:0.45, DEF:0.55, DMF:0.68, MID:0.75, AMF:0.88, FWD:1.00 },
};

function positionPenalty(naturalZone, assignedZone) {
  return (ZONE_PENALTY[naturalZone] || {})[assignedZone] ?? 0.70;
}

// Weighted overall rating from skills [pace, shooting, passing, defending, physical]
const OVR_WEIGHTS = {
  GK:  [0.05, 0.03, 0.12, 0.50, 0.30],
  DEF: [0.18, 0.08, 0.14, 0.38, 0.22],
  DMF: [0.12, 0.12, 0.32, 0.28, 0.16],
  MID: [0.15, 0.20, 0.32, 0.16, 0.17],
  AMF: [0.22, 0.28, 0.28, 0.10, 0.12],
  FWD: [0.28, 0.40, 0.16, 0.05, 0.11],
};

function calcOverall(player, assignedSlot) {
  const { pace, shooting, passing, defending, physical } = player;
  if (!pace && !shooting && !passing && !defending && !physical) return null;
  const naturalZone = posToZone(player.position);
  const w = OVR_WEIGHTS[naturalZone] || OVR_WEIGHTS.MID;
  const base = Math.round(
    w[0]*(pace||50) + w[1]*(shooting||50) + w[2]*(passing||50) +
    w[3]*(defending||50) + w[4]*(physical||50)
  );
  if (!assignedSlot) return base;
  const assignedZone = slotToZone(assignedSlot);
  if (!assignedZone || assignedZone === naturalZone) return base;
  return Math.round(base * positionPenalty(naturalZone, assignedZone));
}

function ovrBadge(ovr, assignedZone, naturalZone) {
  if (ovr === null || ovr === undefined) return '';
  const outOfPos = assignedZone && naturalZone && assignedZone !== naturalZone;
  const color = ovr >= 80 ? '#f1c40f' : ovr >= 70 ? '#2ecc71' : ovr >= 60 ? '#3498db' : '#95a5a6';
  const style = `background:${color};color:#000;font-weight:700;font-size:11px;padding:1px 5px;border-radius:3px;${outOfPos?'opacity:0.75':''}`;
  return `<span style="${style}" title="${outOfPos?'Не на своей позиции (-штраф)':'Рейтинг'}">${ovr}${outOfPos?'⚠':''}</span>`;
}

// Interactive pitch builder state
let _pitchState = { teamId: null, lineup: [], players: [], selectedPlayerId: null };

const PITCH_SVG = `<svg viewBox="0 0 320 500" xmlns="http://www.w3.org/2000/svg" class="pitch-svg">
  <rect width="320" height="500" fill="#2d8a4e" rx="6"/>
  <rect x="0" y="0"   width="320" height="62" fill="#2a8548" opacity=".45"/>
  <rect x="0" y="125" width="320" height="62" fill="#2a8548" opacity=".45"/>
  <rect x="0" y="250" width="320" height="62" fill="#2a8548" opacity=".45"/>
  <rect x="0" y="375" width="320" height="62" fill="#2a8548" opacity=".45"/>
  <rect x="10" y="10" width="300" height="480" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.8"/>
  <line x1="10" y1="250" x2="310" y2="250" stroke="rgba(255,255,255,.8)" stroke-width="1.8"/>
  <circle cx="160" cy="250" r="46" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.8"/>
  <circle cx="160" cy="250" r="2.8" fill="rgba(255,255,255,.9)"/>
  <rect x="135" y="0"   width="50" height="12" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="108" y="12"  width="104" height="36" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="78"  y="12"  width="164" height="102" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <circle cx="160" cy="94" r="2.8" fill="rgba(255,255,255,.9)"/>
  <path d="M 124 114 A 48 48 0 0 1 196 114" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="135" y="488" width="50" height="12" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="108" y="452" width="104" height="36" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="78"  y="386" width="164" height="102" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <circle cx="160" cy="406" r="2.8" fill="rgba(255,255,255,.9)"/>
  <path d="M 124 386 A 48 48 0 0 0 196 386" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <path d="M 10 30 A 20 20 0 0 1 30 10"  fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  <path d="M 290 10 A 20 20 0 0 1 310 30" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  <path d="M 10 470 A 20 20 0 0 0 30 490" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  <path d="M 290 490 A 20 20 0 0 0 310 470" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
</svg>`;
function renderPitch(players, isAway = false) {
  if (!players || !players.length) return `<div class="empty-state"><p>Нет данных об игроках</p></div>`;
  const rows = {};
  for (const p of players) {
    const cat = posCategory(p.position);
    if (!rows[cat]) rows[cat] = [];
    rows[cat].push(p);
  }
  let dots = '';
  for (const [cat, catPl] of Object.entries(rows)) {
    catPl.forEach((p, i) => {
      const { x, y } = pitchCoords(p.position, i, catPl.length, isAway);
      const firstName = (p.name||'').split(' ')[0];
      const initials = (p.name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
      const avatarHtml = p.image_url
        ? `<img src="${escHtml(p.image_url)}" alt="${escHtml(p.name)}" onerror="this.style.display='none'">`
        : `<div class="pc-ini">${escHtml(initials)}</div>`;
      dots += `<div class="pitch-player${isAway?' away':''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" title="${escHtml(p.name)} (${p.position||'?'})">
        <div class="pc-av">${avatarHtml}</div>
        <div class="pl">${escHtml(firstName)}</div>
      </div>`;
    });
  }
  return `<div class="pitch-container"><div style="position:relative">${PITCH_SVG}<div class="pitch-overlay">${dots}</div></div></div>`;
}

function renderCombinedMatchPitch(homeSlots, awaySlots, matchStats, homeTeamName, awayTeamName) {
  // matchStats is an array from match.stats: [{player_id, rating, goals, assists, yellow_cards, red_cards, team_id}, ...]
  const statsById = {};
  for (const s of (matchStats || [])) statsById[s.player_id] = s;

  const homeStarters = homeSlots.filter(s => s.slot >= 1 && s.slot <= 11);
  const awayStarters = awaySlots.filter(s => s.slot >= 1 && s.slot <= 11);

  // Zone Y positions on the COMBINED pitch (0% = top edge, 100% = bottom edge)
  const HOME_Y = { GK: 2, DEF: 10.5, DMF: 19, MID: 27.5, AMF: 36, FWD: 44.5 };
  const AWAY_Y = { GK: 98, DEF: 89.5, DMF: 81, MID: 72.5, AMF: 64, FWD: 55.5 };

  function buildZones(starters) {
    const zones = { GK: [], DEF: [], DMF: [], MID: [], AMF: [], FWD: [] };
    for (const s of starters) {
      const z = ALL_ZONES.includes(s.position_override) ? s.position_override : posToZone(s.position);
      zones[z].push(s);
    }
    return zones;
  }

  function playerDot(s, yPct, xPct, isAway) {
    const st = statsById[s.player_id] || {};
    const rating = st.rating ? st.rating.toFixed(1) : null;
    const rColor = !rating ? '#888' : rating >= 7.5 ? '#27ae60' : rating >= 6.5 ? '#f39c12' : '#e74c3c';
    const name = s.player_name || s.name || '?';
    const lastName = name.split(' ').slice(-1)[0];
    const ini = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const num = s.shirt_number || '';
    const goals = st.goals || 0;
    const yc = st.yellow_cards || 0;
    const rc = st.red_cards || 0;
    const teamColor = isAway ? '#c0392b' : '#1a6b32';
    const borderColor = isAway ? '#e74c3c' : '#27ae60';
    const avatarHtml = s.image_url
      ? `<img src="${escHtml(s.image_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + `<span class="mp-ini" style="display:none">${escHtml(ini)}</span>`
      : `<span class="mp-ini">${escHtml(ini)}</span>`;
    const events = (goals > 0 ? `<span class="mp-ev-goal" title="${goals} гол(а)">⚽</span>`.repeat(Math.min(goals,3)) : '')
                 + (yc > 0 && rc === 0 ? `<span class="mp-ev-card yc" title="Жёлтая карточка">◼</span>` : '')
                 + (rc > 0 ? `<span class="mp-ev-card rc" title="Красная карточка">◼</span>` : '');
    return `<div class="mp-player${isAway?' away':''}" style="left:${xPct.toFixed(1)}%;top:${yPct.toFixed(1)}%" title="${escHtml(name)}">
      <div class="mp-av-wrap">
        ${rating ? `<span class="mp-rating" style="background:${rColor}">${rating}</span>` : ''}
        ${events ? `<span class="mp-events">${events}</span>` : ''}
        <div class="mp-av" style="border-color:${borderColor};background:${teamColor}">${avatarHtml}</div>
      </div>
      ${num ? `<div class="mp-num">${num}</div>` : ''}
      <div class="mp-name">${escHtml(lastName)}</div>
    </div>`;
  }

  function renderTeamDots(starters, yMap, isAway) {
    const zones = buildZones(starters);
    let dots = '';
    for (const [zoneId, zPlayers] of Object.entries(zones)) {
      if (!zPlayers.length) continue;
      const y = yMap[zoneId];
      zPlayers.forEach((s, i) => {
        const x = zPlayers.length === 1 ? 50 : 8 + 84 * (i / (zPlayers.length - 1));
        dots += playerDot(s, y, x, isAway);
      });
    }
    return dots;
  }

  const homeDots = renderTeamDots(homeStarters, HOME_Y, false);
  const awayDots = renderTeamDots(awayStarters, AWAY_Y, true);

  const homeFormation = computeFormation(homeSlots);
  const awayFormation = computeFormation(awaySlots);

  return `<div class="mp-container">
    <div style="position:relative">
      ${PITCH_SVG}
      <div class="pitch-overlay">
        ${homeDots}${awayDots}
        <div class="mp-team-label home">
          <span class="mp-formation-badge">${escHtml(homeFormation)}</span>
          <span class="mp-team-name-badge">${escHtml(homeTeamName)}</span>
        </div>
        <div class="mp-team-label away">
          <span class="mp-team-name-badge">${escHtml(awayTeamName)}</span>
          <span class="mp-formation-badge">${escHtml(awayFormation)}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function renderPitchFromLineup(lineupSlots, isAway = false) {
  const starters = lineupSlots.filter(s => s.slot >= 1 && s.slot <= 11);
  if (!starters.length) return `<div class="empty-state"><p>Нет игроков в стартовом составе</p></div>`;

  const ZONE_Y_HOME = { GK:84, DEF:68, DMF:53, MID:38, AMF:24, FWD:10 };
  const ZONE_Y_AWAY = { GK:16, DEF:32, DMF:47, MID:62, AMF:76, FWD:90 };
  const yMap = isAway ? ZONE_Y_AWAY : ZONE_Y_HOME;

  const zones = { GK:[], DEF:[], DMF:[], MID:[], AMF:[], FWD:[] };
  for (const s of starters) {
    const z = ALL_ZONES.includes(s.position_override) ? s.position_override : posToZone(s.position);
    zones[z].push(s);
  }

  const teamColor = isAway ? '#c0392b' : '#1a6b32';
  const borderColor = isAway ? '#e74c3c' : '#27ae60';

  let dots = '';
  for (const [zoneId, zPlayers] of Object.entries(zones)) {
    if (!zPlayers.length) continue;
    const y = yMap[zoneId];
    zPlayers.forEach((s, i) => {
      const x = zPlayers.length === 1 ? 50 : 10 + 80 * (i / (zPlayers.length - 1));
      const name = s.player_name || s.name || '?';
      const lastName = name.split(' ').slice(-1)[0];
      const ini = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      const ovr = typeof calcOverall === 'function' ? calcOverall(s, s.position_override) : null;
      const ovrColor = !ovr ? '#888' : ovr >= 80 ? '#f1c40f' : ovr >= 70 ? '#2ecc71' : ovr >= 60 ? '#3498db' : '#95a5a6';
      const avatarHtml = s.image_url
        ? `<img src="${escHtml(s.image_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          + `<span class="mp-ini" style="display:none">${escHtml(ini)}</span>`
        : `<span class="mp-ini">${escHtml(ini)}</span>`;
      dots += `<div class="mp-player${isAway?' away':''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" title="${escHtml(name)}">
        <div class="mp-av-wrap">
          ${ovr ? `<span class="mp-rating" style="background:${ovrColor};color:${ovr>=80?'#222':'#fff'}">${ovr}</span>` : ''}
          <div class="mp-av" style="border-color:${borderColor};background:${teamColor}">${avatarHtml}</div>
        </div>
        <div class="mp-name">${escHtml(lastName)}</div>
      </div>`;
    });
  }
  return `<div class="pitch-container"><div style="position:relative">${PITCH_SVG}<div class="pitch-overlay">${dots}</div></div></div>`;
}
function ratingColor(r) { return r >= 7.5 ? 'high' : r >= 6 ? 'mid' : 'low'; }
function achIcon(type) {
  return {hat_trick:'🎩',brace:'⚽⚽',man_of_the_match:'🌟',clean_sheet:'🧤',tournament_winner:'🏆'}[type]||'🏅';
}

// ─── Auth ─────────────────────────────────────────────────────
function isLoggedIn() { return !!State.token; }
function isAdmin() { return !!State.token && State.role !== 'coach'; }
function isCoach() { return !!State.token && State.role === 'coach'; }

function updateAuthUI() {
  const loggedIn = isLoggedIn();
  document.getElementById('btn-login').classList.toggle('hidden', loggedIn);
  document.getElementById('btn-logout').classList.toggle('hidden', !loggedIn);
  const indEl = document.getElementById('user-indicator');
  indEl.classList.toggle('hidden', !loggedIn);
  if (loggedIn) { indEl.textContent = isCoach() ? 'COACH' : 'ADMIN'; indEl.style.color = isCoach() ? '#3498db' : '#f1c40f'; }
  document.getElementById('nav-admin').classList.toggle('hidden', !isAdmin());
  document.getElementById('nav-coach').classList.toggle('hidden', !isCoach());
}

async function loadCoachProfile() {
  if (!isCoach()) return;
  try { State.coachProfile = await GET('/coaches/me'); } catch { State.coachProfile = null; }
}

// ── Notifications ─────────────────────────────────────────────────────────────
let _notifPollTimer = null;

async function loadNotifications() {
  if (!isLoggedIn()) { updateNotifBadge([]); return; }
  try {
    const items = await buildNotifications();
    updateNotifBadge(items);
    renderNotifList(items);
    // Update the Challenges tab badge in the coach dashboard (if visible)
    const challengesBadge = document.getElementById('coach-challenges-badge');
    const challengesPanel = document.getElementById('tab-challenges');
    if (challengesBadge || challengesPanel) {
      const ch = await GET('/match-challenges').catch(() => ({ incoming: [], outgoing: [] }));
      const cnt = (ch.incoming || []).length;
      if (challengesBadge) {
        challengesBadge.textContent = cnt || '';
        challengesBadge.classList.toggle('hidden', cnt === 0);
      }
      // If the challenges tab is currently active, re-render its content too
      if (challengesPanel && challengesPanel.classList.contains('active')) {
        challengesPanel.innerHTML = renderChallengesTab(ch, State.coachProfile?.team_id);
      }
    }
  } catch { /* silent */ }
}

async function buildNotifications() {
  const items = [];

  if (isCoach()) {
    // Incoming match challenges
    const ch = await GET('/match-challenges').catch(() => ({ incoming: [], outgoing: [] }));
    for (const c of (ch.incoming || [])) {
      items.push({
        id: `ch-in-${c.id}`,
        icon: '⚔️',
        text: `<strong>${escHtml(c.from_team_name)}</strong> вызывает вас на товарищеский матч`,
        time: c.created_at,
        actions: [
          { label: '✅ Принять',   cls: 'btn-green',   fn: `respondChallenge(${c.id},'accept')` },
          { label: '❌ Отклонить', cls: 'btn-notif-decline', fn: `respondChallenge(${c.id},'decline')` },
        ],
      });
    }
    // Accepted outgoing challenges (match ready to play)
    for (const c of (ch.outgoing || [])) {
      if (c.status === 'accepted' && c.match_id) {
        items.push({
          id: `ch-acc-${c.id}`,
          icon: '✅',
          text: `<strong>${escHtml(c.to_team_name)}</strong> принял вызов! Товарищеский матч готов`,
          time: c.created_at,
          actions: [{ label: '▶ Перейти к матчу', cls: 'btn-green', fn: `navigate('/matches/${c.match_id}')` }],
        });
      }
    }
    // Pending transfer offers
    const offers = await GET('/transfer-offers').catch(() => []);
    const pending = (Array.isArray(offers) ? offers : []).filter(o => o.status === 'pending' && o.to_team_id === State.coachProfile?.team_id);
    for (const o of pending.slice(0, 5)) {
      items.push({
        id: `of-${o.id}`,
        icon: '💶',
        text: `Предложение о трансфере <strong>${escHtml(o.player_name || '?')}</strong> от <strong>${escHtml(o.from_team_name || '?')}</strong> — ${fmtValue(o.amount)}`,
        time: o.created_at,
        actions: [{ label: 'Открыть', cls: 'btn-notif-open', fn: `navigate('/coach');setTimeout(()=>document.querySelector('[data-tab=offers]')?.click(),400)` }],
      });
    }
  }
  return items;
}

function updateNotifBadge(items) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = items.length;
  badge.textContent = count > 9 ? '9+' : count;
  badge.classList.toggle('hidden', count === 0);
}

let _notifExpanded = false;
const NOTIF_VISIBLE = 5;

function renderNotifList(items) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="notif-empty">Нет новых уведомлений</div>'; return; }
  const visible = _notifExpanded ? items : items.slice(0, NOTIF_VISIBLE);
  const hasMore = items.length > NOTIF_VISIBLE;
  list.innerHTML = visible.map(item => `
    <div class="notif-item" id="notif-item-${item.id}">
      <div class="notif-icon">${item.icon}</div>
      <div class="notif-body">
        <div class="notif-text">${item.text}</div>
        ${item.time ? `<div class="notif-time">${fmtDate(item.time)}</div>` : ''}
        ${item.actions?.length ? `<div class="notif-actions">${item.actions.map(a =>
          `<button class="btn btn-sm ${a.cls}" onclick="(()=>{closeNotifDropdown();${a.fn};})()">${a.label}</button>`
        ).join('')}</div>` : ''}
      </div>
    </div>`).join('')
    + (hasMore && !_notifExpanded
      ? `<div class="notif-show-more" onclick="_notifExpanded=true;loadNotifications()">Показать ещё ${items.length - NOTIF_VISIBLE} →</div>`
      : '')
    + (items.length > 0
      ? `<div class="notif-clear-row"><button class="btn btn-sm btn-outline notif-clear-btn" onclick="clearAllNotifications()">✕ Очистить всё</button></div>`
      : '');
}

async function clearAllNotifications() {
  if (!isCoach()) return;
  try {
    // Decline all incoming challenges and clear accepted outgoing
    const ch = await GET('/match-challenges').catch(() => ({ incoming: [], outgoing: [] }));
    for (const c of (ch.incoming || [])) {
      await PUT(`/match-challenges/${c.id}/decline`, {}).catch(() => {});
    }
    // Remove accepted/declined outgoing
    for (const c of (ch.outgoing || [])) {
      if (c.status !== 'pending') await DEL('/match-challenges/' + c.id).catch(() => {});
    }
    _notifExpanded = false;
    await loadNotifications();
    toast('Уведомления очищены');
  } catch(e) { toast(e.message, 'error'); }
}

function closeNotifDropdown() {
  document.getElementById('notif-dropdown')?.classList.add('hidden');
}

function startNotifPolling() {
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  loadNotifications();
  _notifPollTimer = setInterval(loadNotifications, 5000);
}

// Notification bell toggle
document.getElementById('notif-btn').addEventListener('click', e => {
  e.stopPropagation();
  const dd = document.getElementById('notif-dropdown');
  const isHidden = dd.classList.toggle('hidden');
  if (!isHidden) loadNotifications();
});
document.addEventListener('click', e => {
  if (!document.getElementById('notif-wrap')?.contains(e.target)) closeNotifDropdown();
});

document.getElementById('btn-login').addEventListener('click', () => {
  document.getElementById('login-modal').classList.remove('hidden');
  document.getElementById('login-username').focus();
  document.getElementById('login-error').style.display = 'none';
});
document.getElementById('login-modal-close').addEventListener('click', () => document.getElementById('login-modal').classList.add('hidden'));
document.getElementById('login-modal').addEventListener('click', e => { if (e.target === document.getElementById('login-modal')) document.getElementById('login-modal').classList.add('hidden'); });
document.getElementById('btn-do-login').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
async function doLogin() {
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const data = await POST('/auth/login', { username: document.getElementById('login-username').value.trim(), password: document.getElementById('login-password').value });
    State.token = data.token; State.user = data.username; State.role = data.role || 'admin';
    localStorage.setItem('tm_token', data.token);
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-password').value = '';
    updateAuthUI(); await loadCoachProfile(); toast('Вход выполнен: ' + data.username); startNotifPolling(); router();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
}
document.getElementById('btn-logout').addEventListener('click', () => {
  State.token = null; State.role = null; State.coachProfile = null; localStorage.removeItem('tm_token'); if(_notifPollTimer){clearInterval(_notifPollTimer);_notifPollTimer=null;} updateNotifBadge([]); renderNotifList([]); updateAuthUI(); toast('Выход выполнен','info'); navigate('/');
});

// ─── Global Search ────────────────────────────────────────────
let searchTimeout;
document.getElementById('search-global').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  searchTimeout = setTimeout(() => navigate('/search?q=' + encodeURIComponent(q)), 400);
});

// ─── Banner loader ────────────────────────────────────────────
async function loadBanners() {
  try {
    const [b, featured] = await Promise.all([GET('/banners/public'), GET('/stats/featured').catch(()=>({}))]);
    renderBannerCol('banner-left',  b.left  || [], featured?.topValue || null, '💰 Top Value');
    renderBannerCol('banner-right', b.right || [], featured?.topRated || null, '⭐ Top Rated');
  } catch { /* banners are optional */ }
}
function renderBannerCol(containerId, banners, featuredPlayer, featuredLabel) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let html = banners.map(b => `
    <${b.link_url ? `a href="${escHtml(b.link_url)}" target="_blank" rel="noopener"` : 'div'} class="banner-item">
      ${b.image_url ? `<img src="${escHtml(b.image_url)}" alt="${escHtml(b.title||'')}">` : `<div class="banner-text-only">${escHtml(b.title||'')}</div>`}
    </${b.link_url ? 'a' : 'div'}>
  `).join('');
  if (featuredPlayer) {
    const initials = (featuredPlayer.name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const ratingStr = featuredPlayer.avg_rating ? `<div class="fc-rating">${featuredPlayer.avg_rating.toFixed(2)}</div><div class="fc-pos">Avg Rating</div>` : `<div class="fc-val">${fmtValue(featuredPlayer.market_value)}</div>`;
    html += `<div class="featured-card" onclick="navigate('/players/${featuredPlayer.id}')">
      <div class="fc-label">${featuredLabel}</div>
      ${featuredPlayer.image_url
        ? `<img src="${escHtml(featuredPlayer.image_url)}" class="fc-avatar" alt="" onerror="this.style.display='none'">`
        : `<div class="fc-avatar-ph">${initials}</div>`}
      <div class="fc-name">${escHtml(featuredPlayer.name)}</div>
      <div class="fc-pos">${escHtml(featuredPlayer.team_name||'Free Agent')}</div>
      ${ratingStr}
    </div>`;
  }
  el.innerHTML = html;
}

// ─── Router ───────────────────────────────────────────────────
function navigate(path) { window.location.hash = '#' + path; }
function router() {
  stopLiveMatchPoll(); // cancel live polling when navigating away
  if (_homeLivePollTimer) { clearInterval(_homeLivePollTimer); _homeLivePollTimer = null; }
  const hash = window.location.hash.replace(/^#/,'') || '/';
  const [rawPath, qs = ''] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));
  document.querySelectorAll('#main-nav a').forEach(a => {
    const r = a.dataset.route;
    const active = rawPath==='/' ? r==='home' : rawPath.startsWith('/'+r) && r!=='home';
    a.classList.toggle('active', active);
  });
  const app = document.getElementById('app');
  const parts = rawPath.split('/').filter(Boolean);
  if (!rawPath||rawPath==='/') return renderHome(app);
  if (rawPath==='/teams') return renderTeams(app, params);
  if (parts[0]==='teams'&&parts[1]) return renderTeamDetail(app, parts[1]);
  if (rawPath==='/players') return renderPlayers(app, params);
  if (parts[0]==='players'&&parts[1]) return renderPlayerDetail(app, parts[1]);
  if (rawPath==='/competitions') return renderCompetitions(app, params);
  if (parts[0]==='competitions'&&parts[1]) return renderCompetitionDetail(app, parts[1]);
  if (rawPath==='/transfers') return renderTransfers(app, params);
  if (rawPath==='/matches') return renderMatches(app, params);
  if (parts[0]==='matches'&&parts[1]) return renderMatchDetail(app, parts[1]);
  if (rawPath==='/tournaments') return renderTournaments(app);
  if (parts[0]==='tournaments'&&parts[1]) return renderTournamentDetail(app, parts[1]);
  if (rawPath==='/leagues') return renderLeagues(app);
  if (parts[0]==='leagues'&&parts[1]) return renderLeagueDetail(app, parts[1]);
  if (rawPath==='/coach') return renderCoachDashboard(app);
  if (rawPath==='/admin') return renderAdmin(app);
  if (rawPath==='/news')  return renderNewsPage(app);
  if (rawPath==='/search') return renderSearch(app, params.q);
  app.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Page not found</p></div>`;
}
window.addEventListener('hashchange', router);
window.addEventListener('load', async () => { updateAuthUI(); await loadCoachProfile(); loadBanners(); startNotifPolling(); router(); });
// Re-sync notifications immediately when user switches back to this tab
document.addEventListener('visibilitychange', () => { if (!document.hidden && isLoggedIn()) loadNotifications(); });

// ═══════════════════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════════════════
let _homeLivePollTimer = null;

async function renderHome(app) {
  app.innerHTML = '<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [stats, newsData, liveMatches] = await Promise.all([
      GET('/stats'),
      GET('/news?limit=3'),
      GET('/matches?status=in_progress').catch(() => []),
    ]);

    const liveBlock = `<div id="home-live-section" style="margin-bottom:20px">${renderHomeLiveMatches(liveMatches)}</div>`;

    app.innerHTML = `
      ${liveBlock}
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${stats.totals.teams}</div><div class="stat-label">Teams</div></div>
        <div class="stat-card"><div class="stat-value">${stats.totals.players}</div><div class="stat-label">Players</div></div>
        <div class="stat-card"><div class="stat-value">${stats.totals.transfers}</div><div class="stat-label">Transfers</div></div>
        <div class="stat-card"><div class="stat-value">${fmtValue(stats.totals.transfer_value)}</div><div class="stat-label">Transfer Value</div></div>
      </div>
      ${newsData.rows.length ? `
      <div class="card mt-3 mb-3" style="margin-bottom:20px">
        <div class="card-header">📰 Последние новости <a href="#/news" style="font-size:12px;color:rgba(255,255,255,.7);font-weight:400;float:right">Все новости →</a></div>
        ${newsData.rows.map(n => `
          <div class="news-item">
            <div class="news-icon">${newsIcon(n.type)}</div>
            <div class="news-body">
              <div class="news-title">${escHtml(n.title)}</div>
              ${n.body ? `<div class="news-meta">${escHtml(n.body.substring(0,120))}${n.body.length>120?'…':''}</div>` : ''}
              <div class="news-meta">${fmtDate(n.created_at)}</div>
            </div>
          </div>
        `).join('')}
      </div>` : ''}
      <div class="two-col">
        <div class="card">
          <div class="card-header">⭐ Most Valuable Players</div>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Team</th><th class="text-right">Value</th></tr></thead>
            <tbody>
              ${stats.top_players.map((p,i) => `
                <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
                  <td class="text-muted">${i+1}</td>
                  <td><div class="flex-center gap-2">${avatarEl(p.image_url,p.name)}<div><div class="font-bold">${escHtml(p.name)}</div><div class="text-muted" style="font-size:11px">${p.flag_emoji||''}</div></div></div></td>
                  <td>${posBadge(p.position)}</td>
                  <td class="text-muted">${escHtml(p.team_name||'Free')}</td>
                  <td class="text-right" style="white-space:nowrap;font-size:12px;color:var(--green);font-weight:700">${fmtValue(p.market_value)}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-header">🏆 Most Valuable Teams</div>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Team</th><th>League</th><th class="text-right">Value</th></tr></thead>
            <tbody>
              ${stats.top_teams.map((t,i) => `
                <tr class="clickable-row" onclick="navigate('/teams/${t.id}')">
                  <td class="text-muted">${i+1}</td>
                  <td><div class="flex-center gap-2">${teamLogoEl(t.logo_url,t.name)}<span class="font-bold">${escHtml(t.name)}</span></div></td>
                  <td class="text-muted">${escHtml(t.competition_name||'–')}</td>
                  <td class="text-right mv">${fmtValue(t.market_value)}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
      ${stats.recent_transfers.length ? `
      <div class="card mt-3">
        <div class="card-header">🔄 Recent Transfers</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Player</th><th>From</th><th></th><th>To</th><th>Type</th><th class="text-right">Fee</th><th>Date</th></tr></thead>
          <tbody>
            ${stats.recent_transfers.map(tr=>`
              <tr class="clickable-row" onclick="navigate('/players/${tr.player_id}')">
                <td><div class="flex-center gap-2">${posBadge(tr.position)}<span>${escHtml(tr.player_name)}</span></div></td>
                <td class="text-muted">${escHtml(tr.from_team_name||'–')}</td>
                <td><span style="color:var(--green)">→</span></td>
                <td>${escHtml(tr.to_team_name||'–')}</td>
                <td>${ttypeBadge(tr.transfer_type)}</td>
                <td class="text-right transfer-fee">${tr.transfer_fee>0?fmtValue(tr.transfer_fee):'<span class="transfer-free">Free</span>'}</td>
                <td class="text-muted">${fmtDate(tr.transfer_date)}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
    `;

    // Poll live matches every 4 seconds while on the home page
    if (_homeLivePollTimer) clearInterval(_homeLivePollTimer);
    _homeLivePollTimer = setInterval(async () => {
      const sec = document.getElementById('home-live-section');
      if (!sec) { clearInterval(_homeLivePollTimer); _homeLivePollTimer = null; return; }
      const live = await GET('/matches?status=in_progress').catch(() => []);
      sec.innerHTML = renderHomeLiveMatches(live);
    }, 4000);

  } catch (err) { app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`; }
}

function renderHomeLiveMatches(matches) {
  if (!matches || !matches.length) return '';
  return `
    <div class="home-live-header">
      <span class="live-dot"></span> <span>LIVE</span>
      <span style="font-size:12px;color:var(--text-muted);margin-left:auto">${matches.length} ${matches.length === 1 ? 'матч' : matches.length < 5 ? 'матча' : 'матчей'}</span>
    </div>
    <div class="home-live-grid">
      ${matches.map(m => `
        <div class="home-live-card" onclick="navigate('/matches/${m.id}')">
          <div class="hlc-team">
            ${teamLogoEl(m.home_logo, m.home_team_name)}
            <span class="hlc-name">${escHtml(m.home_team_name)}</span>
          </div>
          <div class="hlc-score">
            <span class="hlc-score-val">${m.home_score ?? '–'} : ${m.away_score ?? '–'}</span>
            <span class="hlc-live-badge">🔴 LIVE</span>
            ${m.league_name ? `<span class="hlc-league">${escHtml(m.league_name)}</span>` : m.tournament_name ? `<span class="hlc-league">🏆 ${escHtml(m.tournament_name)}</span>` : m.is_friendly ? `<span class="hlc-league">⚑ Товарищеский</span>` : ''}
          </div>
          <div class="hlc-team hlc-team-right">
            ${teamLogoEl(m.away_logo, m.away_team_name)}
            <span class="hlc-name">${escHtml(m.away_team_name)}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  NEWS PAGE
// ═══════════════════════════════════════════════════════════
async function renderNewsPage(app) {
  app.innerHTML = '<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const data = await GET('/news?limit=50');
    app.innerHTML = `
      <div class="page-header"><h1 class="page-title">📰 Последние новости</h1></div>
      <div class="card">
        ${!data.rows.length ? '<div class="empty-state" style="padding:40px"><div class="empty-icon">📰</div><p>Новостей пока нет</p></div>' :
          data.rows.map(n => `
            <div class="news-item">
              <div class="news-icon">${newsIcon(n.type)}</div>
              <div class="news-body" style="flex:1">
                <div class="news-title">${escHtml(n.title)}</div>
                ${n.body ? `<div class="news-meta" style="margin-top:4px">${escHtml(n.body)}</div>` : ''}
                <div class="news-meta" style="margin-top:4px">
                  <span class="badge badge-green" style="font-size:10px">${n.type}</span>
                  ${n.author_name ? `✍️ ${escHtml(n.author_name)} · ` : ''}${fmtDate(n.created_at)}
                  ${n.match_id?`<a href="#/matches/${n.match_id}" style="color:var(--green)">Матч</a>`:''}
                  ${n.tournament_id?`<a href="#/tournaments/${n.tournament_id}" style="color:var(--green)">Турнир</a>`:''}
                </div>
              </div>
            </div>`).join('')}
      </div>`;
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

// ═══════════════════════════════════════════════════════════
//  TEAMS
// ═══════════════════════════════════════════════════════════
const POSITIONS = ['Goalkeeper','Centre-Back','Left-Back','Right-Back','Defensive Midfield','Central Midfield','Attacking Midfield','Left Winger','Right Winger','Centre-Forward','Striker'];

async function renderTeams(app, params) {
  app.innerHTML = '<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [teams, competitions] = await Promise.all([GET('/teams'), GET('/competitions')]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Teams <small>${teams.length} clubs</small></h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showTeamForm()">+ Добавить команду</button>`:''}
      </div>
      <div class="filters">
        <input type="search" id="team-search" placeholder="Search teams…" />
        <select id="team-comp-filter">
          <option value="">All Competitions</option>
          ${competitions.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Команда</th><th>Страна</th><th>Лига</th><th>Основан</th><th>Стадион</th><th class="text-right">Стоимость состава</th>${isAdmin()?'<th></th>':''}</tr></thead>
        <tbody id="teams-tbody"></tbody>
      </table></div></div>`;
    const renderRows = list => {
      const tbody = document.getElementById('teams-tbody');
      if (!list.length) { tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🏟️</div><p>No teams</p></div></td></tr>`; return; }
      tbody.innerHTML = list.map(t=>`
        <tr class="clickable-row" onclick="navigate('/teams/${t.id}')">
          <td><div class="flex-center gap-2">${teamLogoEl(t.logo_url,t.name)}<span class="font-bold">${escHtml(t.name)}</span></div></td>
          <td>${t.flag_emoji||''} ${escHtml(t.country_name||'–')}</td>
          <td>${escHtml(t.competition_name||'–')}</td>
          <td class="text-muted">${t.founded||'–'}</td>
          <td class="text-muted">${escHtml(t.stadium||'–')}</td>
          <td class="text-right mv">${fmtValue(t.market_value)}</td>
          ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showTeamForm(${JSON.stringify(t).replace(/"/g,'&quot;')})">✏️</button>
            <button class="btn-icon danger" onclick="deleteTeam(${t.id},'${escHtml(t.name)}')">🗑️</button>
          </td>`:''}
        </tr>`).join('');
    };
    renderRows(teams);
    const applyFilters = () => {
      const s = document.getElementById('team-search').value.toLowerCase();
      const c = document.getElementById('team-comp-filter').value;
      renderRows(teams.filter(t=>(!s||t.name.toLowerCase().includes(s)||(t.short_name||'').toLowerCase().includes(s))&&(!c||String(t.competition_id)===c)));
    };
    document.getElementById('team-search').addEventListener('input', applyFilters);
    document.getElementById('team-comp-filter').addEventListener('change', applyFilters);
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

async function showTeamForm(team) {
  const [countries, competitions] = await Promise.all([GET('/countries'), GET('/competitions')]);
  const isEdit = !!team;
  const modal = mkModal(isEdit?'Редактировать команду':'Добавить команду', `
    <div class="form-row">
      <div class="form-group"><label>Название команды *</label><input type="text" id="tf-name" value="${escHtml(team?.name||'')}"/></div>
      <div class="form-group"><label>Краткое название</label><input type="text" id="tf-short" value="${escHtml(team?.short_name||'')}" maxlength="10"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Страна</label><select id="tf-country"><option value="">–</option>${countries.map(c=>`<option value="${c.id}"${team?.country_id==c.id?' selected':''}>${c.flag_emoji||''} ${escHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Соревнование</label><select id="tf-comp"><option value="">–</option>${competitions.map(c=>`<option value="${c.id}"${team?.competition_id==c.id?' selected':''}>${escHtml(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Основан</label><input type="number" id="tf-founded" value="${team?.founded||''}"/></div>
      <div class="form-group"><label>Стадион</label><input type="text" id="tf-stadium" value="${escHtml(team?.stadium||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Рыночная стоимость (€)</label><input type="number" id="tf-mv" value="${team?.market_value||0}" step="100000"/></div>
      <div class="form-group"><label>URL логотипа</label><input type="text" id="tf-logo" value="${escHtml(team?.logo_url||'')}"/></div>
    </div>
    <div class="form-group"><label>Фото стадиона (URL)</label><input type="text" id="tf-stadium-url" value="${escHtml(team?.stadium_url||'')}"/></div>
  `, async () => {
    const payload = { name:document.getElementById('tf-name').value.trim(), short_name:document.getElementById('tf-short').value.trim(), country_id:document.getElementById('tf-country').value||null, competition_id:document.getElementById('tf-comp').value||null, founded:document.getElementById('tf-founded').value||null, stadium:document.getElementById('tf-stadium').value.trim(), market_value:parseFloat(document.getElementById('tf-mv').value)||0, logo_url:document.getElementById('tf-logo').value.trim()||null, stadium_url:document.getElementById('tf-stadium-url').value.trim()||null };
    if (!payload.name) { toast('Название обязательно','error'); return false; }
    if (isEdit) await PUT('/teams/'+team.id, payload); else await POST('/teams', payload);
    toast(isEdit?'Команда обновлена':'Команда добавлена');
  });
}
async function deleteTeam(id, name) {
  if (!confirm(`Delete team "${name}"?`)) return;
  try { await DEL('/teams/'+id); toast('Deleted'); router(); } catch(e){toast(e.message,'error');}
}

async function renderTeamDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const team = await GET('/teams/'+id);

    // ── Stats calculations ────────────────────────────────────
    const players = team.players || [];
    const ages = players.map(p => calcAge(p.date_of_birth)).filter(Boolean);
    const avgAge = ages.length ? (ages.reduce((a,b)=>a+b,0)/ages.length).toFixed(1) : '–';
    const foreigners = players.filter(p => p.nationality_id && p.nationality_id !== team.country_id).length;
    const foreignPct = players.length ? ((foreigners/players.length)*100).toFixed(1) : 0;
    const intlPlayers = players.filter(p => p.national_caps > 0 || p.national_team).length;
    const transfers = team.transfers || [];
    const income  = transfers.filter(t=>t.from_team_id===team.id).reduce((s,t)=>s+(t.transfer_fee||0),0);

    // ── OVR strength breakdown (admin only) ──────────────────
    const ATK_POS = new Set(['Centre-Forward','Striker','Left Winger','Right Winger','Attacking Midfield']);
    const MID_POS = new Set(['Central Midfield','Defensive Midfield']);
    const DEF_POS = new Set(['Centre-Back','Left-Back','Right-Back']);
    const GK_POS  = new Set(['Goalkeeper']);
    const lineAvg = pls => { const v = pls.map(p=>calcOverall(p)).filter(x=>x!==null); return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null; };
    const atkPl = players.filter(p=>ATK_POS.has(p.position||'')), midPl = players.filter(p=>MID_POS.has(p.position||''));
    const defPl = players.filter(p=>DEF_POS.has(p.position||'')), gkPl  = players.filter(p=>GK_POS.has(p.position||''));
    const atkOvr = lineAvg(atkPl), midOvr = lineAvg(midPl), defOvr = lineAvg(defPl), gkOvr = lineAvg(gkPl);
    const allOvrs = players.map(p=>calcOverall(p)).filter(x=>x!==null);
    const sqOvr = allOvrs.length ? Math.round(allOvrs.reduce((a,b)=>a+b,0)/allOvrs.length) : null;
    // Weighted attack/defense using simulator formula
    const A = atkOvr??sqOvr??60, M = midOvr??sqOvr??60, D = defOvr??sqOvr??60, G = gkOvr??sqOvr??60;
    const teamAtkStr = Math.round(A*0.55 + M*0.30 + D*0.10 + G*0.05);
    const teamDefStr = Math.round(D*0.45 + G*0.30 + M*0.20 + A*0.05);
    const ovrBar = (val, color='#16a34a') => val===null ? '–' :
      `<div style="display:flex;align-items:center;gap:6px">
        ${ovrBadge(val,null,null)}
        <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${val}%;background:${color};border-radius:3px"></div>
        </div>
      </div>`;
    const ovrPanel = sqOvr===null ? '<div style="color:var(--text-muted);font-size:12px">Нет данных по навыкам</div>' : `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="font-size:32px;font-weight:900;line-height:1;color:var(--green)">${sqOvr}</div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.4">Средний<br>OVR состава</div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-size:11px;color:var(--text-muted)">Атак. сила</div>
          <div style="font-weight:800;color:#e67e22">${teamAtkStr}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted)">Защ. сила</div>
          <div style="font-weight:800;color:#2980b9">${teamDefStr}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;font-size:12px">
        <div><span style="display:inline-block;width:80px;color:var(--text-muted)">🗡 Атака</span>${ovrBar(atkOvr,'#e67e22')}</div>
        <div><span style="display:inline-block;width:80px;color:var(--text-muted)">⚙ Полузащ.</span>${ovrBar(midOvr,'#8e44ad')}</div>
        <div><span style="display:inline-block;width:80px;color:var(--text-muted)">🛡 Защита</span>${ovrBar(defOvr,'#2980b9')}</div>
        <div><span style="display:inline-block;width:80px;color:var(--text-muted)">🧤 Вратарь</span>${ovrBar(gkOvr,'#27ae60')}</div>
      </div>`;
    const expense = transfers.filter(t=>t.to_team_id===team.id).reduce((s,t)=>s+(t.transfer_fee||0),0);
    const balance = income - expense;
    const balSign = balance>=0?'+':'';

    // ── Trophy strip ──────────────────────────────────────────
    const trophyStrip = (() => {
      if (!team.titles?.length) return '<span style="color:var(--text-muted);font-size:13px;font-style:italic">Пока нет титулов</span>';
      const groups = {};
      for (const t of team.titles) {
        const key = t.competition_id || t.title_name;
        if (!groups[key]) groups[key] = { t, count:0 };
        groups[key].count++;
      }
      return Object.values(groups).map(({t,count}) => {
        const img = t.trophy_url
          ? `<img src="${escHtml(t.trophy_url)}" class="trophy-icon-img" onerror="this.style.display='none'">`
          : `<span class="trophy-icon-emoji">🏆</span>`;
        return `<div class="trophy-chip" title="${escHtml(t.competition_name||t.title_name)}" onclick="document.querySelector('[data-tab=titles]').click()">
          <div class="trophy-chip-icon">${img}</div>
          <span class="trophy-chip-count">${count}</span>
        </div>`;
      }).join('') + `<span class="trophy-strip-more" onclick="document.querySelector('[data-tab=titles]').click()">›</span>`;
    })();

    const teamJson = JSON.stringify(team).replace(/"/g,'&quot;');

    app.innerHTML=`
      <h1 class="tp-title">${escHtml(team.name)}</h1>

      <div class="tp-header-card">
        <!-- Logo -->
        <div class="tp-logo-col">
          ${team.logo_url
            ? `<img src="${escHtml(team.logo_url)}" class="tp-logo-img" onerror="this.style.display='none'">`
            : `<div class="tp-logo-ph">${escHtml(team.name[0])}</div>`}
        </div>

        <!-- Center: trophy strip + stats -->
        <div class="tp-center-col">
          <div class="trophy-strip" style="margin-bottom:14px">${trophyStrip}</div>
          <div class="tp-stats-grid">
            <div class="tp-stat"><span class="tp-stat-key">Игроков в заявке:</span> <span class="tp-stat-val">${players.length}</span></div>
            <div class="tp-stat"><span class="tp-stat-key">Средний возраст:</span> <span class="tp-stat-val">${avgAge}</span></div>
            <div class="tp-stat"><span class="tp-stat-key">Легионеры:</span> <span class="tp-stat-val">${foreigners} <span style="color:var(--text-muted);font-weight:400">${players.length?foreignPct+'%':''}</span></span></div>
            ${intlPlayers?`<div class="tp-stat"><span class="tp-stat-key">Игроки сборных:</span> <span class="tp-stat-val">${intlPlayers}</span></div>`:''}
            ${team.stadium?`<div class="tp-stat"><span class="tp-stat-key">Стадион:</span> <span class="tp-stat-val">${escHtml(team.stadium)}</span></div>`:''}
            ${team.founded?`<div class="tp-stat"><span class="tp-stat-key">Основан:</span> <span class="tp-stat-val">${team.founded}</span></div>`:''}
            ${transfers.length?`<div class="tp-stat"><span class="tp-stat-key">Трансферный баланс:</span> <span class="tp-stat-val" style="color:${balance>=0?'#27ae60':'#e74c3c'}">${balSign}${fmtValue(balance)}</span></div>`:''}
          </div>
          ${isAdmin()?`<div style="margin-top:12px"><button class="btn btn-sm" style="background:var(--green);color:#fff;border:none" onclick="showTeamForm(${teamJson})">✏️ Редактировать</button></div>`:''}
        </div>

        <!-- Right: competition card -->
        <div class="tp-right-col">
          ${team.competition_name ? `
          <div class="tp-comp-card">
            ${team.competition_logo_url
              ? `<img src="${escHtml(team.competition_logo_url)}" class="tp-comp-logo" onerror="this.style.display='none'">`
              : ''}
            <div>
              <div class="tp-comp-name">${escHtml(team.competition_name)}</div>
              ${team.flag_emoji?`<div class="tp-comp-country">${team.flag_emoji} ${escHtml(team.country_name||'')}</div>`:''}
            </div>
          </div>` : ''}
          <div class="tp-mv-box">
            <div class="tp-mv-val">${fmtValueTM(team.market_value)}</div>
            <div class="tp-mv-label">Общая стоимость</div>
          </div>
          ${isAdmin() ? `<div class="tp-ovr-toggle-row">
            <span class="tp-ovr-toggle-label">Сила состава (OVR)</span>
            <label class="toggle-switch">
              <input type="checkbox" onchange="document.getElementById('tp-ovr-panel-${team.id}').style.display=this.checked?'block':'none'">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div id="tp-ovr-panel-${team.id}" class="tp-ovr-panel" style="display:none">${ovrPanel}</div>` : ''}
          ${isCoach() && State.coachProfile?.team_id && State.coachProfile.team_id !== team.id ? `
          <div style="margin-top:10px">
            <button class="btn btn-green" style="width:100%" onclick="showSendChallengeToTeam(${team.id},'${escHtml(team.name)}')">⚔️ Вызвать на матч</button>
          </div>` : ''}
        </div>
      </div>

      ${team.stadium_url ? `<div class="stadium-banner"><img src="${escHtml(team.stadium_url)}" alt="${escHtml(team.stadium||team.name)}" class="stadium-img"/><div class="stadium-label">🏟️ ${escHtml(team.stadium||'Стадион')}</div></div>` : ''}
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="squad">Состав (${team.players.length})</button>
        <button class="detail-tab" data-tab="formation">Расстановка</button>
        <button class="detail-tab" data-tab="about">О клубе</button>
        <button class="detail-tab" data-tab="kits">👕 Форма</button>
        <button class="detail-tab" data-tab="titles">Титулы (${team.titles.length})</button>
        <button class="detail-tab" data-tab="transfers">Трансферы</button>
        <button class="detail-tab" data-tab="matches">Матчи</button>
        <button class="detail-tab" data-tab="team-news">Новости</button>
      </div>
      <div id="tab-squad" class="tab-panel active">${renderSquadTab(team, isCoach() && State.coachProfile?.team_id === team.id)}</div>
      <div id="tab-formation" class="tab-panel"><div class="pitch-section" style="padding:20px"><div class="empty-state"><p>Загрузка…</p></div></div></div>
      <div id="tab-about" class="tab-panel">${renderAboutTab(team)}</div>
      <div id="tab-kits" class="tab-panel">${renderKitsTab(team, isCoach() && State.coachProfile?.team_id === team.id)}</div>
      <div id="tab-titles" class="tab-panel">${renderTitlesTab(team.titles,team.id,null)}</div>
      <div id="tab-transfers" class="tab-panel">${renderTransfersTab(team.transfers)}</div>
      <div id="tab-matches" class="tab-panel"><div class="empty-state"><p>Загрузка матчей…</p></div></div>
      <div id="tab-team-news" class="tab-panel"><div class="empty-state"><p>Загрузка…</p></div></div>
    `;
    setupTabs(app);
    // Lazy-load formation tab with lineup data (11 starters only)
    app.querySelector('[data-tab="formation"]').addEventListener('click', async () => {
      const panel = document.getElementById('tab-formation');
      if (panel.dataset.loaded) return;
      panel.dataset.loaded = '1';
      try {
        const ld = await GET('/lineups/'+id).catch(()=>({lineup:[]}));
        const slots = (ld.lineup||[]).filter(s=>s.slot<=11);
        panel.querySelector('.pitch-section').innerHTML = slots.length
          ? renderPitchFromLineup(slots, false)
          : renderPitch(team.players.filter((_,i)=>i<11));
      } catch { panel.querySelector('.pitch-section').innerHTML = '<div class="empty-state"><p>Ошибка загрузки</p></div>'; }
    }, { once: true });
    app.querySelector('[data-tab="matches"]').addEventListener('click', async () => {
      const panel = document.getElementById('tab-matches');
      if (panel.dataset.loaded) return;
      panel.dataset.loaded = '1';
      try {
        const matches = await GET('/matches?team_id='+id+'&limit=20');
        panel.innerHTML = renderMatchList(matches, id);
      } catch { panel.innerHTML = '<div class="empty-state"><p>Error loading matches</p></div>'; }
    }, { once: true });
    app.querySelector('[data-tab="team-news"]').addEventListener('click', async () => {
      const panel = document.getElementById('tab-team-news');
      if (panel.dataset.loaded) return;
      panel.dataset.loaded = '1';
      try {
        const data = await GET('/news?team_id='+id+'&limit=30');
        if (!data.rows.length) { panel.innerHTML = '<div class="empty-state"><div class="empty-icon">📰</div><p>Новостей пока нет</p></div>'; return; }
        panel.innerHTML = `<div class="card">${data.rows.map(n => `
          <div class="news-item">
            <div class="news-icon">${newsIcon(n.type)}</div>
            <div class="news-body">
              <div class="news-title">${escHtml(n.title)}</div>
              ${n.body ? `<div class="news-meta">${escHtml(n.body.substring(0,150))}${n.body.length>150?'…':''}</div>` : ''}
              <div class="news-meta">${n.author_name ? `✍️ ${escHtml(n.author_name)} · ` : ''}${fmtDate(n.created_at)}</div>
            </div>
          </div>`).join('')}</div>`;
      } catch { panel.innerHTML = '<div class="empty-state"><p>Error loading news</p></div>'; }
    }, { once: true });
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function renderAboutTab(team) {
  const hasContent = team.about_text || team.team_photo_url;
  const empty = `<div class="empty-state"><div class="empty-icon">🏟️</div><p>Информация о клубе пока не заполнена</p></div>`;
  if (!hasContent) return empty;
  return `
    ${team.team_photo_url ? `
      <div class="team-photo-block">
        <img src="${escHtml(team.team_photo_url)}" alt="${escHtml(team.name)}" class="team-panorama-img"/>
        <div class="team-photo-caption">📸 ${escHtml(team.name)}</div>
      </div>` : ''}
    ${team.about_text ? `
      <div class="card about-text-card">
        <div class="card-header">О клубе</div>
        <div class="card-body about-text-body">${escHtml(team.about_text).replace(/\n/g,'<br>')}</div>
      </div>` : ''}
  `;
}

function renderKitsTab(team, isOwnTeam) {
  const kits = [
    { key: 'kit_home_url',  label: '🟢 Домашняя', url: team.kit_home_url  },
    { key: 'kit_away_url',  label: '⬛ Гостевая',  url: team.kit_away_url  },
    { key: 'kit_third_url', label: '🔵 Третья',    url: team.kit_third_url },
  ];
  const editBtn = isOwnTeam
    ? `<div style="margin-bottom:16px"><button class="btn btn-sm btn-green" onclick="showKitsForm(${JSON.stringify(team).replace(/"/g,'&quot;')})">✏️ Редактировать форму</button></div>`
    : '';
  const cards = kits.map(k => `
    <div class="kit-card">
      <div class="kit-card-label">${k.label}</div>
      ${k.url
        ? `<img src="${escHtml(k.url)}" class="kit-card-img" alt="${k.label}" onerror="this.src='';this.style.display='none'">`
        : `<div class="kit-card-empty">Не задана</div>`}
    </div>`).join('');
  return `<div style="padding:12px 0">${editBtn}<div class="kits-grid">${cards}</div></div>`;
}

async function showKitsForm(team) {
  const teamJson = JSON.stringify(team).replace(/"/g,'&quot;');
  mkModal('👕 Комплекты формы', `
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:14px">Укажите URL-ссылки на изображения формы. Рекомендуемое разрешение: <strong>300×400px</strong>.</p>
    <div class="form-group"><label>🟢 Домашняя форма</label><input type="text" id="kit-home" value="${escHtml(team.kit_home_url||'')}" placeholder="https://…"/></div>
    <div class="form-group"><label>⬛ Гостевая форма</label><input type="text" id="kit-away" value="${escHtml(team.kit_away_url||'')}" placeholder="https://…"/></div>
    <div class="form-group"><label>🔵 Третья форма</label><input type="text" id="kit-third" value="${escHtml(team.kit_third_url||'')}" placeholder="https://…"/></div>
  `, async () => {
    const kit_home_url  = document.getElementById('kit-home').value.trim() || null;
    const kit_away_url  = document.getElementById('kit-away').value.trim() || null;
    const kit_third_url = document.getElementById('kit-third').value.trim() || null;
    await PUT('/teams/'+team.id, { ...team, kit_home_url, kit_away_url, kit_third_url });
    toast('Форма обновлена');
  });
}

let _squadState = { sort: 'market_value', dir: -1, posFilter: 'all', players: [], teamId: null, isOwnTeam: false };

function _squadPosGroup(pos) {
  if (!pos) return 'other';
  if (pos === 'Goalkeeper') return 'GK';
  if (pos.includes('Back') || pos === 'Centre-Back') return 'DEF';
  if (pos.includes('Midfield')) return 'MID';
  if (pos.includes('Winger') || pos.includes('Forward') || pos.includes('Striker')) return 'FWD';
  return 'other';
}

function squadFilter(group) {
  _squadState.posFilter = group;
  _refreshSquadTable();
}

function squadSort(field) {
  if (_squadState.sort === field) {
    _squadState.dir *= -1;
  } else {
    _squadState.sort = field;
    _squadState.dir = (field === 'market_value' || field === 'ovr') ? -1 : 1;
  }
  _refreshSquadTable();
}

function _refreshSquadTable() {
  const root = document.getElementById('squad-tab-root');
  if (!root) return;
  root.innerHTML = _buildSquadInner();
}

function _buildSquadInner() {
  const { sort, dir, posFilter, players, teamId, isOwnTeam } = _squadState;
  const showActions = isAdmin() || (isCoach() && isOwnTeam);

  const groups = ['all','GK','DEF','MID','FWD'];
  const groupLabels = { all:'Все', GK:'Вратари', DEF:'Защитники', MID:'Полузащитники', FWD:'Нападающие' };

  let filtered = players.filter(p => {
    if (posFilter === 'all') return true;
    return _squadPosGroup(p.position) === posFilter;
  });

  filtered = filtered.map(p => ({ ...p, _ovr: calcOverall(p) ?? -1 }));

  filtered.sort((a, b) => {
    let av, bv;
    if (sort === 'ovr') { av = a._ovr; bv = b._ovr; }
    else if (sort === 'market_value') { av = a.market_value || 0; bv = b.market_value || 0; }
    else if (sort === 'position') { av = _squadPosGroup(a.position); bv = _squadPosGroup(b.position); }
    else if (sort === 'name') { av = a.name || ''; bv = b.name || ''; }
    else if (sort === 'age') { av = a.date_of_birth || '9999'; bv = b.date_of_birth || '9999'; }
    else { av = a[sort] ?? ''; bv = b[sort] ?? ''; }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });

  const arrow = (field) => sort === field ? (dir > 0 ? ' ↑' : ' ↓') : '';
  const th = (field, label, cls='') =>
    `<th class="sortable-th${cls?' '+cls:''}" onclick="squadSort('${field}')" style="cursor:pointer;user-select:none">${label}${arrow(field)}</th>`;

  return `
    <div class="squad-controls">
      <div class="squad-filter-btns">
        ${groups.map(g=>`<button class="squad-filter-btn${posFilter===g?' active':''}" onclick="squadFilter('${g}')">${groupLabels[g]}</button>`).join('')}
      </div>
      <span class="squad-count">${filtered.length} игр.</span>
    </div>
    <div class="card" style="margin-top:8px">
      <div class="card-header">Состав ${isAdmin()?`<button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showPlayerForm(null,${teamId})">+ Добавить игрока</button>`:''}  </div>
      <div class="table-wrap"><table>
        <thead><tr>
          ${th('shirt_number','#')}
          ${th('name','Игрок')}
          <th>Нац.</th>
          ${th('position','Поз')}
          ${th('age','Возраст')}
          <th>Нога</th>
          ${th('ovr','OVR','text-right')}
          ${th('market_value','Ценность','text-right')}
          ${showActions?'<th></th>':''}
        </tr></thead>
        <tbody>
          ${filtered.length ? filtered.map(p=>`
            <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
              <td class="text-muted">${p.shirt_number||'–'}</td>
              <td><div class="flex-center gap-2">${avatarEl(p.image_url,p.name)}<span class="font-bold">${escHtml(p.name)}</span></div></td>
              <td>${p.flag_emoji||'–'}</td>
              <td>${posBadge(p.position)}</td>
              <td class="text-muted">${calcAge(p.date_of_birth)||'–'}</td>
              <td class="text-muted">${p.foot||'–'}</td>
              <td class="text-right">${ovrBadge(p._ovr === -1 ? null : p._ovr, null, null)||'–'}</td>
              <td class="text-right mv">${fmtValue(p.market_value)}</td>
              ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
                <button class="btn-icon" onclick="showPlayerForm(${JSON.stringify(p).replace(/"/g,'&quot;')})">✏️</button>
                <button class="btn-icon" onclick="showQuickTransfer(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Transfer">→</button>
                <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${escHtml(p.name)}')">🗑️</button>
              </td>`:(isCoach()&&isOwnTeam)?`<td onclick="event.stopPropagation()"><button class="btn-icon" onclick="showCoachPlayerEditForm(${JSON.stringify(p).replace(/"/g,'&quot;')})">✏️</button></td>`:''}
            </tr>`).join('') : `<tr><td colspan="${showActions?9:8}" class="text-muted" style="text-align:center;padding:24px">Нет игроков</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
}

function renderSquadTab(team, isOwnTeam = false) {
  _squadState = { sort: 'market_value', dir: -1, posFilter: 'all', players: team.players || [], teamId: team.id, isOwnTeam };
  if (!team.players.length) return `<div class="empty-state"><div class="empty-icon">⚽</div><p>Игроки отсутствуют</p></div>`;
  return `<div id="squad-tab-root">${_buildSquadInner()}</div>`;
}

async function showCoachPlayerEditForm(player) {
  const countries = await GET('/countries').catch(()=>[]);
  const POSITIONS = ['Goalkeeper','Centre-Back','Left-Back','Right-Back','Defensive Midfield','Central Midfield','Attacking Midfield','Left Winger','Right Winger','Centre-Forward'];
  mkModal('Редактировать игрока', `
    <div class="form-row">
      <div class="form-group"><label>Имя *</label><input type="text" id="cpe-name" value="${escHtml(player.name||'')}"/></div>
      <div class="form-group"><label>Номер</label><input type="number" id="cpe-shirt" value="${player.shirt_number||''}" min="1" max="10000" placeholder="1–10000"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Позиция</label>
        <select id="cpe-pos">
          <option value="">—</option>
          ${POSITIONS.map(pos=>`<option value="${pos}"${player.position===pos?' selected':''}>${pos}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Нога</label>
        <select id="cpe-foot">
          <option value="">—</option>
          <option value="Right"${player.foot==='Right'?' selected':''}>Правая</option>
          <option value="Left"${player.foot==='Left'?' selected':''}>Левая</option>
          <option value="Both"${player.foot==='Both'?' selected':''}>Обе</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Национальность</label>
      <select id="cpe-nat">
        <option value="">—</option>
        ${countries.map(c=>`<option value="${c.id}"${player.nationality_id==c.id?' selected':''}>${c.flag_emoji||''} ${escHtml(c.name)}</option>`).join('')}
      </select>
    </div>
  `, async () => {
    const name = document.getElementById('cpe-name').value.trim();
    const nationality_id = document.getElementById('cpe-nat').value||null;
    const shirt_number = parseInt(document.getElementById('cpe-shirt').value)||null;
    const position = document.getElementById('cpe-pos').value||null;
    const foot = document.getElementById('cpe-foot').value||null;
    if (!name) { toast('Имя обязательно','error'); return false; }
    if (shirt_number !== null && (shirt_number < 1 || shirt_number > 10000)) { toast('Номер должен быть от 1 до 10000','error'); return false; }
    await fetch('/api/players/'+player.id, {
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+State.token},
      body:JSON.stringify({name, nationality_id, shirt_number, position, foot}),
    }).then(r=>{if(!r.ok) throw new Error('Ошибка сохранения'); return r.json();});
    toast('Игрок обновлён');
  });
}

function renderTitlesTab(titles, teamId, playerId) {
  return `<div class="card">
    <div class="card-header">Titles & Honours ${isAdmin()?`<button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showTitleForm(null,${teamId||'null'},${playerId||'null'})">+ Add</button>`:''}  </div>
    ${!titles.length?`<div class="empty-state" style="padding:40px"><div class="empty-icon">🏆</div><p>No titles</p></div>`:`
    <div class="table-wrap"><table>
      <thead><tr><th>Title</th><th>Competition</th><th>Season</th><th>Year</th>${isAdmin()?'<th></th>':''}</tr></thead>
      <tbody>
        ${titles.map(t=>`<tr>
          <td class="font-bold">🏆 ${escHtml(t.title_name)}</td>
          <td class="text-muted">${escHtml(t.competition_name||'–')}</td>
          <td class="text-muted">${escHtml(t.season||'–')}</td>
          <td class="text-muted">${t.year||'–'}</td>
          ${isAdmin()?`<td style="white-space:nowrap">
            <button class="btn-icon" onclick="showTitleForm(${JSON.stringify(t).replace(/"/g,'&quot;')},${teamId||'null'},${playerId||'null'})">✏️</button>
            <button class="btn-icon danger" onclick="deleteTitle(${t.id})">🗑️</button>
          </td>`:''}
        </tr>`).join('')}
      </tbody>
    </table></div>`}
  </div>`;
}

function renderTransfersTab(transfers) {
  if (!transfers.length) return `<div class="empty-state"><div class="empty-icon">🔄</div><p>No transfers</p></div>`;
  return `<div class="card"><div class="card-header">Transfer History</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Player</th><th>From</th><th></th><th>To</th><th>Type</th><th class="text-right">Fee</th><th>Date</th></tr></thead>
      <tbody>${transfers.map(tr=>`
        <tr class="clickable-row" onclick="navigate('/players/${tr.player_id}')">
          <td class="font-bold">${escHtml(tr.player_name)}</td>
          <td class="text-muted">${escHtml(tr.from_team_name||'–')}</td>
          <td><span style="color:var(--green)">→</span></td>
          <td>${escHtml(tr.to_team_name||'–')}</td>
          <td>${ttypeBadge(tr.transfer_type)}</td>
          <td class="text-right">${tr.transfer_fee>0?fmtValue(tr.transfer_fee):'<span class="transfer-free">Free</span>'}</td>
          <td class="text-muted">${fmtDate(tr.transfer_date)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

function setupTabs(container) {
  container.querySelectorAll('.detail-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.detail-tab').forEach(b=>b.classList.remove('active'));
      container.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  PLAYERS
// ═══════════════════════════════════════════════════════════
async function renderPlayers(app, params) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [players, teams] = await Promise.all([GET('/players'), GET('/teams')]);
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Players <small>${players.length} registered</small></h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showPlayerForm()">+ Добавить игрока</button>`:''}
      </div>
      <div class="filters">
        <input type="search" id="player-search" placeholder="Search players…"/>
        <select id="player-pos-filter"><option value="">All Positions</option>${POSITIONS.map(p=>`<option value="${p}">${p}</option>`).join('')}</select>
        <select id="player-team-filter"><option value="">All Teams</option><option value="free">Free Agents</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select>
        <select id="player-status-filter"><option value="">All Status</option><option value="active">Active</option><option value="retired">Retired</option><option value="free_agent">Free Agent</option></select>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Игрок</th><th>Нац.</th><th>Позиция</th><th>Возраст</th><th>Команда</th><th>Нога</th><th class="text-right">OVR</th><th class="text-right">Ценность</th>${isAdmin()?'<th></th>':''}</tr></thead>
        <tbody id="players-tbody"></tbody>
      </table></div></div>`;
    const renderRows = list => {
      const tbody = document.getElementById('players-tbody');
      if (!list.length){tbody.innerHTML=`<tr><td colspan="${isAdmin()?10:9}"><div class="empty-state"><div class="empty-icon">⚽</div><p>Игроки отсутствуют</p></div></td></tr>`;return;}
      tbody.innerHTML = list.map(p=>`
        <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
          <td><div class="flex-center gap-2">${avatarEl(p.image_url,p.name)}<div><div class="font-bold">${escHtml(p.name)}</div>${p.status!=='active'?`<span class="badge badge-gray">${p.status}</span>`:''}</div></div></td>
          <td title="${escHtml(p.nationality_name||'')}">${p.flag_emoji||'–'}</td>
          <td>${posBadge(p.position)}</td>
          <td class="text-muted">${calcAge(p.date_of_birth)||'–'}</td>
          <td class="text-muted">${escHtml(p.team_name||'Free Agent')}</td>
          <td class="text-muted">${p.foot||'–'}</td>
          <td class="text-right">${ovrBadge(calcOverall(p), null, null)||'–'}</td>
          <td class="text-right mv">${fmtValue(p.market_value)}</td>
          ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showPlayerForm(${JSON.stringify(p).replace(/"/g,'&quot;')})">✏️</button>
            <button class="btn-icon" onclick="showQuickTransfer(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Transfer">→</button>
            <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${escHtml(p.name)}')">🗑️</button>
          </td>`:''}
        </tr>`).join('');
    };
    renderRows(players);
    const applyFilters=()=>{
      const s=document.getElementById('player-search').value.toLowerCase();
      const pos=document.getElementById('player-pos-filter').value;
      const tv=document.getElementById('player-team-filter').value;
      const st=document.getElementById('player-status-filter').value;
      renderRows(players.filter(p=>(!s||p.name.toLowerCase().includes(s))&&(!pos||p.position===pos)&&(!tv||(tv==='free'?!p.team_id:String(p.team_id)===tv))&&(!st||p.status===st)));
    };
    ['player-search','player-pos-filter','player-team-filter','player-status-filter'].forEach(id=>{
      document.getElementById(id).addEventListener('change',applyFilters);
      document.getElementById(id).addEventListener('input',applyFilters);
    });
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

async function showPlayerForm(player, defaultTeamId) {
  const [countries, teams] = await Promise.all([GET('/countries'), GET('/teams')]);
  const isEdit = !!player;
  mkModal(isEdit?'Редактировать игрока':'Добавить игрока', `
    <div class="form-row">
      <div class="form-group"><label>Имя *</label><input type="text" id="pf-name" value="${escHtml(player?.name||'')}"/></div>
      <div class="form-group"><label>Дата рождения</label><input type="date" id="pf-dob" value="${player?.date_of_birth?.substring(0,10)||''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Национальность</label><select id="pf-nat"><option value="">–</option>${countries.map(c=>`<option value="${c.id}"${player?.nationality_id==c.id?' selected':''}>${c.flag_emoji||''} ${escHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Позиция</label><select id="pf-pos"><option value="">–</option>${POSITIONS.map(p=>`<option value="${p}"${player?.position===p?' selected':''}>${p}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Команда</label><select id="pf-team"><option value="">Free Agent</option>${teams.map(t=>`<option value="${t.id}"${(player?.team_id||defaultTeamId)==t.id?' selected':''}>${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Номер</label><input type="number" id="pf-shirt" value="${player?.shirt_number||''}" min="1" max="10000"/></div>
    </div>
    <div class="form-row-3">
      <div class="form-group"><label>Нога</label><select id="pf-foot"><option value="">–</option><option value="Right"${player?.foot==='Right'?' selected':''}>Right</option><option value="Left"${player?.foot==='Left'?' selected':''}>Left</option><option value="Both"${player?.foot==='Both'?' selected':''}>Both</option></select></div>
      <div class="form-group"><label>Рост (см)</label><input type="number" id="pf-height" value="${player?.height||''}" min="140" max="220"/></div>
      <div class="form-group"><label>Статус</label><select id="pf-status"><option value="active"${(!player?.status||player.status==='active')?' selected':''}>Active</option><option value="retired"${player?.status==='retired'?' selected':''}>Retired</option><option value="free_agent"${player?.status==='free_agent'?' selected':''}>Free Agent</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Рыночная стоимость (€)</label><input type="number" id="pf-mv" value="${player?.market_value||0}" min="0" step="100000"/></div>
      <div class="form-group"><label>URL фото</label><input type="text" id="pf-img" value="${escHtml(player?.image_url||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Место рождения</label><input type="text" id="pf-birthplace" value="${escHtml(player?.birthplace||'')}"/></div>
      <div class="form-group"><label>Контракт до</label><input type="date" id="pf-contract" value="${player?.contract_until?.substring(0,10)||''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Сборная</label><input type="text" id="pf-natteam" value="${escHtml(player?.national_team||'')}" placeholder="Россия"/></div>
      <div class="form-group"><label>Матчи / голы (сборная)</label><div style="display:flex;gap:8px"><input type="number" id="pf-caps" value="${player?.national_caps||0}" min="0" style="width:80px"/> / <input type="number" id="pf-natgoals" value="${player?.national_goals||0}" min="0" style="width:80px"/></div></div>
    </div>
  `, async () => {
    const payload = {
      name:document.getElementById('pf-name').value.trim(),
      date_of_birth:document.getElementById('pf-dob').value||null,
      nationality_id:document.getElementById('pf-nat').value||null,
      position:document.getElementById('pf-pos').value||null,
      foot:document.getElementById('pf-foot').value||null,
      height:parseInt(document.getElementById('pf-height').value)||null,
      team_id:document.getElementById('pf-team').value||null,
      shirt_number:parseInt(document.getElementById('pf-shirt').value)||null,
      market_value:parseFloat(document.getElementById('pf-mv').value)||0,
      image_url:document.getElementById('pf-img').value.trim()||null,
      status:document.getElementById('pf-status').value,
      birthplace:document.getElementById('pf-birthplace').value.trim()||null,
      contract_until:document.getElementById('pf-contract').value||null,
      national_team:document.getElementById('pf-natteam').value.trim()||null,
      national_caps:parseInt(document.getElementById('pf-caps').value)||0,
      national_goals:parseInt(document.getElementById('pf-natgoals').value)||0,
    };
    if (!payload.name){toast('Имя обязательно','error');return false;}
    if (payload.shirt_number !== null && (payload.shirt_number < 1 || payload.shirt_number > 10000)){toast('Номер должен быть от 1 до 10000','error');return false;}
    if (isEdit) await PUT('/players/'+player.id, payload); else await POST('/players', payload);
    toast(isEdit?'Игрок обновлён':'Игрок добавлен');
  });
}
async function deletePlayer(id, name) {
  if (!confirm(`Delete player "${name}"?`)) return;
  try { await DEL('/players/'+id); toast('Deleted'); router(); } catch(e){toast(e.message,'error');}
}

async function renderPlayerDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const player = await GET('/players/'+id);
    const age = calcAge(player.date_of_birth);
    let achRows = [], careerStats = null, playerSkills = null;
    try { const r = await GET('/players/'+id+'/achievements'); achRows = r; } catch{}
    try { careerStats = await GET('/players/'+id+'/career-stats'); } catch{}
    try { playerSkills = await GET('/players/'+id+'/skills'); } catch{}

    // ── Trophy strip: group titles by competition ─────────────────────────
    const titlesStrip = (() => {
      if (!player.titles?.length) return '';
      const groups = {};
      for (const t of player.titles) {
        const key = t.competition_id || t.title_name;
        if (!groups[key]) groups[key] = { title: t, count: 0 };
        groups[key].count++;
      }
      const chips = Object.values(groups).map(g => {
        const img = g.title.trophy_url
          ? `<img src="${escHtml(g.title.trophy_url)}" class="trophy-icon-img" onerror="this.style.display='none'">`
          : `<span class="trophy-icon-emoji">🏆</span>`;
        return `<div class="trophy-chip" title="${escHtml(g.title.competition_name||g.title.title_name)} (${g.count}x)" onclick="document.querySelector('[data-tab=titles]').click()">
          <div class="trophy-chip-icon">${img}</div>
          <span class="trophy-chip-count">${g.count}</span>
        </div>`;
      }).join('');
      return `<div class="trophy-strip">${chips}<span class="trophy-strip-more" onclick="document.querySelector('[data-tab=titles]').click()">›</span></div>`;
    })();

    // ── Bio rows ──────────────────────────────────────────────────────────
    const fmtDob = (dob) => {
      if (!dob) return '–';
      const d = new Date(dob);
      return d.toLocaleDateString('ru-RU', {day:'2-digit',month:'short',year:'numeric'}).replace(' г.','') + (age ? ` (${age})` : '');
    };
    const fmtHeight = h => h ? `${(h/100).toFixed(2).replace('.',',')} м` : '–';
    const fmtContract = d => {
      if (!d) return '–';
      return new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'});
    };
    const joinedDate = (() => {
      const tr = (player.transfers||[]).filter(t=>t.to_team_id===player.team_id).sort((a,b)=>new Date(b.transfer_date)-new Date(a.transfer_date));
      if (!tr.length) return null;
      return new Date(tr[0].transfer_date).toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'});
    })();
    const lastMvDate = player.market_value_history?.at(-1)?.recorded_at;

    const bioRows = [
      ['Род./возраст', fmtDob(player.date_of_birth)],
      player.birthplace ? ['Место рождения', escHtml(player.birthplace)] : null,
      ['Национальность', player.flag_emoji ? `${player.flag_emoji} ${escHtml(player.nationality_name||'–')}` : (escHtml(player.nationality_name||'–'))],
      player.height ? ['Рост', fmtHeight(player.height)] : null,
      player.sub_position||player.position ? ['Амплуа', escHtml(player.sub_position||player.position||'–')] : null,
      player.foot ? ['Нога', escHtml(player.foot)] : null,
      player.national_team ? ['Сборная', escHtml(player.national_team)] : null,
      (player.national_caps||player.national_goals) ? ['Матчи/голы (сборная)', `${player.national_caps||0} / ${player.national_goals||0}`] : null,
    ].filter(Boolean);

    const playerJson = JSON.stringify(player).replace(/"/g,'&quot;');
    const actionBtns = isAdmin()
      ? `<div class="pp-actions">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="showPlayerForm(${playerJson})">✏️ Редактировать</button>
          <button class="btn btn-green" onclick="showQuickTransfer(${playerJson})">→ Перевести</button>
        </div>`
      : isCoach()&&player.team_id!==State.coachProfile?.team_id
        ? `<div class="pp-actions"><button class="btn btn-green" onclick="showQuickOffer(${playerJson})">📨 Предложить трансфер</button><button class="btn btn-outline" onclick="showSwapOfferForm(${playerJson},${State.coachProfile?.team_id})">🔄 Обмен</button></div>`
        : '';

    app.innerHTML=`
      <div class="pp-wrap">
        <!-- LEFT: photo -->
        <div class="pp-photo-col">
          <div class="pp-photo-frame">
            ${player.image_url
              ? `<img src="${escHtml(player.image_url)}" class="pp-photo" onerror="this.src=''">`
              : `<div class="pp-photo-placeholder">${escHtml(player.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase())}</div>`}
          </div>
        </div>

        <!-- CENTER: name + bio -->
        <div class="pp-center-col">
          <div class="pp-name-row">
            ${player.shirt_number?`<span class="pp-shirt">#${player.shirt_number}</span>`:''}
            <h1 class="pp-name">${escHtml(player.name)}</h1>
          </div>
          ${titlesStrip}
          <table class="pp-bio-table">
            ${bioRows.map(([k,v])=>`<tr><td class="pp-bio-key">${k}</td><td class="pp-bio-val">${v}</td></tr>`).join('')}
          </table>
          ${actionBtns}
        </div>

        <!-- RIGHT: team card + MV -->
        <div class="pp-right-col">
          ${player.team_id ? `
          <div class="pp-team-card">
            <a href="#/teams/${player.team_id}" class="pp-team-logo-link">
              ${player.team_logo_url
                ? `<img src="${escHtml(player.team_logo_url)}" class="pp-team-logo-big" onerror="this.style.display='none'">`
                : `<div class="pp-team-logo-ph-big">${escHtml((player.team_name||'?')[0])}</div>`}
            </a>
            ${player.competition_name?`<div class="pp-comp-name" style="text-align:center;margin-top:6px">${escHtml(player.competition_name)}</div>`:''}
            ${joinedDate?`<div class="pp-team-row"><span>В команде с:</span><span>${joinedDate}</span></div>`:''}
            ${player.contract_until?`<div class="pp-team-row"><span>Контракт до:</span><span>${fmtContract(player.contract_until)}</span></div>`:''}
          </div>` : `<div class="pp-team-card"><div style="color:var(--text-muted);font-size:13px">🔓 Свободный агент</div></div>`}

          <div class="pp-mv-box">
            <div class="pp-mv-value">${fmtValue(player.market_value)}</div>
            ${lastMvDate?`<div class="pp-mv-label">Последнее изменение: ${new Date(lastMvDate).toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'})}</div>`:''}
          </div>
        </div>
      </div>

      <div class="detail-tabs" style="margin-top:20px">
        <button class="detail-tab active" data-tab="stats">Статистика</button>
        <button class="detail-tab" data-tab="transfers">Трансферы</button>
        <button class="detail-tab" data-tab="titles">Титулы (${player.titles?.length||0})</button>
        <button class="detail-tab" data-tab="achievements">Достижения (${achRows.length})</button>
        <button class="detail-tab" data-tab="market">История стоимости</button>
      </div>
      <div id="tab-stats" class="tab-panel active"><div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">${renderPentagonChart(playerSkills, player.position)}<div style="flex:1;min-width:260px">${renderPlayerCareerStats(careerStats, player.position)}</div></div></div>
      <div id="tab-transfers" class="tab-panel">${renderTransfersTab(player.transfers)}</div>
      <div id="tab-titles" class="tab-panel">${renderTitlesTab(player.titles,null,player.id)}</div>
      <div id="tab-achievements" class="tab-panel">${renderAchievementsTab(achRows)}</div>
      <div id="tab-market" class="tab-panel">${renderMarketHistoryTab(player)}</div>
    `;
    setupTabs(app);
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function renderAchievementsTab(achievements) {
  if (!achievements.length) return `<div class="empty-state"><div class="empty-icon">🏅</div><p>No achievements yet</p></div>`;
  const typeLabel = { hat_trick:'Hat-trick', brace:'Brace', man_of_the_match:'Man of the Match', clean_sheet:'Clean Sheet', tournament_winner:'Tournament Winner' };
  return `<div class="card"><div class="card-header">Career Achievements</div>
    ${achievements.map(a=>`
      <div class="achievement-item">
        <div class="ach-icon">${achIcon(a.achievement_type)}</div>
        <div class="ach-info">
          <div class="ach-type">${typeLabel[a.achievement_type]||a.achievement_type.replace(/_/g,' ')}</div>
          ${a.description?`<div class="ach-desc">${escHtml(a.description)}</div>`:''}
          <div class="ach-date">${fmtDate(a.created_at)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function renderPlayerCareerStats(cs, position) {
  if (!cs || cs.matches_played === 0) {
    return `<div class="empty-state"><div class="empty-icon">📊</div><p>No match appearances yet</p></div>`;
  }
  const r = cs.avg_rating;
  const rCls = r >= 7.5 ? 'high' : r >= 6 ? 'mid' : 'low';
  const gpm  = cs.matches_played > 0 ? (cs.total_goals / cs.matches_played).toFixed(2) : '0.00';
  const apm  = cs.matches_played > 0 ? (cs.total_assists / cs.matches_played).toFixed(2) : '0.00';
  const isGK = position === 'Goalkeeper';
  return `<div class="career-stats-card">
    <div class="cs-rating-block">
      <div class="cs-rating-big ${rCls}">${r ? r.toFixed(2) : '–'}</div>
      <div class="cs-rating-meta">
        <div><span class="rm-label">Average Rating</span></div>
        <div><span class="rm-label">Matches Played:</span> <span class="rm-val">${cs.matches_played}</span></div>
        <div><span class="rm-label">Best Rating:</span> <span class="rm-val">${cs.best_rating || '–'}</span></div>
      </div>
    </div>
    <div class="cs-grid">
      ${isGK ? '' : `<div class="cs-stat"><div class="sv">${cs.total_goals}</div><div class="sl">Goals</div></div>`}
      ${isGK ? '' : `<div class="cs-stat"><div class="sv">${cs.total_assists}</div><div class="sl">Assists</div></div>`}
      ${isGK ? '' : `<div class="cs-stat"><div class="sv">${cs.total_goals + cs.total_assists}</div><div class="sl">G+A</div></div>`}
      ${isGK ? `<div class="cs-stat"><div class="sv">${cs.clean_sheets}</div><div class="sl">Clean Sheets</div></div>` : ''}
      <div class="cs-stat"><div class="sv">${gpm}</div><div class="sl">${isGK ? 'GA/Game' : 'Goals/Game'}</div></div>
      ${isGK ? '' : `<div class="cs-stat"><div class="sv">${apm}</div><div class="sl">Assists/Game</div></div>`}
      <div class="cs-stat"><div class="sv" style="color:#f39c12">${cs.total_yellow_cards}</div><div class="sl">Yellow Cards</div></div>
      <div class="cs-stat"><div class="sv" style="color:#e74c3c">${cs.total_red_cards}</div><div class="sl">Red Cards</div></div>
      <div class="cs-stat"><div class="sv">${cs.motm_awards}</div><div class="sl">MOTM Awards</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600">CAREER ACHIEVEMENTS</div>
    <div class="cs-ach-row">
      ${cs.hat_tricks ? `<div class="cs-ach-chip">🎩 ${cs.hat_tricks} Hat-trick${cs.hat_tricks>1?'s':''}</div>` : ''}
      ${cs.braces ? `<div class="cs-ach-chip">⚽⚽ ${cs.braces} Brace${cs.braces>1?'s':''}</div>` : ''}
      ${cs.motm_awards ? `<div class="cs-ach-chip">🌟 ${cs.motm_awards} MOTM</div>` : ''}
      ${cs.clean_sheets && !isGK ? `<div class="cs-ach-chip">🧤 ${cs.clean_sheets} Clean Sheet${cs.clean_sheets>1?'s':''}</div>` : ''}
      ${cs.tournament_wins ? `<div class="cs-ach-chip">🏆 ${cs.tournament_wins} Tournament Win${cs.tournament_wins>1?'s':''}</div>` : ''}
      ${(!cs.hat_tricks && !cs.braces && !cs.motm_awards && !cs.clean_sheets && !cs.tournament_wins) ? '<span style="color:var(--text-muted);font-size:12px">None yet</span>' : ''}
    </div>
  </div>`;
}

function renderPentagonChart(skills, position) {
  if (!skills) return '<div class="empty-state"><p>Skills data not available</p></div>';
  const isGK = position === 'Goalkeeper';
  const labels = isGK
    ? ['Reflexes', 'Positioning', 'Kicking', 'Handling', 'Aerial']
    : ['Pace', 'Shooting', 'Passing', 'Defending', 'Physical'];
  const values = [skills.pace, skills.shooting, skills.passing, skills.defending, skills.physical];

  const cx = 110, cy = 110, rMax = 80, rLabel = 100;
  const N = 5;

  function pt(r, i) {
    const a = (Math.PI * 2 * i / N) - Math.PI / 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  const rings = [0.25, 0.5, 0.75, 1.0].map(pct => {
    const pts = Array.from({length:N}, (_,i) => pt(rMax * pct, i));
    return pts.map((p,i) => `${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z';
  });

  const axes = Array.from({length:N}, (_,i) => {
    const p = pt(rMax, i);
    return `M${cx},${cy} L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  });

  const skillPts = values.map((v, i) => pt(rMax * Math.min(99, Math.max(1, v||50)) / 99, i));
  const skillPath = skillPts.map((p,i) => `${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z';

  const labelPts = Array.from({length:N}, (_,i) => pt(rLabel, i));
  const textAnchors = ['middle', 'start', 'start', 'end', 'end'];

  const svgH = 220, svgW = 220;

  return `<div class="pentagon-wrap">
    <svg viewBox="0 0 ${svgW} ${svgH}" class="pentagon-svg">
      ${rings.map(d => `<path d="${d}" fill="none" stroke="var(--border)" stroke-width="1"/>`).join('')}
      ${axes.map(d => `<path d="${d}" stroke="var(--border)" stroke-width="1"/>`).join('')}
      <path d="${skillPath}" fill="rgba(39,174,96,.25)" stroke="var(--green)" stroke-width="2"/>
      ${skillPts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--green)"/>`).join('')}
      ${labelPts.map((p, i) => `
        <text x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}"
          text-anchor="${textAnchors[i]}"
          font-size="9" fill="var(--text-muted)" font-family="sans-serif">${labels[i]}</text>
        <text x="${p.x.toFixed(1)}" y="${(p.y + 5).toFixed(1)}"
          text-anchor="${textAnchors[i]}"
          font-size="11" fill="var(--text)" font-weight="700" font-family="sans-serif">${values[i] || 50}</text>
      `).join('')}
    </svg>
  </div>`;
}

function renderMarketHistoryTab(player) {
  const hist = player.market_value_history || [];
  if (!hist.length) return `<div class="empty-state"><div class="empty-icon">📈</div><p>No market value history</p></div>`;

  const W = 480, H = 140;
  const PAD = { top: 16, right: 16, bottom: 28, left: 60 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  const vals = hist.map(h => h.market_value);
  const maxV = Math.max(...vals) * 1.15;
  const minV = Math.min(0, ...vals) * 0.9;
  const dates = hist.map(h => new Date(h.recorded_at).getTime());
  const minD = Math.min(...dates), maxD = Math.max(...dates);

  const toX = ts => PAD.left + (maxD === minD ? iW/2 : iW * (ts - minD) / (maxD - minD));
  const toY = v  => PAD.top  + iH * (1 - (v - minV) / (maxV - minV || 1));

  const pts = hist.map((h, i) => ({ x: toX(dates[i]), y: toY(h.market_value), v: h.market_value, d: h.recorded_at }));
  const linePath = pts.map((p,i) => `${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = pts.length > 1
    ? `${linePath} L${pts[pts.length-1].x.toFixed(1)},${(PAD.top+iH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.top+iH).toFixed(1)} Z`
    : '';

  const yTicks = [0, 0.5, 1].map(pct => {
    const v = minV + (maxV - minV) * (1 - pct);
    const y = PAD.top + iH * pct;
    return { v, y };
  });

  const chartHtml = `<div class="mv-chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" class="mv-chart-svg">
      <defs>
        <linearGradient id="mvGrad${player.id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#27ae60" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#27ae60" stop-opacity=".03"/>
        </linearGradient>
      </defs>
      ${yTicks.map(t => `<line x1="${PAD.left}" y1="${t.y.toFixed(1)}" x2="${W-PAD.right}" y2="${t.y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`).join('')}
      ${yTicks.map(t => `<text x="${PAD.left-6}" y="${(t.y+4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)" font-family="sans-serif">${fmtValue(t.v)}</text>`).join('')}
      ${areaPath ? `<path d="${areaPath}" fill="url(#mvGrad${player.id})"/>` : ''}
      <path d="${linePath}" fill="none" stroke="#27ae60" stroke-width="2.5" stroke-linejoin="round"/>
      ${pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#27ae60" stroke="var(--surface)" stroke-width="1.5"><title>${fmtValue(p.v)} · ${fmtDate(p.d)}</title></circle>`).join('')}
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top+iH}" stroke="var(--border)" stroke-width="1"/>
      <line x1="${PAD.left}" y1="${PAD.top+iH}" x2="${W-PAD.right}" y2="${PAD.top+iH}" stroke="var(--border)" stroke-width="1"/>
    </svg>
  </div>`;

  return `<div class="card"><div class="card-header">Market Value History</div>
    <div class="card-body">${chartHtml}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="text-right">Value</th></tr></thead>
      <tbody>${[...hist].reverse().slice(0,10).map(h=>`<tr><td class="text-muted">${fmtDate(h.recorded_at)}</td><td class="text-right mv">${fmtValue(h.market_value)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

async function showQuickTransfer(player) {
  const teams = await GET('/teams');
  const otherTeams = teams.filter(t => t.id !== player.team_id);
  mkModal('Перевод игрока', `
    <div class="player-card" style="margin-bottom:16px;background:var(--bg-card);border-radius:8px;padding:12px">
      ${avatarEl(player.image_url, player.name)}
      <div class="pc-info">
        <div class="pc-name">${escHtml(player.name)}</div>
        <div>${posBadge(player.position)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${fmtValue(player.market_value)}${player.team_name?' · '+escHtml(player.team_name):''}</div>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Назначение в новой команде</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button id="role-starter" onclick="selectQtRole('starter')" class="qt-role-btn" style="padding:14px 8px;border:2px solid var(--border);border-radius:8px;background:none;cursor:pointer;transition:all .15s;text-align:center">
          <div style="font-size:22px">🏟</div>
          <div style="font-weight:700;font-size:13px;margin-top:4px">Основной состав</div>
          <div style="font-size:11px;color:var(--text-muted)">Постоянный трансфер</div>
        </button>
        <button id="role-reserve" onclick="selectQtRole('reserve')" class="qt-role-btn" style="padding:14px 8px;border:2px solid var(--border);border-radius:8px;background:none;cursor:pointer;transition:all .15s;text-align:center">
          <div style="font-size:22px">📋</div>
          <div style="font-weight:700;font-size:13px;margin-top:4px">Запасные</div>
          <div style="font-size:11px;color:var(--text-muted)">Аренда / резерв</div>
        </button>
      </div>
    </div>
    <div class="form-group">
      <label>Команда назначения *</label>
      <select id="qt-team"><option value="">Выберите команду…</option>${otherTeams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Сумма (€)</label><input type="number" id="qt-fee" value="${player.market_value||0}" step="100000" min="0"/></div>
      <div class="form-group"><label>Дата</label><input type="date" id="qt-date" value="${new Date().toISOString().substring(0,10)}"/></div>
    </div>
  `, async () => {
    const toTeamId = parseInt(document.getElementById('qt-team').value);
    const fee = parseFloat(document.getElementById('qt-fee').value)||0;
    const date = document.getElementById('qt-date').value;
    const role = window._qtRole;
    if (!toTeamId) { toast('Выберите команду назначения', 'error'); return false; }
    if (!role) { toast('Выберите назначение: основной состав или запасные', 'error'); return false; }
    const transferType = role === 'reserve' ? 'loan' : 'permanent';
    await PUT('/players/'+player.id, { ...player, team_id: toTeamId });
    await POST('/transfers', { player_id: player.id, from_team_id: player.team_id||null, to_team_id: toTeamId, transfer_fee: fee, transfer_date: date, transfer_type: transferType });
    try {
      const lineupData = await GET('/lineups/'+toTeamId);
      const existing = lineupData.lineup || [];
      const starters = existing.filter(s => s.slot >= 1 && s.slot <= 11);
      const reserves = existing.filter(s => s.slot >= 12);
      if (role === 'starter' && starters.length < 11) {
        const used = new Set(starters.map(s => s.slot));
        let slot = 1; while (used.has(slot)) slot++;
        await PUT('/lineups/'+toTeamId, { lineup: [...existing, { slot, player_id: player.id, position_override: posToZone(player.position) }] });
      } else if (reserves.length < 11) {
        const used = new Set(reserves.map(s => s.slot));
        let slot = 12; while (used.has(slot)) slot++;
        await PUT('/lineups/'+toTeamId, { lineup: [...existing, { slot, player_id: player.id, position_override: null }] });
      }
    } catch {}
    toast('Трансфер завершён!'); window._qtRole = null; navigate('/players/'+player.id);
  });
  window._qtRole = null;
}

function selectQtRole(role) {
  window._qtRole = role;
  ['starter','reserve'].forEach(r => {
    const el = document.getElementById('role-'+r);
    if (!el) return;
    el.style.borderColor = r === role ? 'var(--green)' : 'var(--border)';
    el.style.background  = r === role ? 'rgba(46,204,113,.12)' : 'none';
    el.style.color       = r === role ? 'var(--green)' : '';
  });
}

async function showQuickOffer(player) {
  mkModal('Предложить трансфер', `
    <div class="player-card" style="margin-bottom:16px;background:var(--bg-card);border-radius:8px;padding:12px">
      ${avatarEl(player.image_url, player.name)}
      <div class="pc-info">
        <div class="pc-name">${escHtml(player.name)}</div>
        <div>${posBadge(player.position)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${fmtValue(player.market_value)}${player.team_name?' · '+escHtml(player.team_name):''}</div>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Роль в вашей команде</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button id="qo-role-starter" onclick="selectQoRole('buy')" class="qt-role-btn" style="padding:14px 8px;border:2px solid var(--border);border-radius:8px;background:none;cursor:pointer;transition:all .15s;text-align:center">
          <div style="font-size:22px">🏟</div>
          <div style="font-weight:700;font-size:13px;margin-top:4px">Основной состав</div>
          <div style="font-size:11px;color:var(--text-muted)">Покупка</div>
        </button>
        <button id="qo-role-reserve" onclick="selectQoRole('loan')" class="qt-role-btn" style="padding:14px 8px;border:2px solid var(--border);border-radius:8px;background:none;cursor:pointer;transition:all .15s;text-align:center">
          <div style="font-size:22px">📋</div>
          <div style="font-weight:700;font-size:13px;margin-top:4px">Запасные</div>
          <div style="font-size:11px;color:var(--text-muted)">Аренда</div>
        </button>
      </div>
    </div>
    <div class="form-group"><label>Сумма предложения (€) *</label>
      <input type="number" id="qo-amount" value="${player.market_value||0}" step="100000" min="0"/>
    </div>
    <div class="form-group"><label>Сообщение (необязательно)</label>
      <textarea id="qo-msg" rows="2" placeholder="Добавьте сообщение тренеру…"></textarea>
    </div>
  `, async () => {
    const amount = parseFloat(document.getElementById('qo-amount').value)||0;
    const offer_type = window._qoOfferType || 'buy';
    const message = document.getElementById('qo-msg').value.trim()||null;
    if (!amount) { toast('Укажите сумму предложения', 'error'); return false; }
    if (!window._qoOfferType) { toast('Выберите роль игрока в команде', 'error'); return false; }
    await POST('/transfer-offers', { to_team_id: player.team_id, player_id: player.id, offer_type, amount, loan_months: 6, message });
    toast('Предложение отправлено!'); window._qoOfferType = null;
  });
  window._qoOfferType = null;
}

function selectQoRole(type) {
  window._qoOfferType = type;
  const ids = { buy: 'qo-role-starter', loan: 'qo-role-reserve' };
  Object.entries(ids).forEach(([t, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const active = t === type;
    el.style.borderColor = active ? 'var(--green)' : 'var(--border)';
    el.style.background  = active ? 'rgba(46,204,113,.12)' : 'none';
    el.style.color       = active ? 'var(--green)' : '';
  });
}

async function showSwapOfferForm(targetPlayer, coachTeamId) {
  const myTeam = await GET('/teams/' + coachTeamId);
  const myPlayers = (myTeam.players || []).filter(p => p.id !== targetPlayer.id);
  mkModal('Предложить обмен', `
    <div style="margin-bottom:12px;padding:10px;background:var(--bg-darker);border-radius:6px">
      <strong>Запрашиваемый игрок:</strong> ${escHtml(targetPlayer.name)} (${fmtValue(targetPlayer.market_value)})
    </div>
    <div class="form-group">
      <label>Ваш игрок *</label>
      <select id="swap-my-player">
        <option value="">— выберите игрока —</option>
        ${myPlayers.map(p => `<option value="${p.id}">${escHtml(p.name)} (${posBadge(p.position)}) — ${fmtValue(p.market_value)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Доплата (положительная = вы платите, отрицательная = они платят)</label>
      <input type="number" id="swap-cash" value="0" step="100000" placeholder="0"/>
    </div>
    <div class="form-group">
      <label>Сообщение</label>
      <input type="text" id="swap-msg" placeholder="Необязательно…"/>
    </div>
  `, async () => {
    const swapPlayerId = document.getElementById('swap-my-player').value;
    const cash = parseFloat(document.getElementById('swap-cash').value) || 0;
    const msg = document.getElementById('swap-msg').value.trim() || null;
    if (!swapPlayerId) { toast('Выберите вашего игрока', 'error'); return false; }
    await POST('/transfer-offers', {
      to_team_id: targetPlayer.team_id,
      player_id: targetPlayer.id,
      swap_player_id: parseInt(swapPlayerId),
      offer_type: 'swap',
      amount: cash,
      message: msg,
    });
    toast('Предложение обмена отправлено');
  });
}

async function showTitleForm(title, teamId, playerId) {
  const competitions = await GET('/competitions');
  const isEdit = !!title;
  mkModal(isEdit?'Edit Title':'Add Title', `
    <div class="form-group"><label>Title Name *</label><input type="text" id="titf-name" value="${escHtml(title?.title_name||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Competition</label><select id="titf-comp"><option value="">–</option>${competitions.map(c=>`<option value="${c.id}"${title?.competition_id==c.id?' selected':''}>${escHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Year</label><input type="number" id="titf-year" value="${title?.year||new Date().getFullYear()}"/></div>
    </div>
    <div class="form-group"><label>Season</label><input type="text" id="titf-season" value="${escHtml(title?.season||'')}" placeholder="2024/25"/></div>
  `, async () => {
    const payload = { title_name:document.getElementById('titf-name').value.trim(), competition_id:document.getElementById('titf-comp').value||null, year:parseInt(document.getElementById('titf-year').value)||null, season:document.getElementById('titf-season').value.trim()||null, team_id:teamId||null, player_id:playerId||null };
    if (!payload.title_name){toast('Title name required','error');return false;}
    if (isEdit) await PUT('/titles/'+title.id, payload); else await POST('/titles', payload);
    toast(isEdit?'Updated':'Added');
  });
}
async function deleteTitle(id) { if (!confirm('Delete title?')) return; try { await DEL('/titles/'+id); toast('Deleted'); router(); } catch(e){toast(e.message,'error');} }

// ─── Loan form ────────────────────────────────────────────────
async function showLoanForm(player) {
  const teams = await GET('/teams');
  mkModal('Loan Out: '+escHtml(player.name), `
    <div class="form-row">
      <div class="form-group"><label>Parent Club (From)</label><select id="lf-from"><option value="">– None –</option>${teams.map(t=>`<option value="${t.id}"${player?.team_id==t.id?' selected':''}>${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Loan Club (To) *</label><select id="lf-to"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Loan Fee (€/month)</label><input type="number" id="lf-fee" value="0" step="10000"/></div>
      <div class="form-group"><label>Start Date</label><input type="date" id="lf-start" value="${new Date().toISOString().substring(0,10)}"/></div>
    </div>
    <div class="form-group"><label>End Date</label><input type="date" id="lf-end"/></div>
  `, async () => {
    const to = document.getElementById('lf-to').value;
    if (!to){toast('Loan club required','error');return false;}
    await POST('/loans', { player_id:player.id, from_team_id:document.getElementById('lf-from').value||null, to_team_id:to, loan_fee:parseFloat(document.getElementById('lf-fee').value)||0, start_date:document.getElementById('lf-start').value||null, end_date:document.getElementById('lf-end').value||null });
    toast('Loan recorded');
  });
}

// ═══════════════════════════════════════════════════════════
//  COMPETITIONS
// ═══════════════════════════════════════════════════════════
async function renderCompetitions(app, params) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [competitions, countries] = await Promise.all([GET('/competitions'), GET('/countries')]);
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Competitions <small>${competitions.length} total</small></h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showCompForm(null)">+ Add Competition</button>`:''}
      </div>
      <div class="filters">
        <input type="search" id="comp-search" placeholder="Search…"/>
        <select id="comp-type-filter"><option value="">All Types</option><option value="league">League</option><option value="cup">Cup</option><option value="international">International</option></select>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Competition</th><th>Country</th><th>Type</th>${isAdmin()?'<th></th>':''}</tr></thead>
        <tbody id="comp-tbody"></tbody>
      </table></div></div>`;
    const renderRows = list => {
      const tbody = document.getElementById('comp-tbody');
      if (!list.length){tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">🏆</div><p>No competitions</p></div></td></tr>`;return;}
      tbody.innerHTML=list.map(c=>`
        <tr class="clickable-row" onclick="navigate('/competitions/${c.id}')">
          <td class="font-bold">${escHtml(c.name)}</td>
          <td>${c.flag_emoji||''} ${escHtml(c.country_name||'–')}</td>
          <td><span class="badge badge-green">${c.type||'league'}</span></td>
          ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showCompForm(${JSON.stringify(c).replace(/"/g,'&quot;')})">✏️</button>
            <button class="btn-icon danger" onclick="deleteComp(${c.id},'${escHtml(c.name)}')">🗑️</button>
          </td>`:''}
        </tr>`).join('');
    };
    renderRows(competitions);
    const applyF=()=>{const s=document.getElementById('comp-search').value.toLowerCase();const t=document.getElementById('comp-type-filter').value;renderRows(competitions.filter(c=>(!s||c.name.toLowerCase().includes(s))&&(!t||c.type===t)));};
    document.getElementById('comp-search').addEventListener('input',applyF);
    document.getElementById('comp-type-filter').addEventListener('change',applyF);
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

async function renderCompetitionDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const comp = await GET('/competitions/'+id);
    app.innerHTML=`
      <div class="detail-hero" style="gap:20px">
        <div class="hero-info"><h1>🏆 ${escHtml(comp.name)}</h1><div class="meta">${comp.flag_emoji?`<span>${comp.flag_emoji} ${escHtml(comp.country_name)}</span>`:''}<span class="badge badge-green">${comp.type}</span></div></div>
        ${isAdmin()?`<div style="margin-left:auto"><button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showCompForm(${JSON.stringify(comp).replace(/"/g,'&quot;')})">Edit</button></div>`:''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="teams">Teams (${comp.teams.length})</button>
        <button class="detail-tab" data-tab="titles">Winners (${comp.titles.length})</button>
      </div>
      <div id="tab-teams" class="tab-panel active">
        <div class="card"><div class="card-header">Teams</div>
          ${!comp.teams.length?`<div class="empty-state" style="padding:40px"><p>No teams</p></div>`:`
          <div class="table-wrap"><table>
            <thead><tr><th>Team</th><th>Country</th><th class="text-right">Value</th></tr></thead>
            <tbody>${comp.teams.map(t=>`<tr class="clickable-row" onclick="navigate('/teams/${t.id}')"><td><div class="flex-center gap-2">${teamLogoEl(t.logo_url,t.name)}<span class="font-bold">${escHtml(t.name)}</span></div></td><td>${t.flag_emoji||''} ${escHtml(t.country_name||'–')}</td><td class="text-right mv">${fmtValue(t.market_value)}</td></tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      </div>
      <div id="tab-titles" class="tab-panel">
        <div class="card"><div class="card-header">Past Winners</div>
          ${!comp.titles.length?`<div class="empty-state" style="padding:40px"><div class="empty-icon">🏆</div><p>None recorded</p></div>`:`
          <div class="table-wrap"><table>
            <thead><tr><th>Year</th><th>Season</th><th>Winner</th></tr></thead>
            <tbody>${comp.titles.map(t=>`<tr><td class="font-bold">${t.year||'–'}</td><td class="text-muted">${escHtml(t.season||'–')}</td><td>${t.team_name?`<a href="#/teams/${t.team_id}" class="text-green font-bold">${escHtml(t.team_name)}</a>`:'–'}</td></tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      </div>
    `;
    setupTabs(app);
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

async function showCompForm(comp) {
  const countries = await GET('/countries');
  const isEdit = !!comp;
  mkModal(isEdit?'Edit Competition':'Add Competition', `
    <div class="form-group"><label>Name *</label><input type="text" id="cf-name" value="${escHtml(comp?.name||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Country</label><select id="cf-country"><option value="">– International –</option>${countries.map(c=>`<option value="${c.id}"${comp?.country_id==c.id?' selected':''}>${c.flag_emoji||''} ${escHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Type</label><select id="cf-type"><option value="league"${comp?.type==='league'?' selected':''}>League</option><option value="cup"${comp?.type==='cup'?' selected':''}>Cup</option><option value="international"${comp?.type==='international'?' selected':''}>International</option></select></div>
    </div>
    <div class="form-group"><label>URL логотипа лиги</label><input type="text" id="cf-logo" value="${escHtml(comp?.logo_url||'')}" placeholder="https://…"/></div>
    <div class="form-group">
      <label>URL кубка/трофея <small style="color:var(--text-muted)">(показывается в профиле победителей)</small></label>
      <input type="text" id="cf-trophy" value="${escHtml(comp?.trophy_url||'')}" placeholder="https://…"/>
      ${comp?.trophy_url?`<img src="${escHtml(comp.trophy_url)}" style="height:48px;margin-top:6px;object-fit:contain" onerror="this.style.display='none'">`:''}
    </div>
  `, async () => {
    const payload={
      name:document.getElementById('cf-name').value.trim(),
      country_id:document.getElementById('cf-country').value||null,
      type:document.getElementById('cf-type').value,
      logo_url:document.getElementById('cf-logo').value.trim()||null,
      trophy_url:document.getElementById('cf-trophy').value.trim()||null,
    };
    if(!payload.name){toast('Name required','error');return false;}
    if(isEdit) await PUT('/competitions/'+comp.id,payload); else await POST('/competitions',payload);
    toast(isEdit?'Updated':'Added');
  });
}
async function deleteComp(id,name){if(!confirm(`Delete "${name}"?`))return;try{await DEL('/competitions/'+id);toast('Deleted');router();}catch(e){toast(e.message,'error');}}

// ═══════════════════════════════════════════════════════════
//  TRANSFERS PAGE
// ═══════════════════════════════════════════════════════════
async function renderTransfers(app, params) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [transfers, teams, loans] = await Promise.all([GET('/transfers?limit=100'), GET('/teams'), GET('/loans')]);
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Трансферы</h1>
        ${isAdmin()?`<div style="display:flex;gap:8px"><button class="btn btn-green" onclick="showTransferFormStandalone()">+ Transfer</button><button class="btn btn-outline btn-green" onclick="showLoanFormStandalone()">+ Loan</button></div>`:''}
      </div>
      <div class="detail-tabs" style="margin-bottom:16px">
        <button class="detail-tab active" data-tab="tr-transfers">Transfers (${transfers.length})</button>
        <button class="detail-tab" data-tab="tr-loans">Active Loans (${loans.filter(l=>l.status==='active').length})</button>
      </div>
      <div id="tab-tr-transfers" class="tab-panel active">
        <div class="filters">
          <input type="search" id="tr-search" placeholder="Search player…"/>
          <select id="tr-team-filter"><option value="">All Teams</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select>
          <select id="tr-type-filter"><option value="">All Types</option><option value="permanent">Permanent</option><option value="loan">Loan</option><option value="free">Free</option><option value="youth">Youth</option></select>
        </div>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Player</th><th>Pos</th><th>From</th><th></th><th>To</th><th>Type</th><th class="text-right">Fee</th><th>Date</th>${isAdmin()?'<th></th>':''}</tr></thead>
          <tbody id="tr-tbody"></tbody>
        </table></div></div>
      </div>
      <div id="tab-tr-loans" class="tab-panel">
        <div class="card"><div class="card-header">Active Loans</div>
          ${!loans.filter(l=>l.status==='active').length?`<div class="empty-state" style="padding:40px"><div class="empty-icon">🔗</div><p>No active loans</p></div>`:`
          <div class="table-wrap"><table>
            <thead><tr><th>Player</th><th>From</th><th>To</th><th>Fee/mo</th><th>Until</th><th>Status</th>${isAdmin()?'<th></th>':''}</tr></thead>
            <tbody>${loans.filter(l=>l.status==='active').map(l=>`
              <tr>
                <td class="font-bold">${posBadge(l.position)} ${escHtml(l.player_name)}</td>
                <td class="text-muted">${escHtml(l.from_team_name||'–')}</td>
                <td>${escHtml(l.to_team_name)}</td>
                <td>${l.loan_fee>0?fmtValue(l.loan_fee):'–'}</td>
                <td class="text-muted">${fmtDate(l.end_date)}</td>
                <td><span class="loan-active">● Active</span></td>
                ${isAdmin()?`<td style="white-space:nowrap">
                  <button class="btn btn-sm btn-outline" onclick="endLoan(${l.id})">End Loan</button>
                  <button class="btn-icon danger" onclick="deleteLoan(${l.id})">🗑️</button>
                </td>`:''}
              </tr>`).join('')}
            </tbody>
          </table></div>`}
        </div>
      </div>
    `;
    setupTabs(app);
    const renderRows=list=>{
      const tbody=document.getElementById('tr-tbody');
      if(!list.length){tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🔄</div><p>No transfers</p></div></td></tr>`;return;}
      tbody.innerHTML=list.map(tr=>`
        <tr class="clickable-row" onclick="navigate('/players/${tr.player_id}')">
          <td class="font-bold">${escHtml(tr.player_name)}</td>
          <td>${posBadge(tr.position)}</td>
          <td class="text-muted">${escHtml(tr.from_team_name||'–')}</td>
          <td><span style="color:var(--green)">→</span></td>
          <td>${escHtml(tr.to_team_name||'–')}</td>
          <td>${ttypeBadge(tr.transfer_type)}</td>
          <td class="text-right">${tr.transfer_fee>0?fmtValue(tr.transfer_fee):'<span class="transfer-free">Free</span>'}</td>
          <td class="text-muted">${fmtDate(tr.transfer_date)}</td>
          ${isAdmin()?`<td onclick="event.stopPropagation()"><button class="btn-icon danger" onclick="deleteTransfer(${tr.id})">🗑️</button></td>`:''}
        </tr>`).join('');
    };
    renderRows(transfers);
    const applyF=()=>{const s=document.getElementById('tr-search').value.toLowerCase();const t=document.getElementById('tr-team-filter').value;const tp=document.getElementById('tr-type-filter').value;renderRows(transfers.filter(tr=>(!s||tr.player_name.toLowerCase().includes(s))&&(!t||String(tr.from_team_id)===t||String(tr.to_team_id)===t)&&(!tp||tr.transfer_type===tp)));};
    ['tr-search','tr-team-filter','tr-type-filter'].forEach(id=>{document.getElementById(id)?.addEventListener('change',applyF);document.getElementById(id)?.addEventListener('input',applyF);});
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

async function showTransferFormStandalone() {
  const [players, teams] = await Promise.all([GET('/players'), GET('/teams')]);
  mkModal('Record Transfer', `
    <div class="form-group"><label>Player *</label><select id="trf2-player"><option value="">–</option>${players.map(p=>`<option value="${p.id}">${escHtml(p.name)} (${escHtml(p.team_name||'Free')})</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>From</label><select id="trf2-from"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>To</label><select id="trf2-to"><option value="">Free Agent</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Fee (€)</label><input type="number" id="trf2-fee" value="0" step="100000"/></div>
      <div class="form-group"><label>Date</label><input type="date" id="trf2-date" value="${new Date().toISOString().substring(0,10)}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Type</label><select id="trf2-type"><option value="permanent">Permanent</option><option value="loan">Loan</option><option value="free">Free</option><option value="youth">Youth</option></select></div>
      <div class="form-group"><label>Notes</label><input type="text" id="trf2-notes"/></div>
    </div>
  `, async ()=>{
    const pid=document.getElementById('trf2-player').value;if(!pid){toast('Select player','error');return false;}
    await POST('/transfers',{player_id:pid,from_team_id:document.getElementById('trf2-from').value||null,to_team_id:document.getElementById('trf2-to').value||null,transfer_fee:parseFloat(document.getElementById('trf2-fee').value)||0,transfer_date:document.getElementById('trf2-date').value||null,transfer_type:document.getElementById('trf2-type').value,notes:document.getElementById('trf2-notes').value.trim()||null});
    toast('Recorded');
  });
}

async function showLoanFormStandalone() {
  const [players, teams] = await Promise.all([GET('/players'), GET('/teams')]);
  mkModal('Record Loan', `
    <div class="form-group"><label>Player *</label><select id="lfst-player"><option value="">–</option>${players.map(p=>`<option value="${p.id}">${escHtml(p.name)} (${escHtml(p.team_name||'Free')})</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>From (Parent Club)</label><select id="lfst-from"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>To (Loan Club) *</label><select id="lfst-to"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Fee/month (€)</label><input type="number" id="lfst-fee" value="0" step="10000"/></div>
      <div class="form-group"><label>Start Date</label><input type="date" id="lfst-start" value="${new Date().toISOString().substring(0,10)}"/></div>
    </div>
    <div class="form-group"><label>End Date</label><input type="date" id="lfst-end"/></div>
  `, async ()=>{
    const pid=document.getElementById('lfst-player').value;const to=document.getElementById('lfst-to').value;
    if(!pid||!to){toast('Player and loan club required','error');return false;}
    await POST('/loans',{player_id:pid,from_team_id:document.getElementById('lfst-from').value||null,to_team_id:to,loan_fee:parseFloat(document.getElementById('lfst-fee').value)||0,start_date:document.getElementById('lfst-start').value||null,end_date:document.getElementById('lfst-end').value||null});
    toast('Loan recorded');
  });
}

async function endLoan(id){if(!confirm('End loan and return player?'))return;try{await PUT('/loans/'+id+'/end');toast('Loan ended');router();}catch(e){toast(e.message,'error');}}
async function deleteLoan(id){if(!confirm('Delete loan record?'))return;try{await DEL('/loans/'+id);toast('Deleted');router();}catch(e){toast(e.message,'error');}}
async function deleteTransfer(id){if(!confirm('Delete transfer?'))return;try{await DEL('/transfers/'+id);toast('Deleted');router();}catch(e){toast(e.message,'error');}}

// ═══════════════════════════════════════════════════════════
//  MATCHES
// ═══════════════════════════════════════════════════════════
async function renderMatches(app, params) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [matches, teams] = await Promise.all([GET('/matches?limit=50'), GET('/teams')]);
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Matches</h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showMatchForm()">+ Schedule Match</button>`:''}
      </div>
      <div class="filters">
        <select id="m-status-filter"><option value="">All Status</option><option value="scheduled">Scheduled</option><option value="finished">Finished</option></select>
        <select id="m-team-filter"><option value="">All Teams</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select>
      </div>
      <div id="matches-list"></div>`;
    const renderList=list=>{
      const el=document.getElementById('matches-list');
      if(!list.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">⚽</div><p>No matches found</p></div>`;return;}
      el.innerHTML=list.map(m=>matchCardHtml(m)).join('');
    };
    renderList(matches);
    const applyF=()=>{const s=document.getElementById('m-status-filter').value;const t=document.getElementById('m-team-filter').value;renderList(matches.filter(m=>(!s||m.status===s)&&(!t||String(m.home_team_id)===t||String(m.away_team_id)===t)));};
    document.getElementById('m-status-filter').addEventListener('change',applyF);
    document.getElementById('m-team-filter').addEventListener('change',applyF);
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function matchCardHtml(m) {
  const statusCls = m.status==='finished'?'match-status-finished':m.status==='in_progress'?'match-status-live':'match-status-scheduled';
  const scoreStr = m.status==='finished' ? `${m.home_score} – ${m.away_score}` : m.status==='in_progress' ? '🔴 LIVE' : 'vs';
  const stadiumBg = m.home_stadium_url
    ? `background-image:linear-gradient(rgba(0,0,0,0.55),rgba(0,0,0,0.55)),url('${escHtml(m.home_stadium_url)}');background-size:cover;background-position:center;`
    : '';
  return `<div class="match-card" onclick="navigate('/matches/${m.id}')" style="${stadiumBg}">
    <div class="mc-team">
      ${teamLogoXL(m.home_logo,m.home_team_name)}
      <span class="mc-team-name">${escHtml(m.home_team_name)}</span>
    </div>
    <div class="mc-score">
      ${m.tournament_name?`<div style="margin-bottom:4px"><span class="badge badge-gold">${escHtml(m.tournament_name)}</span></div>`:''}
      ${m.is_friendly?`<div style="margin-bottom:4px"><span class="badge badge-gray">⚑ Товарищеский</span></div>`:''}
      <div class="mc-score-val">${scoreStr}</div>
      <div><span class="match-status-badge ${statusCls}">${m.status}</span></div>
      ${m.match_date?`<div class="mc-date">${fmtDate(m.match_date)}</div>`:''}
    </div>
    <div class="mc-team mc-team-right">
      ${teamLogoXL(m.away_logo,m.away_team_name)}
      <span class="mc-team-name">${escHtml(m.away_team_name)}</span>
    </div>
  </div>`;
}

function renderMatchList(matches, highlightTeamId) {
  if (!matches.length) return `<div class="empty-state"><div class="empty-icon">⚽</div><p>No matches</p></div>`;
  return matches.map(m => matchCardHtml(m)).join('');
}

async function renderMatchDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const match = await GET('/matches/'+id);
    const isFinished = match.status === 'finished' || match.status === 'overtime';
    const isLive = match.status === 'in_progress';
    const canSimulate = !isFinished && !isLive &&
      (isAdmin() || (isCoach() && match.is_friendly &&
        (match.home_team_id === State.coachProfile?.team_id || match.away_team_id === State.coachProfile?.team_id)));

    const stadiumStyle = match.home_stadium_url
      ? `background-image:linear-gradient(rgba(0,0,0,0.55),rgba(0,0,0,0.55)),url('${escHtml(match.home_stadium_url)}');background-size:cover;background-position:center;`
      : '';

    const initHome = isFinished ? match.home_score : (isLive ? match.home_score : '0');
    const initAway = isFinished ? match.away_score : (isLive ? match.away_score : '0');
    const clockInit = isFinished ? `90'` : (isLive ? `${match.live_minute}'` : (match.match_date ? fmtDate(match.match_date) : '–'));
    const badgeCls = isFinished ? 'match-status-finished' : (isLive ? 'match-status-live' : 'match-status-scheduled');
    const badgeTxt = isFinished ? 'FINISHED' : (isLive ? 'LIVE' : match.status);

    app.innerHTML=`
      <div class="scoreboard" id="scoreboard" style="${stadiumStyle}">
        <div class="score-teams">
          <div class="score-team">
            ${teamLogoXL(match.home_logo,match.home_team_name)}
            <div class="score-team-name">${escHtml(match.home_team_name)}</div>
          </div>
          <div class="score-center">
            <div class="score-display">
              <div class="score-value" id="score-home">${initHome}</div>
              <div class="score-sep">–</div>
              <div class="score-value" id="score-away">${initAway}</div>
            </div>
            <span class="match-status-badge ${badgeCls}" id="match-status-badge">${badgeTxt}</span>
          </div>
          <div class="score-team">
            ${teamLogoXL(match.away_logo,match.away_team_name)}
            <div class="score-team-name">${escHtml(match.away_team_name)}</div>
          </div>
        </div>
        <div class="match-clock">
          <span class="clock-min" id="match-clock">⏱ ${clockInit}</span>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${match.tournament_name?`<span class="badge badge-gold">🏆 ${escHtml(match.tournament_name)}</span>`:''}
        ${match.league_name?`<span class="badge badge-blue" style="display:flex;align-items:center;gap:5px">${match.league_logo_url?`<img src="${escHtml(match.league_logo_url)}" style="height:14px;width:auto;object-fit:contain">`:''}${escHtml(match.league_name)}</span>`:''}
        ${match.is_friendly?`<span class="badge badge-gray">⚑ Товарищеский</span>`:''}
        ${canSimulate?`<button class="btn-simulate" id="btn-sim" onclick="startMatchSimulation(${id})">▶ Начать матч</button>`:''}
      </div>
      ${match.challengeMessage ? `<div class="challenge-match-banner"><span class="challenge-match-icon">⚔️</span><span class="challenge-match-text">«${escHtml(match.challengeMessage.text)}»</span>${match.challengeMessage.from_team_name?`<span class="challenge-match-from">— ${escHtml(match.challengeMessage.from_team_name)}</span>`:''}</div>` : ''}
      <div class="detail-tabs" id="match-tabs">
        <button class="detail-tab active" data-tab="m-events">📋 Events</button>
        <button class="detail-tab" data-tab="m-ratings">👤 Ratings</button>
        ${isFinished?`<button class="detail-tab" data-tab="m-fullstats">📊 Stats</button>`:''}
        ${isFinished?`<button class="detail-tab" data-tab="m-formations">🏟️ Formations</button>`:''}
      </div>
      <div id="tab-m-events" class="tab-panel active">
        <div class="event-log" id="event-log">
          ${isFinished ? renderEventLog(match.events) : (isLive ? renderEventLog(match.events) : '<div style="padding:40px;text-align:center;color:var(--text-muted)">Матч ещё не начался</div>')}
        </div>
      </div>
      <div id="tab-m-ratings" class="tab-panel">
        ${isFinished&&match.stats.length?renderMatchPlayerRatings(match.stats,match.home_team_id,match.away_team_id):'<div class="empty-state"><p>Stats available after match</p></div>'}
      </div>
      ${isFinished?`<div id="tab-m-fullstats" class="tab-panel">${renderMatchFullStats(match.fullStats, match.home_team_name, match.away_team_name)}</div>`:''}
      ${isFinished?`<div id="tab-m-formations" class="tab-panel"><div id="match-formations-panel"><div class="empty-state"><p>Loading formations…</p></div></div></div>`:''}
    `;
    setupTabs(app);
    // Lazy-load formations tab
    if (isFinished) {
      app.querySelector('[data-tab="m-formations"]')?.addEventListener('click', async () => {
        const panel = document.getElementById('match-formations-panel');
        if (panel.dataset.loaded) return;
        panel.dataset.loaded = '1';
        try {
          const [homeLineup, awayLineup] = await Promise.all([
            GET('/lineups/'+match.home_team_id).catch(()=>({lineup:[]})),
            GET('/lineups/'+match.away_team_id).catch(()=>({lineup:[]})),
          ]);
          const homeSlots = (homeLineup.lineup||[]).filter(s=>s.slot<=11);
          const awaySlots = (awayLineup.lineup||[]).filter(s=>s.slot<=11);
          panel.innerHTML = `<div style="padding:16px;max-width:380px;margin:0 auto">
            ${renderCombinedMatchPitch(homeSlots, awaySlots, match.stats, match.home_team_name, match.away_team_name)}
          </div>`;
        } catch { panel.innerHTML = '<div class="empty-state"><p>Ошибка загрузки составов</p></div>'; }
      }, { once: true });
    }
    // Auto-start live polling for anyone watching an in-progress match
    if (isLive) {
      startLiveMatchPoll(id);
    }
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function renderEventLog(events) {
  if (!events.length) return '<div style="padding:40px;text-align:center;color:var(--text-muted)">No events</div>';
  let html = '';
  let htShown = false;
  for (const e of events) {
    if (!htShown && e.minute > 45) { html += `<div class="halftime-divider">⏸ Перерыв</div>`; htShown = true; }
    const isBuild = e.event_type === 'buildup';
    html += `<div class="event-log-item event-${e.event_type}${isBuild?' ev-buildup':''}">
      <span class="ev-min">${e.minute}'</span>
      <span class="ev-icon">${eventIcon(e.event_type)}</span>
      <span class="ev-desc">${escHtml(e.description||'')}</span>
    </div>`;
  }
  return html;
}

function renderMatchPlayerRatings(stats, homeId, awayId) {
  if (!stats.length) return '<div class="empty-state"><p>No rating data</p></div>';
  const top = stats;
  return `<div class="card"><div class="card-header">Player Ratings</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Player</th><th>G</th><th>A</th><th>YC</th><th>RC</th><th>Rating</th></tr></thead>
      <tbody>${top.map(s=>{
        const rc = ratingColor(s.rating);
        const pct = (s.rating/10*100).toFixed(0);
        return `<tr class="clickable-row" onclick="navigate('/players/${s.player_id}')">
          <td><div class="flex-center gap-2">${avatarEl(s.image_url,s.player_name)}<span class="font-bold">${escHtml(s.player_name)}</span></div></td>
          <td>${s.goals||0}</td><td>${s.assists||0}</td>
          <td>${s.yellow_cards?'🟨':''}</td><td>${s.red_cards?'🟥':''}</td>
          <td><div class="rating-bar"><span class="rb-val ${rc}">${s.rating.toFixed(1)}</span><div class="rb-bg"><div class="rb-fill" style="width:${pct}%"></div></div></div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}

function renderMatchFullStats(ms, homeName, awayName) {
  if (!ms) return `<div class="empty-state"><p>Match statistics not available</p></div>`;
  function row(homeVal, label, awayVal) {
    return `<div class="match-stat-row">
      <div class="msr-val home">${homeVal}</div>
      <div class="msr-label">${label}</div>
      <div class="msr-val away">${awayVal}</div>
    </div>`;
  }
  return `<div class="card"><div class="card-header">Match Statistics</div>
    <div class="card-body">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:4px">
        <span style="color:var(--green)">${escHtml(homeName)}</span>
        <span style="color:#e74c3c">${escHtml(awayName)}</span>
      </div>
      <div class="poss-bar">
        <div class="pb-home" style="width:${ms.possession_home}%"></div>
        <div class="pb-away" style="width:${ms.possession_away}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:12px">
        <span>${ms.possession_home}%</span><span>Ball Possession</span><span>${ms.possession_away}%</span>
      </div>
      ${row(ms.shots_home, 'Shots', ms.shots_away)}
      ${row(ms.shots_on_target_home, 'Shots on Target', ms.shots_on_target_away)}
      ${row(ms.corners_home, 'Corners', ms.corners_away)}
      ${row(ms.fouls_home, 'Fouls', ms.fouls_away)}
      ${row(ms.offsides_home, 'Offsides', ms.offsides_away)}
    </div>
  </div>`;
}

function triggerGoalCelebration(side, match, ev) {
  const container = document.getElementById('scoreboard');
  if (!container) return;
  const teamName = side === 'home' ? match.home_team_name : match.away_team_name;
  const teamLogo = side === 'home' ? match.home_logo : match.away_logo;
  const teamColorPrimary   = (side === 'home' ? match.home_color_primary   : match.away_color_primary)   || null;
  const teamColorSecondary = (side === 'home' ? match.home_color_secondary : match.away_color_secondary) || null;
  const teamColorPattern   = (side === 'home' ? match.home_color_pattern   : match.away_color_pattern)   || 'none';
  const goalBannerUrl      = (side === 'home' ? match.home_goal_banner_url : match.away_goal_banner_url)  || null;
  const scorerName = ev && ev.player_name ? ev.player_name : '';
  const scorerImg = ev && ev.player_image_url ? ev.player_image_url : '';

  // Particle burst inside scoreboard
  const EMOJIS = ['⚽','🎉','🔥','⭐','💥','🏆','👏'];
  const COUNT = 22;
  for (let i = 0; i < COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'goal-particle';
    el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    const startX = side === 'home' ? 20 + Math.random() * 30 : 50 + Math.random() * 30;
    el.style.cssText = `left:${startX}%;top:50%;--dx:${(Math.random()-0.5)*180}px;--dy:${-(60+Math.random()*120)}px;animation-delay:${Math.random()*0.35}s`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // Goal banner — centered overlay with team colors or custom image
  const banner = document.createElement('div');
  banner.className = 'goal-banner';

  if (goalBannerUrl) {
    // Custom banner image — use as background, overlay stays semi-transparent
    banner.style.backgroundImage = `url('${goalBannerUrl}')`;
    banner.style.backgroundSize = 'cover';
    banner.style.backgroundPosition = 'center';
    banner.classList.add('goal-banner-custom-img');
  } else if (teamColorPrimary) {
    banner.style.background = teamColorPrimary;
  }

  const patternHtml = (!goalBannerUrl && teamColorSecondary && teamColorPattern && teamColorPattern !== 'none')
    ? `<div class="goal-banner-pattern goal-banner-pattern-${escHtml(teamColorPattern)}" style="--pat-color:${escHtml(teamColorSecondary)}"></div>`
    : '';

  const logoHtml = teamLogo
    ? `<img src="${escHtml(teamLogo)}" class="goal-banner-logo" onerror="this.style.display='none'">`
    : '';

  const marqueeText = '⚽ ГООООООООООООООООООООООООООООЛ! ⚽ ГООООООООООООООООООООООООООООЛ! ⚽ ГООООООООООООООООООООООООООООЛ! ';

  banner.innerHTML = `
    ${patternHtml}
    <div class="goal-banner-top">
      ${logoHtml}
      <span class="goal-banner-team">${escHtml(teamName)}</span>
    </div>
    <div class="goal-banner-marquee-wrap">
      <div class="goal-banner-marquee">${escHtml(marqueeText)}</div>
    </div>
    ${scorerName ? `
    <div class="goal-banner-scorer">
      ${scorerImg
        ? `<img src="${escHtml(scorerImg)}" class="goal-banner-scorer-av" onerror="this.style.display='none'">`
        : `<span class="goal-banner-scorer-ini">${escHtml(scorerName.charAt(0))}</span>`
      }
      <span>⚽ ${escHtml(scorerName)}</span>
    </div>` : ''}
  `;
  document.body.appendChild(banner);
  setTimeout(() => { banner.classList.add('goal-banner-hide'); setTimeout(() => banner.remove(), 600); }, 3000);
}

async function startMatchSimulation(matchId) {
  const btn = document.getElementById('btn-sim');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Запуск…'; }
  try {
    await POST('/matches/'+matchId+'/simulate');
    startLiveMatchPoll(matchId);
  } catch(e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '▶ Начать матч'; }
  }
}

// Live polling — shared by the initiating coach AND any other user watching the match page
let _liveMatchTimer = null;
function stopLiveMatchPoll() {
  if (_liveMatchTimer) { clearInterval(_liveMatchTimer); _liveMatchTimer = null; }
}

function startLiveMatchPoll(matchId) {
  stopLiveMatchPoll();

  // Init UI
  const badge = document.getElementById('match-status-badge');
  if (badge) { badge.textContent = 'LIVE'; badge.className = 'match-status-badge match-status-live'; }
  document.getElementById('score-home').textContent = '0';
  document.getElementById('score-away').textContent = '0';
  const logEl = document.getElementById('event-log');
  if (logEl) logEl.innerHTML = '';
  const btn = document.getElementById('btn-sim');
  if (btn) btn.remove();

  let seenIds = new Set();
  let lastMatch = null;

  async function poll() {
    let data;
    try { data = await GET('/matches/'+matchId); } catch { return; }

    const clockEl = document.getElementById('match-clock');
    const sh = document.getElementById('score-home');
    const sa = document.getElementById('score-away');

    if (data.status === 'in_progress') {
      if (clockEl) clockEl.textContent = `⏱ ${data.live_minute}'`;
      if (sh) sh.textContent = data.home_score;
      if (sa) sa.textContent = data.away_score;

      // Show newly revealed events
      for (const ev of (data.events || [])) {
        if (seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);

        if (ev.event_type === 'goal' || ev.event_type === 'own_goal') {
          const isOwnGoal = ev.event_type === 'own_goal';
          const scoringHome = isOwnGoal
            ? ev.team_id !== data.home_team_id
            : ev.team_id === data.home_team_id;
          if (!isOwnGoal) triggerGoalCelebration(scoringHome ? 'home' : 'away', data, ev);
          const scoreboard = document.getElementById('scoreboard');
          if (scoreboard) { scoreboard.classList.add('sb-goal-flash'); setTimeout(()=>scoreboard.classList.remove('sb-goal-flash'),700); }
        }

        const logEl2 = document.getElementById('event-log');
        if (logEl2) {
          if (ev.minute > 45 && !logEl2.querySelector('.halftime-divider')) {
            const ht = document.createElement('div');
            ht.className = 'halftime-divider'; ht.textContent = '⏸ Перерыв';
            logEl2.insertBefore(ht, logEl2.firstChild);
          }
          const isBuild = ev.event_type === 'buildup';
          const item = document.createElement('div');
          item.className = `event-log-item event-${ev.event_type}${isBuild?' ev-buildup':''}`;
          item.innerHTML = `<span class="ev-min">${ev.minute}'</span><span class="ev-icon">${eventIcon(ev.event_type)}</span><span class="ev-desc">${escHtml(ev.description||'')}</span>`;
          logEl2.insertBefore(item, logEl2.firstChild);
        }
      }
      lastMatch = data;
    } else {
      // Match finished (or overtime)
      stopLiveMatchPoll();
      if (clockEl) clockEl.textContent = `⏱ 90'`;
      if (sh) sh.textContent = data.home_score;
      if (sa) sa.textContent = data.away_score;
      const badgeEl = document.getElementById('match-status-badge');
      if (badgeEl) {
        badgeEl.textContent = data.status === 'overtime' ? 'OVERTIME' : 'FINISHED';
        badgeEl.className = 'match-status-badge match-status-finished';
      }
      toast(`Финальный свисток: ${data.home_team_name} ${data.home_score}–${data.away_score} ${data.away_team_name}`);
      // Reload full match to show combined pitch / player stats
      setTimeout(() => navigate(location.hash || '#/matches'), 2000);
    }
  }

  poll();
  _liveMatchTimer = setInterval(poll, 1500);
}

async function showMatchForm() {
  const teams = await GET('/teams');
  mkModal('Schedule Match', `
    <div class="form-row">
      <div class="form-group"><label>Home Team *</label><select id="mf-home"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Away Team *</label><select id="mf-away"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Match Date</label><input type="date" id="mf-date" value="${new Date().toISOString().substring(0,10)}"/></div>
    <div class="form-group" style="display:flex;align-items:center;gap:12px;margin-top:4px">
      <label class="toggle-switch"><input type="checkbox" id="mf-friendly"><span class="toggle-slider"></span></label>
      <span>Товарищеский матч <span style="color:var(--text-muted);font-size:13px">(результат не влияет на стату и стоимость)</span></span>
    </div>
  `, async ()=>{
    const home=document.getElementById('mf-home').value;const away=document.getElementById('mf-away').value;
    if(!home||!away){toast('Both teams required','error');return false;}
    if(home===away){toast('Teams must be different','error');return false;}
    const friendly=document.getElementById('mf-friendly').checked;
    const r=await POST('/matches',{home_team_id:home,away_team_id:away,match_date:document.getElementById('mf-date').value||null,is_friendly:friendly});
    toast('Match scheduled');
    navigate('/matches/'+r.id);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
//  TOURNAMENTS
// ═══════════════════════════════════════════════════════════
async function renderTournaments(app) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const tournaments = await GET('/tournaments');
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Tournaments</h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showTournamentForm()">+ New Tournament</button>`:''}
      </div>
      ${!tournaments.length?`<div class="empty-state"><div class="empty-icon">🏆</div><p>No tournaments yet</p></div>`:
      `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Tournament</th><th>Teams</th><th>Status</th><th>Created</th>${isAdmin()?'<th></th>':''}</tr></thead>
        <tbody>${tournaments.map(t=>`
          <tr class="clickable-row" onclick="navigate('/tournaments/${t.id}')">
            <td class="font-bold">🏆 ${escHtml(t.name)}</td>
            <td>${t.team_count}</td>
            <td><span class="badge ${t.status==='finished'?'badge-green':t.status==='in_progress'?'badge-gold':'badge-gray'}">${t.status}</span></td>
            <td class="text-muted">${fmtDate(t.created_at)}</td>
            ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
              <button class="btn-icon danger" onclick="deleteTournament(${t.id},'${escHtml(t.name)}')">🗑️</button>
            </td>`:''}
          </tr>`).join('')}
        </tbody>
      </table></div></div>`}
    `;
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

async function renderTournamentDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const [tour, teams] = await Promise.all([GET('/tournaments/'+id), GET('/teams')]);
    const inSetup = tour.status === 'setup';
    const inProg  = tour.status === 'in_progress';
    const finished = tour.status === 'finished';

    app.innerHTML=`
      <div class="detail-hero" style="gap:20px">
        <div class="hero-info" style="display:flex;align-items:center;gap:16px">
          ${tour.trophy_url ? `<img src="${escHtml(tour.trophy_url)}" style="height:64px;width:auto;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">` : ''}
          <div>
            <h1>${escHtml(tour.name)}</h1>
            <div class="meta">
              <span class="badge ${finished?'badge-green':inProg?'badge-gold':'badge-gray'}">${({setup:'Настройка',in_progress:'Идёт',finished:'Завершён'}[tour.status]||tour.status)}</span>
              <span>${tour.teams.length} команд</span>
              ${inProg?`<span>Раунд ${tour.current_round} из ${tour.total_rounds}</span>`:''}
            </div>
          </div>
        </div>
        ${isAdmin()?`<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="showTournamentEditForm(${JSON.stringify(tour).replace(/"/g,'&quot;')})">✏️ Настройки</button>
          ${inSetup?`<button class="btn btn-green" onclick="showAddTeamToTournament(${id},${JSON.stringify(teams).replace(/"/g,'&quot;')},${JSON.stringify(tour.teams.map(t=>t.team_id))})">+ Добавить команду</button>
          <button class="btn-simulate" onclick="startTournament(${id})" ${tour.teams.length<2?'disabled':''}>▶ Начать турнир</button>`:
          inProg?`<button class="btn-simulate" onclick="simulateTournamentRound(${id})">▶ Сыграть раунд</button>`:''}
        </div>`:''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="bracket">Bracket</button>
        <button class="detail-tab" data-tab="t-teams">Teams (${tour.teams.length})</button>
      </div>
      <div id="tab-bracket" class="tab-panel active">${renderBracket(tour)}</div>
      <div id="tab-t-teams" class="tab-panel">${renderTournamentTeams(tour,id)}</div>
    `;
    setupTabs(app);
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function renderBracket(tour) {
  const rounds = Object.keys(tour.bracket).sort((a,b)=>Number(a)-Number(b));
  if (!rounds.length) {
    return `<div class="empty-state"><div class="empty-icon">📊</div><p>${tour.status==='setup'?'Add teams and start the tournament to see the bracket':'No matches generated yet'}</p></div>`;
  }
  return `<div class="bracket-wrapper"><div class="bracket">
    ${rounds.map(rk=>{
      const round = tour.bracket[rk];
      return `<div class="bracket-round">
        <div class="bracket-round-header">${escHtml(round.name)}</div>
        <div class="bracket-matches">
          ${round.matches.map(m=>{
            const fin = m.status==='finished';
            const isOT = m.status==='overtime';
            const isPen = m.status==='penalties';
            const penWin = fin && m.ot_type==='penalties';
            const homeWon = fin && (penWin ? m.pen_home > m.pen_away : m.home_score >= m.away_score);
            const awayWon = fin && (penWin ? m.pen_away > m.pen_home : m.away_score > m.home_score);
            const scoreH = fin||isOT||isPen ? m.home_score : '';
            const scoreA = fin||isOT||isPen ? m.away_score : '';
            const penLabel = penWin ? `<div class="bt-pen">(${m.pen_home}:${m.pen_away} пен.)</div>` : '';
            const otLabel = fin && m.ot_type && m.ot_type!=='penalties' ? `<span class="badge badge-gray" style="font-size:10px;padding:1px 4px">ДВ</span>` : '';
            return `<div class="bracket-slot">
              <div class="bracket-match" onclick="navigate('/matches/${m.id}')">
                <div class="bracket-team ${homeWon?'winner':''}">
                  ${teamLogoEl(m.home_logo,m.home_team_name)}
                  <span class="bt-name">${escHtml(m.home_team_name)}</span>
                  <span class="bt-score">${scoreH}</span>
                </div>
                <div class="bracket-team ${awayWon?'winner':''}">
                  ${teamLogoEl(m.away_logo,m.away_team_name)}
                  <span class="bt-name">${escHtml(m.away_team_name)}</span>
                  <span class="bt-score">${scoreA}</span>
                </div>
                ${penLabel}
                ${otLabel}
              </div>
              ${(isOT||isPen) && isAdmin() ? `<div class="bracket-ot-btns">
                ${isOT?`<button class="btn btn-sm btn-gold" onclick="event.stopPropagation();playOvertime(${m.id},'golden_goal',${tour.id})">⚡ Золотой гол</button>
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();playOvertime(${m.id},'classic',${tour.id})">⏱ Овертайм (30 мин)</button>`:''}
                ${isPen?`<button class="btn btn-sm btn-red" onclick="event.stopPropagation();playPenalties(${m.id},${tour.id})">🥅 Серия пенальти</button>`:''}
              </div>`:''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div></div>`;
}

async function playOvertime(matchId, type, tourId) {
  try {
    const r = await POST('/matches/'+matchId+'/overtime', { type });
    if (r.needs_penalties) {
      toast('Ничья в овертайме! Серия пенальти.');
    } else if (r.needs_classic) {
      toast('Золотой гол не забит. Классический овертайм.');
    } else {
      toast('Гол в дополнительное время!');
    }
    navigate('/tournaments/'+tourId);
  } catch(e) { toast(e.message,'error'); }
}

async function playPenalties(matchId, tourId) {
  try {
    const r = await POST('/matches/'+matchId+'/penalties');
    toast(`Серия пенальти: ${r.pen_home}:${r.pen_away}`);
    navigate('/tournaments/'+tourId);
  } catch(e) { toast(e.message,'error'); }
}

function renderTournamentTeams(tour, tournamentId) {
  if (!tour.teams.length) return `<div class="empty-state"><div class="empty-icon">🏟️</div><p>No teams added yet</p></div>`;
  return `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th>Seed</th><th>Команда</th><th>Страна</th><th class="text-right">Стоимость состава</th>${isAdmin()&&tour.status==='setup'?'<th></th>':''}</tr></thead>
    <tbody>${tour.teams.map(t=>`
      <tr class="clickable-row" onclick="navigate('/teams/${t.team_id}')">
        <td class="font-bold">#${t.seed||'–'}</td>
        <td><div class="flex-center gap-2">${teamLogoEl(t.logo_url,t.team_name)}<span class="font-bold">${escHtml(t.team_name)}</span></div></td>
        <td>${t.flag_emoji||''} ${escHtml(t.country_name||'–')}</td>
        <td class="text-right mv">${fmtValue(t.market_value)}</td>
        ${isAdmin()&&tour.status==='setup'?`<td onclick="event.stopPropagation()"><button class="btn-icon danger" onclick="removeTeamFromTournament(${tournamentId},${t.team_id})">🗑️</button></td>`:''}
      </tr>`).join('')}
    </tbody>
  </table></div></div>`;
}

async function showTournamentForm() {
  mkModal('Новый турнир', `
    <div class="form-group"><label>Название *</label><input type="text" id="torf-name" placeholder="Например: Кубок чемпионов 2025"/></div>
    <div class="form-group">
      <label>URL картинки трофея</label>
      <input type="text" id="torf-trophy" placeholder="https://…"/>
    </div>
  `, async ()=>{
    const name = document.getElementById('torf-name').value.trim();
    const trophy_url = document.getElementById('torf-trophy').value.trim() || null;
    if (!name) { toast('Название обязательно', 'error'); return false; }
    const r = await POST('/tournaments', { name });
    if (trophy_url) await PUT('/tournaments/' + r.id, { name, trophy_url });
    toast('Турнир создан');
    navigate('/tournaments/' + r.id);
    return true;
  });
}

async function showTournamentEditForm(tour) {
  mkModal('Настройки турнира', `
    <div class="form-group"><label>Название *</label><input type="text" id="torf-edit-name" value="${escHtml(tour.name||'')}"/></div>
    <div class="form-group">
      <label>URL картинки трофея</label>
      <input type="text" id="torf-edit-trophy" value="${escHtml(tour.trophy_url||'')}" placeholder="https://…"/>
      ${tour.trophy_url ? `<img src="${escHtml(tour.trophy_url)}" style="height:60px;margin-top:6px;object-fit:contain" onerror="this.style.display='none'">` : ''}
    </div>
  `, async () => {
    const name = document.getElementById('torf-edit-name').value.trim();
    const trophy_url = document.getElementById('torf-edit-trophy').value.trim() || null;
    if (!name) { toast('Название обязательно', 'error'); return false; }
    await PUT('/tournaments/' + tour.id, { name, trophy_url });
    toast('Турнир обновлён');
    navigate('/tournaments/' + tour.id);
  });
}

async function showAddTeamToTournament(tournamentId, allTeams, existingIds) {
  const available = allTeams.filter(t => !existingIds.includes(t.id));
  if (!available.length) { toast('All teams already added','info'); return; }
  mkModal('Add Team to Tournament', `
    <div class="form-group"><label>Select Team *</label>
      <select id="att-team" style="height:200px" multiple>
        ${available.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div style="font-size:12px;color:var(--text-muted)">Hold Ctrl/Cmd to select multiple teams</div>
  `, async ()=>{
    const sel=[...document.getElementById('att-team').selectedOptions].map(o=>o.value);
    if(!sel.length){toast('Select at least one team','error');return false;}
    for(const tid of sel) await POST('/tournaments/'+tournamentId+'/teams',{team_id:tid});
    toast(`${sel.length} team(s) added`);
  });
}

async function removeTeamFromTournament(tournamentId, teamId) {
  if (!confirm('Remove team from tournament?')) return;
  try { await DEL('/tournaments/'+tournamentId+'/teams/'+teamId); toast('Removed'); router(); } catch(e){toast(e.message,'error');}
}

async function startTournament(id) {
  if (!confirm('Start tournament? This will generate the bracket.')) return;
  try { await POST('/tournaments/'+id+'/start'); toast('Tournament started! Bracket generated.'); router(); } catch(e){toast(e.message,'error');}
}

async function simulateTournamentRound(id) {
  const btn = document.querySelector('.btn-simulate');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Simulating…'; }
  try {
    const r = await POST('/tournaments/'+id+'/simulate-round');
    toast(`Round simulated: ${r.simulated} match(es)`);
    router();
  } catch(e){toast(e.message,'error');if(btn){btn.disabled=false;btn.textContent='▶ Simulate Next Round';}}
}

async function deleteTournament(id, name) {
  if (!confirm(`Delete tournament "${name}"?`)) return;
  try { await DEL('/tournaments/'+id); toast('Deleted'); router(); } catch(e){toast(e.message,'error');}
}

// ═══════════════════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════════════════
async function renderAdmin(app) {
  if (!isAdmin()) { app.innerHTML=`<div class="empty-state"><div class="empty-icon">🔒</div><p>Login required</p></div>`; return; }
  const [stats, countries, banners, users, leagues] = await Promise.all([
    GET('/stats'), GET('/countries'), GET('/banners'),
    GET('/auth/users').catch(()=>[]),
    GET('/leagues').catch(()=>[]),
  ]);
  app.innerHTML=`
    <div class="page-header"><h1 class="page-title">Панель администратора</h1><span class="badge badge-gold">ADMIN</span></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${stats.totals.teams}</div><div class="stat-label">Teams</div></div>
      <div class="stat-card"><div class="stat-value">${stats.totals.players}</div><div class="stat-label">Players</div></div>
      <div class="stat-card"><div class="stat-value">${stats.totals.transfers}</div><div class="stat-label">Transfers</div></div>
      <div class="stat-card"><div class="stat-value">${fmtValue(stats.totals.transfer_value)}</div><div class="stat-label">Transfer Value</div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header">Quick Actions</div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-green" onclick="showTeamForm()">+ Добавить команду</button>
          <button class="btn btn-green" onclick="showPlayerForm()">+ Добавить игрока</button>
          <button class="btn btn-green" onclick="showMatchForm()">+ Schedule Match</button>
          <button class="btn btn-green" onclick="showTournamentForm()">+ New Tournament</button>
          <button class="btn btn-green" onclick="navigate('/leagues')">🏆 Manage Leagues</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Countries <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showCountryForm()">+ Add</button></div>
        <div class="table-wrap" style="max-height:280px;overflow-y:auto"><table>
          <thead><tr><th>Flag</th><th>Name</th><th>Code</th><th></th></tr></thead>
          <tbody>${countries.map(c=>`<tr><td>${c.flag_emoji||''}</td><td>${escHtml(c.name)}</td><td class="text-muted">${c.code||'–'}</td><td style="white-space:nowrap">
            <button class="btn-icon" onclick="showCountryForm(${JSON.stringify(c).replace(/"/g,'&quot;')})">✏️</button>
            <button class="btn-icon danger" onclick="deleteCountry(${c.id},'${escHtml(c.name)}')">🗑️</button>
          </td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>

    <!-- Team Generator -->
    <div class="card mt-3">
      <div class="card-header">Генератор команды</div>
      <div class="generator-panel">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Сгенерировать полный состав из 22 игроков (11 основных + 11 запасных) для новой команды.</p>
        <div class="form-row">
          <div class="form-group"><label>Team Name *</label><input type="text" id="gen-name" placeholder="e.g. City United FC"/></div>
          <div class="form-group"><label>Short Name</label><input type="text" id="gen-short" maxlength="10" placeholder="e.g. CUF"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Average Market Value (€M)</label><input type="number" id="gen-mv" value="5" min="0.5" max="100" step="0.5" placeholder="5"/></div>
          <div class="form-group" style="align-self:flex-end"><button class="btn btn-green" onclick="generateTeam()" style="width:100%">⚡ Сгенерировать состав</button></div>
        </div>
        <div id="gen-result"></div>
      </div>
    </div>

    <!-- User Management -->
    <div class="card mt-3">
      <div class="card-header">Пользователи
        <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showCreateUserForm()">+ Добавить пользователя</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Имя пользователя</th><th>Роль</th><th>Created</th><th>Manages</th><th></th></tr></thead>
        <tbody id="users-tbody">
          ${users.map(u=>`<tr>
            <td class="font-bold">${escHtml(u.username)}</td>
            <td><span class="role-badge role-${u.role}">${u.role}</span></td>
            <td class="text-muted">${fmtDate(u.created_at)}</td>
            <td class="text-muted">${escHtml(u.team_name||'–')}</td>
            <td style="white-space:nowrap">
              ${u.role==='coach'?`<button class="btn-icon" onclick="showAssignCoachForm(${u.id},'${escHtml(u.username)}')">⚙️ Назначить</button>`:''}
            </td>
          </tr>`).join('')}
          ${!users.length?`<tr><td colspan="5" class="text-center text-muted" style="padding:20px">No users yet</td></tr>`:''}
        </tbody>
      </table></div>
    </div>

    <!-- Banners management -->
    <div class="card mt-3">
      <div class="card-header">
        Advertising Banners
        <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showBannerForm()">+ Add Banner</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Position</th><th>Title</th><th>Image</th><th>Link</th><th>Active</th><th>Order</th><th></th></tr></thead>
        <tbody id="banners-tbody">
          ${banners.map(b=>`<tr>
            <td><span class="badge ${b.position==='left'?'badge-green':'badge-gold'}">${b.position}</span></td>
            <td>${escHtml(b.title||'–')}</td>
            <td>${b.image_url?`<img src="${escHtml(b.image_url)}" style="height:30px;width:auto;border-radius:3px">`:'–'}</td>
            <td class="text-muted">${b.link_url?`<a href="${escHtml(b.link_url)}" target="_blank">Link ↗</a>`:'–'}</td>
            <td>${b.active?'✅':'❌'}</td>
            <td class="text-muted">${b.sort_order}</td>
            <td style="white-space:nowrap">
              <button class="btn-icon" onclick="showBannerForm(${JSON.stringify(b).replace(/"/g,'&quot;')})">✏️</button>
              <button class="btn-icon danger" onclick="deleteBanner(${b.id})">🗑️</button>
            </td>
          </tr>`).join('')}
          ${!banners.length?`<tr><td colspan="7" class="text-center text-muted" style="padding:20px">No banners yet</td></tr>`:''}
        </tbody>
      </table></div>
    </div>
    <!-- Telegram settings -->
    <div class="card mt-3" id="tg-settings-card">
      <div class="card-header">Telegram Уведомления</div>
      <div class="card-body" style="display:flex;align-items:center;gap:16px">
        <label class="toggle-switch"><input type="checkbox" id="tg-enabled-toggle" onchange="saveTgEnabled(this.checked)"><span class="toggle-slider"></span></label>
        <div>
          <div style="font-weight:600">Отправка в Telegram</div>
          <div style="font-size:13px;color:var(--text-muted)" id="tg-status-text">Загрузка…</div>
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-header">Change Password</div>
      <div class="card-body">
        <div class="form-row-3">
          <div class="form-group"><label>Current Password</label><input type="password" id="pw-current"/></div>
          <div class="form-group"><label>New Password</label><input type="password" id="pw-new"/></div>
          <div class="form-group"><label>Confirm</label><input type="password" id="pw-confirm"/></div>
        </div>
        <button class="btn btn-green" onclick="changePassword()">Update Password</button>
      </div>
    </div>
  `;
  // Load Telegram toggle state
  GET('/admin/settings').then(s => {
    const toggle = document.getElementById('tg-enabled-toggle');
    const txt = document.getElementById('tg-status-text');
    if (!toggle) return;
    const on = s.telegram_enabled === '1';
    toggle.checked = on;
    txt.textContent = on ? 'Включено — результаты матчей и новости тренеров отправляются в группу' : 'Выключено — уведомления не отправляются';
  }).catch(()=>{});
}

async function generateTeam() {
  const name = document.getElementById('gen-name').value.trim();
  const short_name = document.getElementById('gen-short').value.trim();
  const avgMv = parseFloat(document.getElementById('gen-mv').value)||5;
  if (!name) { toast('Team name required','error'); return; }
  const btn = event.target; btn.disabled=true; btn.textContent='Generating…';
  try {
    const result = await POST('/admin/generate-team', {name, short_name:short_name||null, avg_market_value_m:avgMv});
    document.getElementById('gen-result').innerHTML = `
      <div style="margin-top:16px;padding:12px;background:rgba(39,174,96,.1);border-radius:6px;border:1px solid rgba(39,174,96,.3)">
        <div style="font-weight:700;margin-bottom:8px;color:var(--green)">✅ ${escHtml(result.team.name)} created — ${result.players.length} players generated</div>
        <div class="generator-result">
          ${result.players.map((p,i)=>`<div class="gen-player-row"><div class="gpr-slot">${i<11?i+1:''}<span style="font-size:9px">${i>=11?'RES':''}</span></div><div class="gpr-name">${escHtml(p.name)}</div>${posBadge(p.position)}<div style="font-size:11px;color:var(--green);margin-left:auto">${fmtValue(p.market_value)}</div></div>`).join('')}
        </div>
        <button class="btn btn-outline" style="margin-top:10px;color:#fff;border-color:rgba(255,255,255,.3)" onclick="navigate('/teams/${result.team.id}')">View Team →</button>
      </div>`;
    btn.textContent='⚡ Сгенерировать состав'; btn.disabled=false;
    document.getElementById('gen-name').value=''; document.getElementById('gen-short').value='';
  } catch(e) { toast(e.message,'error'); btn.textContent='⚡ Сгенерировать состав'; btn.disabled=false; }
}

async function showCreateUserForm() {
  mkModal('Создать пользователя', `
    <div class="form-group"><label>Имя пользователя *</label><input type="text" id="nu-user" placeholder="e.g. coach_arsenalFC"/></div>
    <div class="form-group"><label>Пароль *</label><input type="password" id="nu-pass" placeholder="min 8 characters"/></div>
    <div class="form-group"><label>Роль *</label>
      <select id="nu-role">
        <option value="coach">Coach</option>
        <option value="admin">Admin</option>
      </select>
    </div>
  `, async () => {
    const username = document.getElementById('nu-user').value.trim();
    const password = document.getElementById('nu-pass').value;
    const role = document.getElementById('nu-role').value;
    if (!username||!password) { toast('Заполните все поля','error'); return false; }
    if (password.length<8) { toast('Пароль: мин. 8 символов','error'); return false; }
    const data = await POST('/auth/users', {username,password,role});
    toast('Пользователь создан. '+( role==='coach'?'Теперь назначьте команду через ⚙️ Назначить.':''));
    if (role==='coach') {
      // Create coach profile automatically
      await POST('/coaches', {user_id:data.id, name:username}).catch(()=>{});
    }
  });
}

async function showAssignCoachForm(userId, username) {
  const [teams, coaches] = await Promise.all([GET('/teams'), GET('/coaches')]);
  const existing = coaches.find(c=>c.user_id===userId);
  mkModal(`Назначить клуб: ${username}`, `
    <div class="form-group"><label>Команда *</label>
      <select id="ac-team">
        <option value="">Выберите команду…</option>
        ${teams.map(t=>`<option value="${t.id}"${existing?.team_id===t.id?' selected':''}>${escHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Имя тренера</label><input type="text" id="ac-name" value="${escHtml(existing?.name||username)}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Возраст</label><input type="number" id="ac-age" value="${existing?.age||''}"/></div>
      <div class="form-group"><label>Рост (см)</label><input type="number" id="ac-height" value="${existing?.height||''}"/></div>
    </div>
    <div class="form-group"><label>Игровой стиль</label><input type="text" id="ac-style" value="${escHtml(existing?.playing_style||'')}" placeholder="e.g. 4-3-3 High Press"/></div>
  `, async () => {
    const team_id = parseInt(document.getElementById('ac-team').value);
    const name = document.getElementById('ac-name').value.trim()||username;
    const age = parseInt(document.getElementById('ac-age').value)||null;
    const height = parseInt(document.getElementById('ac-height').value)||null;
    const playing_style = document.getElementById('ac-style').value.trim()||null;
    if (!team_id) { toast('Выберите команду','error'); return false; }
    if (existing) await PUT('/coaches/'+existing.id, {name,team_id,age,height,playing_style});
    else await POST('/coaches', {user_id:userId,team_id,name,age,height,playing_style});
    toast(`Клуб назначен: ${username}!`);
  });
}

async function saveTgEnabled(checked) {
  try {
    await PUT('/admin/settings', { telegram_enabled: checked });
    const txt = document.getElementById('tg-status-text');
    if (txt) txt.textContent = checked ? 'Включено — результаты матчей и новости тренеров отправляются в группу' : 'Выключено — уведомления не отправляются';
    toast(checked ? 'Telegram уведомления включены' : 'Telegram уведомления выключены');
  } catch(e) { toast(e.message, 'error'); }
}

async function changePassword() {
  const cur=document.getElementById('pw-current').value;const nw=document.getElementById('pw-new').value;const cf=document.getElementById('pw-confirm').value;
  if(!cur||!nw){toast('Fill all fields','error');return;}if(nw!==cf){toast('Passwords do not match','error');return;}if(nw.length<8){toast('Min 8 characters','error');return;}
  try{await api('POST','/auth/change-password',{currentPassword:cur,newPassword:nw});toast('Password updated');document.getElementById('pw-current').value='';document.getElementById('pw-new').value='';document.getElementById('pw-confirm').value='';}catch(e){toast(e.message,'error');}
}

async function showCountryForm(country) {
  const isEdit=!!country;
  mkModal(isEdit?'Edit Country':'Add Country',`
    <div class="form-group"><label>Name *</label><input type="text" id="cof-name" value="${escHtml(country?.name||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Code</label><input type="text" id="cof-code" value="${escHtml(country?.code||'')}" maxlength="3"/></div>
      <div class="form-group"><label>Flag Emoji</label><input type="text" id="cof-flag" value="${country?.flag_emoji||''}" placeholder="🇬🇧"/></div>
    </div>
  `,async()=>{
    const payload={name:document.getElementById('cof-name').value.trim(),code:document.getElementById('cof-code').value.trim().toUpperCase()||null,flag_emoji:document.getElementById('cof-flag').value.trim()||null};
    if(!payload.name){toast('Name required','error');return false;}
    if(isEdit) await PUT('/countries/'+country.id,payload); else await POST('/countries',payload);
    toast(isEdit?'Updated':'Added');
  });
}
async function deleteCountry(id,name){if(!confirm(`Delete "${name}"?`))return;try{await DEL('/countries/'+id);toast('Deleted');router();}catch(e){toast(e.message,'error');}}

// ─── Banner form ──────────────────────────────────────────────
async function showBannerForm(banner) {
  const isEdit=!!banner;
  mkModal(isEdit?'Edit Banner':'Add Banner',`
    <div class="form-row">
      <div class="form-group"><label>Position *</label><select id="bf-pos"><option value="left"${banner?.position==='left'?' selected':''}>Left</option><option value="right"${banner?.position==='right'?' selected':''}>Right</option></select></div>
      <div class="form-group"><label>Sort Order</label><input type="number" id="bf-order" value="${banner?.sort_order||0}"/></div>
    </div>
    <div class="form-group"><label>Title / Alt Text</label><input type="text" id="bf-title" value="${escHtml(banner?.title||'')}"/></div>
    <div class="form-group"><label>Image URL</label><input type="text" id="bf-img" value="${escHtml(banner?.image_url||'')}" placeholder="https://… or /images/uploads/…"/></div>
    <div class="form-group"><label>Link URL (optional)</label><input type="text" id="bf-link" value="${escHtml(banner?.link_url||'')}" placeholder="https://…"/></div>
    <div class="form-group"><label>Active</label><select id="bf-active"><option value="1"${banner?.active!==0?' selected':''}>Yes</option><option value="0"${banner?.active===0?' selected':''}>No</option></select></div>
  `,async()=>{
    const payload={position:document.getElementById('bf-pos').value,title:document.getElementById('bf-title').value.trim()||null,image_url:document.getElementById('bf-img').value.trim()||null,link_url:document.getElementById('bf-link').value.trim()||null,active:document.getElementById('bf-active').value==='1',sort_order:parseInt(document.getElementById('bf-order').value)||0};
    if(isEdit) await PUT('/banners/'+banner.id,payload); else await POST('/banners',payload);
    toast(isEdit?'Banner updated':'Banner added');
    loadBanners();
  });
}
async function deleteBanner(id){if(!confirm('Delete banner?'))return;try{await DEL('/banners/'+id);toast('Deleted');loadBanners();router();}catch(e){toast(e.message,'error');}}

// ═══════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════
async function renderSearch(app, query) {
  if (!query){app.innerHTML=`<div class="empty-state"><p>Enter a search term</p></div>`;return;}
  app.innerHTML='<div class="empty-state"><p>Searching…</p></div>';
  try {
    const [players,teams]=await Promise.all([GET('/players?search='+encodeURIComponent(query)),GET('/teams?search='+encodeURIComponent(query))]);
    app.innerHTML=`
      <div class="page-header"><h1 class="page-title">Results for "<em>${escHtml(query)}</em>"</h1></div>
      ${players.length?`<div class="card mb-2"><div class="card-header">Players (${players.length})</div><div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th class="text-right">Value</th></tr></thead>
        <tbody>${players.map(p=>`<tr class="clickable-row" onclick="navigate('/players/${p.id}')"><td><div class="flex-center gap-2">${avatarEl(p.image_url,p.name)}<span class="font-bold">${escHtml(p.name)}</span></div></td><td>${posBadge(p.position)}</td><td class="text-muted">${escHtml(p.team_name||'Free')}</td><td class="text-right mv">${fmtValue(p.market_value)}</td></tr>`).join('')}</tbody>
      </table></div></div>`:''}
      ${teams.length?`<div class="card"><div class="card-header">Teams (${teams.length})</div><div class="table-wrap"><table>
        <thead><tr><th>Team</th><th>League</th><th class="text-right">Value</th></tr></thead>
        <tbody>${teams.map(t=>`<tr class="clickable-row" onclick="navigate('/teams/${t.id}')"><td><div class="flex-center gap-2">${teamLogoEl(t.logo_url,t.name)}<span class="font-bold">${escHtml(t.name)}</span></div></td><td class="text-muted">${escHtml(t.competition_name||'–')}</td><td class="text-right mv">${fmtValue(t.market_value)}</td></tr>`).join('')}</tbody>
      </table></div></div>`:''}
      ${!players.length&&!teams.length?`<div class="empty-state"><div class="empty-icon">🔍</div><p>Ничего не найдено по запросу "${escHtml(query)}"</p></div>`:''}
    `;
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

// ═══════════════════════════════════════════════════════════
//  LEAGUES
// ═══════════════════════════════════════════════════════════
async function showLeagueEditForm(lg) {
  mkModal('Настройки лиги', `
    <div class="form-group"><label>Название</label><input type="text" id="le-name" value="${escHtml(lg.name||'')}"/></div>
    <div class="form-group"><label>Сезон</label><input type="number" id="le-season" value="${lg.season||1}" min="1"/></div>
    <div class="form-group">
      <label>URL логотипа лиги</label>
      <input type="text" id="le-logo" value="${escHtml(lg.logo_url||'')}" placeholder="https://…"/>
      ${lg.logo_url?`<img src="${escHtml(lg.logo_url)}" style="height:40px;margin-top:6px;object-fit:contain" onerror="this.style.display='none'">`:''}
    </div>
    <div class="form-group">
      <label>URL картинки трофея</label>
      <input type="text" id="le-trophy" value="${escHtml(lg.trophy_url||'')}" placeholder="https://…"/>
      ${lg.trophy_url?`<img src="${escHtml(lg.trophy_url)}" style="height:60px;margin-top:6px;object-fit:contain" onerror="this.style.display='none'">`:''}
    </div>
  `, async () => {
    const name = document.getElementById('le-name').value.trim();
    const season = parseInt(document.getElementById('le-season').value) || lg.season;
    const logo_url = document.getElementById('le-logo').value.trim() || null;
    const trophy_url = document.getElementById('le-trophy').value.trim() || null;
    if (!name) { toast('Название обязательно', 'error'); return false; }
    await PUT('/leagues/'+lg.id, { name, season, logo_url, trophy_url });
    toast('Лига обновлена');
    navigate('/leagues/'+lg.id);
  });
}

async function renderLeagues(app) {
  app.innerHTML = '<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const leagues = await GET('/leagues');
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">🏆 Лиги</h1>
        ${isAdmin() ? `<button class="btn btn-green" onclick="showCreateLeagueForm()">+ New League</button>` : ''}
      </div>
      ${!leagues.length ? `<div class="empty-state"><div class="empty-icon">🏆</div><p>Лиг пока нет</p></div>` :
        leagues.map(l => `
          <div class="card mb-2 clickable-row" onclick="navigate('/leagues/${l.id}')" style="padding:16px 20px;display:flex;align-items:center;gap:16px">
            <div style="flex:1">
              <div style="font-size:18px;font-weight:700">${escHtml(l.name)}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Season ${l.season} · Matchday ${l.current_matchday}/${l.total_matchdays}</div>
            </div>
            <span class="season-badge season-${l.status}">${({active:'Активна',transfer_window:'Трансферное окно',pending:'Ожидание',finished:'Завершена',setup:'Настройка'}[l.status]||l.status.replace('_',' '))}</span>
            ${isAdmin() ? `<div onclick="event.stopPropagation()" style="display:flex;gap:6px">
              ${l.status==='setup'?`<button class="btn btn-sm btn-green" onclick="startLeague(${l.id})">Начать сезон</button>`:''}
              ${l.status==='active'?`<button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="simulateLeagueMatchday(${l.id})">▶ Сыграть тур</button>`:''}
              ${l.status==='transfer_window'?`<button class="btn btn-sm btn-green" onclick="leagueNextSeason(${l.id})">→ Следующий сезон</button>`:''}
              <button class="btn-icon danger" onclick="deleteLeague(${l.id},'${escHtml(l.name)}')">🗑️</button>
            </div>` : ''}
          </div>`).join('')}
    `;
  } catch(err) { app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`; }
}

async function showCreateLeagueForm() {
  const teams = await GET('/teams');
  mkModal('Create League', `
    <div class="form-row">
      <div class="form-group"><label>League Name *</label><input type="text" id="lg-name" value="Premier League"/></div>
      <div class="form-group"><label>Season #</label><input type="number" id="lg-season" value="1" min="1"/></div>
    </div>
    <div class="form-group"><label>Select Teams (pick up to 10)</label>
      <div class="team-checklist">
        ${teams.map(t => `<label class="team-check-item"><input type="checkbox" class="lg-team-cb" value="${t.id}"> ${teamLogoEl(t.logo_url,t.name)} ${escHtml(t.name)}</label>`).join('')}
      </div>
    </div>
  `, async () => {
    const name = document.getElementById('lg-name').value.trim();
    const season = parseInt(document.getElementById('lg-season').value) || 1;
    const team_ids = [...document.querySelectorAll('.lg-team-cb:checked')].map(cb => parseInt(cb.value));
    if (!name) { toast('Name required','error'); return false; }
    if (team_ids.length < 2) { toast('Select at least 2 teams','error'); return false; }
    if (team_ids.length > 20) { toast('Max 20 teams','error'); return false; }
    await POST('/leagues', { name, season, team_ids });
    toast('League created! Now click "Start Season" to generate the schedule.');
  });
}

async function startLeague(id) {
  if (!confirm('Начать сезон?')) return;
  try { await POST('/leagues/'+id+'/start', {}); toast('Сезон начат!'); router(); }
  catch(e) { toast(e.message,'error'); }
}

async function simulateLeagueMatchday(id) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = '…';
  try { const r = await POST('/leagues/'+id+'/simulate-matchday', {}); toast(r.message || 'Тур сыгран!'); router(); }
  catch(e) { toast(e.message,'error'); btn.disabled=false; btn.textContent='▶ Сыграть тур'; }
}

async function leagueNextSeason(id) {
  if (!confirm('Начать новый сезон?')) return;
  try { const r = await POST('/leagues/'+id+'/next-season', {}); toast(r.message || 'Новый сезон начат!'); router(); }
  catch(e) { toast(e.message,'error'); }
}

async function deleteLeague(id, name) {
  if (!confirm(`Delete league "${name}"? All standings and schedule will be lost.`)) return;
  try { await DEL('/leagues/'+id); toast('Deleted'); router(); } catch(e) { toast(e.message,'error'); }
}

async function renderLeagueDetail(app, id) {
  app.innerHTML = '<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const lg = await GET('/leagues/'+id);
    const statusBadge = `<span class="season-badge season-${lg.status}">${({active:'Активна',transfer_window:'Трансферное окно',pending:'Ожидание',finished:'Завершена',setup:'Настройка'}[lg.status]||lg.status.replace('_',' '))}</span>`;
    app.innerHTML = `
      <div class="page-header" style="flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:14px">
          ${lg.logo_url?`<img src="${escHtml(lg.logo_url)}" style="height:56px;width:auto;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">`:''}
          <div>
            <h1 class="page-title">${escHtml(lg.name)}</h1>
            <div style="font-size:13px;color:var(--text-muted);margin-top:2px">Season ${lg.season} · ${statusBadge} · Matchday ${lg.current_matchday}/${lg.total_matchdays}</div>
          </div>
        </div>
        ${isAdmin() ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="showLeagueEditForm(${JSON.stringify(lg).replace(/"/g,'&quot;')})">✏️ Настройки</button>
          ${lg.status==='setup'?`<button class="btn btn-sm btn-green" onclick="startLeague(${lg.id})">Начать сезон</button>`:''}
          ${lg.status==='active'?`<button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="simulateLeagueMatchday(${lg.id})">▶ Сыграть тур</button>`:''}
          ${lg.status==='transfer_window'?`<button class="btn btn-sm btn-green" onclick="leagueNextSeason(${lg.id})">→ Следующий сезон</button>`:''}
        </div>` : ''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="standings">Таблица</button>
        <button class="detail-tab" data-tab="schedule">Расписание</button>
        <button class="detail-tab" data-tab="scorers">Бомбардиры</button>
        <button class="detail-tab" data-tab="assists">Ассистенты</button>
      </div>
      <div id="tab-standings" class="tab-panel active">${renderLeagueStandings(lg.standings)}</div>
      <div id="tab-schedule" class="tab-panel">${renderLeagueSchedule(lg.schedule)}</div>
      <div id="tab-scorers" class="tab-panel">${renderLeagueTopScorers(lg.top_scorers)}</div>
      <div id="tab-assists" class="tab-panel">${renderLeagueTopAssists(lg.top_assists)}</div>
    `;
    setupTabs(app);
  } catch(err) { app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`; }
}

function renderLeagueStandings(standings) {
  if (!standings || !standings.length) return `<div class="empty-state"><div class="empty-icon">📊</div><p>Таблица пуста</p></div>`;
  const n = standings.length;
  return `<div class="card" style="padding:0">
    <table class="league-table">
      <thead><tr>
        <th class="rank-col">#</th>
        <th style="text-align:left;padding-left:12px">Клуб</th>
        <th title="Played">P</th><th title="Won">W</th><th title="Drawn">D</th><th title="Lost">L</th>
        <th title="Goals For">GF</th><th title="Goals Against">GA</th><th title="Goal Difference">GD</th>
        <th class="pts-col" title="Points">Pts</th>
        <th>Форма</th>
      </tr></thead>
      <tbody>
        ${standings.map((s,i) => {
          const gd = (s.goals_for||0)-(s.goals_against||0);
          const zone = i<4?'zone-cl':i<6?'zone-eur':i>=n-3?'zone-rel':'';
          const form = (s.form||[]).map(r=>`<span class="form-badge form-${r.toLowerCase()}">${r}</span>`).join('');
          return `<tr class="clickable-row ${zone}" onclick="navigate('/teams/${s.team_id}')">
            <td class="rank-col">${i+1}</td>
            <td style="text-align:left;padding-left:12px"><div class="flex-center gap-2">${teamLogoEl(s.logo_url,s.team_name)}<span class="font-bold">${escHtml(s.team_name||'–')}</span></div></td>
            <td>${s.played}</td><td>${s.won}</td><td>${s.drawn}</td><td>${s.lost}</td>
            <td>${s.goals_for}</td><td>${s.goals_against}</td>
            <td>${gd>=0?'+':''}${gd}</td>
            <td class="pts-col">${s.points}</td>
            <td>${form}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="padding:10px 14px;font-size:11px;color:var(--text-muted);display:flex;gap:16px;flex-wrap:wrap">
      <span><span style="display:inline-block;width:10px;height:10px;background:#3498db;border-radius:2px;margin-right:4px"></span>Champions League</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#e67e22;border-radius:2px;margin-right:4px"></span>European place</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#e74c3c;border-radius:2px;margin-right:4px"></span>Relegation zone</span>
    </div>
  </div>`;
}

function renderLeagueSchedule(schedule) {
  // schedule may be an object {matchday: [rows]} or an array
  const allRows = Array.isArray(schedule)
    ? schedule
    : Object.values(schedule || {}).flat();
  if (!allRows.length) return `<div class="empty-state"><div class="empty-icon">📅</div><p>Расписание пока не составлено</p></div>`;
  const today = new Date().toISOString().substring(0, 10);
  // Group by calendar date (fall back to matchday if no date)
  const byGroup = {};
  const groupOrder = [];
  for (const s of allRows) {
    const dateKey = s.scheduled_date ? s.scheduled_date.substring(0, 10) : ('md_' + s.matchday);
    if (!byGroup[dateKey]) { byGroup[dateKey] = { games: [], matchday: s.matchday, date: s.scheduled_date ? s.scheduled_date.substring(0, 10) : null }; groupOrder.push(dateKey); }
    byGroup[dateKey].games.push(s);
  }
  return `<div class="card" style="padding:16px">
    ${groupOrder.map(key => {
      const grp = byGroup[key];
      const isToday = grp.date === today;
      const headerLabel = grp.date
        ? `${fmtDate(grp.date)}${isToday ? ' 📍 Сегодня' : ''}`
        : `Тур ${grp.matchday}`;
      return `
      <div class="matchday-group${isToday ? ' matchday-today' : ''}">
        <div class="matchday-header">${headerLabel}</div>
        ${grp.games.map(g => {
          const played = g.match_id && g.home_score !== null;
          const timeStr = played ? '' : '<div class="mi-time">🕕 18:00 МСК</div>';
          return `<div class="matchday-item" ${g.match_id?`onclick="navigate('/matches/${g.match_id}')"`:''}>
            <div class="mi-team home">${escHtml(g.home_team_name||'–')}</div>
            <div class="mi-score-wrap">
              <div class="mi-score ${played?'':'pending'}">${played?`${g.home_score}–${g.away_score}`:'vs'}</div>
              ${timeStr}
            </div>
            <div class="mi-team">${escHtml(g.away_team_name||'–')}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function renderLeagueTopScorers(scorers) {
  if (!scorers || !scorers.length) return `<div class="empty-state"><div class="empty-icon">⚽</div><p>Голов пока нет</p></div>`;
  return `<div class="card" style="padding:16px">
    ${scorers.map((p,i) => `
      <div class="scorers-row clickable-row" onclick="navigate('/players/${p.player_id}')">
        <div class="sr-rank">${i+1}</div>
        ${avatarEl(p.image_url,p.player_name)}
        <div style="flex:1"><div class="font-bold">${escHtml(p.player_name)}</div><div class="text-muted" style="font-size:11px">${escHtml(p.team_name||'–')}</div></div>
        <div class="sr-goals">${p.total_goals}</div><div style="font-size:11px;color:var(--text-muted)">голов</div>
      </div>`).join('')}
  </div>`;
}

function renderLeagueTopAssists(assists) {
  if (!assists || !assists.length) return `<div class="empty-state"><div class="empty-icon">🎯</div><p>Передач пока нет</p></div>`;
  return `<div class="card" style="padding:16px">
    ${assists.map((p,i) => `
      <div class="scorers-row clickable-row" onclick="navigate('/players/${p.player_id}')">
        <div class="sr-rank">${i+1}</div>
        ${avatarEl(p.image_url,p.player_name)}
        <div style="flex:1"><div class="font-bold">${escHtml(p.player_name)}</div><div class="text-muted" style="font-size:11px">${escHtml(p.team_name||'–')}</div></div>
        <div class="sr-assists">${p.total_assists}</div><div style="font-size:11px;color:var(--text-muted)">передач</div>
      </div>`).join('')}
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  COACH DASHBOARD
// ═══════════════════════════════════════════════════════════
async function renderCoachDashboard(app) {
  if (!isCoach() && !isAdmin()) {
    app.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Требуется вход как тренер</p></div>`;
    return;
  }
  app.innerHTML = '<div class="empty-state"><p>Загрузка…</p></div>';
  try {
    const coach = State.coachProfile || await GET('/coaches/me');
    if (!coach) { app.innerHTML = `<div class="empty-state"><div class="empty-icon">⚽</div><p>No coach profile found. Contact admin.</p></div>`; return; }
    State.coachProfile = coach;
    const [team, lineupData, offersData, challengesData] = await Promise.all([
      GET('/teams/'+coach.team_id),
      GET('/lineups/'+coach.team_id).catch(()=>({lineup:[]})),
      GET('/transfer-offers').catch(()=>[]),
      GET('/match-challenges').catch(()=>({incoming:[],outgoing:[]})),
    ]);
    const lineup = { slots: lineupData.lineup || [] };
    const offers = Array.isArray(offersData) ? offersData : [];
    const pendingCount = offers.filter(o=>o.status==='pending').length;
    const challenges = challengesData || { incoming: [], outgoing: [] };
    const pendingChallenges = challenges.incoming.length;
    const totalBudget = team.transfer_budget != null ? team.transfer_budget : 10000000;
    const budgetSpent = team.transfer_budget_spent || 0;
    const budgetAvailable = Math.max(0, totalBudget - budgetSpent);

    app.innerHTML = `
      <div class="coach-hero">
        ${avatarElXL(coach.avatar_url, coach.name)}
        <div class="coach-info">
          <h1>${escHtml(coach.name)}</h1>
          <div class="coach-meta">
            ${coach.age?`<span>Age ${coach.age}</span>`:''}
            ${coach.height?`<span>${coach.height} cm</span>`:''}
            ${coach.playing_style?`<span>Style: ${escHtml(coach.playing_style)}</span>`:''}
          </div>
          ${coach.description?`<div style="margin-top:8px;font-size:13px;color:var(--text-muted)">${escHtml(coach.description)}</div>`:''}
        </div>
        <div class="coach-team-badge">
          ${teamLogoXL(team.logo_url, team.name)}
          <div class="team-name">${escHtml(team.name)}</div>
          <div class="budget-label">${fmtValue(team.market_value)} стоимость состава</div>
        </div>
        <div style="margin-left:8px;display:flex;flex-direction:column;gap:6px">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3);font-size:12px" onclick="showCoachEditForm(${JSON.stringify(coach).replace(/"/g,'&quot;')})">✏️ Профиль</button>
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3);font-size:12px" onclick="showCoachClubForm(${JSON.stringify(coach).replace(/"/g,'&quot;')},${JSON.stringify(team).replace(/"/g,'&quot;')})">🏟️ Клуб</button>
        </div>
      </div>
      <div class="card mb-2" style="padding:16px">
        <div class="card-header" style="margin:-16px -16px 12px;border-radius:10px 10px 0 0">Трансферный бюджет сезона</div>
        <div class="budget-bar"><div class="budget-bar-fill${budgetSpent>totalBudget?' over':''}" style="width:${Math.min(100,Math.round((budgetSpent/Math.max(totalBudget,1))*100))}%"></div></div>
        <div class="budget-stats">
          <div class="budget-stat"><div class="bs-val">${fmtValue(totalBudget)}</div><div class="bs-label">Всего бюджет</div></div>
          <div class="budget-stat"><div class="bs-val spent">${fmtValue(budgetSpent)}</div><div class="bs-label">Потрачено</div></div>
          <div class="budget-stat"><div class="bs-val" style="color:${budgetAvailable>0?'#1565c0':'#d32f2f'}">${fmtValue(budgetAvailable)}</div><div class="bs-label">Доступно</div></div>
        </div>
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="lineup">Состав</button>
        <button class="detail-tab" data-tab="offers">Трансферы ${pendingCount?`<span class="badge badge-gold">${pendingCount}</span>`:''}</button>
        <button class="detail-tab" data-tab="challenges" id="coach-tab-challenges">⚔️ Вызовы ${pendingChallenges?`<span class="badge badge-gold" id="coach-challenges-badge">${pendingChallenges}</span>`:`<span class="badge badge-gold hidden" id="coach-challenges-badge"></span>`}</button>
        <button class="detail-tab" data-tab="post-news">Новость клуба</button>
        <button class="detail-tab" data-tab="squad">Весь состав</button>
        <button class="detail-tab" data-tab="settings">⚙️ Настройки</button>
      </div>
      <div id="tab-lineup" class="tab-panel active"></div>
      <div id="tab-offers" class="tab-panel"></div>
      <div id="tab-challenges" class="tab-panel"></div>
      <div id="tab-post-news" class="tab-panel"></div>
      <div id="tab-squad" class="tab-panel"></div>
      <div id="tab-settings" class="tab-panel"></div>
    `;
    setupTabs(app);

    // Render lineup tab
    document.getElementById('tab-lineup').innerHTML = renderLineupEditor(team, lineup);

    // Render offers tab
    document.getElementById('tab-offers').innerHTML = renderTransferOffersTab(offers, coach.team_id);

    // Render challenges tab
    document.getElementById('tab-challenges').innerHTML = renderChallengesTab(challenges, coach.team_id);

    // Auto-refresh challenges tab when clicked (always fetch fresh data)
    app.querySelector('[data-tab="challenges"]')?.addEventListener('click', async () => {
      const panel = document.getElementById('tab-challenges');
      if (!panel) return;
      try {
        const fresh = await GET('/match-challenges').catch(() => ({ incoming: [], outgoing: [] }));
        panel.innerHTML = renderChallengesTab(fresh, coach.team_id);
      } catch { /* silent */ }
    });

    // Render post news
    document.getElementById('tab-post-news').innerHTML = `
      <div class="card" style="padding:20px">
        <div class="card-header" style="margin:-20px -20px 16px;border-radius:10px 10px 0 0">Новость клуба</div>
        <div class="form-group"><label>Заголовок *</label><input type="text" id="cn-title" placeholder="Заголовок новости…"/></div>
        <div class="form-group"><label>Текст</label><textarea id="cn-body" rows="5" placeholder="Напишите текст новости…" style="resize:vertical"></textarea></div>
        <button class="btn btn-green" onclick="postCoachNews(${coach.team_id})">Опубликовать</button>
      </div>`;

    // Render squad tab
    document.getElementById('tab-squad').innerHTML = renderSquadTab(team, true);

    // Render settings tab
    document.getElementById('tab-settings').innerHTML = `
      <div class="card" style="padding:20px;max-width:480px">
        <div class="card-header" style="margin:-20px -20px 16px;border-radius:10px 10px 0 0">🔑 Изменить пароль</div>
        <div class="form-group"><label>Текущий пароль</label><input type="password" id="coach-pw-cur" autocomplete="current-password"/></div>
        <div class="form-group"><label>Новый пароль</label><input type="password" id="coach-pw-new" autocomplete="new-password"/></div>
        <div class="form-group"><label>Повторите новый пароль</label><input type="password" id="coach-pw-cf" autocomplete="new-password"/></div>
        <button class="btn btn-green" onclick="coachChangePassword()">Сохранить пароль</button>
      </div>`;

  } catch(err) { app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`; }
}

// ─── Interactive Pitch Builder ───────────────────────────────────────────────
function renderLineupEditor(team, lineup) {
  const slots = lineup.slots || [];
  const allPlayers = team.players || [];
  const starterCount = slots.filter(s=>s.slot>=1&&s.slot<=11).length;
  _pitchState = { teamId: team.id, lineup: slots, players: allPlayers, selectedPlayerId: null };

  return `
    <div class="lineup-editor">
      <div class="lineup-save-bar" style="flex-wrap:wrap;gap:8px">
        <span>Схема: <strong id="pb-formation-label">${computeFormation(slots)}</strong></span>
        <span id="pb-starter-count" style="font-size:12px;color:var(--text-muted)">${starterCount}/11 основных</span>
        <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="autoLineup(${team.id})">Авто-подбор</button>
      </div>
      <div class="pb-layout">
        <div class="pb-pitch-wrap" id="pb-pitch">${renderPitchZones(slots)}</div>
        <div class="pb-sidebar">
          <div class="pb-sidebar-header">✋ Перетащите игрока на поле или в скамейку</div>
          <div id="pb-player-list"
               ondragover="event.preventDefault()"
               ondrop="dropOnSidebar(event)"
               ondragleave="event.currentTarget.classList.remove('bench-drop-active')">${renderPitchSidebar(allPlayers, slots, null)}</div>
        </div>
      </div>
      <div id="pb-bench-section" style="margin-top:16px">${renderBenchSection(slots, allPlayers, team.id)}</div>
    </div>`;
}

function renderPitchZones(lineupSlots) {
  const starters = lineupSlots.filter(s=>s.slot>=1&&s.slot<=11);
  const players = _pitchState.players || [];
  const hasSel = !!_pitchState.selectedPlayerId;
  const selPlayer = hasSel ? players.find(p=>p.id===_pitchState.selectedPlayerId) : null;
  const selNaturalZone = selPlayer ? posToZone(selPlayer.position) : null;

  // Build slotId → starterSlot map (handle both new slot IDs and old zone IDs)
  const slotMap = {}; // slotId → s
  const oldZoneStarters = [];
  for (const s of starters) {
    if (PITCH_SLOTS.find(ps=>ps.id===s.position_override)) {
      slotMap[s.position_override] = s;
    } else {
      oldZoneStarters.push(s);
    }
  }
  // Map old zone-based starters to first available slot in that zone
  const usedIds = new Set(Object.keys(slotMap));
  for (const s of oldZoneStarters) {
    const zone = slotToZone(s.position_override) ||
      posToZone(players.find(p=>p.id===s.player_id)?.position);
    const free = PITCH_SLOTS.find(ps=>ps.zone===zone && !usedIds.has(ps.id));
    if (free) { slotMap[free.id] = s; usedIds.add(free.id); }
  }

  let html = '';
  for (const slot of PITCH_SLOTS) {
    const s = slotMap[slot.id];
    if (s) {
      // ── Filled slot ─────────────────────────────────────────
      const p = players.find(pl=>pl.id===s.player_id);
      if (!p) continue;
      const ini = p.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
      const ovr = calcOverall(p, slot.id);
      const naturalZone = posToZone(p.position);
      const outOfPos = naturalZone !== slot.zone;
      const ovrColor = !ovr ? '#888' : ovr>=80 ? '#f1c40f' : ovr>=70 ? '#2ecc71' : ovr>=60 ? '#3498db' : '#95a5a6';
      const isInjured = s.injury_matches_remaining > 0;
      const zoneLabel = { GK:'Вратарь', DEF:'Защитник', DMF:'Опорный', MID:'Полузащитник', AMF:'Атакующий', FWD:'Нападающий' };
      const bestZone = zoneLabel[naturalZone] || naturalZone;
      const curZone = zoneLabel[slot.zone] || slot.zone;
      const posHint = `${escHtml(p.name)} | Предпочитает: ${escHtml(p.position||naturalZone)} (${bestZone})${outOfPos?' | Текущая позиция: '+curZone+' ⚠':''}${isInjured?' | ⚠ ТРАВМА':''}`;
      html += `<div class="pb-slot pb-slot-filled${isInjured?' pb-slot-injured':''}"
        style="left:${slot.x}%;top:${slot.y}%"
        onclick="event.stopPropagation();pitchPlayerDotClick(${p.id})"
        title="${posHint}">
        <div class="pb-slot-av">
          ${p.image_url?`<img src="${escHtml(p.image_url)}" onerror="this.style.display='none'">`:`<span>${escHtml(ini)}</span>`}
          ${isInjured?'<span class="pb-inj-icon">🚑</span>':''}
        </div>
        <div class="pb-slot-name">${escHtml(p.name.split(' ')[0])}</div>
        <div class="pb-slot-ovr" style="color:${isInjured?'#e74c3c':ovrColor}">${isInjured?'❌':(ovr!=null?ovr+(outOfPos?'⚠':''):'?')}</div>
        <div class="pb-slot-remove-badge">✕</div>
      </div>`;
    } else {
      // ── Empty slot ──────────────────────────────────────────
      const preferred = hasSel && slot.zone === selNaturalZone;
      const active = hasSel;
      html += `<div class="pb-slot pb-slot-empty${active?' pb-slot-available':''}${preferred?' pb-slot-preferred':''}"
        style="left:${slot.x}%;top:${slot.y}%"
        onclick="pitchSlotClick('${slot.id}',event)"
        ondragover="event.preventDefault();event.currentTarget.classList.add('pb-slot-drag-over')"
        ondragleave="event.currentTarget.classList.remove('pb-slot-drag-over')"
        ondrop="event.currentTarget.classList.remove('pb-slot-drag-over');dropOnZone('${slot.id}',event)"
        title="${slot.label}${active?' — нажмите чтобы поставить':''}">
        <span class="pb-slot-empty-label">${slot.label}</span>
      </div>`;
    }
  }
  return `<div style="position:relative">${PITCH_SVG}<div class="pitch-overlay">${html}</div></div>`;
}

function _buildInjuredIds(lineupSlots, allPlayers) {
  const ids = new Set();
  for (const s of lineupSlots) { if (s.injury_matches_remaining > 0) ids.add(s.player_id); }
  for (const p of allPlayers)  { if (p.injury_matches_remaining > 0) ids.add(p.id); }
  return ids;
}

function renderPitchSidebar(allPlayers, lineupSlots, selectedId) {
  // Show only players not assigned to ANY slot (neither starters nor bench)
  const inAnySlot = new Set(lineupSlots.map(s=>s.player_id));
  const injuredIds = _buildInjuredIds(lineupSlots, allPlayers);
  const available = allPlayers.filter(p => !inAnySlot.has(p.id) && !injuredIds.has(p.id));
  if (!available.length) return '<div class="text-muted" style="padding:12px;font-size:13px">Все игроки распределены ✓</div>';
  return available.map(p => {
    const sel = p.id === selectedId;
    const ovr = calcOverall(p);
    const ovrColor = !ovr ? '#888' : ovr >= 80 ? '#f1c40f' : ovr >= 70 ? '#2ecc71' : ovr >= 60 ? '#3498db' : '#95a5a6';
    const natZone = posToZone(p.position);
    const zoneNames = { GK:'Вратарь', DEF:'Защитник', DMF:'Опорный', MID:'Полузащитник', AMF:'Атакующий', FWD:'Нападающий' };
    const tooltip = `${p.name} | Позиция: ${p.position||'–'} | Лучшая зона: ${zoneNames[natZone]||natZone}${p.sub_position?' ('+p.sub_position+')':''}`;
    return `<div class="pb-player-row${sel?' pb-selected':''}"
      draggable="true"
      ondragstart="dragPlayerStart(${p.id},'sidebar',event)"
      onclick="pitchPlayerClick(${p.id})"
      title="${escHtml(tooltip)}">
      ${avatarEl(p.image_url,p.name)}
      <div style="flex:1;min-width:0">
        <div class="font-bold" style="font-size:13px">${escHtml(p.name)}</div>
        <div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap;margin-top:1px">${posBadge(p.position)}${zoneBadge(natZone, p)}</div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${ovrColor};min-width:24px;text-align:right">${ovr??'?'}</span>
      ${sel?`<span style="color:var(--blue);font-size:14px;font-weight:700;margin-left:4px">✓</span>`:''}
    </div>`;
  }).join('');
}

function injuredPlayerClick() {
  toast('Игрок травмирован и не может выйти на поле', 'error');
}

// ─── Bench section: 3 columns ────────────────────────────────────────────────
function renderBenchSection(lineupSlots, allPlayers, teamId) {
  const benchSlots = lineupSlots.filter(s=>s.slot>11);
  const injuredIds = _buildInjuredIds(lineupSlots, allPlayers);

  // Priority subs (priority_sub=1, max 3)
  const priority = benchSlots.filter(s => s.priority_sub && !injuredIds.has(s.player_id));
  // Regular bench (not priority, not injured)
  const regular  = benchSlots.filter(s => !s.priority_sub && !injuredIds.has(s.player_id));
  // Injured players from entire squad (not just bench)
  const allInjuredPlayers = allPlayers.filter(p => injuredIds.has(p.id));

  function benchCard(s, opts={}) {
    const p = allPlayers.find(pl=>pl.id===s.player_id);
    if (!p) return '';
    const ovr = calcOverall(p);
    const ovrColor = !ovr?'#888':ovr>=80?'#f1c40f':ovr>=70?'#2ecc71':ovr>=60?'#3498db':'#95a5a6';
    const assignedZone = s.position_override && ALL_ZONES.includes(s.position_override) ? s.position_override : posToZone(p.position);
    return `<div class="bench-card${opts.priority?' bench-priority':''}"
      draggable="true"
      ondragstart="dragPlayerStart(${p.id},'${opts.priority?'priority':'bench'}',event)">
      <div style="position:relative;flex-shrink:0">${avatarEl(p.image_url,p.name)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
        <div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap;margin-top:2px">${posBadge(p.position)}${zoneBadge(assignedZone, p)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
        <span style="font-size:11px;font-weight:800;color:${ovrColor}">${ovr??'?'}</span>
        ${opts.showPriority?`<label class="priority-sub-label" title="Приоритетная замена" onclick="event.stopPropagation()"><input type="checkbox" ${s.priority_sub?'checked':''} onchange="togglePrioritySub(${p.id},${teamId},this.checked)"> ⭐</label>`:''}
        <button class="btn-icon" onclick="pitchReserveToStarter(${p.id},${teamId})" title="В основу">⚡</button>
        <button class="btn-icon danger" onclick="pitchRemoveFromLineup(${p.id},${teamId})" title="Убрать">✕</button>
      </div>
    </div>`;
  }

  function injCard(p) {
    const ovr = calcOverall(p);
    const mr = p.injury_matches_remaining || 0;
    return `<div class="bench-card bench-injured-card">
      <div style="flex-shrink:0">${avatarEl(p.image_url,p.name)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:#e74c3c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
        <div>${posBadge(p.position)}</div>
        <div style="font-size:10px;color:#e74c3c;margin-top:2px">🚑 ещё ${mr} матч${mr===1?'':'а(ей)'}</div>
      </div>
      <span style="font-size:11px;font-weight:800;color:#e74c3c">${ovr??'?'}</span>
    </div>`;
  }

  const dropAttrs = (type) =>
    `ondragover="event.preventDefault();event.currentTarget.classList.add('bench-drop-active')"` +
    ` ondragleave="event.currentTarget.classList.remove('bench-drop-active')"` +
    ` ondrop="dropOnBench('${type}',event)"`;

  return `<div class="bench-grid">
    <div class="bench-col">
      <div class="bench-col-header bench-header-priority">⭐ Замены в приоритете <span class="bench-count">${priority.length}/3</span></div>
      <div class="bench-col-body bench-drop-zone" ${dropAttrs('priority')}>${priority.length
        ? priority.map(s=>benchCard(s,{priority:true,showPriority:true})).join('')
        : '<div class="bench-empty">Перетащите игрока сюда</div>'}</div>
    </div>
    <div class="bench-col">
      <div class="bench-col-header bench-header-bench">🪑 Скамейка запасных <span class="bench-count">${regular.length}</span></div>
      <div class="bench-col-body bench-drop-zone" ${dropAttrs('bench')}>${regular.length
        ? regular.map(s=>benchCard(s,{showPriority:true})).join('')
        : '<div class="bench-empty">Перетащите игрока сюда</div>'}</div>
    </div>
    <div class="bench-col">
      <div class="bench-col-header bench-header-injured">🚑 Лазарет <span class="bench-count">${allInjuredPlayers.length}</span></div>
      <div class="bench-col-body">${allInjuredPlayers.length
        ? allInjuredPlayers.map(injCard).join('')
        : '<div class="bench-empty">Травмированных нет</div>'}</div>
    </div>
  </div>`;
}

function renderReservesList(lineupSlots, allPlayers, teamId) {
  const reserves = lineupSlots.filter(s=>s.slot>11).sort((a,b)=>a.slot-b.slot);
  if (!reserves.length) return `<div style="color:var(--text-muted);font-size:12px;padding:4px 0">Нет запасных</div>`;
  return reserves.map(s => {
    const p = allPlayers.find(pl=>pl.id===s.player_id);
    if (!p) return '';
    const injured = s.injury_matches_remaining > 0;
    const isPriority = !!s.priority_sub;
    const assignedZone = s.position_override && ALL_ZONES.includes(s.position_override) ? s.position_override : posToZone(p.position);
    return `<div class="player-card${injured?' pc-injured':''}">
      <div style="position:relative">${avatarEl(p.image_url,p.name)}${injured?`<span class="inj-badge" title="Травма: ещё ${s.injury_matches_remaining} матча(ей)">🚑</span>`:''}</div>
      <div class="pc-info">
        <div class="pc-name">${escHtml(p.name)}${injured?` <span style="color:#e74c3c;font-size:10px">(травма ${s.injury_matches_remaining})</span>`:''}</div>
        <div class="pc-pos" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${posBadge(p.position)}${zoneBadge(assignedZone, p)}</div>
      </div>
      <div class="pc-btn" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <label class="priority-sub-label" title="Приоритетная замена — выйдет первым">
          <input type="checkbox" ${isPriority?'checked':''} onchange="togglePrioritySub(${p.id},${teamId},this.checked)"> ⭐
        </label>
        <div style="display:flex;gap:2px">
          <button class="btn-icon" onclick="pitchReserveToStarter(${p.id},${teamId})" title="Поставить в основу">⚡</button>
          <button class="btn-icon danger" onclick="pitchRemoveFromLineup(${p.id},${teamId})" title="Убрать из состава">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function togglePrioritySub(playerId, teamId, checked) {
  if (checked) {
    const cnt = _pitchState.lineup.filter(s => s.priority_sub && s.player_id !== playerId && s.slot > 11).length;
    if (cnt >= 3) {
      toast('Максимум 3 приоритетных замены', 'error');
      // Reset the checkbox UI
      const el = document.getElementById('pb-bench-section');
      if (el) el.innerHTML = renderBenchSection(_pitchState.lineup, _pitchState.players, teamId);
      return;
    }
  }
  const current = _pitchState.lineup.map(s => ({
    ...s,
    priority_sub: s.player_id === playerId ? (checked ? 1 : 0) : (s.priority_sub || 0)
  }));
  try {
    await PUT('/lineups/'+teamId, { lineup: current });
    _pitchState.lineup = current;
    // re-render reserves only
    const el = document.getElementById('pb-bench-section');
    if (el) el.innerHTML = renderBenchSection(_pitchState.lineup, _pitchState.players, teamId);
  } catch(e) { toast(e.message,'error'); }
}

// ─── Drag-and-drop helpers ───────────────────────────────────────────────────
let _dragPlayerId = null;
let _dragSource   = null; // 'sidebar' | 'bench' | 'priority'

function dragPlayerStart(playerId, source, event) {
  _dragPlayerId = playerId;
  _dragSource   = source;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(playerId));
}

async function _placePlayerOnPitch(pid, slotId) {
  const player = _pitchState.players.find(p=>p.id===pid);
  if (player?.injury_matches_remaining > 0) { toast('Игрок травмирован', 'error'); return; }
  const tid = _pitchState.teamId;
  const starters = _pitchState.lineup.filter(s=>s.slot>=1&&s.slot<=11);
  // If already a starter, just move to new slot
  if (starters.find(s=>s.player_id===pid)) {
    const current = _pitchState.lineup.map(s=>s.player_id===pid?{...s,position_override:slotId}:s);
    await PUT('/lineups/'+tid, {lineup:current});
    await refreshPitchEditor();
    return;
  }
  if (starters.length >= 11) { toast('Основной состав заполнен (11/11)', 'error'); return; }
  const usedNums = new Set(starters.map(s=>s.slot));
  let freeNum = null;
  for (let i=1;i<=11;i++) { if(!usedNums.has(i)){freeNum=i;break;} }
  const current = _pitchState.lineup.filter(s=>s.player_id!==pid);
  current.push({slot:freeNum, player_id:pid, position_override:slotId});
  await PUT('/lineups/'+tid, {lineup:current});
  await refreshPitchEditor();
}

async function dropOnZone(slotId, event) {
  event.preventDefault();
  const pid = _dragPlayerId;
  if (!pid) return;
  try { await _placePlayerOnPitch(pid, slotId); } catch(e){toast(e.message,'error');}
}

async function dropOnBench(targetType, event) {
  event.preventDefault();
  event.currentTarget.classList.remove('bench-drop-active');
  const pid = _dragPlayerId;
  if (!pid) return;
  const player = _pitchState.players.find(p=>p.id===pid);
  if (player?.injury_matches_remaining > 0) { toast('Травмированный игрок в лазарете', 'error'); return; }
  const tid = _pitchState.teamId;
  const isPriority = targetType === 'priority';
  if (isPriority) {
    const cnt = _pitchState.lineup.filter(s=>s.priority_sub&&s.player_id!==pid&&s.slot>11).length;
    if (cnt >= 3) { toast('Максимум 3 приоритетных замены', 'error'); return; }
  }
  const existing = _pitchState.lineup.find(s=>s.player_id===pid&&s.slot>11);
  let current;
  if (existing) {
    // Already on bench — just toggle priority
    current = _pitchState.lineup.map(s=>s.player_id===pid?{...s,priority_sub:isPriority?1:0}:s);
  } else {
    const usedBench = new Set(_pitchState.lineup.filter(s=>s.slot>11).map(s=>s.slot));
    let slot = null;
    for (let i=12;i<=999;i++){if(!usedBench.has(i)){slot=i;break;}}
    if (!slot) { toast('Скамейка запасных заполнена', 'error'); return; }
    current = _pitchState.lineup.filter(s=>s.player_id!==pid);
    current.push({slot, player_id:pid, position_override:null, priority_sub:isPriority?1:0});
  }
  try { await PUT('/lineups/'+tid,{lineup:current}); await refreshPitchEditor(); } catch(e){toast(e.message,'error');}
}

async function dropOnSidebar(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('bench-drop-active');
  const pid = _dragPlayerId;
  if (!pid || _dragSource === 'sidebar') return;
  const current = _pitchState.lineup.filter(s=>s.player_id!==pid);
  try { await PUT('/lineups/'+_pitchState.teamId,{lineup:current}); await refreshPitchEditor(); } catch(e){toast(e.message,'error');}
}

function pitchPlayerClick(playerId) {
  _pitchState.selectedPlayerId = _pitchState.selectedPlayerId === playerId ? null : playerId;
  const el = document.getElementById('pb-player-list');
  if (el) el.innerHTML = renderPitchSidebar(_pitchState.players, _pitchState.lineup, _pitchState.selectedPlayerId);
  const pitchEl = document.getElementById('pb-pitch');
  if (pitchEl) pitchEl.innerHTML = renderPitchZones(_pitchState.lineup);
}

async function pitchSlotClick(slotId, event) {
  if (event) event.stopPropagation();
  const pid = _pitchState.selectedPlayerId;
  if (!pid) return;
  try { await _placePlayerOnPitch(pid, slotId); } catch(e) { toast(e.message,'error'); }
}

// kept for backward compat (auto-lineup etc.)
async function pitchZoneClick(zoneId) {
  const pid = _pitchState.selectedPlayerId;
  if (!pid) return;
  const usedSlotIds = new Set(_pitchState.lineup.filter(s=>s.slot>=1&&s.slot<=11).map(s=>s.position_override));
  const free = PITCH_SLOTS.find(s=>s.zone===zoneId && !usedSlotIds.has(s.id));
  if (free) return pitchSlotClick(free.id, null);
  toast('Нет свободных позиций в этой зоне', 'error');
}

async function pitchPlayerDotClick(playerId) {
  const tid = _pitchState.teamId;
  const usedReserveSlots = new Set(_pitchState.lineup.filter(s=>s.slot>11).map(s=>s.slot));
  let reserveSlot = null;
  for (let i=12;i<=999;i++) { if(!usedReserveSlots.has(i)){reserveSlot=i;break;} }
  try {
    const current = _pitchState.lineup.filter(s=>s.player_id!==playerId);
    if (reserveSlot) current.push({ slot: reserveSlot, player_id: playerId, position_override: null });
    await PUT('/lineups/'+tid, { lineup: current });
    await refreshPitchEditor();
  } catch(e) { toast(e.message,'error'); }
}

async function pitchReserveToStarter(playerId, teamId) {
  const starters = _pitchState.lineup.filter(s=>s.slot>=1&&s.slot<=11);
  if (starters.length >= 11) { toast('Основной состав заполнен (11/11)', 'error'); return; }
  const usedSlots = new Set(starters.map(s=>s.slot));
  let freeSlot = null;
  for (let i=1;i<=11;i++) { if(!usedSlots.has(i)){freeSlot=i;break;} }
  const p = _pitchState.players.find(pl=>pl.id===playerId);
  // Find a free slot matching natural position
  const naturalZone = p ? posToZone(p.position) : 'MID';
  const usedSlotIds = new Set(starters.map(s=>s.position_override));
  const targetSlot = PITCH_SLOTS.find(s=>s.zone===naturalZone&&!usedSlotIds.has(s.id))
    || PITCH_SLOTS.find(s=>!usedSlotIds.has(s.id))
    || PITCH_SLOTS[0];
  try {
    const current = _pitchState.lineup.filter(s=>s.player_id!==playerId);
    current.push({ slot: freeSlot, player_id: playerId, position_override: targetSlot.id });
    await PUT('/lineups/'+teamId, { lineup: current });
    await refreshPitchEditor();
  } catch(e) { toast(e.message,'error'); }
}

async function pitchRemoveFromLineup(playerId, teamId) {
  try {
    const current = _pitchState.lineup.filter(s=>s.player_id!==playerId);
    await PUT('/lineups/'+teamId, { lineup: current });
    await refreshPitchEditor();
  } catch(e) { toast(e.message,'error'); }
}

async function refreshPitchEditor() {
  const tid = _pitchState.teamId;
  try {
    const lr = await GET('/lineups/'+tid);
    _pitchState.lineup = lr.lineup || [];
    _pitchState.selectedPlayerId = null;
    const starters = _pitchState.lineup.filter(s=>s.slot>=1&&s.slot<=11);
    const reserves = _pitchState.lineup.filter(s=>s.slot>11);
    const $ = id => document.getElementById(id);
    if ($('pb-pitch')) $('pb-pitch').innerHTML = renderPitchZones(_pitchState.lineup);
    if ($('pb-player-list')) $('pb-player-list').innerHTML = renderPitchSidebar(_pitchState.players, _pitchState.lineup, null);
    if ($('pb-bench-section')) $('pb-bench-section').innerHTML = renderBenchSection(_pitchState.lineup, _pitchState.players, tid);
    if ($('pb-starter-count')) $('pb-starter-count').textContent = `${starters.length}/11 основных`;
    if ($('pb-formation-label')) $('pb-formation-label').textContent = computeFormation(_pitchState.lineup);
    if ($('pb-reserve-count')) $('pb-reserve-count').textContent = `${reserves.length} запасных`;
  } catch(e) { toast(e.message,'error'); }
}

async function autoLineup(teamId) {
  if (!confirm('Автоматически распределить всех игроков?')) return;
  try {
    await POST('/lineups/'+teamId+'/auto', {});
    toast('Состав автоматически сформирован!');
    await refreshPitchEditor();
  } catch(e) { toast(e.message,'error'); }
}

async function postCoachNews(teamId) {
  const title = document.getElementById('cn-title').value.trim();
  const body = document.getElementById('cn-body').value.trim();
  if (!title) { toast('Заголовок обязателен','error'); return; }
  try {
    await POST('/coaches/me/news', {title, body});
    toast('Новость опубликована!');
    document.getElementById('cn-title').value = '';
    document.getElementById('cn-body').value = '';
  } catch(e) { toast(e.message,'error'); }
}

function renderTransferOffersTab(offers, myTeamId) {
  const received = offers.filter(o=>o.to_team_id===myTeamId&&o.status==='pending');
  const sent = offers.filter(o=>o.from_team_id===myTeamId);
  const fmtStatus = s => ({pending:'🕐 В ожидании',accepted:'✅ Принято',rejected:'❌ Отклонено',cancelled:'⚫ Отменено'}[s]||s);

  const offerCard = (o, isReceived) => `
    <div class="offer-card offer-${o.status}">
      <div class="offer-header">
        <span class="offer-type-badge offer-${o.offer_type}">${o.offer_type}</span>
        <span class="font-bold">${escHtml(o.player_name||'Player')}</span>
        <span class="text-muted" style="font-size:12px">${isReceived?`From ${escHtml(o.from_team_name)}`:`To ${escHtml(o.to_team_name)}`}</span>
        <span class="ml-auto">${fmtStatus(o.status)}</span>
      </div>
      <div class="offer-amount">${fmtValue(o.amount)}</div>
      ${o.offer_type==='loan'?`<div class="offer-meta">Срок аренды: ${o.loan_months} мес.</div>`:''}
      ${o.offer_type==='swap'&&o.swap_player_name?`<div class="offer-meta">Обмен на: <strong>${escHtml(o.swap_player_name)}</strong></div>`:''}
      ${o.message?`<div class="offer-meta" style="margin-top:6px;font-style:italic">"${escHtml(o.message)}"</div>`:''}
      <div class="offer-meta">${fmtDate(o.created_at)}</div>
      ${isReceived&&o.status==='pending'?`
        <div class="offer-actions">
          <button class="btn btn-green" onclick="respondOffer(${o.id},'accept')">✓ Принять</button>
          <button class="btn btn-outline" style="color:#e74c3c;border-color:#e74c3c" onclick="respondOffer(${o.id},'reject')">✗ Отклонить</button>
        </div>` : ''}
      ${!isReceived&&o.status==='pending'?`
        <div class="offer-actions">
          <button class="btn btn-outline" style="color:#e74c3c;border-color:#e74c3c;font-size:12px" onclick="respondOffer(${o.id},'cancel')">Отменить предложение</button>
        </div>` : ''}
    </div>`;

  return `
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div class="font-bold">Трансферные предложения</div>
        <button class="btn btn-green" onclick="showSendOfferForm()">+ Отправить предложение</button>
      </div>
      ${received.length?`<div style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:8px">Получено (${received.length})</div>${received.map(o=>offerCard(o,true)).join('')}`:''}
      ${sent.length?`<div style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:8px;margin-top:${received.length?16:0}px">Отправлено (${sent.length})</div>${sent.map(o=>offerCard(o,false)).join('')}`:''}
      ${!received.length&&!sent.length?`<div class="empty-state" style="padding:30px"><div class="empty-icon">📨</div><p>Предложений ещё нет</p></div>`:''}
    </div>`;
}

async function respondOffer(id, action) {
  const labels = {accept:'Принять предложение?',reject:'Отклонить предложение?',cancel:'Отменить предложение?'};
  if (!confirm(labels[action])) return;
  try {
    await PUT('/transfer-offers/'+id+'/'+action, {});
    toast(action==='accept'?'Трансфер завершён!':action==='reject'?'Предложение отклонено':'Предложение отменено');
    navigate('/coach');
  } catch(e) { toast(e.message,'error'); }
}

async function showSendOfferForm() {
  const teams = await GET('/teams');
  const coach = State.coachProfile;
  const myTeamId = coach?.team_id;
  const otherTeams = teams.filter(t=>t.id!==myTeamId);
  mkModal('Отправить трансферное предложение', `
    <div class="form-group"><label>Команда-получатель *</label>
      <select id="sof-team" onchange="loadTeamPlayersForOffer()">
        <option value="">Выберите команду…</option>
        ${otherTeams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Игрок *</label><select id="sof-player"><option value="">Сначала выберите команду…</option></select></div>
    <div class="form-row">
      <div class="form-group"><label>Тип</label>
        <select id="sof-type"><option value="buy">Покупка</option><option value="loan">Аренда</option></select>
      </div>
      <div class="form-group"><label>Сумма (€) *</label><input type="number" id="sof-amount" step="100000" min="0"/></div>
    </div>
    <div class="form-group"><label>Срок аренды (мес.)</label><input type="number" id="sof-months" value="6" min="1" max="24"/></div>
    <div class="form-group"><label>Сообщение (необязательно)</label><textarea id="sof-msg" rows="2"></textarea></div>
  `, async () => {
    const to_team_id = parseInt(document.getElementById('sof-team').value);
    const player_id = parseInt(document.getElementById('sof-player').value);
    const offer_type = document.getElementById('sof-type').value;
    const amount = parseFloat(document.getElementById('sof-amount').value)||0;
    const loan_months = parseInt(document.getElementById('sof-months').value)||6;
    const message = document.getElementById('sof-msg').value.trim()||null;
    if (!to_team_id||!player_id||!amount) { toast('Заполните все обязательные поля','error'); return false; }
    await POST('/transfer-offers', {to_team_id,player_id,offer_type,amount,loan_months,message});
    toast('Предложение отправлено!');
  });
}

async function loadTeamPlayersForOffer() {
  const teamId = document.getElementById('sof-team').value;
  const sel = document.getElementById('sof-player');
  if (!teamId) { sel.innerHTML='<option value="">Сначала выберите команду…</option>'; return; }
  const players = await GET('/players?team_id='+teamId).catch(()=>[]);
  sel.innerHTML = players.map(p=>`<option value="${p.id}">${escHtml(p.name)} (${fmtValue(p.market_value)})</option>`).join('');
}

// ── Match challenges tab ──────────────────────────────────────────────────────
const CHALLENGES_VISIBLE = 5;
let _challengesExpanded = { in: false, out: false };

function renderChallengesTab(data, myTeamId) {
  const { incoming = [], outgoing = [] } = data;
  const statusLabel = { pending:'🕐 Ожидает', accepted:'✅ Принято', declined:'❌ Отклонено' };
  const statusCls   = { pending:'badge-gold', accepted:'badge-green', declined:'badge-red' };

  const inVisible = _challengesExpanded.in ? incoming : incoming.slice(0, CHALLENGES_VISIBLE);
  const outVisible = _challengesExpanded.out ? outgoing : outgoing.slice(0, CHALLENGES_VISIBLE);

  const incomingHtml = incoming.length
    ? inVisible.map(c => `
      <div class="challenge-card" id="ch-card-${c.id}">
        <div class="challenge-from">
          ${c.from_team_logo ? `<img src="${escHtml(c.from_team_logo)}" class="challenge-logo" onerror="this.style.display='none'">` : ''}
          <strong>${escHtml(c.from_team_name)}</strong>
          <span class="text-muted" style="font-size:12px">вызывает вас на товарищеский матч</span>
        </div>
        ${c.message ? `<div class="challenge-msg">"${escHtml(c.message)}"</div>` : ''}
        <div class="challenge-meta">${fmtDate(c.created_at)}</div>
        <div class="challenge-actions">
          <button class="btn btn-green" onclick="respondChallenge(${c.id},'accept')">✅ Принять</button>
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="respondChallenge(${c.id},'decline')">❌ Отклонить</button>
        </div>
      </div>`).join('')
      + (incoming.length > CHALLENGES_VISIBLE && !_challengesExpanded.in
        ? `<div class="notif-show-more" onclick="_challengesExpanded.in=true;reloadCoachChallengesTab()">Показать ещё ${incoming.length - CHALLENGES_VISIBLE} →</div>`
        : '')
    : '<div class="empty-state" style="padding:20px"><p>Входящих вызовов нет</p></div>';

  const outgoingHtml = outgoing.length
    ? outVisible.map(c => `
      <div class="challenge-card">
        <div class="challenge-from">
          ${c.to_team_logo ? `<img src="${escHtml(c.to_team_logo)}" class="challenge-logo" onerror="this.style.display='none'">` : ''}
          <strong>${escHtml(c.to_team_name)}</strong>
          <span class="badge ${statusCls[c.status]||'badge-gray'}" style="margin-left:8px">${statusLabel[c.status]||c.status}</span>
        </div>
        ${c.message ? `<div class="challenge-msg">"${escHtml(c.message)}"</div>` : ''}
        <div class="challenge-meta">${fmtDate(c.created_at)}</div>
        ${c.status==='pending'
          ? `<button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3);margin-top:6px" onclick="cancelChallenge(${c.id},this)">Отменить</button>`
          : c.status==='accepted' && c.match_id
            ? `<button class="btn btn-sm btn-green" style="margin-top:6px" onclick="navigate('/matches/${c.match_id}')">Перейти к матчу →</button>`
            : ''}
      </div>`).join('')
      + (outgoing.length > CHALLENGES_VISIBLE && !_challengesExpanded.out
        ? `<div class="notif-show-more" onclick="_challengesExpanded.out=true;reloadCoachChallengesTab()">Показать ещё ${outgoing.length - CHALLENGES_VISIBLE} →</div>`
        : '')
    : '<div class="empty-state" style="padding:20px"><p>Исходящих вызовов нет</p></div>';

  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;padding:8px 0">
      <div class="card" style="flex:1;min-width:260px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>Входящие вызовы ${incoming.length ? `<span class="badge badge-gold">${incoming.length}</span>` : ''}</span>
          ${incoming.length ? `<button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3);font-size:11px" onclick="clearIncomingChallenges()">✕ Очистить</button>` : ''}
        </div>
        <div style="padding:12px">${incomingHtml}</div>
      </div>
      <div class="card" style="flex:1;min-width:260px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>Исходящие вызовы</span>
          <div style="display:flex;gap:6px">
            ${outgoing.length ? `<button class="btn btn-sm btn-outline" style="color:#fff;border-color:rgba(255,255,255,.3);font-size:11px" onclick="clearOutgoingChallenges()">✕ Очистить</button>` : ''}
            <button class="btn btn-sm btn-green" onclick="showSendChallengeModal()">⚔️ Вызвать</button>
          </div>
        </div>
        <div style="padding:12px">${outgoingHtml}</div>
      </div>
    </div>`;
}

async function reloadCoachChallengesTab() {
  const panel = document.getElementById('tab-challenges');
  if (!panel) return;
  const ch = await GET('/match-challenges').catch(() => ({ incoming: [], outgoing: [] }));
  panel.innerHTML = renderChallengesTab(ch, State.coachProfile?.team_id);
}

async function clearIncomingChallenges() {
  try {
    const ch = await GET('/match-challenges').catch(() => ({ incoming: [] }));
    for (const c of (ch.incoming || [])) {
      await PUT(`/match-challenges/${c.id}/decline`, {}).catch(() => {});
    }
    _challengesExpanded.in = false;
    await reloadCoachChallengesTab();
    toast('Входящие вызовы очищены');
  } catch(e) { toast(e.message, 'error'); }
}

async function clearOutgoingChallenges() {
  try {
    const ch = await GET('/match-challenges').catch(() => ({ outgoing: [] }));
    for (const c of (ch.outgoing || [])) {
      if (c.status !== 'pending') await DEL('/match-challenges/' + c.id).catch(() => {});
      else await DEL('/match-challenges/' + c.id).catch(() => {});
    }
    _challengesExpanded.out = false;
    await reloadCoachChallengesTab();
    toast('Исходящие вызовы очищены');
  } catch(e) { toast(e.message, 'error'); }
}

async function respondChallenge(id, action) {
  try {
    const r = await PUT(`/match-challenges/${id}/${action}`, {});
    if (action === 'accept') {
      toast('Матч создан! Перейдите в раздел матчей.');
      navigate('/matches/' + r.match_id);
    } else {
      toast('Вызов отклонён');
      const card = document.getElementById('ch-card-' + id);
      if (card) card.remove();
    }
  } catch(e) { toast(e.message, 'error'); }
}

async function cancelChallenge(id, btn) {
  try {
    await DEL('/match-challenges/' + id);
    toast('Вызов отменён');
    btn.closest('.challenge-card').remove();
  } catch(e) { toast(e.message, 'error'); }
}

async function showSendChallengeToTeam(teamId, teamName) {
  mkModal(`⚔️ Вызов на матч: ${teamName}`, `
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Вызов на <strong>товарищеский матч</strong> будет отправлен тренеру команды <strong>${escHtml(teamName)}</strong>. Матч будет создан после подтверждения.</p>
    <div class="form-group">
      <label>Сообщение (необязательно)</label>
      <textarea id="ch-msg-direct" rows="2" placeholder="Привет! Сыграем товарищеский матч?"></textarea>
    </div>
  `, async () => {
    const message = document.getElementById('ch-msg-direct').value.trim() || null;
    await POST('/match-challenges', { to_team_id: teamId, message });
    toast(`Вызов отправлен команде ${teamName}!`);
    return true;
  });
}

async function showSendChallengeModal() {
  const teams = await GET('/teams').catch(()=>[]);
  const myTeamId = State.coachProfile?.team_id;
  const others = teams.filter(t => t.id !== myTeamId);
  mkModal('⚔️ Вызов на товарищеский матч', `
    <div class="form-group">
      <label>Команда соперника *</label>
      <select id="ch-to-team">
        <option value="">Выберите команду…</option>
        ${others.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Сообщение (необязательно)</label>
      <textarea id="ch-msg" rows="2" placeholder="Привет! Сыграем товарищеский матч?"></textarea>
    </div>
    <p style="font-size:12px;color:var(--text-muted)">Вызов будет отправлен тренеру команды. Матч состоится после подтверждения.</p>
  `, async () => {
    const to_team_id = document.getElementById('ch-to-team').value;
    const message = document.getElementById('ch-msg').value.trim() || null;
    if (!to_team_id) { toast('Выберите команду', 'error'); return false; }
    await POST('/match-challenges', { to_team_id: parseInt(to_team_id), message });
    toast('Вызов отправлен!');
    navigate('/coach');
    return true;
  });
}

// Challenge button on team profile (for coaches only)
async function challengeTeam(teamId, teamName) {
  if (!isCoach()) return;
  const message = null;
  try {
    await POST('/match-challenges', { to_team_id: teamId, message });
    toast(`Вызов на матч отправлен команде ${teamName}!`);
  } catch(e) { toast(e.message, 'error'); }
}

async function showCoachEditForm(coach) {
  mkModal('Редактировать профиль тренера', `
    <div class="form-row">
      <div class="form-group"><label>Имя *</label><input type="text" id="ce-name" value="${escHtml(coach.name||'')}"/></div>
      <div class="form-group"><label>URL аватара</label><input type="text" id="ce-avatar" value="${escHtml(coach.avatar_url||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Возраст</label><input type="number" id="ce-age" value="${coach.age||''}"/></div>
      <div class="form-group"><label>Рост (см)</label><input type="number" id="ce-height" value="${coach.height||''}"/></div>
    </div>
    <div class="form-group"><label>Игровой стиль / Предпочтительная расстановка</label>
      <input type="text" id="ce-style" value="${escHtml(coach.playing_style||'')}" placeholder="e.g. 4-3-3 High Press"/>
    </div>
    <div class="form-group"><label>Описание</label><textarea id="ce-desc" rows="3">${escHtml(coach.description||'')}</textarea></div>
  `, async () => {
    await PUT('/coaches/'+coach.id, {
      name: document.getElementById('ce-name').value.trim(),
      avatar_url: document.getElementById('ce-avatar').value.trim()||null,
      age: parseInt(document.getElementById('ce-age').value)||null,
      height: parseInt(document.getElementById('ce-height').value)||null,
      playing_style: document.getElementById('ce-style').value.trim()||null,
      description: document.getElementById('ce-desc').value.trim()||null,
    });
    State.coachProfile = null;
    toast('Профиль обновлён');
  });
}

const TEAM_PATTERNS = [
  { value: 'none',     label: 'Нет' },
  { value: 'stripes',  label: 'Полосы' },
  { value: 'hoops',    label: 'Кольца' },
  { value: 'diamonds', label: 'Ромбы' },
  { value: 'dots',     label: 'Точки' },
  { value: 'chevrons', label: 'Шевроны' },
];

async function showCoachClubForm(coach, team) {
  const patternOpts = TEAM_PATTERNS.map(p =>
    `<option value="${p.value}" ${(team.color_pattern||'none')===p.value?'selected':''}>${p.label}</option>`
  ).join('');

  mkModal('🏟️ Редактировать клуб', `
    <div class="form-group"><label>Название клуба *</label><input type="text" id="ccf-name" value="${escHtml(team.name||'')}"/></div>
    <div class="form-group"><label>URL логотипа</label><input type="text" id="ccf-logo" value="${escHtml(team.logo_url||'')}" placeholder="https://…"/></div>
    <div class="form-group"><label>URL фото стадиона</label><input type="text" id="ccf-stadium" value="${escHtml(team.stadium_url||'')}" placeholder="https://…"/></div>
    <div style="border-top:1px solid rgba(255,255,255,.1);margin:14px 0 10px;padding-top:10px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">🎨 Цвета клуба</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:120px">
          <label>Акцентный цвет</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" id="ccf-color1" value="${team.color_primary||'#e74c3c'}" style="width:44px;height:36px;border:none;border-radius:6px;cursor:pointer;background:none;padding:2px"/>
            <input type="text" id="ccf-color1-hex" value="${team.color_primary||''}" placeholder="#e74c3c" style="flex:1;font-size:13px" oninput="document.getElementById('ccf-color1').value=this.value||'#e74c3c'"/>
          </div>
        </div>
        <div class="form-group" style="flex:1;min-width:120px">
          <label>Дополнительный цвет</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" id="ccf-color2" value="${team.color_secondary||'#ffffff'}" style="width:44px;height:36px;border:none;border-radius:6px;cursor:pointer;background:none;padding:2px"/>
            <input type="text" id="ccf-color2-hex" value="${team.color_secondary||''}" placeholder="#ffffff" style="flex:1;font-size:13px" oninput="document.getElementById('ccf-color2').value=this.value||'#ffffff'"/>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Рисунок</label>
        <select id="ccf-pattern" style="background:var(--bg-darker);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;width:100%">${patternOpts}</select>
      </div>
      <div id="ccf-preview" style="height:48px;border-radius:10px;margin-top:4px;overflow:hidden;position:relative">
        <div id="ccf-preview-pat" style="position:absolute;inset:0;pointer-events:none"></div>
      </div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,.1);margin:14px 0 10px;padding-top:10px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">🎉 Баннер гола</div>
      <div class="form-group"><label>Своя картинка для баннера гола</label><input type="text" id="ccf-banner" value="${escHtml(team.goal_banner_url||'')}" placeholder="https://… (рекомендуется 520×200px или 1040×400px @2x)"/></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:-8px;margin-bottom:8px">Если задать — при голе будет показана эта картинка вместо стандартного фона. Рекомендуемое разрешение: <strong>520×200 px</strong>.</div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,.1);margin:14px 0 10px;padding-top:10px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">📋 Вкладка «О клубе»</div>
      <div class="form-group"><label>Панорамное фото команды</label><input type="text" id="ccf-photo" value="${escHtml(team.team_photo_url||'')}" placeholder="https://… (широкоформатная фотография)"/></div>
      <div class="form-group"><label>Описание клуба</label><textarea id="ccf-about" rows="5" style="width:100%;background:var(--bg-darker);border:1px solid var(--border);color:#fff;border-radius:6px;padding:8px;resize:vertical;font-family:inherit" placeholder="История клуба, достижения, философия…">${escHtml(team.about_text||'')}</textarea></div>
    </div>
  `, async () => {
    const team_name = document.getElementById('ccf-name').value.trim();
    const team_logo_url = document.getElementById('ccf-logo').value.trim()||null;
    const stadium_url = document.getElementById('ccf-stadium').value.trim()||null;
    const team_photo_url = document.getElementById('ccf-photo').value.trim()||null;
    const about_text = document.getElementById('ccf-about').value.trim()||null;
    const goal_banner_url = document.getElementById('ccf-banner').value.trim()||null;
    const color_primary = document.getElementById('ccf-color1').value || document.getElementById('ccf-color1-hex').value.trim() || null;
    const color_secondary = document.getElementById('ccf-color2').value || document.getElementById('ccf-color2-hex').value.trim() || null;
    const color_pattern = document.getElementById('ccf-pattern').value || 'none';
    if (!team_name) { toast('Название клуба обязательно','error'); return false; }
    await PUT('/coaches/'+coach.id, { team_name, team_logo_url });
    await PUT('/teams/'+team.id, { ...team, name: team_name, logo_url: team_logo_url||team.logo_url, stadium_url, about_text, team_photo_url, color_primary, color_secondary, color_pattern, goal_banner_url });
    State.coachProfile = null;
    toast('Клуб обновлён');
  });

  // Live preview
  function updatePreview() {
    const c1 = document.getElementById('ccf-color1')?.value || '#e74c3c';
    const c2 = document.getElementById('ccf-color2')?.value || '#ffffff';
    const pat = document.getElementById('ccf-pattern')?.value || 'none';
    const preview = document.getElementById('ccf-preview');
    const patDiv = document.getElementById('ccf-preview-pat');
    if (!preview) return;
    preview.style.background = c1;
    patDiv.className = pat !== 'none' ? `goal-banner-pattern goal-banner-pattern-${pat}` : '';
    patDiv.style.setProperty('--pat-color', c2);
  }
  setTimeout(() => {
    // Color picker → hex text sync
    document.getElementById('ccf-color1')?.addEventListener('input', e => {
      const hex = document.getElementById('ccf-color1-hex');
      if (hex) hex.value = e.target.value;
      updatePreview();
    });
    document.getElementById('ccf-color2')?.addEventListener('input', e => {
      const hex = document.getElementById('ccf-color2-hex');
      if (hex) hex.value = e.target.value;
      updatePreview();
    });
    document.getElementById('ccf-pattern')?.addEventListener('input', updatePreview);
    updatePreview();
  }, 50);
}

async function coachChangePassword() {
  const cur = document.getElementById('coach-pw-cur').value;
  const nw  = document.getElementById('coach-pw-new').value;
  const cf  = document.getElementById('coach-pw-cf').value;
  if (!cur || !nw) { toast('Заполните все поля','error'); return; }
  if (nw !== cf) { toast('Пароли не совпадают','error'); return; }
  if (nw.length < 8) { toast('Пароль: мин. 8 символов','error'); return; }
  try {
    await POST('/auth/change-password', { currentPassword: cur, newPassword: nw });
    toast('Пароль изменён');
    document.getElementById('coach-pw-cur').value = '';
    document.getElementById('coach-pw-new').value = '';
    document.getElementById('coach-pw-cf').value = '';
  } catch(e) { toast(e.message,'error'); }
}

// ═══════════════════════════════════════════════════════════
//  MODAL HELPER
// ═══════════════════════════════════════════════════════════
function mkModal(title, bodyHtml, onSave) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>${escHtml(title)}</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        ${bodyHtml}
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Отмена</button>
          <button class="btn btn-green modal-save">Сохранить</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.modal-close').onclick = close;
  modal.querySelector('.modal-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('.modal-save').addEventListener('click', async () => {
    try {
      const result = await onSave();
      if (result !== false) { close(); router(); }
    } catch(e) { toast(e.message, 'error'); }
  });
  return modal;
}
