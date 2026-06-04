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
  let _timerInterval = null;   // countdown timer interval
  let lastCommunityLen = 0;    // for staggered deal animation

  const EMOTES = [
    { key: 'laugh',  emoji: '😂', label: 'Смеюсь' },
    { key: 'mind',   emoji: '🤯', label: 'Ничего себе' },
    { key: 'flex',   emoji: '💪', label: 'Сила' },
    { key: 'cool',   emoji: '😎', label: 'Красавчик' },
    { key: 'party',  emoji: '🎉', label: 'Отмечаем' },
    { key: 'cry',    emoji: '😢', label: 'Грустно' },
    { key: 'think',  emoji: '🤔', label: 'Думаю' },
    { key: 'angry',  emoji: '😤', label: 'Злой' },
    { key: 'clap',   emoji: '👏', label: 'Аплодирую' },
    { key: 'fire',   emoji: '🔥', label: 'Огонь' },
  ];
  const activeEmotes = new Map(); // seatIndex → { emoji, expiresAt }
  let _emotePickerOpen = false;

  // ── Standard suits ─────────────────────────────────────────────────────────
  const SUIT = {
    s: { sym: '♠', cls: 'suit-dark', name: 'Пики' },
    c: { sym: '♣', cls: 'suit-dark', name: 'Трефы' },
    h: { sym: '♥', cls: 'suit-red',  name: 'Червы' },
    d: { sym: '♦', cls: 'suit-red',  name: 'Бубны' },
  };
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  function rankLabel(r) { return RANK_LABEL[r] || String(r); }

  const cardKey = c => c ? c.rank + c.suit : '';

  function cardHtml(card, opts = {}) {
    const szCls = opts.xs ? ' pk-card-xs' : (opts.small ? ' pk-card-sm' : '');
    if (!card || card.hidden) {
      return `<div class="pk-card pk-card-back${szCls}"><div class="pk-card-back-inner"></div></div>`;
    }
    const s = SUIT[card.suit] || SUIT.s;
    const hl = opts.highlight ? ' pk-card-hl' : opts.liveHl ? ' pk-card-live-hl' : (opts.dim ? ' pk-card-dim' : '');
    const dealStyle = opts.deal && opts.dealDelay ? ` style="animation-delay:${opts.dealDelay}ms"` : '';
    return `<div class="pk-card ${s.cls}${szCls}${opts.deal ? ' pk-card-deal' : ''}${hl}"${dealStyle}>
      <div class="pk-card-corner tl"><span class="pk-card-rank">${rankLabel(card.rank)}</span><span class="pk-card-suit">${s.sym}</span></div>
      <div class="pk-card-center">${s.sym}</div>
      <div class="pk-card-corner br"><span class="pk-card-rank">${rankLabel(card.rank)}</span><span class="pk-card-suit">${s.sym}</span></div>
    </div>`;
  }

  // ── Client-side hand evaluator (for live combo display) ───────────────────
  function _combos5(arr) {
    const res = [], n = arr.length;
    for (let a = 0; a < n-4; a++)
    for (let b = a+1; b < n-3; b++)
    for (let c = b+1; c < n-2; c++)
    for (let d = c+1; d < n-1; d++)
    for (let e = d+1; e < n; e++)
      res.push([arr[a], arr[b], arr[c], arr[d], arr[e]]);
    return res;
  }

  function _evalFive(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);
    const uniq = [...new Set(ranks)];
    const isStraight = (uniq.length === 5 && ranks[0] - ranks[4] === 4) ||
      (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2);
    const cnt = {};
    for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
    const groups = Object.entries(cnt).map(([r, c]) => [+r, c]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const top = groups[0][1], sec = groups[1] ? groups[1][1] : 0;
    if (isFlush && isStraight) return ranks[0] === 14 && ranks[1] === 13 ? 9 : 8;
    if (top === 4) return 7;
    if (top === 3 && sec === 2) return 6;
    if (isFlush) return 5;
    if (isStraight) return 4;
    if (top === 3) return 3;
    if (top === 2 && sec === 2) return 2;
    if (top === 2) return 1;
    return 0;
  }

  const HAND_NAMES_RU = ['Старшая карта','Пара','Две пары','Тройка','Стрит','Флеш','Фулл-хаус','Каре','Стрит-флеш','Флеш-рояль'];

  // Returns only the "key" cards that define the combination (e.g. just the pair, not kickers).
  function getKeyCards(rank, cards) {
    if (!cards || !cards.length) return cards || [];
    const cnt = {};
    for (const c of cards) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
    switch (rank) {
      case 0: { // high card — just the highest card
        const max = Math.max(...cards.map(c => c.rank));
        return cards.filter(c => c.rank === max).slice(0, 1);
      }
      case 1: { // pair
        const pr = Object.entries(cnt).find(([, n]) => n === 2);
        return pr ? cards.filter(c => c.rank === +pr[0]) : cards;
      }
      case 2: { // two pair
        const prs = Object.entries(cnt).filter(([, n]) => n === 2).map(([r]) => +r);
        return cards.filter(c => prs.includes(c.rank));
      }
      case 3: { // three of a kind
        const tr = Object.entries(cnt).find(([, n]) => n === 3);
        return tr ? cards.filter(c => c.rank === +tr[0]) : cards;
      }
      case 7: { // four of a kind
        const qr = Object.entries(cnt).find(([, n]) => n === 4);
        return qr ? cards.filter(c => c.rank === +qr[0]) : cards;
      }
      default: // straight(4), flush(5), full house(6), sf(8), rf(9) — show all 5
        return cards;
    }
  }

  function evalCurrentHand(holeCards, communityCards) {
    const visible = [...(holeCards || []), ...(communityCards || [])].filter(c => c && !c.hidden);
    if (visible.length < 2) return null;
    const allCombos = visible.length <= 5 ? [visible] : _combos5(visible);
    let bestRank = -1, bestCards = null;
    for (const combo of allCombos) {
      const r = _evalFive(combo);
      if (r > bestRank) { bestRank = r; bestCards = combo; }
    }
    return bestCards ? { rank: bestRank, name: HAND_NAMES_RU[bestRank], cards: bestCards } : null;
  }

  // Build the set of card keys for the winning combination's KEY cards only (not kickers).
  function winningComboKeys(st) {
    if (!st || !st.lastResult) return null;
    const r = st.lastResult;
    if (!r.revealed || !r.pots) return null;
    const winnerPos = new Set();
    for (const p of r.pots) for (const w of (p.winners || [])) winnerPos.add(w.pos);
    const keys = new Set();
    for (const rv of r.revealed) {
      if (winnerPos.has(rv.pos) && rv.combo) {
        const keycards = getKeyCards(rv.comboRank ?? 0, rv.combo);
        for (const c of keycards) keys.add(cardKey(c));
      }
    }
    return keys.size ? keys : null;
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
    socket.on('table:emote', ({ seatIndex, emoteKey }) => {
      const emote = EMOTES.find(e => e.key === emoteKey);
      if (!emote) return;
      activeEmotes.set(seatIndex, { emoji: emote.emoji, expiresAt: Date.now() + 4000 });
      if (view === 'table') {
        _renderEmotes();
        setTimeout(() => { if (view === 'table') _renderEmotes(); }, 4100);
      }
    });
    return socket;
  }

  function _startTimer(deadline) {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    if (!deadline || deadline <= Date.now()) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const urgent = secs <= 7;
      ['pk-timer-seat', 'pk-timer-ctrl'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = secs; el.className = 'pk-timer-num' + (urgent ? ' pk-timer-urgent' : ''); }
      });
      if (secs <= 0) { clearInterval(_timerInterval); _timerInterval = null; }
    };
    tick();
    _timerInterval = setInterval(tick, 500);
  }

  function teardown() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    if (socket) {
      try { socket.emit('lobby:leave'); if (currentTableId) socket.emit('table:unwatch', { tableId: currentTableId }); } catch (e) {}
      socket.disconnect();
      socket = null;
    }
    view = 'lobby'; currentTableId = null; tableState = null; mySeatChips = null;
    lastCommunityLen = 0;
    activeEmotes.clear();
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
              <button class="pk-shop-open-btn" onclick="PokerUI._openShop()">🛍️ Магазин косметики</button>
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

    // Winning combination highlight (only while a result is on screen)
    const comboKeys = winningComboKeys(st);
    const hlOpt = (c, small) => {
      if (!comboKeys) return { small };
      return comboKeys.has(cardKey(c)) ? { small, highlight: true } : { small, dim: true };
    };

    // Live combination — shows the player's current best hand during betting rounds
    const activeBetting = iAmSeated && mySeat && !mySeat.hasFolded &&
      ['preflop','flop','turn','river'].includes(st.state);
    let liveHand = null, liveKeys = null;
    if (activeBetting && !comboKeys) {
      const myCards = (mySeat.cards || []).filter(c => c && !c.hidden);
      if (myCards.length === 2) {
        liveHand = evalCurrentHand(myCards, st.community || []);
        if (liveHand) {
          // Only show badge for real combos preflop; post-flop always show
          if (st.community.length < 3 && liveHand.rank < 1) liveHand = null;
        }
        if (liveHand) liveKeys = new Set(getKeyCards(liveHand.rank, liveHand.cards).map(cardKey));
      }
    }
    const liveHlOpt = (c, small) => liveKeys && liveKeys.has(cardKey(c)) ? { small, liveHl: true } : { small };

    // Helper: render a hole card with hover-to-reveal flip (for the local player's own cards).
    const renderFlipCard = (c, opts) => {
      const isHl = opts.liveHl;
      const backHtml = `<div class="pk-card pk-card-back pk-card-sm"><div class="pk-card-back-inner"></div></div>`;
      // strip liveHl from face card — glow is applied to the flip container instead
      const faceHtml = cardHtml(c, { ...opts, liveHl: false });
      return `<div class="pk-hole-flip${isHl ? ' pk-hole-flip-hl' : ''}">
        <div class="pk-hole-flip-inner">
          <div class="pk-hole-flip-back">${backHtml}</div>
          <div class="pk-hole-flip-front">${faceHtml}</div>
        </div>
      </div>`;
    };

    // Seats
    const seatsHtml = SEAT_POS.slice(0, st.maxSeats).map((pos, i) => {
      const seat = st.seats[i];
      const isDealer = st.dealerPos === i;
      const isActing = st.actingPos === i;
      if (!seat) {
        return `<div class="pk-seat pk-seat-empty" data-seat="${i}" style="left:${pos.x}%;top:${pos.y}%">
          ${iAmSeated ? `<div class="pk-seat-open">место</div>` : `<button class="pk-seat-sit" onclick="PokerUI._openSitModal(${i})">＋ Сесть</button>`}
        </div>`;
      }
      const winner = st.lastResult && st.lastResult.payouts && st.lastResult.payouts[i] > 0;

      let holeCardsHtml;
      if (seat.isMe && !comboKeys) {
        // Own cards: hover-to-reveal flip, with live combo glow on key cards
        const myCardOpts = (c) => liveKeys ? liveHlOpt(c, true) : { small: true };
        const flips = (seat.cards || []).map(c => renderFlipCard(c, myCardOpts(c))).join('');
        holeCardsHtml = `<div class="pk-my-hole-wrap">${flips}</div>`;
      } else {
        // Opponents / showdown: standard cards with showdown highlight
        holeCardsHtml = (seat.cards || []).map(c =>
          cardHtml(c, (comboKeys && winner) ? hlOpt(c, true) : { small: true })
        ).join('');
      }

      const alreadyRevealed = st.lastResult && st.lastResult.revealed && st.lastResult.revealed.some(r => r.pos === i);
      const showCardsBtn = seat.isMe && iAmSeated && st.state === 'waiting' && st.lastResult && st.lastResult.byFold && winner && !alreadyRevealed
        ? `<button class="pk-show-cards-btn" onclick="PokerUI._showCards()">Показать карты</button>` : '';
      return `<div class="pk-seat pk-seat-filled${isActing ? ' pk-seat-acting' : ''}${seat.hasFolded ? ' pk-seat-folded' : ''}${winner ? ' pk-seat-winner' : ''}" data-seat="${i}" style="left:${pos.x}%;top:${pos.y}%">
        ${isDealer ? '<span class="pk-dealer-btn">D</span>' : ''}
        ${isActing ? `<div class="pk-seat-timer"><span id="pk-timer-seat" class="pk-timer-num">–</span></div>` : ''}
        <div class="pk-seat-cards">${holeCardsHtml}</div>
        <div class="pk-seat-av">${seat.avatarUrl ? `<img src="${escHtml(seat.avatarUrl)}" onerror="this.style.display='none'">` : escHtml((seat.name || '?').charAt(0))}${seat.cosmetic ? `<span class="pk-cosmetic-badge">${seat.cosmetic.emoji}</span>` : ''}</div>
        <div class="pk-seat-info">
          <div class="pk-seat-name">${escHtml(seat.name)}${seat.isMe ? ' (вы)' : ''}</div>
          <div class="pk-seat-chips">${fmtChips(seat.chips)} 🪙</div>
        </div>
        ${seat.betThisRound ? `<div class="pk-seat-bet">${fmtChips(seat.betThisRound)}</div>` : ''}
        ${seat.isAllIn ? '<div class="pk-seat-allin">ALL-IN</div>' : ''}
        ${seat.stake && seat.stake.type !== 'cash' ? `<div class="pk-seat-stake">${seat.stake.type === 'team' ? '⚽ КОМАНДА' : '👤 ' + escHtml(seat.stake.playerName || 'игрок')}</div>` : ''}
        ${showCardsBtn}
      </div>`;
    }).join('');

    if (st.community.length === 0) lastCommunityLen = 0;
    const community = st.community.map((c, i) => {
      const isNew = i >= lastCommunityLen;
      const delay = isNew ? (i - lastCommunityLen) * 180 : 0;
      const baseOpts = { deal: isNew, dealDelay: delay };
      return cardHtml(c, comboKeys ? { ...baseOpts, ...hlOpt(c, false) } : liveKeys ? { ...baseOpts, ...liveHlOpt(c, false) } : baseOpts);
    }).join('') || '<div class="pk-board-placeholder">Карты стола появятся здесь</div>';

    // Result banner
    let resultBanner = '';
    if (st.state === 'waiting' && st.lastResult) {
      const r = st.lastResult;
      const wins = (r.pots || []).map(p => p.winners.map(w => `${escHtml(w.name)} — ${escHtml(w.hand)}`).join(', ')).join(' · ');
      resultBanner = `<div class="pk-result-banner">🏆 ${wins} забирает ${fmtChips((r.pots || []).reduce((a, p) => a + p.amount, 0))} 🪙</div>`;
    }

    // Live hand badge — shows combo name + key card images
    const liveHandBadge = liveHand ? (() => {
      const keyCards = getKeyCards(liveHand.rank, liveHand.cards);
      const miniCards = keyCards.map(c => cardHtml(c, { xs: true })).join('');
      return `<div class="pk-live-hand-badge">
        <span class="pk-live-hand-name">${escHtml(liveHand.name)}</span>
        <div class="pk-live-hand-cards">${miniCards}</div>
      </div>`;
    })() : '';

    // Action controls
    let controls = '';
    if (iAmSeated) {
      if (myTurn) {
        const toCall = st.currentBet - mySeat.betThisRound;
        const minRaiseTo = st.currentBet + st.minRaise;
        const maxTo = mySeat.betThisRound + mySeat.chips;
        controls = `
          ${liveHandBadge}
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
            <div class="pk-my-timer">⏱ <span id="pk-timer-ctrl" class="pk-timer-num">–</span>с</div>
          </div>`;
      } else {
        controls = `${liveHandBadge}<div class="pk-actions-wait">${st.state === 'waiting' ? 'Ждём начала раздачи…' : 'Ход другого игрока…'}
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

    // Update community card tracker after render
    lastCommunityLen = st.community.length;

    // Start action countdown timer after DOM is ready
    if (st.actingPos >= 0 && st.actionDeadline) _startTimer(st.actionDeadline);

    // Render emotes and emote button
    _renderEmotes();
    if (iAmSeated && st.state !== 'showdown') _ensureEmoteBtn(mySeat.pos);
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

  // ── show cards (voluntary reveal after winning by fold) ─────────────────────
  function showCards() {
    if (!socket || !currentTableId) return;
    socket.emit('table:showcards', { tableId: currentTableId });
  }

  // ── emotes ──────────────────────────────────────────────────────────────────
  function _renderEmotes() {
    const now = Date.now();
    for (const [seatIdx, data] of activeEmotes) {
      if (now > data.expiresAt) { activeEmotes.delete(seatIdx); continue; }
      const seatEl = appEl && appEl.querySelector('.pk-seat-filled[data-seat="' + seatIdx + '"]');
      if (!seatEl || seatEl.querySelector('.pk-emote-bubble')) continue;
      const div = document.createElement('div');
      div.className = 'pk-emote-bubble';
      div.textContent = data.emoji;
      seatEl.appendChild(div);
    }
  }

  function _ensureEmoteBtn(myPos) {
    const seatEl = appEl && appEl.querySelector('.pk-seat-filled[data-seat="' + myPos + '"]');
    if (!seatEl || seatEl.querySelector('.pk-emote-open')) return;
    const btn = document.createElement('button');
    btn.className = 'pk-emote-open';
    btn.textContent = '😊';
    btn.title = 'Эмоции';
    btn.onclick = (e) => { e.stopPropagation(); _toggleEmotePicker(myPos); };
    seatEl.appendChild(btn);
  }

  function _toggleEmotePicker(myPos) {
    const existing = document.getElementById('pk-emote-picker');
    if (existing) { existing.remove(); _emotePickerOpen = false; return; }
    _emotePickerOpen = true;
    const picker = document.createElement('div');
    picker.id = 'pk-emote-picker';
    picker.className = 'pk-emote-picker';
    picker.innerHTML = EMOTES.map(e =>
      `<button class="pk-emote-item" title="${e.label}" onclick="PokerUI._sendEmote('${e.key}')">${e.emoji}</button>`
    ).join('');
    const seatEl = appEl && appEl.querySelector('.pk-seat-filled[data-seat="' + myPos + '"]');
    if (seatEl) seatEl.appendChild(picker);
    setTimeout(() => document.addEventListener('click', _closeEmotePicker, { once: true }), 10);
  }

  function _closeEmotePicker() {
    const el = document.getElementById('pk-emote-picker');
    if (el) el.remove();
    _emotePickerOpen = false;
  }

  function sendEmote(key) {
    if (!socket || !currentTableId) return;
    socket.emit('table:emote', { tableId: currentTableId, emoteKey: key });
    _closeEmotePicker();
  }

  // ── cosmetics shop ───────────────────────────────────────────────────────────
  async function openShop() {
    let shopData;
    try { shopData = await GET('/poker/shop'); } catch { toast('Ошибка загрузки магазина', 'error'); return; }
    const modal = document.createElement('div');
    modal.className = 'pk-modal-overlay';
    modal.id = 'pk-shop-modal';
    modal.innerHTML = `
      <div class="pk-modal pk-shop-modal">
        <div class="pk-modal-head">
          <h3>🛍️ Магазин аксессуаров</h3>
          <button class="pk-modal-close" onclick="document.getElementById('pk-shop-modal').remove()">×</button>
        </div>
        <div class="pk-modal-body">
          <div class="pk-shop-budget">Бюджет: <b>${fmtValue(shopData.budget)}</b></div>
          <div class="pk-shop-grid">
            ${shopData.catalog.map(item => `
              <div class="pk-shop-item${item.equipped ? ' pk-shop-item-equipped' : ''}">
                <div class="pk-shop-emoji">${item.emoji}</div>
                <div class="pk-shop-name">${escHtml(item.name)}</div>
                <div class="pk-shop-price">${item.owned ? (item.equipped ? '✓ Надет' : 'В наличии') : fmtValue(item.price)}</div>
                ${item.owned
                  ? `<button class="pk-shop-btn ${item.equipped ? 'pk-shop-unequip' : 'pk-shop-equip'}" onclick="PokerUI._shopEquip('${item.key}', ${item.equipped})">${item.equipped ? 'Снять' : 'Надеть'}</button>`
                  : `<button class="pk-shop-btn pk-shop-buy" onclick="PokerUI._shopBuy('${item.key}', '${escHtml(item.name)}', ${item.price})"${item.price > shopData.budget ? ' disabled' : ''}>Купить</button>`
                }
              </div>`).join('')}
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  async function shopBuy(key, name, price) {
    if (!confirm(`Купить "${name}" за ${fmtValue(price)}?`)) return;
    try {
      await POST('/poker/shop/buy', { itemKey: key });
      toast('Куплено!', 'success');
      document.getElementById('pk-shop-modal')?.remove();
      openShop();
    } catch (e) { toast(e.message || 'Ошибка покупки', 'error'); }
  }

  async function shopEquip(key, isEquipped) {
    try {
      await POST('/poker/shop/equip', { itemKey: isEquipped ? null : key });
      document.getElementById('pk-shop-modal')?.remove();
      openShop();
    } catch (e) { toast(e.message || 'Ошибка', 'error'); }
  }

  // public API
  window.PokerUI = {
    render, teardown,
    _enterTable: enterTable,
    _act: act, _raise: raise, _syncRaise: syncRaise, _syncRaiseFromInput: syncRaiseFromInput,
    _leaveTable: leaveTable, _backToLobby: backToLobby,
    _openSitModal: openSitModal, _stakeTab: stakeTab, _closeSit: closeSit, _confirmSit: confirmSit,
    _showCards: showCards,
    _sendEmote: sendEmote,
    _openShop: openShop, _shopBuy: shopBuy, _shopEquip: shopEquip,
  };
})();
