/* ═══════════════════════════════════════════════════════════
   TransferMarket SPA  (v2)
   ═══════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────
const State = { token: localStorage.getItem('tm_token') || null, user: null };

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
function fmtDate(d) {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
function teamLogoEl(url, name) {
  if (url) return `<img src="${url}" class="team-logo" alt="${escHtml(name)}" onerror="this.style.display='none'">`;
  return `<div class="team-logo-placeholder">${(name||'?').substring(0,3).toUpperCase()}</div>`;
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function eventIcon(type) {
  return {goal:'⚽',own_goal:'⚽',yellow_card:'🟨',red_card:'🟥',substitution:'🔄',penalty:'⚽',penalty_miss:'❌',var_review:'📺'}[type]||'📋';
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
const PITCH_SVG = `<svg viewBox="0 0 280 400" xmlns="http://www.w3.org/2000/svg" class="pitch-svg">
  <rect width="280" height="400" fill="#2d8a4e" rx="6"/>
  <rect x="0" y="0" width="280" height="50" fill="#2a8548" opacity=".45"/>
  <rect x="0" y="100" width="280" height="50" fill="#2a8548" opacity=".45"/>
  <rect x="0" y="200" width="280" height="50" fill="#2a8548" opacity=".45"/>
  <rect x="0" y="300" width="280" height="50" fill="#2a8548" opacity=".45"/>
  <rect x="10" y="10" width="260" height="380" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.8"/>
  <line x1="10" y1="200" x2="270" y2="200" stroke="rgba(255,255,255,.8)" stroke-width="1.8"/>
  <circle cx="140" cy="200" r="40" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.8"/>
  <circle cx="140" cy="200" r="2.5" fill="rgba(255,255,255,.9)"/>
  <rect x="115" y="0" width="50" height="10" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="88" y="10" width="104" height="30" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="58" y="10" width="164" height="82" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <circle cx="140" cy="75" r="2.5" fill="rgba(255,255,255,.9)"/>
  <path d="M 107 92 A 42 42 0 0 1 173 92" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="115" y="390" width="50" height="10" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="88" y="360" width="104" height="30" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <rect x="58" y="308" width="164" height="82" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <circle cx="140" cy="325" r="2.5" fill="rgba(255,255,255,.9)"/>
  <path d="M 107 308 A 42 42 0 0 0 173 308" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
  <path d="M 10 28 A 18 18 0 0 1 28 10" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  <path d="M 252 10 A 18 18 0 0 1 270 28" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  <path d="M 10 372 A 18 18 0 0 0 28 390" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  <path d="M 252 390 A 18 18 0 0 0 270 372" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
</svg>`;
function renderPitch(players, isAway = false) {
  if (!players || !players.length) return `<div class="empty-state"><p>No player data</p></div>`;
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
function ratingColor(r) { return r >= 7.5 ? 'high' : r >= 6 ? 'mid' : 'low'; }
function achIcon(type) {
  return {hat_trick:'🎩',brace:'⚽⚽',man_of_the_match:'🌟',clean_sheet:'🧤',tournament_winner:'🏆'}[type]||'🏅';
}

// ─── Auth ─────────────────────────────────────────────────────
function isAdmin() { return !!State.token; }

function updateAuthUI() {
  document.getElementById('btn-login').classList.toggle('hidden', isAdmin());
  document.getElementById('btn-logout').classList.toggle('hidden', !isAdmin());
  document.getElementById('admin-indicator').classList.toggle('hidden', !isAdmin());
  document.getElementById('nav-admin').classList.toggle('hidden', !isAdmin());
}
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
    State.token = data.token; State.user = data.username;
    localStorage.setItem('tm_token', data.token);
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-password').value = '';
    updateAuthUI(); toast('Logged in as ' + data.username); router();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
}
document.getElementById('btn-logout').addEventListener('click', () => {
  State.token = null; localStorage.removeItem('tm_token'); updateAuthUI(); toast('Logged out','info'); navigate('/');
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
  if (rawPath==='/admin') return renderAdmin(app);
  if (rawPath==='/news')  return renderNewsPage(app);
  if (rawPath==='/search') return renderSearch(app, params.q);
  app.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Page not found</p></div>`;
}
window.addEventListener('hashchange', router);
window.addEventListener('load', () => { updateAuthUI(); loadBanners(); router(); });

// ═══════════════════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════════════════
async function renderHome(app) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [stats, newsData] = await Promise.all([GET('/stats'), GET('/news?limit=3')]);
    app.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${stats.totals.teams}</div><div class="stat-label">Teams</div></div>
        <div class="stat-card"><div class="stat-value">${stats.totals.players}</div><div class="stat-label">Players</div></div>
        <div class="stat-card"><div class="stat-value">${stats.totals.transfers}</div><div class="stat-label">Transfers</div></div>
        <div class="stat-card"><div class="stat-value">${fmtValue(stats.totals.transfer_value)}</div><div class="stat-label">Transfer Value</div></div>
      </div>
      ${newsData.rows.length ? `
      <div class="card mt-3 mb-3" style="margin-bottom:20px">
        <div class="card-header">📰 Latest News <a href="#/news" style="font-size:12px;color:rgba(255,255,255,.7);font-weight:400;float:right">All news →</a></div>
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
  } catch (err) { app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`; }
}

// ═══════════════════════════════════════════════════════════
//  NEWS PAGE
// ═══════════════════════════════════════════════════════════
async function renderNewsPage(app) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const data = await GET('/news?limit=50');
    app.innerHTML = `
      <div class="page-header"><h1 class="page-title">📰 News Feed</h1></div>
      <div class="card">
        ${!data.rows.length ? '<div class="empty-state" style="padding:40px"><div class="empty-icon">📰</div><p>No news yet</p></div>' :
          data.rows.map(n => `
            <div class="news-item">
              <div class="news-icon">${newsIcon(n.type)}</div>
              <div class="news-body" style="flex:1">
                <div class="news-title">${escHtml(n.title)}</div>
                ${n.body ? `<div class="news-meta" style="margin-top:4px">${escHtml(n.body)}</div>` : ''}
                <div class="news-meta" style="margin-top:4px">
                  <span class="badge badge-green" style="font-size:10px">${n.type}</span>
                  ${fmtDate(n.created_at)}
                  ${n.match_id?`<a href="#/matches/${n.match_id}" style="color:var(--green)">View match</a>`:''}
                  ${n.tournament_id?`<a href="#/tournaments/${n.tournament_id}" style="color:var(--green)">View tournament</a>`:''}
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
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [teams, competitions] = await Promise.all([GET('/teams'), GET('/competitions')]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Teams <small>${teams.length} clubs</small></h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showTeamForm()">+ Add Team</button>`:''}
      </div>
      <div class="filters">
        <input type="search" id="team-search" placeholder="Search teams…" />
        <select id="team-comp-filter">
          <option value="">All Competitions</option>
          ${competitions.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Team</th><th>Country</th><th>League</th><th>Founded</th><th>Stadium</th><th class="text-right">Squad Value</th>${isAdmin()?'<th></th>':''}</tr></thead>
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
  const modal = mkModal(isEdit?'Edit Team':'Add New Team', `
    <div class="form-row">
      <div class="form-group"><label>Team Name *</label><input type="text" id="tf-name" value="${escHtml(team?.name||'')}"/></div>
      <div class="form-group"><label>Short Name</label><input type="text" id="tf-short" value="${escHtml(team?.short_name||'')}" maxlength="10"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Country</label><select id="tf-country"><option value="">–</option>${countries.map(c=>`<option value="${c.id}"${team?.country_id==c.id?' selected':''}>${c.flag_emoji||''} ${escHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Competition</label><select id="tf-comp"><option value="">–</option>${competitions.map(c=>`<option value="${c.id}"${team?.competition_id==c.id?' selected':''}>${escHtml(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Founded</label><input type="number" id="tf-founded" value="${team?.founded||''}"/></div>
      <div class="form-group"><label>Stadium</label><input type="text" id="tf-stadium" value="${escHtml(team?.stadium||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Market Value (€)</label><input type="number" id="tf-mv" value="${team?.market_value||0}" step="100000"/></div>
      <div class="form-group"><label>Logo URL</label><input type="text" id="tf-logo" value="${escHtml(team?.logo_url||'')}"/></div>
    </div>
  `, async () => {
    const payload = { name:document.getElementById('tf-name').value.trim(), short_name:document.getElementById('tf-short').value.trim(), country_id:document.getElementById('tf-country').value||null, competition_id:document.getElementById('tf-comp').value||null, founded:document.getElementById('tf-founded').value||null, stadium:document.getElementById('tf-stadium').value.trim(), market_value:parseFloat(document.getElementById('tf-mv').value)||0, logo_url:document.getElementById('tf-logo').value.trim()||null };
    if (!payload.name) { toast('Name required','error'); return false; }
    if (isEdit) await PUT('/teams/'+team.id, payload); else await POST('/teams', payload);
    toast(isEdit?'Team updated':'Team added');
  });
}
async function deleteTeam(id, name) {
  if (!confirm(`Delete team "${name}"?`)) return;
  try { await DEL('/teams/'+id); toast('Deleted'); router(); } catch(e){toast(e.message,'error');}
}

async function renderTeamDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  try {
    const team = await GET('/teams/'+id);
    app.innerHTML=`
      <div class="detail-hero">
        ${teamLogoEl(team.logo_url,team.name)}
        <div class="hero-info">
          <h1>${escHtml(team.name)}</h1>
          <div class="meta">
            ${team.flag_emoji?`<span>${team.flag_emoji} ${escHtml(team.country_name)}</span>`:''}
            ${team.competition_name?`<span>🏆 ${escHtml(team.competition_name)}</span>`:''}
            ${team.founded?`<span>📅 Founded ${team.founded}</span>`:''}
            ${team.stadium?`<span>🏟️ ${escHtml(team.stadium)}</span>`:''}
          </div>
        </div>
        <div class="hero-mv"><div class="mv-label">Squad Value</div><div class="mv-value">${fmtValue(team.market_value)}</div></div>
        ${isAdmin()?`<div style="margin-left:16px;display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showTeamForm(${JSON.stringify(team).replace(/"/g,'&quot;')})">Edit</button>
        </div>`:''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="squad">Squad (${team.players.length})</button>
        <button class="detail-tab" data-tab="formation">Formation</button>
        <button class="detail-tab" data-tab="titles">Titles (${team.titles.length})</button>
        <button class="detail-tab" data-tab="transfers">Transfers</button>
        <button class="detail-tab" data-tab="matches">Matches</button>
        <button class="detail-tab" data-tab="team-news">News</button>
      </div>
      <div id="tab-squad" class="tab-panel active">${renderSquadTab(team)}</div>
      <div id="tab-formation" class="tab-panel">
        <div class="pitch-section" style="padding:20px">
          ${renderPitch(team.players.filter(p=>p.status==='active'||!p.status))}
        </div>
      </div>
      <div id="tab-titles" class="tab-panel">${renderTitlesTab(team.titles,team.id,null)}</div>
      <div id="tab-transfers" class="tab-panel">${renderTransfersTab(team.transfers)}</div>
      <div id="tab-matches" class="tab-panel"><div class="empty-state"><p>Loading matches…</p></div></div>
      <div id="tab-team-news" class="tab-panel"><div class="empty-state"><p>Loading…</p></div></div>
    `;
    setupTabs(app);
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
        if (!data.rows.length) { panel.innerHTML = '<div class="empty-state"><div class="empty-icon">📰</div><p>No news yet</p></div>'; return; }
        panel.innerHTML = `<div class="card">${data.rows.map(n => `
          <div class="news-item">
            <div class="news-icon">${newsIcon(n.type)}</div>
            <div class="news-body">
              <div class="news-title">${escHtml(n.title)}</div>
              ${n.body ? `<div class="news-meta">${escHtml(n.body.substring(0,150))}${n.body.length>150?'…':''}</div>` : ''}
              <div class="news-meta">${fmtDate(n.created_at)}</div>
            </div>
          </div>`).join('')}</div>`;
      } catch { panel.innerHTML = '<div class="empty-state"><p>Error loading news</p></div>'; }
    }, { once: true });
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function renderSquadTab(team) {
  if (!team.players.length) return `<div class="empty-state"><div class="empty-icon">⚽</div><p>No players</p></div>`;
  return `<div class="card">
    <div class="card-header">Squad ${isAdmin()?`<button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showPlayerForm(null,${team.id})">+ Add Player</button>`:''}  </div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th>Nat.</th><th>Pos</th><th>Age</th><th>Foot</th><th class="text-right">Value</th>${isAdmin()?'<th></th>':''}</tr></thead>
      <tbody>
        ${team.players.map(p=>`
          <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
            <td class="text-muted">${p.shirt_number||'–'}</td>
            <td><div class="flex-center gap-2">${avatarEl(p.image_url,p.name)}<span class="font-bold">${escHtml(p.name)}</span></div></td>
            <td>${p.flag_emoji||'–'}</td>
            <td>${posBadge(p.position)}</td>
            <td class="text-muted">${calcAge(p.date_of_birth)||'–'}</td>
            <td class="text-muted">${p.foot||'–'}</td>
            <td class="text-right mv">${fmtValue(p.market_value)}</td>
            ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
              <button class="btn-icon" onclick="showPlayerForm(${JSON.stringify(p).replace(/"/g,'&quot;')})">✏️</button>
              <button class="btn-icon" onclick="showLoanForm(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Loan out">🔗</button>
              <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${escHtml(p.name)}')">🗑️</button>
            </td>`:''}
          </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
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
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [players, teams] = await Promise.all([GET('/players'), GET('/teams')]);
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Players <small>${players.length} registered</small></h1>
        ${isAdmin()?`<button class="btn btn-green" onclick="showPlayerForm()">+ Add Player</button>`:''}
      </div>
      <div class="filters">
        <input type="search" id="player-search" placeholder="Search players…"/>
        <select id="player-pos-filter"><option value="">All Positions</option>${POSITIONS.map(p=>`<option value="${p}">${p}</option>`).join('')}</select>
        <select id="player-team-filter"><option value="">All Teams</option><option value="free">Free Agents</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select>
        <select id="player-status-filter"><option value="">All Status</option><option value="active">Active</option><option value="retired">Retired</option><option value="free_agent">Free Agent</option></select>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Nat.</th><th>Position</th><th>Age</th><th>Team</th><th>Foot</th><th class="text-right">Value</th>${isAdmin()?'<th></th>':''}</tr></thead>
        <tbody id="players-tbody"></tbody>
      </table></div></div>`;
    const renderRows = list => {
      const tbody = document.getElementById('players-tbody');
      if (!list.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚽</div><p>No players</p></div></td></tr>`;return;}
      tbody.innerHTML = list.map(p=>`
        <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
          <td><div class="flex-center gap-2">${avatarEl(p.image_url,p.name)}<div><div class="font-bold">${escHtml(p.name)}</div>${p.status!=='active'?`<span class="badge badge-gray">${p.status}</span>`:''}</div></div></td>
          <td title="${escHtml(p.nationality_name||'')}">${p.flag_emoji||'–'}</td>
          <td>${posBadge(p.position)}</td>
          <td class="text-muted">${calcAge(p.date_of_birth)||'–'}</td>
          <td class="text-muted">${escHtml(p.team_name||'Free Agent')}</td>
          <td class="text-muted">${p.foot||'–'}</td>
          <td class="text-right mv">${fmtValue(p.market_value)}</td>
          ${isAdmin()?`<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showPlayerForm(${JSON.stringify(p).replace(/"/g,'&quot;')})">✏️</button>
            <button class="btn-icon" onclick="showLoanForm(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Loan">🔗</button>
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
  mkModal(isEdit?'Edit Player':'Add New Player', `
    <div class="form-row">
      <div class="form-group"><label>Full Name *</label><input type="text" id="pf-name" value="${escHtml(player?.name||'')}"/></div>
      <div class="form-group"><label>Date of Birth</label><input type="date" id="pf-dob" value="${player?.date_of_birth?.substring(0,10)||''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Nationality</label><select id="pf-nat"><option value="">–</option>${countries.map(c=>`<option value="${c.id}"${player?.nationality_id==c.id?' selected':''}>${c.flag_emoji||''} ${escHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Position</label><select id="pf-pos"><option value="">–</option>${POSITIONS.map(p=>`<option value="${p}"${player?.position===p?' selected':''}>${p}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Team</label><select id="pf-team"><option value="">Free Agent</option>${teams.map(t=>`<option value="${t.id}"${(player?.team_id||defaultTeamId)==t.id?' selected':''}>${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Shirt #</label><input type="number" id="pf-shirt" value="${player?.shirt_number||''}" min="1" max="99"/></div>
    </div>
    <div class="form-row-3">
      <div class="form-group"><label>Foot</label><select id="pf-foot"><option value="">–</option><option value="Right"${player?.foot==='Right'?' selected':''}>Right</option><option value="Left"${player?.foot==='Left'?' selected':''}>Left</option><option value="Both"${player?.foot==='Both'?' selected':''}>Both</option></select></div>
      <div class="form-group"><label>Height (cm)</label><input type="number" id="pf-height" value="${player?.height||''}" min="140" max="220"/></div>
      <div class="form-group"><label>Status</label><select id="pf-status"><option value="active"${(!player?.status||player.status==='active')?' selected':''}>Active</option><option value="retired"${player?.status==='retired'?' selected':''}>Retired</option><option value="free_agent"${player?.status==='free_agent'?' selected':''}>Free Agent</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Market Value (€)</label><input type="number" id="pf-mv" value="${player?.market_value||0}" min="0" step="100000"/></div>
      <div class="form-group"><label>Image URL</label><input type="text" id="pf-img" value="${escHtml(player?.image_url||'')}"/></div>
    </div>
  `, async () => {
    const payload = { name:document.getElementById('pf-name').value.trim(), date_of_birth:document.getElementById('pf-dob').value||null, nationality_id:document.getElementById('pf-nat').value||null, position:document.getElementById('pf-pos').value||null, foot:document.getElementById('pf-foot').value||null, height:parseInt(document.getElementById('pf-height').value)||null, team_id:document.getElementById('pf-team').value||null, shirt_number:parseInt(document.getElementById('pf-shirt').value)||null, market_value:parseFloat(document.getElementById('pf-mv').value)||0, image_url:document.getElementById('pf-img').value.trim()||null, status:document.getElementById('pf-status').value };
    if (!payload.name){toast('Name required','error');return false;}
    if (isEdit) await PUT('/players/'+player.id, payload); else await POST('/players', payload);
    toast(isEdit?'Player updated':'Player added');
  });
}
async function deletePlayer(id, name) {
  if (!confirm(`Delete player "${name}"?`)) return;
  try { await DEL('/players/'+id); toast('Deleted'); router(); } catch(e){toast(e.message,'error');}
}

async function renderPlayerDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  try {
    const player = await GET('/players/'+id);
    const age = calcAge(player.date_of_birth);
    let achRows = [], careerStats = null, playerSkills = null;
    try { const r = await GET('/players/'+id+'/achievements'); achRows = r; } catch{}
    try { careerStats = await GET('/players/'+id+'/career-stats'); } catch{}
    try { playerSkills = await GET('/players/'+id+'/skills'); } catch{}

    app.innerHTML=`
      <div class="detail-hero">
        ${avatarEl(player.image_url,player.name,true)}
        <div class="hero-info">
          <h1>${escHtml(player.name)}</h1>
          <div class="meta">
            ${player.flag_emoji?`<span>${player.flag_emoji} ${escHtml(player.nationality_name||'')}</span>`:''}
            ${player.position?`<span>${posBadge(player.position)}</span>`:''}
            ${age?`<span>🎂 ${age} yrs</span>`:''}
            ${player.team_name?`<span>🏟️ <a href="#/teams/${player.team_id}" style="color:rgba(255,255,255,.85);text-decoration:underline">${escHtml(player.team_name)}</a></span>`:'<span>🔓 Free Agent</span>'}
            ${player.foot?`<span>👟 ${player.foot}</span>`:''}
            ${player.height?`<span>📏 ${player.height}cm</span>`:''}
          </div>
        </div>
        <div class="hero-mv"><div class="mv-label">Market Value</div><div class="mv-value">${fmtValue(player.market_value)}</div></div>
        ${isAdmin()?`<div style="margin-left:16px;display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showPlayerForm(${JSON.stringify(player).replace(/"/g,'&quot;')})">Edit</button>
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showTransferForm(${JSON.stringify(player).replace(/"/g,'&quot;')})">Transfer</button>
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showLoanForm(${JSON.stringify(player).replace(/"/g,'&quot;')})">Loan</button>
        </div>`:''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="stats">Statistics</button>
        <button class="detail-tab" data-tab="transfers">Transfers</button>
        <button class="detail-tab" data-tab="titles">Titles</button>
        <button class="detail-tab" data-tab="achievements">Achievements (${achRows.length})</button>
        <button class="detail-tab" data-tab="market">Value History</button>
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

async function showTransferForm(player) {
  const teams = await GET('/teams');
  mkModal('Record Transfer: '+escHtml(player.name), `
    <div class="form-row">
      <div class="form-group"><label>From Team</label><select id="trf-from"><option value="">– None –</option>${teams.map(t=>`<option value="${t.id}"${player?.team_id==t.id?' selected':''}>${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>To Team</label><select id="trf-to"><option value="">– Free Agent –</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Fee (€)</label><input type="number" id="trf-fee" value="0" step="100000"/></div>
      <div class="form-group"><label>Date</label><input type="date" id="trf-date" value="${new Date().toISOString().substring(0,10)}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Type</label><select id="trf-type"><option value="permanent">Permanent</option><option value="loan">Loan</option><option value="free">Free Transfer</option><option value="youth">Youth</option></select></div>
      <div class="form-group"><label>Notes</label><input type="text" id="trf-notes"/></div>
    </div>
  `, async () => {
    await POST('/transfers', { player_id:player.id, from_team_id:document.getElementById('trf-from').value||null, to_team_id:document.getElementById('trf-to').value||null, transfer_fee:parseFloat(document.getElementById('trf-fee').value)||0, transfer_date:document.getElementById('trf-date').value||null, transfer_type:document.getElementById('trf-type').value, notes:document.getElementById('trf-notes').value.trim()||null });
    toast('Transfer recorded');
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
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
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
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
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
  `, async () => {
    const payload={name:document.getElementById('cf-name').value.trim(),country_id:document.getElementById('cf-country').value||null,type:document.getElementById('cf-type').value};
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
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [transfers, teams, loans] = await Promise.all([GET('/transfers?limit=100'), GET('/teams'), GET('/loans')]);
    app.innerHTML=`
      <div class="page-header">
        <h1 class="page-title">Transfers & Loans</h1>
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
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
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
  const scoreStr = m.status==='finished' ? `${m.home_score} – ${m.away_score}` : m.status==='scheduled' ? 'vs' : `${m.home_score} – ${m.away_score}`;
  return `<div class="match-card" onclick="navigate('/matches/${m.id}')">
    <div class="mc-team"><div class="flex-center gap-2">${teamLogoEl(m.home_logo,m.home_team_name)}<span>${escHtml(m.home_team_name)}</span></div></div>
    <div class="mc-score">
      <div>${scoreStr}</div>
      <div><span class="match-status-badge ${statusCls}">${m.status}</span></div>
      ${m.match_date?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${fmtDate(m.match_date)}</div>`:''}
    </div>
    <div class="mc-team right" style="text-align:right"><div class="flex-center gap-2" style="justify-content:flex-end"><span>${escHtml(m.away_team_name)}</span>${teamLogoEl(m.away_logo,m.away_team_name)}</div></div>
    <div class="mc-info">${m.tournament_name?`<span class="badge badge-gold">${escHtml(m.tournament_name)}</span>`:''}</div>
  </div>`;
}

function renderMatchList(matches, highlightTeamId) {
  if (!matches.length) return `<div class="empty-state"><div class="empty-icon">⚽</div><p>No matches</p></div>`;
  return matches.map(m => matchCardHtml(m)).join('');
}

async function renderMatchDetail(app, id) {
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  try {
    const match = await GET('/matches/'+id);
    const isFinished = match.status === 'finished';

    app.innerHTML=`
      <div class="scoreboard" id="scoreboard">
        <div class="score-teams">
          <div class="score-team">
            ${teamLogoEl(match.home_logo,match.home_team_name)}
            <div class="score-team-name">${escHtml(match.home_team_name)}</div>
          </div>
          <div class="score-center">
            <div class="score-display">
              <div class="score-value" id="score-home">${isFinished?match.home_score:'0'}</div>
              <div class="score-sep">–</div>
              <div class="score-value" id="score-away">${isFinished?match.away_score:'0'}</div>
            </div>
            <span class="match-status-badge ${isFinished?'match-status-finished':'match-status-scheduled'}" id="match-status-badge">${match.status}</span>
          </div>
          <div class="score-team">
            ${teamLogoEl(match.away_logo,match.away_team_name)}
            <div class="score-team-name">${escHtml(match.away_team_name)}</div>
          </div>
        </div>
        <div class="match-clock">
          <span class="clock-min" id="match-clock">⏱ ${isFinished?'90':match.match_date?fmtDate(match.match_date):'–'}</span>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${match.tournament_name?`<span class="badge badge-gold">🏆 ${escHtml(match.tournament_name)}</span>`:''}
        ${isAdmin()&&!isFinished?`<button class="btn-simulate" id="btn-sim" onclick="startMatchSimulation(${id})">▶ Simulate Match</button>`:''}
        ${isFinished?`<button class="btn btn-green" onclick="startMatchReplay(${id})">▶ Watch Replay</button>`:''}
      </div>
      <div class="detail-tabs" id="match-tabs">
        <button class="detail-tab active" data-tab="m-events">📋 Events</button>
        <button class="detail-tab" data-tab="m-ratings">👤 Ratings</button>
        ${isFinished?`<button class="detail-tab" data-tab="m-fullstats">📊 Stats</button>`:''}
        ${isFinished?`<button class="detail-tab" data-tab="m-formations">🏟️ Formations</button>`:''}
      </div>
      <div id="tab-m-events" class="tab-panel active">
        <div class="event-log" id="event-log">
          ${isFinished ? renderEventLog(match.events) : '<div style="padding:40px;text-align:center;color:var(--text-muted)">No events yet</div>'}
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
          const [homePl, awayPl] = await Promise.all([
            GET('/players?team_id='+match.home_team_id+'&status=active'),
            GET('/players?team_id='+match.away_team_id+'&status=active'),
          ]);
          panel.innerHTML = `
            <div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:center;padding:16px">
              <div class="pitch-section">
                <div style="font-weight:700;margin-bottom:8px;text-align:center">${escHtml(match.home_team_name)}</div>
                ${renderPitch(homePl, false)}
              </div>
              <div class="pitch-section">
                <div style="font-weight:700;margin-bottom:8px;text-align:center">${escHtml(match.away_team_name)}</div>
                ${renderPitch(awayPl, true)}
              </div>
            </div>`;
        } catch { panel.innerHTML = '<div class="empty-state"><p>Error loading formations</p></div>'; }
      }, { once: true });
    }
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
}

function renderEventLog(events) {
  if (!events.length) return '<div style="padding:40px;text-align:center;color:var(--text-muted)">No events</div>';
  let html = '';
  let htShown = false;
  for (const e of events) {
    if (!htShown && e.minute > 45) { html += `<div class="halftime-divider">⏸ Half Time</div>`; htShown = true; }
    html += `<div class="event-log-item event-${e.event_type}">
      <span class="ev-min">${e.minute}'</span>
      <span class="ev-icon">${eventIcon(e.event_type)}</span>
      <span class="ev-desc">${escHtml(e.description||'')}</span>
    </div>`;
  }
  return html;
}

function renderMatchPlayerRatings(stats, homeId, awayId) {
  if (!stats.length) return '<div class="empty-state"><p>No rating data</p></div>';
  const top = stats.slice(0, 15);
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

async function startMatchSimulation(matchId) {
  const btn = document.getElementById('btn-sim');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Simulating…'; }
  try {
    await POST('/matches/'+matchId+'/simulate');
    toast('Match simulated! Replay starting…');
    await startMatchReplay(matchId);
  } catch(e) { toast(e.message,'error'); if(btn){btn.disabled=false;btn.textContent='▶ Simulate Match';} }
}

async function startMatchReplay(matchId) {
  const match = await GET('/matches/'+matchId);
  if (!match.events || !match.events.length) { toast('No events to replay','info'); return; }

  // Initialise display
  document.getElementById('score-home').textContent = '0';
  document.getElementById('score-away').textContent = '0';
  const logEl = document.getElementById('event-log');
  if (logEl) logEl.innerHTML = '';
  const badge = document.getElementById('match-status-badge');
  if (badge) { badge.textContent = 'LIVE'; badge.className = 'match-status-badge match-status-live'; }

  let hScore = 0, aScore = 0;
  const TOTAL_MS = 18000; // 18 seconds for full 90 min
  const MS_PER_MIN = TOTAL_MS / 90;
  const clockEl = document.getElementById('match-clock');

  // Replay timer
  let clockTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const min = Math.min(90, Math.floor(elapsed / MS_PER_MIN));
    if (clockEl) clockEl.textContent = `⏱ ${min}'`;
  }, 200);

  const startTime = Date.now();

  // Schedule each event
  for (const ev of match.events) {
    const delay = ev.minute * MS_PER_MIN;
    setTimeout(() => {
      if (ev.event_type === 'goal' || ev.event_type === 'own_goal') {
        if (ev.team_id === match.home_team_id) hScore++;
        else aScore++;
        const sh = document.getElementById('score-home');
        const sa = document.getElementById('score-away');
        if (sh) sh.textContent = hScore;
        if (sa) sa.textContent = aScore;
        // Flash animation
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard) { scoreboard.style.transform='scale(1.02)'; setTimeout(()=>scoreboard.style.transform='',300); }
      }
      const logEl2 = document.getElementById('event-log');
      if (logEl2) {
        // Insert half-time marker
        if (ev.minute > 45 && !logEl2.querySelector('.halftime-divider')) {
          const ht = document.createElement('div');
          ht.className = 'halftime-divider'; ht.textContent = '⏸ Half Time';
          logEl2.insertBefore(ht, logEl2.firstChild);
        }
        const item = document.createElement('div');
        item.className = `event-log-item event-${ev.event_type}`;
        item.innerHTML = `<span class="ev-min">${ev.minute}'</span><span class="ev-icon">${eventIcon(ev.event_type)}</span><span class="ev-desc">${escHtml(ev.description||'')}</span>`;
        logEl2.insertBefore(item, logEl2.firstChild);
      }
    }, delay);
  }

  // Final whistle
  setTimeout(() => {
    clearInterval(clockTimer);
    if (clockEl) clockEl.textContent = '⏱ 90\'';
    if (badge) { badge.textContent = 'FINISHED'; badge.className = 'match-status-badge match-status-finished'; }
    toast(`Full time: ${match.home_team_name} ${match.home_score}–${match.away_score} ${match.away_team_name}`);
  }, TOTAL_MS + 500);
}

async function showMatchForm() {
  const teams = await GET('/teams');
  mkModal('Schedule Match', `
    <div class="form-row">
      <div class="form-group"><label>Home Team *</label><select id="mf-home"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Away Team *</label><select id="mf-away"><option value="">–</option>${teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Match Date</label><input type="date" id="mf-date" value="${new Date().toISOString().substring(0,10)}"/></div>
  `, async ()=>{
    const home=document.getElementById('mf-home').value;const away=document.getElementById('mf-away').value;
    if(!home||!away){toast('Both teams required','error');return false;}
    if(home===away){toast('Teams must be different','error');return false;}
    const r=await POST('/matches',{home_team_id:home,away_team_id:away,match_date:document.getElementById('mf-date').value||null});
    toast('Match scheduled');
    navigate('/matches/'+r.id);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
//  TOURNAMENTS
// ═══════════════════════════════════════════════════════════
async function renderTournaments(app) {
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
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
  app.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [tour, teams] = await Promise.all([GET('/tournaments/'+id), GET('/teams')]);
    const inSetup = tour.status === 'setup';
    const inProg  = tour.status === 'in_progress';
    const finished = tour.status === 'finished';

    app.innerHTML=`
      <div class="detail-hero" style="gap:20px">
        <div class="hero-info">
          <h1>🏆 ${escHtml(tour.name)}</h1>
          <div class="meta">
            <span class="badge ${finished?'badge-green':inProg?'badge-gold':'badge-gray'}">${tour.status}</span>
            <span>${tour.teams.length} Teams</span>
            ${inProg?`<span>Round ${tour.current_round} of ${tour.total_rounds}</span>`:''}
          </div>
        </div>
        ${isAdmin()?`<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          ${inSetup?`<button class="btn btn-green" onclick="showAddTeamToTournament(${id},${JSON.stringify(teams).replace(/"/g,'&quot;')},${JSON.stringify(tour.teams.map(t=>t.team_id))})">+ Add Team</button>
          <button class="btn-simulate" onclick="startTournament(${id})" ${tour.teams.length<2?'disabled':''}>▶ Start Tournament</button>`:
          inProg?`<button class="btn-simulate" onclick="simulateTournamentRound(${id})">▶ Simulate Next Round</button>`:''}
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
      const slotCount = round.matches.length;
      return `<div class="bracket-round">
        <div class="bracket-round-header">${escHtml(round.name)}</div>
        <div class="bracket-matches">
          ${round.matches.map(m=>{
            const homeWon = m.status==='finished' && m.home_score >= m.away_score;
            const awayWon = m.status==='finished' && m.away_score > m.home_score;
            return `<div class="bracket-slot">
              <div class="bracket-match" onclick="navigate('/matches/${m.id}')">
                <div class="bracket-team ${homeWon?'winner':''}">
                  ${teamLogoEl(m.home_logo,m.home_team_name)}
                  <span class="bt-name">${escHtml(m.home_team_name)}</span>
                  <span class="bt-score">${m.status==='finished'?m.home_score:''}</span>
                </div>
                <div class="bracket-team ${awayWon?'winner':''}">
                  ${teamLogoEl(m.away_logo,m.away_team_name)}
                  <span class="bt-name">${escHtml(m.away_team_name)}</span>
                  <span class="bt-score">${m.status==='finished'?m.away_score:''}</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div></div>`;
}

function renderTournamentTeams(tour, tournamentId) {
  if (!tour.teams.length) return `<div class="empty-state"><div class="empty-icon">🏟️</div><p>No teams added yet</p></div>`;
  return `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th>Seed</th><th>Team</th><th>Country</th><th class="text-right">Squad Value</th>${isAdmin()&&tour.status==='setup'?'<th></th>':''}</tr></thead>
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
  mkModal('New Tournament', `
    <div class="form-group"><label>Tournament Name *</label><input type="text" id="torf-name" placeholder="e.g. Champions Cup 2025"/></div>
  `, async ()=>{
    const name=document.getElementById('torf-name').value.trim();
    if(!name){toast('Name required','error');return false;}
    const r=await POST('/tournaments',{name});
    toast('Tournament created');
    navigate('/tournaments/'+r.id);
    return true;
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
  const [stats, countries, banners] = await Promise.all([GET('/stats'), GET('/countries'), GET('/banners')]);
  app.innerHTML=`
    <div class="page-header"><h1 class="page-title">Admin Panel</h1><span class="badge badge-gold">ADMIN</span></div>
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
          <button class="btn btn-green" onclick="showTeamForm()">+ Add Team</button>
          <button class="btn btn-green" onclick="showPlayerForm()">+ Add Player</button>
          <button class="btn btn-green" onclick="showMatchForm()">+ Schedule Match</button>
          <button class="btn btn-green" onclick="showTournamentForm()">+ New Tournament</button>
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
    <div class="card mt-3">
      <div class="card-header">Change Admin Password</div>
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
      ${!players.length&&!teams.length?`<div class="empty-state"><div class="empty-icon">🔍</div><p>No results for "${escHtml(query)}"</p></div>`:''}
    `;
  } catch(err){app.innerHTML=`<div class="empty-state"><p>Error: ${err.message}</p></div>`;}
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
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green modal-save">Save</button>
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
