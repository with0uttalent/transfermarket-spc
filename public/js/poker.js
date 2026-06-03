/* ============================================================================
   POKER — real-time Texas Hold'em on a football-stadium themed table.
   Exposes window.PokerUI = { render, teardown }. Reuses app.js globals:
   State, GET, POST, toast, escHtml, fmtValue, isCoach, navigate.
   ========================================================================== */
(function () {
  'use strict';

  let socket = null;
  let appEl = null;
  let view = 'lobby';          // 'lobby' | 'table'
  let currentTableId = null;
  let tableState = null;
  let lobbyData = null;
  let mySeatChips = null;      // chips when I'm seated (for bet slider bounds)

  // ── Football-themed suits ──────────────────────────────────────────────────
  const SUIT = {
    s: { sym: '⚽', cls: 'suit-dark',  name: 'Мяч' },
    c: { sym: '👟', cls: 'suit-dark',  name: 'Бутса' },
    h: { sym: '🏆', cls: 'suit-red',   name: 'Кубок' },
    d: { sym: '🥅', cls: 'suit-red',   name: 'Ворота' },
  };
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  function rankLabel(r) { return RANK_LABEL[r] || String(r); }

  function cardHtml(card, opts = {}) {
    if (!card || card.hidden) {
      return `<div class="pk-card pk-card-back${opts.small ? ' pk-card-sm' : ''}"><div class="pk-card-back-inner">⚽</div></div>`;
    }
    const s = SUIT[card.suit] || SUIT.s;
    return `<div class="pk-card ${s.cls}${opts.small ? ' pk-card-sm' : ''}${opts.deal ? ' pk-card-deal' : ''}">
      <div class="pk-card-corner tl"><span class="pk-card-rank">${rankLabel(card.rank)}</span><span class="pk-card-suit">${s.sym}</span></div>
      <div class="pk-card-center">${s.sym}</div>
      <div class="pk-card-corner br"><span class="pk-card-rank">${rankLabel(card.rank)}</span><span class="pk-card-suit">${s.sym}</span></div>
    </div>`;
  }

  function fmtChips(n) {
    if (n == null) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(n));
  }

  // Ensure the socket.io client global `io` exists. If the server-served copy
  // at /socket.io/socket.io.js didn't load (e.g. nginx not proxying that path,
  // or socket.io not installed/restarted), fall back to a CDN copy.
  let _ioLoading = null;
  function ensureIo() {
    if (typeof io !== 'undefined') return Promise.resolve(true);
    if (_ioLoading) return _ioLoading;
    const SOURCES = [
      '/socket.io/socket.io.js',
      'https://cdn.socket.io/4.8.1/socket.io.min.js',
      'https://cdn.jsdelivr.net/npm/socket.io-client@4.8.1/dist/socket.io.min.js',
    ];
    _ioLoading = new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (typeof io !== 'undefined') return resolve(true);
        if (i >= SOURCES.length) return resolve(false);
        const src = SOURCES[i++];
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve(typeof io !== 'undefined' ? true : (tryNext(), undefined));
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
    return _ioLoading;
  }

  // ── socket lifecycle ───────────────────────────────────────────────────────
  async function connect() {
    if (socket && socket.connected) return socket;
    const ok = await ensureIo();
    if (!ok || typeof io === 'undefined') {
      toast('Не удалось загрузить покер-движок (socket.io). Проверьте подключение.', 'error');
      return null;
    }
    if (socket && socket.connected) return socket;
    socket = io({ auth: { token: State.token || '' }, transports: ['websocket', 'polling'] });
    socket.on('connect_error', (err) => { toast('Покер: нет связи с сервером (' + (err.message || 'ошибка') + ')', 'error'); });

    socket.on('connect', () => { socket.emit('lobby:join'); });
    socket.on('lobby:tables', tables => { if (lobbyData) lobbyData.tables = tables; if (view === 'lobby') renderLobby(); });
    socket.on('lobby:room', room => { if (lobbyData) lobbyData.room = room; if (view === 'lobby') renderLobby(); });
    socket.on('table:state', st => { tableState = st; if (view === 'table') renderTable(); });
    socket.on('table:sat', ({ chips }) => { mySeatChips = chips; toast('Вы сели за стол!'); });
    socket.on('table:left', ({ summary }) => { announceCashout(summary); mySeatChips = null; });
    socket.on('poker:error', ({ error }) => toast(error, 'error'));
    return socket;
  }

  function teardown() {
    if (socket) {
      try { socket.emit('lobby:leave'); if (currentTableId) socket.emit('table:unwatch', { tableId: currentTableId }); } catch (e) {}
      socket.disconnect();
      socket = null;
    }
    view = 'lobby'; currentTableId = null; tableState = null; mySeatChips = null;
  }

  // ── entry ────────────────────────────────────────────────────────────────
  async function render(el) {
    appEl = el;
    if (!State.token) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🃏</div><p>Войдите как тренер, чтобы играть в покер</p></div>`;
      return;
    }
    el.innerHTML = `<div class="empty-state"><p>Подключение к покер-серверу…</p></div>`;
    try { lobbyData = await GET('/poker'); } catch (e) { lobbyData = { tables: [], room: [] }; }
    await connect();
    view = 'lobby';
    renderLobby();
  }

  // ── LOBBY ──────────────────────────────────────────────────────────────────
  function renderLobby() {
    if (!appEl) return;
    const d = lobbyData || { tables: [], room: [] };
    const canPlay = !!(d.me && d.me.teamId);
    const tables = (d.tables || []).map(t => `
      <div class="pk-table-card" onclick="PokerUI._enterTable('${t.id}')">
        <div class="pk-table-card-felt">
          <div class="pk-table-card-glow"></div>
          <span class="pk-table-card-name">${escHtml(t.name)}</span>
          <div class="pk-table-card-blinds">Блайнды ${fmtChips(t.smallBlind)}/${fmtChips(t.bigBlind)}</div>
        </div>
        <div class="pk-table-card-meta">
          <span class="pk-seats-badge">👥 ${t.seated}/${t.maxSeats}</span>
          <span class="pk-state-badge pk-state-${t.state}">${t.state === 'waiting' ? 'Ожидание' : 'Идёт игра'}</span>
          ${t.pot ? `<span class="pk-pot-badge">Банк ${fmtChips(t.pot)}</span>` : ''}
        </div>
        <button class="pk-join-btn">Войти за стол →</button>
      </div>`).join('');

    const room = (d.room || []).map(m => `<span class="pk-room-chip">${escHtml(m.name)}</span>`).join('') || '<span class="pk-room-empty">Пока никого</span>';

    appEl.innerHTML = `
      <div class="pk-lobby">
        <div class="pk-lobby-hero">
          <div class="pk-lobby-hero-bg"></div>
          <div class="pk-lobby-hero-content">
            <h1 class="pk-lobby-title">🏟️ Покерный Стадион</h1>
            <p class="pk-lobby-sub">Садись за стол и играй на деньги, игроков или всю команду</p>
            ${canPlay ? `<div class="pk-bankroll">
              <span class="pk-bankroll-item">💰 Бюджет: <b>${fmtValue(d.budget || 0)}</b></span>
              <span class="pk-bankroll-item">⚽ Стоимость команды: <b>${fmtValue(d.teamValue || 0)}</b></span>
            </div>` : `<div class="pk-warn">Нужна команда, чтобы садиться за стол</div>`}
          </div>
        </div>

        <div class="pk-room-bar">
          <span class="pk-room-label">В комнате (${(d.room || []).length}/20):</span>
          <div class="pk-room-chips">${room}</div>
        </div>

        <h2 class="pk-section-title">Столы</h2>
        <div class="pk-tables-grid">${tables || '<p>Нет столов</p>'}</div>
      </div>`;
  }

  async function enterTable(tableId) {
    currentTableId = tableId;
    view = 'table';
    tableState = null;
    appEl.innerHTML = `<div class="empty-state"><p>Загрузка стола…</p></div>`;
    const s = await connect();
    if (!s) return;
    s.emit('table:watch', { tableId });
  }

  // ── TABLE ──────────────────────────────────────────────────────────────────
  // Seat screen positions around an oval (9 seats), in %.
  const SEAT_POS = [
    { x: 50, y: 90 },  // 0 bottom center (hero)
    { x: 22, y: 84 },
    { x: 6,  y: 58 },
    { x: 10, y: 28 },
    { x: 30, y: 10 },
    { x: 50, y: 6 },
    { x: 70, y: 10 },
    { x: 90, y: 28 },
    { x: 94, y: 58 },
  ];

  function renderTable() {
    if (!appEl || !tableState) return;
    const st = tableState;
    const mySeat = st.seats.find(s => s && s.isMe);
    const iAmSeated = !!mySeat;
    const myTurn = iAmSeated && st.actingPos === mySeat.pos && st.state !== 'waiting' && st.state !== 'showdown';

    // Seats
    const seatsHtml = SEAT_POS.slice(0, st.maxSeats).map((pos, i) => {
      const seat = st.seats[i];
      const isDealer = st.dealerPos === i;
      const isActing = st.actingPos === i;
      if (!seat) {
        return `<div class="pk-seat pk-seat-empty" style="left:${pos.x}%;top:${pos.y}%">
          ${iAmSeated ? `<div class="pk-seat-open">место</div>` : `<button class="pk-seat-sit" onclick="PokerUI._openSitModal(${i})">＋ Сесть</button>`}
        </div>`;
      }
      const holeCards = (seat.cards || []).map(c => cardHtml(c, { small: true })).join('');
      const winner = st.lastResult && st.lastResult.payouts && st.lastResult.payouts[i] > 0;
      return `<div class="pk-seat pk-seat-filled${isActing ? ' pk-seat-acting' : ''}${seat.hasFolded ? ' pk-seat-folded' : ''}${winner ? ' pk-seat-winner' : ''}" style="left:${pos.x}%;top:${pos.y}%">
        ${isDealer ? '<span class="pk-dealer-btn">D</span>' : ''}
        <div class="pk-seat-cards">${holeCards}</div>
        <div class="pk-seat-av">${seat.avatarUrl ? `<img src="${escHtml(seat.avatarUrl)}" onerror="this.style.display='none'">` : escHtml((seat.name || '?').charAt(0))}</div>
        <div class="pk-seat-info">
          <div class="pk-seat-name">${escHtml(seat.name)}${seat.isMe ? ' (вы)' : ''}</div>
          <div class="pk-seat-chips">${fmtChips(seat.chips)} 🪙</div>
        </div>
        ${seat.betThisRound ? `<div class="pk-seat-bet">${fmtChips(seat.betThisRound)}</div>` : ''}
        ${seat.isAllIn ? '<div class="pk-seat-allin">ALL-IN</div>' : ''}
        ${seat.stake && seat.stake.type !== 'cash' ? `<div class="pk-seat-stake">${seat.stake.type === 'team' ? '⚽ КОМАНДА' : '👤 ' + escHtml(seat.stake.playerName || 'игрок')}</div>` : ''}
      </div>`;
    }).join('');

    const community = st.community.map(c => cardHtml(c, { deal: true })).join('') ||
      '<div class="pk-board-placeholder">Карты стола появятся здесь</div>';

    // Result banner
    let resultBanner = '';
    if (st.state === 'waiting' && st.lastResult) {
      const r = st.lastResult;
      const wins = (r.pots || []).map(p => p.winners.map(w => `${escHtml(w.name)} — ${escHtml(w.hand)}`).join(', ')).join(' · ');
      resultBanner = `<div class="pk-result-banner">🏆 ${wins} забирает ${fmtChips((r.pots || []).reduce((a, p) => a + p.amount, 0))} 🪙</div>`;
    }

    // Action controls
    let controls = '';
    if (iAmSeated) {
      if (myTurn) {
        const toCall = st.currentBet - mySeat.betThisRound;
        const minRaiseTo = st.currentBet + st.minRaise;
        const maxTo = mySeat.betThisRound + mySeat.chips;
        controls = `
          <div class="pk-actions">
            <button class="pk-act pk-act-fold" onclick="PokerUI._act('fold')">Фолд</button>
            ${toCall > 0
              ? `<button class="pk-act pk-act-call" onclick="PokerUI._act('call')">Колл ${fmtChips(toCall)}</button>`
              : `<button class="pk-act pk-act-check" onclick="PokerUI._act('check')">Чек</button>`}
            ${mySeat.chips > toCall ? `
              <div class="pk-raise-group">
                <input type="range" id="pk-raise-range" min="${minRaiseTo}" max="${maxTo}" value="${Math.min(minRaiseTo, maxTo)}" step="${st.bigBlind}" oninput="PokerUI._syncRaise()">
                <input type="number" id="pk-raise-input" min="${minRaiseTo}" max="${maxTo}" value="${Math.min(minRaiseTo, maxTo)}" oninput="PokerUI._syncRaiseFromInput()">
                <button class="pk-act pk-act-raise" onclick="PokerUI._raise()">Рейз</button>
              </div>` : ''}
            <button class="pk-act pk-act-allin" onclick="PokerUI._act('allin')">ALL-IN</button>
          </div>`;
      } else {
        controls = `<div class="pk-actions-wait">${st.state === 'waiting' ? 'Ждём начала раздачи…' : 'Ход другого игрока…'}
          <button class="pk-leave-btn" onclick="PokerUI._leaveTable()">Встать из-за стола</button></div>`;
      }
    } else {
      controls = `<div class="pk-actions-wait">Вы наблюдаете. Сядьте за свободное место, чтобы играть.
        <button class="pk-leave-btn" onclick="PokerUI._backToLobby()">← В лобби</button></div>`;
    }

    appEl.innerHTML = `
      <div class="pk-table-view">
        <div class="pk-table-topbar">
          <button class="pk-back" onclick="PokerUI._backToLobby()">← Лобби</button>
          <span class="pk-table-title">${escHtml(st.name)}</span>
          <span class="pk-table-blinds">${fmtChips(st.smallBlind)}/${fmtChips(st.bigBlind)}</span>
        </div>

        <div class="pk-stadium">
          <div class="pk-stadium-stands"></div>
          <div class="pk-felt">
            <div class="pk-felt-center">
              <div class="pk-pot">Банк: <b>${fmtChips(st.pot)}</b> 🪙</div>
              <div class="pk-board">${community}</div>
              ${resultBanner}
            </div>
            ${seatsHtml}
          </div>
        </div>

        ${controls}
      </div>`;
  }

  // ── actions ──────────────────────────────────────────────────────────────
  function act(action) {
    if (!socket || !currentTableId) return;
    socket.emit('table:action', { tableId: currentTableId, action });
  }
  function raise() {
    const inp = document.getElementById('pk-raise-input');
    if (!inp) return;
    socket.emit('table:action', { tableId: currentTableId, action: 'raise', amount: Number(inp.value) });
  }
  function syncRaise() {
    const r = document.getElementById('pk-raise-range'), i = document.getElementById('pk-raise-input');
    if (r && i) i.value = r.value;
  }
  function syncRaiseFromInput() {
    const r = document.getElementById('pk-raise-range'), i = document.getElementById('pk-raise-input');
    if (r && i) r.value = i.value;
  }
  function leaveTable() {
    if (!socket || !currentTableId) return;
    if (!confirm('Встать из-за стола и зафиксировать результат?')) return;
    socket.emit('table:leave', { tableId: currentTableId });
  }
  function backToLobby() {
    if (socket && currentTableId) socket.emit('table:unwatch', { tableId: currentTableId });
    currentTableId = null; view = 'lobby';
    GET('/poker').then(d => { lobbyData = d; renderLobby(); }).catch(() => renderLobby());
  }

  // ── sit-down modal (choose stake) ───────────────────────────────────────────
  function openSitModal(seatIndex) {
    const d = lobbyData || {};
    if (!d.me || !d.me.teamId) { toast('Нужна команда', 'error'); return; }
    const players = (d.stakeable || []).map(p => `
      <option value="${p.id}">${escHtml(p.name)} — ${fmtValue(p.market_value)}</option>`).join('');
    const modal = document.createElement('div');
    modal.className = 'pk-modal-overlay';
    modal.id = 'pk-sit-modal';
    modal.innerHTML = `
      <div class="pk-modal">
        <div class="pk-modal-head">
          <h3>Сесть за стол — место ${seatIndex + 1}</h3>
          <button class="pk-modal-close" onclick="PokerUI._closeSit()">×</button>
        </div>
        <div class="pk-modal-body">
          <div class="pk-stake-tabs">
            <button class="pk-stake-tab active" data-stake="cash" onclick="PokerUI._stakeTab('cash')">💰 Деньги</button>
            <button class="pk-stake-tab" data-stake="player" onclick="PokerUI._stakeTab('player')">👤 Игрок</button>
            <button class="pk-stake-tab" data-stake="team" onclick="PokerUI._stakeTab('team')">⚽ Команда</button>
          </div>
          <div class="pk-stake-pane" id="pk-pane-cash">
            <label>Сумма из бюджета (доступно ${fmtValue(d.budget || 0)})</label>
            <input type="number" id="pk-stake-cash" min="1000" step="1000" value="${Math.min(100000, d.budget || 0)}">
          </div>
          <div class="pk-stake-pane hidden" id="pk-pane-player">
            <label>Игрок становится фишками по рыночной стоимости</label>
            <select id="pk-stake-player">${players || '<option>Нет доступных игроков</option>'}</select>
            <p class="pk-stake-warn">⚠ Если проиграете все фишки — игрок перейдёт победителю!</p>
          </div>
          <div class="pk-stake-pane hidden" id="pk-pane-team">
            <label>Вся команда как ставка (${fmtValue(d.teamValue || 0)})</label>
            <p class="pk-stake-warn">⚠⚠ Проигрыш всех фишек = потеря всей команды! Только для смелых.</p>
          </div>
          <button class="pk-sit-confirm" onclick="PokerUI._confirmSit(${seatIndex})">Сесть и купить фишки</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  let _stakeType = 'cash';
  function stakeTab(type) {
    _stakeType = type;
    document.querySelectorAll('.pk-stake-tab').forEach(b => b.classList.toggle('active', b.dataset.stake === type));
    ['cash', 'player', 'team'].forEach(t => {
      const pane = document.getElementById('pk-pane-' + t);
      if (pane) pane.classList.toggle('hidden', t !== type);
    });
  }
  function closeSit() { const m = document.getElementById('pk-sit-modal'); if (m) m.remove(); _stakeType = 'cash'; }
  function confirmSit(seatIndex) {
    let stake;
    if (_stakeType === 'cash') {
      const amt = Number(document.getElementById('pk-stake-cash').value);
      if (!amt || amt < 1000) { toast('Минимум 1000', 'error'); return; }
      stake = { type: 'cash', amount: amt };
    } else if (_stakeType === 'player') {
      const pid = Number(document.getElementById('pk-stake-player').value);
      if (!pid) { toast('Выберите игрока', 'error'); return; }
      stake = { type: 'player', playerId: pid };
    } else {
      stake = { type: 'team' };
    }
    socket.emit('table:sit', { tableId: currentTableId, seatIndex, stake });
    closeSit();
  }

  function announceCashout(summary) {
    if (!summary) return;
    if (summary.lostPlayer) { toast('Вы проиграли игрока за столом!', 'error'); return; }
    if (summary.lostTeam) { toast('Вы проиграли всю команду!', 'error'); return; }
    const sign = summary.delta >= 0 ? '+' : '';
    toast(`Результат: ${sign}${fmtChips(summary.delta)} 🪙`, summary.delta >= 0 ? 'success' : 'info');
  }

  // public API
  window.PokerUI = {
    render, teardown,
    _enterTable: enterTable,
    _act: act, _raise: raise, _syncRaise: syncRaise, _syncRaiseFromInput: syncRaiseFromInput,
    _leaveTable: leaveTable, _backToLobby: backToLobby,
    _openSitModal: openSitModal, _stakeTab: stakeTab, _closeSit: closeSit, _confirmSit: confirmSit,
  };
})();
