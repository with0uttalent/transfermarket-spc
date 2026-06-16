/* ════════════════════════════════════════════════════════════
   ТРИАДОР — клиентская логика
   ════════════════════════════════════════════════════════════ */
'use strict';

const TriviaUI = (() => {
  let socket = null;
  let state  = null;   // last room snapshot
  let myId   = null;
  let questionTimer = null;

  const GRID_COLS = 6;
  const GRID_ROWS  = 6;

  // ── helpers ───────────────────────────────────────────────
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function el(id) { return document.getElementById(id); }

  function getToken() { return localStorage.getItem('token'); }

  // ── connect ───────────────────────────────────────────────
  function connect() {
    if (socket && socket.connected) return;
    socket = io({ path: '/trivia-socket', transports: ['websocket'] });

    socket.on('connect', () => {
      socket.emit('trivia:auth', { token: getToken() });
    });

    socket.on('trivia:authed', ({ user }) => {
      myId = String(user.id);
    });

    socket.on('trivia:joined', ({ code }) => {
      renderLobby();
    });

    socket.on('trivia:state', (snap) => {
      state = snap;
      render();
    });

    socket.on('trivia:error', ({ message }) => {
      showToast(message, 'error');
    });
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
    state = null; myId = null;
    clearQuestionTimer();
  }

  // ── main render router ────────────────────────────────────
  function render() {
    if (!state) { renderLobby(); return; }
    if (state.status === 'waiting') { renderWaiting(); return; }
    if (state.status === 'playing') { renderGame(); return; }
    if (state.status === 'finished') { renderFinished(); return; }
  }

  // ── LOBBY ─────────────────────────────────────────────────
  function renderLobby() {
    mount(`
      <div class="tv-screen tv-lobby">
        <div class="tv-logo">🎯 ТРИАДОР</div>
        <p class="tv-subtitle">Викторина-стратегия до 6 игроков</p>
        <div class="tv-lobby-actions">
          <button class="tv-btn tv-btn-primary" onclick="TriviaUI.createRoom()">➕ Создать комнату</button>
          <div class="tv-join-row">
            <input id="tv-join-code" class="tv-input" placeholder="Код комнаты" maxlength="6" style="text-transform:uppercase"/>
            <button class="tv-btn tv-btn-outline" onclick="TriviaUI.joinRoom()">Войти</button>
          </div>
        </div>
        <div class="tv-rules">
          <b>Правила:</b> Захватывайте территории, отвечая на вопросы.
          Атакуйте чужие территории — кто ответит первым, тот победит.
          Потеряйте столицу — выбываете. Последний выживший выигрывает!
        </div>
      </div>
    `);
    const inp = el('tv-join-code');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') TriviaUI.joinRoom(); });
  }

  // ── WAITING ROOM ──────────────────────────────────────────
  function renderWaiting() {
    if (!state) return;
    const isHost = myId === state.host;
    const readyCount = state.players.filter(p => p.ready).length;
    const canStart = isHost && readyCount >= 2;
    const me = state.players.find(p => p.id === myId);

    mount(`
      <div class="tv-screen tv-waiting">
        <div class="tv-room-header">
          <div class="tv-logo-sm">🎯 ТРИАДОР</div>
          <div class="tv-room-code">Код: <span class="tv-code-val">${esc(state.code)}</span>
            <button class="tv-copy-btn" onclick="TriviaUI.copyCode()" title="Скопировать">📋</button>
          </div>
        </div>
        <div class="tv-players-grid">
          ${state.players.map((p, i) => `
            <div class="tv-player-slot${p.id === myId ? ' tv-me' : ''}">
              <div class="tv-player-avatar" style="background:${esc(p.color)}">
                ${esc(p.teamName?.charAt(0) || p.username?.charAt(0) || '?')}
              </div>
              <div class="tv-player-name">${esc(p.teamName || p.username)}</div>
              <div class="tv-player-status">${p.ready ? '✅ Готов' : '⏳ Ожидание'}</div>
            </div>
          `).join('')}
          ${Array.from({ length: Math.max(0, 6 - state.players.length) }).map(() => `
            <div class="tv-player-slot tv-empty-slot">
              <div class="tv-player-avatar tv-empty-av">+</div>
              <div class="tv-player-name" style="color:#555">Свободно</div>
            </div>
          `).join('')}
        </div>
        <div class="tv-waiting-actions">
          ${me ? `<button class="tv-btn ${me.ready ? 'tv-btn-outline' : 'tv-btn-primary'}" onclick="TriviaUI.toggleReady()">
            ${me.ready ? '⏸ Не готов' : '✅ Готов'}
          </button>` : ''}
          ${canStart ? `<button class="tv-btn tv-btn-green" onclick="TriviaUI.startGame()">▶ Начать игру (${readyCount} игроков)</button>` : ''}
        </div>
        ${isHost && !canStart && readyCount < 2 ? `<p class="tv-hint">Нужно минимум 2 готовых игрока</p>` : ''}
      </div>
    `);
  }

  // ── GAME ──────────────────────────────────────────────────
  function renderGame() {
    if (!state) return;
    const me = state.players.find(p => p.id === myId);
    const currentPlayer = state.players[state.turnIndex];
    const isMyTurn = currentPlayer?.id === myId;

    mount(`
      <div class="tv-screen tv-game">
        <div class="tv-game-layout">
          <!-- Left: players panel -->
          <div class="tv-sidebar">
            <div class="tv-phase-badge">${state.phase === 'claim' ? '🏳️ Захват' : '⚔️ Война'}</div>
            ${state.players.map(p => renderPlayerCard(p, p.id === currentPlayer?.id)).join('')}
          </div>

          <!-- Center: map -->
          <div class="tv-map-wrap">
            ${renderMap()}
            ${state.lastResult ? renderResultBanner() : ''}
          </div>

          <!-- Right: action panel -->
          <div class="tv-action-panel">
            ${renderActionPanel(me, isMyTurn, currentPlayer)}
          </div>
        </div>
      </div>
    `);

    // Attach click handlers to territory cells
    document.querySelectorAll('.tv-territory').forEach(cell => {
      cell.addEventListener('click', () => {
        const id = parseInt(cell.dataset.id);
        if (!isNaN(id)) TriviaUI.selectTerritory(id);
      });
    });

    // Start/sync question timer
    if (state.questionActive && state.questionDeadline) {
      startQuestionTimer(state.questionDeadline);
    } else {
      clearQuestionTimer();
    }
  }

  function renderPlayerCard(p, isActive) {
    const alive = !p.eliminated;
    const stars = alive ? '★'.repeat(p.capitalLives) + '☆'.repeat(3 - p.capitalLives) : '💀';
    const terrCount = (p.territories || []).length;
    return `
      <div class="tv-player-card${isActive ? ' tv-active-turn' : ''}${p.eliminated ? ' tv-eliminated' : ''}">
        <div class="tv-pc-dot" style="background:${esc(p.color)}"></div>
        <div class="tv-pc-info">
          <div class="tv-pc-name">${esc(p.teamName || p.username)}</div>
          <div class="tv-pc-stats">
            <span class="tv-stars" style="color:${esc(p.color)}">${stars}</span>
            <span class="tv-terr-count">${terrCount} терр.</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderMap() {
    if (!state) return '';
    const cells = [];
    for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
      const t = state.territories[i];
      const owner = t ? state.players.find(p => p.id === t.owner) : null;
      const bg = owner ? owner.color : '#1a2733';
      const border = owner ? owner.color : '#2a3f52';
      const isCapital = t?.isCapital;
      const isAttackTarget = state.attackTarget === i;
      const isFree = !t?.owner;

      const canSelect = state.awaitingTerritory?.playerId === myId && (
        (state.awaitingTerritory.type === 'claim' && isFree) ||
        (state.awaitingTerritory.type === 'attack' && t?.owner && t.owner !== myId)
      );

      const livesDots = isCapital && owner
        ? `<div class="tv-lives">${'♥'.repeat(t.lives || 1)}</div>`
        : '';

      cells.push(`
        <div class="tv-territory${canSelect ? ' tv-selectable' : ''}${isAttackTarget ? ' tv-under-attack' : ''}${isCapital ? ' tv-capital' : ''}"
             data-id="${i}"
             style="background:${esc(bg)};border-color:${esc(border)}">
          ${isCapital ? `<div class="tv-capital-crown">♛</div>` : ''}
          ${livesDots}
          <div class="tv-territory-id">${i + 1}</div>
        </div>
      `);
    }
    return `<div class="tv-map">${cells.join('')}</div>`;
  }

  function renderActionPanel(me, isMyTurn, currentPlayer) {
    if (!state) return '';
    let html = '';

    if (state.questionActive && state.question) {
      const q = state.question;
      const myAnswer = null; // we don't track locally, server handles it
      html += `
        <div class="tv-question-box">
          <div class="tv-q-timer"><canvas id="tv-timer-canvas" width="60" height="60"></canvas></div>
          <div class="tv-q-text">${esc(q.question)}</div>
          <div class="tv-options">
            ${['a','b','c','d'].map(opt => `
              <button class="tv-option" data-opt="${opt}" onclick="TriviaUI.answer('${opt}')">
                <span class="tv-opt-letter">${opt.toUpperCase()}</span>
                <span class="tv-opt-text">${esc(q['option_'+opt])}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } else if (state.awaitingTerritory?.playerId === myId) {
      const type = state.awaitingTerritory.type;
      html += `
        <div class="tv-action-prompt">
          <div class="tv-action-icon">${type === 'claim' ? '🏳️' : '⚔️'}</div>
          <div class="tv-action-text">${type === 'claim'
            ? 'Выберите свободную территорию на карте'
            : 'Выберите территорию противника для атаки'}</div>
        </div>
      `;
    } else if (state.lastResult && !state.questionActive) {
      html += renderLastResult();
    } else {
      if (!isMyTurn) {
        html += `<div class="tv-waiting-turn">
          <div class="tv-turn-dot" style="background:${esc(currentPlayer?.color||'#888')}"></div>
          <div>Ход игрока<br><b>${esc(currentPlayer?.teamName || currentPlayer?.username || '...')}</b></div>
        </div>`;
      } else {
        html += `<div class="tv-waiting-turn"><div>Ваш ход...</div></div>`;
      }
    }

    return html;
  }

  function renderLastResult() {
    if (!state?.lastResult) return '';
    const r = state.lastResult;
    const winner = state.players.find(p => p.id === r.winner);
    const correctOpt = r.correct;
    const q = state.question; // may be null now — just show winner
    return `
      <div class="tv-result-box">
        ${winner
          ? `<div class="tv-result-win" style="color:${esc(winner.color)}">✅ ${esc(winner.teamName || winner.username)} ответил верно!</div>`
          : `<div class="tv-result-nowin">❌ Никто не ответил правильно</div>`
        }
        ${r.eliminated ? `<div class="tv-result-elim">💀 ${esc(state.players.find(p=>p.id===r.eliminated)?.teamName||'')} выбывает!</div>` : ''}
      </div>
    `;
  }

  function renderResultBanner() {
    return ''; // result is shown in action panel
  }

  // ── FINISHED ──────────────────────────────────────────────
  function renderFinished() {
    if (!state) return;
    const winner = state.players.find(p => p.id === state.winner);
    const ranking = [...state.players].sort((a,b) => {
      if (a.eliminated === b.eliminated) return (b.territories||[]).length - (a.territories||[]).length;
      return a.eliminated ? 1 : -1;
    });

    mount(`
      <div class="tv-screen tv-finished">
        <div class="tv-finish-trophy">🏆</div>
        <div class="tv-finish-title">Игра завершена!</div>
        ${winner ? `<div class="tv-finish-winner" style="color:${esc(winner.color)}">${esc(winner.teamName||winner.username)} победил!</div>` : '<div class="tv-finish-winner">Ничья!</div>'}
        <div class="tv-ranking">
          ${ranking.map((p, i) => `
            <div class="tv-rank-row">
              <span class="tv-rank-num">${i+1}</span>
              <span class="tv-rank-dot" style="background:${esc(p.color)}"></span>
              <span class="tv-rank-name">${esc(p.teamName||p.username)}</span>
              <span class="tv-rank-terr">${(p.territories||[]).length} терр.</span>
            </div>
          `).join('')}
        </div>
        <button class="tv-btn tv-btn-primary" style="margin-top:24px" onclick="TriviaUI.backToLobby()">↩ В лобби</button>
      </div>
    `);
  }

  // ── timer canvas ──────────────────────────────────────────
  function startQuestionTimer(deadline) {
    clearQuestionTimer();
    const total = 15000;
    function tick() {
      const cvs = el('tv-timer-canvas');
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      const remaining = Math.max(0, deadline - Date.now());
      const fraction = remaining / total;
      const secs = Math.ceil(remaining / 1000);

      ctx.clearRect(0, 0, 60, 60);
      // Background arc
      ctx.beginPath(); ctx.arc(30,30,26,0,Math.PI*2);
      ctx.strokeStyle = '#2a3f52'; ctx.lineWidth = 5; ctx.stroke();
      // Progress arc
      ctx.beginPath();
      ctx.arc(30,30,26,-Math.PI/2, -Math.PI/2 + fraction*Math.PI*2);
      ctx.strokeStyle = fraction > 0.4 ? '#2ecc71' : fraction > 0.2 ? '#f39c12' : '#e74c3c';
      ctx.lineWidth = 5; ctx.stroke();
      // Text
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(secs, 30, 30);

      if (remaining > 0) questionTimer = requestAnimationFrame(tick);
    }
    tick();
  }

  function clearQuestionTimer() {
    if (questionTimer) { cancelAnimationFrame(questionTimer); questionTimer = null; }
  }

  // ── mount helper ──────────────────────────────────────────
  function mount(html) {
    const wrap = el('trivia-root');
    if (wrap) wrap.innerHTML = html;
  }

  function showToast(msg, type = 'info') {
    if (window.toast) { window.toast(msg, type); return; }
    console.log('[Trivia]', msg);
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    render() {
      connect();
      if (!state) renderLobby();
      else render();
    },

    teardown() {
      disconnect();
    },

    createRoom() {
      if (!socket) return;
      socket.emit('trivia:create');
    },

    joinRoom() {
      const code = (el('tv-join-code')?.value || '').trim().toUpperCase();
      if (!code) { showToast('Введите код комнаты', 'error'); return; }
      if (!socket) return;
      socket.emit('trivia:join', { code });
    },

    toggleReady() {
      if (socket) socket.emit('trivia:ready');
    },

    startGame() {
      if (socket) socket.emit('trivia:start');
    },

    answer(option) {
      if (!socket) return;
      // Disable buttons immediately
      document.querySelectorAll('.tv-option').forEach(b => b.disabled = true);
      document.querySelectorAll('.tv-option').forEach(b => {
        if (b.dataset.opt === option) b.classList.add('tv-option-selected');
      });
      socket.emit('trivia:answer', { option });
    },

    selectTerritory(id) {
      if (!socket) return;
      socket.emit('trivia:select_territory', { territoryId: id });
    },

    copyCode() {
      if (state?.code) {
        navigator.clipboard.writeText(state.code).then(() => showToast('Код скопирован!'));
      }
    },

    backToLobby() {
      if (socket) socket.emit('trivia:leave');
      state = null;
      renderLobby();
    },
  };
})();

window.TriviaUI = TriviaUI;
