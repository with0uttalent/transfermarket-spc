/* ═══════════════════════════════════════════════════════════
   TransferMarket – Single Page Application
   ═══════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────
const State = {
  token: localStorage.getItem('tm_token') || null,
  user: null,
};

// ─── API helpers ────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (State.token) opts.headers.Authorization = 'Bearer ' + State.token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);

// ─── Toast ───────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── Format helpers ──────────────────────────────────────────
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
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}
function posBadge(pos) {
  if (!pos) return '';
  const map = { 'GK': 'GK', 'Goalkeeper': 'GK', 'Defender': 'DEF', 'Centre-Back': 'DEF', 'Left-Back': 'DEF', 'Right-Back': 'DEF',
    'Midfielder': 'MID', 'Central Midfield': 'MID', 'Attacking Midfield': 'MID', 'Defensive Midfield': 'MID',
    'Forward': 'FWD', 'Winger': 'FWD', 'Striker': 'FWD', 'Centre-Forward': 'FWD', 'Left Winger': 'FWD', 'Right Winger': 'FWD' };
  const key = map[pos] || pos.substring(0, 3).toUpperCase();
  const cls = key === 'GK' ? 'pos-GK' : key === 'DEF' ? 'pos-DEF' : key === 'MID' ? 'pos-MID' : key === 'FWD' ? 'pos-FWD' : 'pos-default';
  return `<span class="pos ${cls}">${pos}</span>`;
}
function ttypeBadge(t) {
  const cls = { permanent: 'ttype-permanent', loan: 'ttype-loan', free: 'ttype-free', youth: 'ttype-youth' }[t] || 'ttype-free';
  return `<span class="ttype ${cls}">${t || 'transfer'}</span>`;
}
function avatarEl(url, name, large) {
  if (url) return `<img src="${url}" class="${large ? 'avatar-lg' : 'avatar'}" alt="${name}" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`;
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="${large ? 'avatar-placeholder-lg' : 'avatar-placeholder'}">${initials}</div>`;
}
function teamLogoEl(url, name) {
  if (url) return `<img src="${url}" class="team-logo" alt="${name}" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`;
  return `<div class="team-logo-placeholder">${(name || '?').substring(0, 3).toUpperCase()}</div>`;
}
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Auth ────────────────────────────────────────────────────
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
document.getElementById('login-modal-close').addEventListener('click', () => {
  document.getElementById('login-modal').classList.add('hidden');
});
document.getElementById('login-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('login-modal'))
    document.getElementById('login-modal').classList.add('hidden');
});
document.getElementById('btn-do-login').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
async function doLogin() {
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const data = await POST('/auth/login', { username: u, password: p });
    State.token = data.token;
    State.user = data.username;
    localStorage.setItem('tm_token', data.token);
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-password').value = '';
    updateAuthUI();
    toast('Logged in as ' + data.username);
    router();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}
document.getElementById('btn-logout').addEventListener('click', () => {
  State.token = null;
  localStorage.removeItem('tm_token');
  updateAuthUI();
  toast('Logged out', 'info');
  navigate('/');
});

// ─── Global Search ────────────────────────────────────────────
let searchTimeout;
document.getElementById('search-global').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  searchTimeout = setTimeout(() => {
    navigate('/search?q=' + encodeURIComponent(q));
  }, 400);
});

// ─── Router ───────────────────────────────────────────────────
function navigate(path) { window.location.hash = '#' + path; }

function router() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [rawPath, qs = ''] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));

  // Update nav active states
  document.querySelectorAll('#main-nav a').forEach(a => {
    const route = a.dataset.route;
    const active = rawPath === '/' ? route === 'home'
      : rawPath.startsWith('/' + route) && route !== 'home';
    a.classList.toggle('active', active);
  });

  const app = document.getElementById('app');
  const parts = rawPath.split('/').filter(Boolean);

  if (rawPath === '/' || rawPath === '') return renderHome(app);
  if (rawPath === '/teams') return renderTeams(app, params);
  if (parts[0] === 'teams' && parts[1]) return renderTeamDetail(app, parts[1]);
  if (rawPath === '/players') return renderPlayers(app, params);
  if (parts[0] === 'players' && parts[1]) return renderPlayerDetail(app, parts[1]);
  if (rawPath === '/competitions') return renderCompetitions(app, params);
  if (parts[0] === 'competitions' && parts[1]) return renderCompetitionDetail(app, parts[1]);
  if (rawPath === '/transfers') return renderTransfers(app, params);
  if (rawPath === '/admin') return renderAdmin(app);
  if (rawPath === '/search') return renderSearch(app, params.q);
  app.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Page not found</p></div>`;
}

window.addEventListener('hashchange', router);
window.addEventListener('load', () => { updateAuthUI(); router(); });

// ═══════════════════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════════════════
async function renderHome(app) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const stats = await GET('/stats');
    app.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.totals.teams}</div>
          <div class="stat-label">Teams</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totals.players}</div>
          <div class="stat-label">Players</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totals.transfers}</div>
          <div class="stat-label">Transfers</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${fmtValue(stats.totals.transfer_value)}</div>
          <div class="stat-label">Total Transfer Value</div>
        </div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-header">⭐ Most Valuable Players</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Team</th><th class="text-right">Market Value</th></tr></thead>
              <tbody>
                ${stats.top_players.map((p, i) => `
                  <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
                    <td class="text-muted">${i + 1}</td>
                    <td>
                      <div class="flex-center gap-2">
                        ${avatarEl(p.image_url, p.name)}
                        <div>
                          <div class="font-bold">${escHtml(p.name)}</div>
                          <div class="text-muted" style="font-size:11px">${p.flag_emoji || ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>${posBadge(p.position)}</td>
                    <td class="text-muted">${escHtml(p.team_name || 'Free Agent')}</td>
                    <td class="text-right mv">${fmtValue(p.market_value)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header">🏆 Most Valuable Teams</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Team</th><th>League</th><th class="text-right">Squad Value</th></tr></thead>
              <tbody>
                ${stats.top_teams.map((t, i) => `
                  <tr class="clickable-row" onclick="navigate('/teams/${t.id}')">
                    <td class="text-muted">${i + 1}</td>
                    <td>
                      <div class="flex-center gap-2">
                        ${teamLogoEl(t.logo_url, t.name)}
                        <span class="font-bold">${escHtml(t.name)}</span>
                      </div>
                    </td>
                    <td class="text-muted">${escHtml(t.competition_name || '–')}</td>
                    <td class="text-right mv">${fmtValue(t.market_value)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ${stats.recent_transfers.length ? `
      <div class="card mt-3">
        <div class="card-header">🔄 Recent Transfers</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Player</th><th>From</th><th></th><th>To</th><th>Type</th><th class="text-right">Fee</th><th>Date</th></tr></thead>
            <tbody>
              ${stats.recent_transfers.map(tr => `
                <tr class="clickable-row" onclick="navigate('/players/${tr.player_id}')">
                  <td><div class="flex-center gap-2">${posBadge(tr.position)}<span>${escHtml(tr.player_name)}</span></div></td>
                  <td class="text-muted">${escHtml(tr.from_team_name || '–')}</td>
                  <td><span style="color:var(--green);font-size:16px">→</span></td>
                  <td>${escHtml(tr.to_team_name || '–')}</td>
                  <td>${ttypeBadge(tr.transfer_type)}</td>
                  <td class="text-right transfer-fee">${tr.transfer_fee > 0 ? fmtValue(tr.transfer_fee) : '<span class="transfer-free">Free</span>'}</td>
                  <td class="text-muted">${fmtDate(tr.transfer_date)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error loading data: ${err.message}</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
//  TEAMS LIST
// ═══════════════════════════════════════════════════════════
async function renderTeams(app, params) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [teams, competitions] = await Promise.all([GET('/teams'), GET('/competitions')]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Teams <small>${teams.length} clubs</small></h1>
        ${isAdmin() ? `<button class="btn btn-green" onclick="showTeamForm()">+ Add Team</button>` : ''}
      </div>
      <div class="filters">
        <input type="search" id="team-search" placeholder="Search teams…" value="${escHtml(params.search || '')}" />
        <select id="team-comp-filter">
          <option value="">All Competitions</option>
          ${competitions.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table id="teams-table">
            <thead>
              <tr>
                <th>Team</th><th>Country</th><th>League</th><th>Founded</th><th>Stadium</th><th class="text-right">Squad Value</th>
                ${isAdmin() ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody id="teams-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    const renderRows = (list) => {
      const tbody = document.getElementById('teams-tbody');
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🏟️</div><p>No teams found</p></div></td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(t => `
        <tr class="clickable-row" onclick="navigate('/teams/${t.id}')">
          <td>
            <div class="flex-center gap-2">
              ${teamLogoEl(t.logo_url, t.name)}
              <span class="font-bold">${escHtml(t.name)}</span>
              ${t.short_name ? `<span class="text-muted" style="font-size:11px">(${escHtml(t.short_name)})</span>` : ''}
            </div>
          </td>
          <td>${t.flag_emoji || ''} ${escHtml(t.country_name || '–')}</td>
          <td>${escHtml(t.competition_name || '–')}</td>
          <td class="text-muted">${t.founded || '–'}</td>
          <td class="text-muted">${escHtml(t.stadium || '–')}</td>
          <td class="text-right mv">${fmtValue(t.market_value)}</td>
          ${isAdmin() ? `<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showTeamForm(${JSON.stringify(t).replace(/"/g,'&quot;')})" title="Edit">✏️</button>
            <button class="btn-icon danger" onclick="deleteTeam(${t.id},'${escHtml(t.name)}')" title="Delete">🗑️</button>
          </td>` : ''}
        </tr>
      `).join('');
    };
    renderRows(teams);

    let filtered = [...teams];
    function applyFilters() {
      const s = document.getElementById('team-search').value.toLowerCase();
      const c = document.getElementById('team-comp-filter').value;
      filtered = teams.filter(t =>
        (!s || t.name.toLowerCase().includes(s) || (t.short_name || '').toLowerCase().includes(s)) &&
        (!c || String(t.competition_id) === c)
      );
      renderRows(filtered);
    }
    document.getElementById('team-search').addEventListener('input', applyFilters);
    document.getElementById('team-comp-filter').addEventListener('change', applyFilters);
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

// ─── Team Form ───────────────────────────────────────────────
async function showTeamForm(team) {
  const [countries, competitions] = await Promise.all([GET('/countries'), GET('/competitions')]);
  const isEdit = !!team;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Team' : 'Add New Team'}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>Team Name *</label>
            <input type="text" id="tf-name" value="${escHtml(team?.name || '')}" />
          </div>
          <div class="form-group">
            <label>Short Name</label>
            <input type="text" id="tf-short" value="${escHtml(team?.short_name || '')}" maxlength="10" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Country</label>
            <select id="tf-country">
              <option value="">– Select –</option>
              ${countries.map(c => `<option value="${c.id}" ${team?.country_id == c.id ? 'selected' : ''}>${c.flag_emoji || ''} ${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Competition / League</label>
            <select id="tf-comp">
              <option value="">– Select –</option>
              ${competitions.map(c => `<option value="${c.id}" ${team?.competition_id == c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Founded Year</label>
            <input type="number" id="tf-founded" value="${team?.founded || ''}" min="1800" max="2030" />
          </div>
          <div class="form-group">
            <label>Stadium</label>
            <input type="text" id="tf-stadium" value="${escHtml(team?.stadium || '')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Market Value (€)</label>
            <input type="number" id="tf-mv" value="${team?.market_value || 0}" min="0" step="100000" />
          </div>
          <div class="form-group">
            <label>Logo URL</label>
            <input type="text" id="tf-logo" value="${escHtml(team?.logo_url || '')}" placeholder="https://... or /images/uploads/..." />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="tf-save">${isEdit ? 'Save Changes' : 'Add Team'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#tf-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('tf-name').value.trim(),
      short_name: document.getElementById('tf-short').value.trim(),
      country_id: document.getElementById('tf-country').value || null,
      competition_id: document.getElementById('tf-comp').value || null,
      founded: document.getElementById('tf-founded').value || null,
      stadium: document.getElementById('tf-stadium').value.trim(),
      market_value: parseFloat(document.getElementById('tf-mv').value) || 0,
      logo_url: document.getElementById('tf-logo').value.trim() || null,
    };
    if (!payload.name) { toast('Team name is required', 'error'); return; }
    try {
      if (isEdit) await PUT('/teams/' + team.id, payload);
      else await POST('/teams', payload);
      toast(isEdit ? 'Team updated' : 'Team added');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteTeam(id, name) {
  if (!confirm(`Delete team "${name}"? This will also remove all associated data.`)) return;
  try {
    await DEL('/teams/' + id);
    toast('Team deleted');
    router();
  } catch (err) { toast(err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
//  TEAM DETAIL
// ═══════════════════════════════════════════════════════════
async function renderTeamDetail(app, id) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const team = await GET('/teams/' + id);
    app.innerHTML = `
      <div class="detail-hero">
        ${teamLogoEl(team.logo_url, team.name)}
        <div class="hero-info">
          <h1>${escHtml(team.name)}</h1>
          <div class="meta">
            ${team.flag_emoji ? `<span>${team.flag_emoji} ${escHtml(team.country_name)}</span>` : ''}
            ${team.competition_name ? `<span>🏆 ${escHtml(team.competition_name)}</span>` : ''}
            ${team.founded ? `<span>📅 Founded ${team.founded}</span>` : ''}
            ${team.stadium ? `<span>🏟️ ${escHtml(team.stadium)}</span>` : ''}
          </div>
        </div>
        <div class="hero-mv">
          <div class="mv-label">Squad Value</div>
          <div class="mv-value">${fmtValue(team.market_value)}</div>
        </div>
        ${isAdmin() ? `
        <div style="margin-left:16px;display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showTeamForm(${JSON.stringify(team).replace(/"/g,'&quot;')})">Edit</button>
        </div>` : ''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="squad">Squad (${team.players.length})</button>
        <button class="detail-tab" data-tab="titles">Titles (${team.titles.length})</button>
        <button class="detail-tab" data-tab="transfers">Transfers (${team.transfers.length})</button>
      </div>
      <div id="tab-squad" class="tab-panel active">${renderSquadTab(team)}</div>
      <div id="tab-titles" class="tab-panel">${renderTitlesTab(team.titles, team.id, null)}</div>
      <div id="tab-transfers" class="tab-panel">${renderTransfersTab(team.transfers)}</div>
    `;
    setupTabs(app);
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

function renderSquadTab(team) {
  if (!team.players.length) return `<div class="empty-state"><div class="empty-icon">⚽</div><p>No players in squad</p></div>`;
  return `
    <div class="card">
      <div class="card-header">
        Squad
        ${isAdmin() ? `<button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showPlayerForm(null,${team.id})">+ Add Player</button>` : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Player</th><th>Nat.</th><th>Pos</th><th>Age</th><th>Foot</th><th class="text-right">Market Value</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${team.players.map(p => `
              <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
                <td class="text-muted">${p.shirt_number || '–'}</td>
                <td>
                  <div class="flex-center gap-2">
                    ${avatarEl(p.image_url, p.name)}
                    <span class="font-bold">${escHtml(p.name)}</span>
                  </div>
                </td>
                <td>${p.flag_emoji || '–'}</td>
                <td>${posBadge(p.position)}</td>
                <td class="text-muted">${calcAge(p.date_of_birth) || '–'}</td>
                <td class="text-muted">${p.foot || '–'}</td>
                <td class="text-right mv">${fmtValue(p.market_value)}</td>
                ${isAdmin() ? `<td onclick="event.stopPropagation()" style="white-space:nowrap">
                  <button class="btn-icon" onclick="showPlayerForm(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Edit">✏️</button>
                  <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${escHtml(p.name)}')" title="Delete">🗑️</button>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTitlesTab(titles, teamId, playerId) {
  return `
    <div class="card">
      <div class="card-header">
        Titles & Honours
        ${isAdmin() ? `<button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showTitleForm(null,${teamId || 'null'},${playerId || 'null'})">+ Add Title</button>` : ''}
      </div>
      ${!titles.length ? `<div class="empty-state" style="padding:40px"><div class="empty-icon">🏆</div><p>No titles recorded</p></div>` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Competition</th><th>Season</th><th>Year</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${titles.map(t => `
              <tr>
                <td class="font-bold">🏆 ${escHtml(t.title_name)}</td>
                <td class="text-muted">${escHtml(t.competition_name || '–')}</td>
                <td class="text-muted">${escHtml(t.season || '–')}</td>
                <td class="text-muted">${t.year || '–'}</td>
                ${isAdmin() ? `<td style="white-space:nowrap">
                  <button class="btn-icon" onclick="showTitleForm(${JSON.stringify(t).replace(/"/g,'&quot;')},${teamId||'null'},${playerId||'null'})" title="Edit">✏️</button>
                  <button class="btn-icon danger" onclick="deleteTitle(${t.id})" title="Delete">🗑️</button>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
  `;
}

function renderTransfersTab(transfers) {
  if (!transfers.length) return `<div class="empty-state"><div class="empty-icon">🔄</div><p>No transfers recorded</p></div>`;
  return `
    <div class="card">
      <div class="card-header">Transfer History</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>From</th><th></th><th>To</th><th>Type</th><th class="text-right">Fee</th><th>Date</th></tr></thead>
          <tbody>
            ${transfers.map(tr => `
              <tr class="clickable-row" onclick="navigate('/players/${tr.player_id}')">
                <td class="font-bold">${escHtml(tr.player_name)}</td>
                <td class="text-muted">${escHtml(tr.from_team_name || '–')}</td>
                <td><span style="color:var(--green);font-size:16px">→</span></td>
                <td>${escHtml(tr.to_team_name || '–')}</td>
                <td>${ttypeBadge(tr.transfer_type)}</td>
                <td class="text-right transfer-fee">${tr.transfer_fee > 0 ? fmtValue(tr.transfer_fee) : '<span class="transfer-free">Free</span>'}</td>
                <td class="text-muted">${fmtDate(tr.transfer_date)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function setupTabs(container) {
  container.querySelectorAll('.detail-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  PLAYERS LIST
// ═══════════════════════════════════════════════════════════
const POSITIONS = ['Goalkeeper', 'Centre-Back', 'Left-Back', 'Right-Back', 'Defensive Midfield', 'Central Midfield', 'Attacking Midfield', 'Left Winger', 'Right Winger', 'Centre-Forward', 'Striker'];

async function renderPlayers(app, params) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [players, teams] = await Promise.all([GET('/players'), GET('/teams')]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Players <small>${players.length} registered</small></h1>
        ${isAdmin() ? `<button class="btn btn-green" onclick="showPlayerForm()">+ Add Player</button>` : ''}
      </div>
      <div class="filters">
        <input type="search" id="player-search" placeholder="Search players…" />
        <select id="player-pos-filter">
          <option value="">All Positions</option>
          ${POSITIONS.map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
        <select id="player-team-filter">
          <option value="">All Teams</option>
          <option value="free">Free Agents</option>
          ${teams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
        </select>
        <select id="player-status-filter">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
          <option value="free_agent">Free Agent</option>
        </select>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Player</th><th>Nat.</th><th>Position</th><th>Age</th><th>Team</th><th>Foot</th><th class="text-right">Market Value</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
            <tbody id="players-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    const renderRows = (list) => {
      const tbody = document.getElementById('players-tbody');
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚽</div><p>No players found</p></div></td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(p => `
        <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
          <td>
            <div class="flex-center gap-2">
              ${avatarEl(p.image_url, p.name)}
              <div>
                <div class="font-bold">${escHtml(p.name)}</div>
                ${p.status !== 'active' ? `<span class="badge badge-gray">${p.status}</span>` : ''}
              </div>
            </div>
          </td>
          <td title="${escHtml(p.nationality_name || '')}">${p.flag_emoji || '–'}</td>
          <td>${posBadge(p.position)}</td>
          <td class="text-muted">${calcAge(p.date_of_birth) || '–'}</td>
          <td class="text-muted">${escHtml(p.team_name || '<em>Free Agent</em>')}</td>
          <td class="text-muted">${p.foot || '–'}</td>
          <td class="text-right mv">${fmtValue(p.market_value)}</td>
          ${isAdmin() ? `<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showPlayerForm(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Edit">✏️</button>
            <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${escHtml(p.name)}')" title="Delete">🗑️</button>
          </td>` : ''}
        </tr>
      `).join('');
    };
    renderRows(players);

    function applyFilters() {
      const s = document.getElementById('player-search').value.toLowerCase();
      const pos = document.getElementById('player-pos-filter').value;
      const teamVal = document.getElementById('player-team-filter').value;
      const status = document.getElementById('player-status-filter').value;
      const filtered = players.filter(p =>
        (!s || p.name.toLowerCase().includes(s)) &&
        (!pos || p.position === pos) &&
        (!teamVal || (teamVal === 'free' ? !p.team_id : String(p.team_id) === teamVal)) &&
        (!status || p.status === status)
      );
      renderRows(filtered);
    }
    ['player-search','player-pos-filter','player-team-filter','player-status-filter'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFilters);
      document.getElementById(id).addEventListener('input', applyFilters);
    });
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

// ─── Player Form ─────────────────────────────────────────────
async function showPlayerForm(player, defaultTeamId) {
  const [countries, teams] = await Promise.all([GET('/countries'), GET('/teams')]);
  const isEdit = !!player;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Player' : 'Add New Player'}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name *</label>
            <input type="text" id="pf-name" value="${escHtml(player?.name || '')}" />
          </div>
          <div class="form-group">
            <label>Date of Birth</label>
            <input type="date" id="pf-dob" value="${player?.date_of_birth?.substring(0,10) || ''}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Nationality</label>
            <select id="pf-nat">
              <option value="">– Select –</option>
              ${countries.map(c => `<option value="${c.id}" ${player?.nationality_id == c.id ? 'selected' : ''}>${c.flag_emoji || ''} ${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Position</label>
            <select id="pf-pos">
              <option value="">– Select –</option>
              ${POSITIONS.map(p => `<option value="${p}" ${player?.position === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Team</label>
            <select id="pf-team">
              <option value="">Free Agent</option>
              ${teams.map(t => `<option value="${t.id}" ${(player?.team_id || defaultTeamId) == t.id ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Shirt Number</label>
            <input type="number" id="pf-shirt" value="${player?.shirt_number || ''}" min="1" max="99" />
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label>Preferred Foot</label>
            <select id="pf-foot">
              <option value="">–</option>
              <option value="Right" ${player?.foot === 'Right' ? 'selected' : ''}>Right</option>
              <option value="Left" ${player?.foot === 'Left' ? 'selected' : ''}>Left</option>
              <option value="Both" ${player?.foot === 'Both' ? 'selected' : ''}>Both</option>
            </select>
          </div>
          <div class="form-group">
            <label>Height (cm)</label>
            <input type="number" id="pf-height" value="${player?.height || ''}" min="140" max="220" />
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="pf-status">
              <option value="active" ${(!player?.status || player.status === 'active') ? 'selected' : ''}>Active</option>
              <option value="retired" ${player?.status === 'retired' ? 'selected' : ''}>Retired</option>
              <option value="free_agent" ${player?.status === 'free_agent' ? 'selected' : ''}>Free Agent</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Market Value (€)</label>
            <input type="number" id="pf-mv" value="${player?.market_value || 0}" min="0" step="100000" />
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <input type="text" id="pf-img" value="${escHtml(player?.image_url || '')}" placeholder="https://... or /images/uploads/..." />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="pf-save">${isEdit ? 'Save Changes' : 'Add Player'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#pf-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('pf-name').value.trim(),
      date_of_birth: document.getElementById('pf-dob').value || null,
      nationality_id: document.getElementById('pf-nat').value || null,
      position: document.getElementById('pf-pos').value || null,
      foot: document.getElementById('pf-foot').value || null,
      height: parseInt(document.getElementById('pf-height').value) || null,
      team_id: document.getElementById('pf-team').value || null,
      shirt_number: parseInt(document.getElementById('pf-shirt').value) || null,
      market_value: parseFloat(document.getElementById('pf-mv').value) || 0,
      image_url: document.getElementById('pf-img').value.trim() || null,
      status: document.getElementById('pf-status').value,
    };
    if (!payload.name) { toast('Player name is required', 'error'); return; }
    try {
      if (isEdit) await PUT('/players/' + player.id, payload);
      else await POST('/players', payload);
      toast(isEdit ? 'Player updated' : 'Player added');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deletePlayer(id, name) {
  if (!confirm(`Delete player "${name}"?`)) return;
  try {
    await DEL('/players/' + id);
    toast('Player deleted');
    router();
  } catch (err) { toast(err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
//  PLAYER DETAIL
// ═══════════════════════════════════════════════════════════
async function renderPlayerDetail(app, id) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const player = await GET('/players/' + id);
    const age = calcAge(player.date_of_birth);
    app.innerHTML = `
      <div class="detail-hero">
        ${avatarEl(player.image_url, player.name, true)}
        <div class="hero-info">
          <h1>${escHtml(player.name)}</h1>
          <div class="meta">
            ${player.flag_emoji ? `<span title="${escHtml(player.nationality_name || '')}">${player.flag_emoji} ${escHtml(player.nationality_name || '')}</span>` : ''}
            ${player.position ? `<span>${posBadge(player.position)}</span>` : ''}
            ${age ? `<span>🎂 ${age} yrs${player.date_of_birth ? ' ('+fmtDate(player.date_of_birth)+')' : ''}</span>` : ''}
            ${player.team_name ? `<span>🏟️ <a href="#/teams/${player.team_id}" style="color:rgba(255,255,255,.85);text-decoration:underline">${escHtml(player.team_name)}</a></span>` : '<span>🔓 Free Agent</span>'}
            ${player.foot ? `<span>👟 ${player.foot} foot</span>` : ''}
            ${player.height ? `<span>📏 ${player.height} cm</span>` : ''}
            ${player.shirt_number ? `<span>#${player.shirt_number}</span>` : ''}
          </div>
        </div>
        <div class="hero-mv">
          <div class="mv-label">Market Value</div>
          <div class="mv-value">${fmtValue(player.market_value)}</div>
          <div class="mt-1" style="font-size:11px;opacity:.7">${player.status !== 'active' ? '<span class="badge badge-gold">'+player.status+'</span>' : ''}</div>
        </div>
        ${isAdmin() ? `
        <div style="margin-left:16px;display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showPlayerForm(${JSON.stringify(player).replace(/"/g,'&quot;')})">Edit</button>
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showTransferForm(${JSON.stringify(player).replace(/"/g,'&quot;')})">Transfer</button>
        </div>` : ''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="transfers">Transfers (${player.transfers.length})</button>
        <button class="detail-tab" data-tab="titles">Titles (${player.titles.length})</button>
        <button class="detail-tab" data-tab="market">Market Value History</button>
      </div>
      <div id="tab-transfers" class="tab-panel active">${renderTransfersTab(player.transfers)}</div>
      <div id="tab-titles" class="tab-panel">${renderTitlesTab(player.titles, null, player.id)}</div>
      <div id="tab-market" class="tab-panel">${renderMarketHistoryTab(player)}</div>
    `;
    setupTabs(app);
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

function renderMarketHistoryTab(player) {
  const hist = player.market_value_history || [];
  if (!hist.length) return `<div class="empty-state"><div class="empty-icon">📈</div><p>No market value history recorded</p></div>`;
  const max = Math.max(...hist.map(h => h.market_value));
  return `
    <div class="card">
      <div class="card-header">Market Value History</div>
      <div class="card-body">
        <div class="chart-container">
          ${hist.map(h => {
            const pct = max > 0 ? Math.max(4, Math.round((h.market_value / max) * 100)) : 4;
            return `<div class="chart-bar" style="height:${pct}%" title="${fmtValue(h.market_value)} (${fmtDate(h.recorded_at)})"></div>`;
          }).join('')}
        </div>
        <div class="flex mt-2" style="justify-content:space-between;font-size:12px;color:var(--text-muted)">
          <span>${fmtDate(hist[0].recorded_at)}</span>
          <span>${fmtDate(hist[hist.length-1].recorded_at)}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th class="text-right">Market Value</th></tr></thead>
          <tbody>
            ${[...hist].reverse().map(h => `
              <tr>
                <td class="text-muted">${fmtDate(h.recorded_at)}</td>
                <td class="text-right mv">${fmtValue(h.market_value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Transfer Form ────────────────────────────────────────────
async function showTransferForm(player) {
  const teams = await GET('/teams');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Record Transfer: ${escHtml(player.name)}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>From Team</label>
            <select id="trf-from">
              <option value="">– None / Youth –</option>
              ${teams.map(t => `<option value="${t.id}" ${player.team_id == t.id ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>To Team</label>
            <select id="trf-to">
              <option value="">– Free Agent –</option>
              ${teams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Transfer Fee (€)</label>
            <input type="number" id="trf-fee" value="0" min="0" step="100000" />
          </div>
          <div class="form-group">
            <label>Transfer Date</label>
            <input type="date" id="trf-date" value="${new Date().toISOString().substring(0,10)}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Transfer Type</label>
            <select id="trf-type">
              <option value="permanent">Permanent</option>
              <option value="loan">Loan</option>
              <option value="free">Free Transfer</option>
              <option value="youth">Youth</option>
            </select>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <input type="text" id="trf-notes" placeholder="Optional notes…" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="trf-save">Record Transfer</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#trf-save').addEventListener('click', async () => {
    const payload = {
      player_id: player.id,
      from_team_id: document.getElementById('trf-from').value || null,
      to_team_id: document.getElementById('trf-to').value || null,
      transfer_fee: parseFloat(document.getElementById('trf-fee').value) || 0,
      transfer_date: document.getElementById('trf-date').value || null,
      transfer_type: document.getElementById('trf-type').value,
      notes: document.getElementById('trf-notes').value.trim() || null,
    };
    try {
      await POST('/transfers', payload);
      toast('Transfer recorded');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ─── Title Form ────────────────────────────────────────────────
async function showTitleForm(title, teamId, playerId) {
  const competitions = await GET('/competitions');
  const isEdit = !!title;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Title' : 'Add Title / Honor'}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Title Name *</label>
          <input type="text" id="titf-name" value="${escHtml(title?.title_name || '')}" placeholder="e.g. Premier League, Champions League…" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Competition</label>
            <select id="titf-comp">
              <option value="">– Select –</option>
              ${competitions.map(c => `<option value="${c.id}" ${title?.competition_id == c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Year</label>
            <input type="number" id="titf-year" value="${title?.year || new Date().getFullYear()}" min="1800" max="2100" />
          </div>
        </div>
        <div class="form-group">
          <label>Season (e.g. 2023/24)</label>
          <input type="text" id="titf-season" value="${escHtml(title?.season || '')}" placeholder="2023/24" />
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="titf-save">${isEdit ? 'Save Changes' : 'Add Title'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#titf-save').addEventListener('click', async () => {
    const payload = {
      title_name: document.getElementById('titf-name').value.trim(),
      competition_id: document.getElementById('titf-comp').value || null,
      year: parseInt(document.getElementById('titf-year').value) || null,
      season: document.getElementById('titf-season').value.trim() || null,
      team_id: teamId || null,
      player_id: playerId || null,
    };
    if (!payload.title_name) { toast('Title name is required', 'error'); return; }
    try {
      if (isEdit) await PUT('/titles/' + title.id, payload);
      else await POST('/titles', payload);
      toast(isEdit ? 'Title updated' : 'Title added');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteTitle(id) {
  if (!confirm('Delete this title?')) return;
  try {
    await DEL('/titles/' + id);
    toast('Title deleted');
    router();
  } catch (err) { toast(err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
//  COMPETITIONS
// ═══════════════════════════════════════════════════════════
async function renderCompetitions(app, params) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [competitions, countries] = await Promise.all([GET('/competitions'), GET('/countries')]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Competitions <small>${competitions.length} total</small></h1>
        ${isAdmin() ? `<button class="btn btn-green" onclick="showCompForm(null,${JSON.stringify(countries).replace(/"/g,'&quot;')})">+ Add Competition</button>` : ''}
      </div>
      <div class="filters">
        <input type="search" id="comp-search" placeholder="Search competitions…" />
        <select id="comp-type-filter">
          <option value="">All Types</option>
          <option value="league">League</option>
          <option value="cup">Cup</option>
          <option value="international">International</option>
        </select>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Competition</th><th>Country</th><th>Type</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
            <tbody id="comp-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    const renderRows = (list) => {
      const tbody = document.getElementById('comp-tbody');
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">🏆</div><p>No competitions found</p></div></td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(c => `
        <tr class="clickable-row" onclick="navigate('/competitions/${c.id}')">
          <td class="font-bold">${escHtml(c.name)}</td>
          <td>${c.flag_emoji || ''} ${escHtml(c.country_name || '–')}</td>
          <td><span class="badge badge-green">${c.type || 'league'}</span></td>
          ${isAdmin() ? `<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon" onclick="showCompForm(${JSON.stringify(c).replace(/"/g,'&quot;')},${JSON.stringify(countries).replace(/"/g,'&quot;')})" title="Edit">✏️</button>
            <button class="btn-icon danger" onclick="deleteComp(${c.id},'${escHtml(c.name)}')" title="Delete">🗑️</button>
          </td>` : ''}
        </tr>
      `).join('');
    };
    renderRows(competitions);

    function applyFilters() {
      const s = document.getElementById('comp-search').value.toLowerCase();
      const type = document.getElementById('comp-type-filter').value;
      renderRows(competitions.filter(c =>
        (!s || c.name.toLowerCase().includes(s)) && (!type || c.type === type)
      ));
    }
    document.getElementById('comp-search').addEventListener('input', applyFilters);
    document.getElementById('comp-type-filter').addEventListener('change', applyFilters);
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

async function renderCompetitionDetail(app, id) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const comp = await GET('/competitions/' + id);
    app.innerHTML = `
      <div class="detail-hero" style="gap:20px">
        <div class="hero-info">
          <h1>🏆 ${escHtml(comp.name)}</h1>
          <div class="meta">
            ${comp.flag_emoji ? `<span>${comp.flag_emoji} ${escHtml(comp.country_name)}</span>` : ''}
            <span class="badge badge-green">${comp.type}</span>
          </div>
        </div>
        ${isAdmin() ? `
        <div style="margin-left:auto">
          <button class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" onclick="showCompForm(${JSON.stringify(comp).replace(/"/g,'&quot;')},null)">Edit</button>
        </div>` : ''}
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="teams">Teams (${comp.teams.length})</button>
        <button class="detail-tab" data-tab="titles">Winners (${comp.titles.length})</button>
      </div>
      <div id="tab-teams" class="tab-panel active">
        <div class="card">
          <div class="card-header">Participating Teams</div>
          ${!comp.teams.length ? `<div class="empty-state" style="padding:40px"><p>No teams in this competition</p></div>` : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Team</th><th>Country</th><th class="text-right">Squad Value</th></tr></thead>
              <tbody>
                ${comp.teams.map(t => `
                  <tr class="clickable-row" onclick="navigate('/teams/${t.id}')">
                    <td><div class="flex-center gap-2">${teamLogoEl(t.logo_url, t.name)}<span class="font-bold">${escHtml(t.name)}</span></div></td>
                    <td>${t.flag_emoji || ''} ${escHtml(t.country_name || '–')}</td>
                    <td class="text-right mv">${fmtValue(t.market_value)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      </div>
      <div id="tab-titles" class="tab-panel">
        <div class="card">
          <div class="card-header">Past Winners</div>
          ${!comp.titles.length ? `<div class="empty-state" style="padding:40px"><div class="empty-icon">🏆</div><p>No winners recorded</p></div>` : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Year</th><th>Season</th><th>Winner</th></tr></thead>
              <tbody>
                ${comp.titles.map(t => `
                  <tr>
                    <td class="font-bold">${t.year || '–'}</td>
                    <td class="text-muted">${escHtml(t.season || '–')}</td>
                    <td>${t.team_name ? `<a href="#/teams/${t.team_id}" class="text-green font-bold">${escHtml(t.team_name)}</a>` : '–'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      </div>
    `;
    setupTabs(app);
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

async function showCompForm(comp, countries) {
  if (!countries) countries = await GET('/countries');
  const isEdit = !!comp;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Competition' : 'Add Competition'}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Name *</label>
          <input type="text" id="cf-name" value="${escHtml(comp?.name || '')}" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Country</label>
            <select id="cf-country">
              <option value="">– International –</option>
              ${countries.map(c => `<option value="${c.id}" ${comp?.country_id == c.id ? 'selected' : ''}>${c.flag_emoji || ''} ${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="cf-type">
              <option value="league" ${comp?.type === 'league' ? 'selected' : ''}>League</option>
              <option value="cup" ${comp?.type === 'cup' ? 'selected' : ''}>Cup</option>
              <option value="international" ${comp?.type === 'international' ? 'selected' : ''}>International</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="cf-save">${isEdit ? 'Save Changes' : 'Add Competition'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#cf-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('cf-name').value.trim(),
      country_id: document.getElementById('cf-country').value || null,
      type: document.getElementById('cf-type').value,
    };
    if (!payload.name) { toast('Name is required', 'error'); return; }
    try {
      if (isEdit) await PUT('/competitions/' + comp.id, payload);
      else await POST('/competitions', payload);
      toast(isEdit ? 'Competition updated' : 'Competition added');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteComp(id, name) {
  if (!confirm(`Delete competition "${name}"?`)) return;
  try {
    await DEL('/competitions/' + id);
    toast('Deleted');
    router();
  } catch (err) { toast(err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
//  TRANSFERS PAGE
// ═══════════════════════════════════════════════════════════
async function renderTransfers(app, params) {
  app.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const [transfers, teams] = await Promise.all([GET('/transfers?limit=100'), GET('/teams')]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Transfers <small>${transfers.length} records</small></h1>
        ${isAdmin() ? `<button class="btn btn-green" onclick="showTransferForm(null)">+ Record Transfer</button>` : ''}
      </div>
      <div class="filters">
        <input type="search" id="tr-search" placeholder="Search player name…" />
        <select id="tr-team-filter">
          <option value="">All Teams</option>
          ${teams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
        </select>
        <select id="tr-type-filter">
          <option value="">All Types</option>
          <option value="permanent">Permanent</option>
          <option value="loan">Loan</option>
          <option value="free">Free</option>
          <option value="youth">Youth</option>
        </select>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Player</th><th>Pos</th><th>From</th><th></th><th>To</th><th>Type</th><th class="text-right">Fee</th><th>Date</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
            <tbody id="tr-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    const renderRows = (list) => {
      const tbody = document.getElementById('tr-tbody');
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🔄</div><p>No transfers found</p></div></td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(tr => `
        <tr class="clickable-row" onclick="navigate('/players/${tr.player_id}')">
          <td class="font-bold">${escHtml(tr.player_name)}</td>
          <td>${posBadge(tr.position)}</td>
          <td class="text-muted">${escHtml(tr.from_team_name || '–')}</td>
          <td><span style="color:var(--green);font-size:16px">→</span></td>
          <td>${escHtml(tr.to_team_name || '–')}</td>
          <td>${ttypeBadge(tr.transfer_type)}</td>
          <td class="text-right transfer-fee">${tr.transfer_fee > 0 ? fmtValue(tr.transfer_fee) : '<span class="transfer-free">Free</span>'}</td>
          <td class="text-muted">${fmtDate(tr.transfer_date)}</td>
          ${isAdmin() ? `<td onclick="event.stopPropagation()" style="white-space:nowrap">
            <button class="btn-icon danger" onclick="deleteTransfer(${tr.id})" title="Delete">🗑️</button>
          </td>` : ''}
        </tr>
      `).join('');
    };
    renderRows(transfers);

    function applyFilters() {
      const s = document.getElementById('tr-search').value.toLowerCase();
      const team = document.getElementById('tr-team-filter').value;
      const type = document.getElementById('tr-type-filter').value;
      renderRows(transfers.filter(tr =>
        (!s || tr.player_name.toLowerCase().includes(s)) &&
        (!team || String(tr.from_team_id) === team || String(tr.to_team_id) === team) &&
        (!type || tr.transfer_type === type)
      ));
    }
    ['tr-search','tr-team-filter','tr-type-filter'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFilters);
      document.getElementById(id).addEventListener('input', applyFilters);
    });
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

async function deleteTransfer(id) {
  if (!confirm('Delete this transfer record?')) return;
  try {
    await DEL('/transfers/' + id);
    toast('Transfer deleted');
    router();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Transfer form (standalone, no player preset) ─────────────
async function showTransferForm(player) {
  const [players, teams] = await Promise.all([GET('/players'), GET('/teams')]);
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Record Transfer</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Player *</label>
          <select id="trf2-player">
            <option value="">– Select Player –</option>
            ${players.map(p => `<option value="${p.id}" ${player?.id == p.id ? 'selected' : ''}>${escHtml(p.name)} ${p.team_name ? '('+escHtml(p.team_name)+')' : '(Free)'}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>From Team</label>
            <select id="trf2-from">
              <option value="">– None / Youth –</option>
              ${teams.map(t => `<option value="${t.id}" ${player?.team_id == t.id ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>To Team</label>
            <select id="trf2-to">
              <option value="">– Free Agent –</option>
              ${teams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Transfer Fee (€)</label>
            <input type="number" id="trf2-fee" value="0" min="0" step="100000" />
          </div>
          <div class="form-group">
            <label>Transfer Date</label>
            <input type="date" id="trf2-date" value="${new Date().toISOString().substring(0,10)}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Type</label>
            <select id="trf2-type">
              <option value="permanent">Permanent</option>
              <option value="loan">Loan</option>
              <option value="free">Free Transfer</option>
              <option value="youth">Youth</option>
            </select>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <input type="text" id="trf2-notes" placeholder="Optional notes…" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="trf2-save">Record Transfer</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#trf2-save').addEventListener('click', async () => {
    const playerId = document.getElementById('trf2-player').value;
    if (!playerId) { toast('Player is required', 'error'); return; }
    const payload = {
      player_id: playerId,
      from_team_id: document.getElementById('trf2-from').value || null,
      to_team_id: document.getElementById('trf2-to').value || null,
      transfer_fee: parseFloat(document.getElementById('trf2-fee').value) || 0,
      transfer_date: document.getElementById('trf2-date').value || null,
      transfer_type: document.getElementById('trf2-type').value,
      notes: document.getElementById('trf2-notes').value.trim() || null,
    };
    try {
      await POST('/transfers', payload);
      toast('Transfer recorded');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════════════════
async function renderAdmin(app) {
  if (!isAdmin()) {
    app.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Admin access required. Please log in.</p></div>`;
    return;
  }
  const [stats, countries] = await Promise.all([GET('/stats'), GET('/countries')]);
  app.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Admin Panel</h1>
      <span class="badge badge-gold">Logged in as admin</span>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.totals.teams}</div>
        <div class="stat-label">Teams</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.totals.players}</div>
        <div class="stat-label">Players</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.totals.transfers}</div>
        <div class="stat-label">Transfers</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtValue(stats.totals.transfer_value)}</div>
        <div class="stat-label">Transfer Value</div>
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header">Quick Actions</div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-green" onclick="navigate('/teams');showTeamForm()">+ Add Team</button>
          <button class="btn btn-green" onclick="navigate('/players');showPlayerForm()">+ Add Player</button>
          <button class="btn btn-green" onclick="navigate('/competitions')">+ Manage Competitions</button>
          <button class="btn btn-green" onclick="navigate('/transfers');showTransferForm(null)">+ Record Transfer</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          Countries / Nationalities
          <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="showCountryForm()">+ Add</button>
        </div>
        <div class="table-wrap" style="max-height:300px;overflow-y:auto">
          <table>
            <thead><tr><th>Flag</th><th>Name</th><th>Code</th><th></th></tr></thead>
            <tbody id="admin-countries-tbody">
              ${countries.map(c => `
                <tr>
                  <td>${c.flag_emoji || ''}</td>
                  <td>${escHtml(c.name)}</td>
                  <td class="text-muted">${c.code || '–'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn-icon" onclick="showCountryForm(${JSON.stringify(c).replace(/"/g,'&quot;')})" title="Edit">✏️</button>
                    <button class="btn-icon danger" onclick="deleteCountry(${c.id},'${escHtml(c.name)}')" title="Delete">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card mt-3">
      <div class="card-header">Change Admin Password</div>
      <div class="card-body">
        <div class="form-row-3">
          <div class="form-group">
            <label>Current Password</label>
            <input type="password" id="pw-current" />
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input type="password" id="pw-new" />
          </div>
          <div class="form-group">
            <label>Confirm New Password</label>
            <input type="password" id="pw-confirm" />
          </div>
        </div>
        <button class="btn btn-green" onclick="changePassword()">Update Password</button>
      </div>
    </div>
  `;
}

async function changePassword() {
  const cur = document.getElementById('pw-current').value;
  const nw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  if (!cur || !nw) { toast('Fill in all password fields', 'error'); return; }
  if (nw !== confirm) { toast('New passwords do not match', 'error'); return; }
  if (nw.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
  try {
    await api('POST', '/auth/change-password', { currentPassword: cur, newPassword: nw });
    toast('Password updated successfully');
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
  } catch (err) { toast(err.message, 'error'); }
}

async function showCountryForm(country) {
  const isEdit = !!country;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Country' : 'Add Country'}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Country Name *</label>
          <input type="text" id="cof-name" value="${escHtml(country?.name || '')}" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Code (3 letters)</label>
            <input type="text" id="cof-code" value="${escHtml(country?.code || '')}" maxlength="3" />
          </div>
          <div class="form-group">
            <label>Flag Emoji</label>
            <input type="text" id="cof-flag" value="${country?.flag_emoji || ''}" placeholder="🇬🇧" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline modal-cancel">Cancel</button>
          <button class="btn btn-green" id="cof-save">${isEdit ? 'Save' : 'Add Country'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#cof-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('cof-name').value.trim(),
      code: document.getElementById('cof-code').value.trim().toUpperCase() || null,
      flag_emoji: document.getElementById('cof-flag').value.trim() || null,
    };
    if (!payload.name) { toast('Name required', 'error'); return; }
    try {
      if (isEdit) await PUT('/countries/' + country.id, payload);
      else await POST('/countries', payload);
      toast(isEdit ? 'Country updated' : 'Country added');
      modal.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteCountry(id, name) {
  if (!confirm(`Delete country "${name}"?`)) return;
  try {
    await DEL('/countries/' + id);
    toast('Country deleted');
    router();
  } catch (err) { toast(err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════
async function renderSearch(app, query) {
  if (!query) { app.innerHTML = `<div class="empty-state"><p>Enter a search term</p></div>`; return; }
  app.innerHTML = '<div class="empty-state"><p>Searching…</p></div>';
  try {
    const [players, teams] = await Promise.all([
      GET('/players?search=' + encodeURIComponent(query)),
      GET('/teams?search=' + encodeURIComponent(query)),
    ]);
    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Search results for "<em>${escHtml(query)}</em>"</h1>
      </div>
      ${players.length ? `
      <div class="card mb-2">
        <div class="card-header">Players (${players.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th class="text-right">Market Value</th></tr></thead>
            <tbody>
              ${players.map(p => `
                <tr class="clickable-row" onclick="navigate('/players/${p.id}')">
                  <td><div class="flex-center gap-2">${avatarEl(p.image_url, p.name)}<span class="font-bold">${escHtml(p.name)}</span></div></td>
                  <td>${posBadge(p.position)}</td>
                  <td class="text-muted">${escHtml(p.team_name || 'Free Agent')}</td>
                  <td class="text-right mv">${fmtValue(p.market_value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
      ${teams.length ? `
      <div class="card">
        <div class="card-header">Teams (${teams.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Team</th><th>League</th><th class="text-right">Squad Value</th></tr></thead>
            <tbody>
              ${teams.map(t => `
                <tr class="clickable-row" onclick="navigate('/teams/${t.id}')">
                  <td><div class="flex-center gap-2">${teamLogoEl(t.logo_url, t.name)}<span class="font-bold">${escHtml(t.name)}</span></div></td>
                  <td class="text-muted">${escHtml(t.competition_name || '–')}</td>
                  <td class="text-right mv">${fmtValue(t.market_value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
      ${!players.length && !teams.length ? `<div class="empty-state"><div class="empty-icon">🔍</div><p>No results found for "${escHtml(query)}"</p></div>` : ''}
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}
