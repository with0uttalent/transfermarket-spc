/* ════════════════════════════════════════════════════════════
   ТРИАДОР — клиентская логика (два этапа вопросов)
   ════════════════════════════════════════════════════════════ */
'use strict';

const TriviaUI = (() => {
  let socket = null;
  let state  = null;
  let myId   = null;
  let timerRaf = null;
  let roomPreview = null;

  const GRID_COLS = 6;
  const GRID_ROWS  = 6;
  const PHASE2_MS  = 20000;

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function el(id) { return document.getElementById(id); }
  function getToken() { return localStorage.getItem('tm_token') || ''; }

  // ── connect ───────────────────────────────────────────────
  function connect() {
    if (socket && socket.connected) return;
    socket = io({ path: '/trivia-socket', auth: { token: getToken() }, transports: ['websocket', 'polling'] });

    socket.on('connect_error', err => {
      showToast('Триадор: нет связи с сервером (' + (err.message || 'ошибка') + ')', 'error');
    });

    socket.on('connect', () => {
      socket.emit('trivia:auth', { token: getToken() });
    });

    socket.on('trivia:authed', ({ user }) => {
      myId = String(user.id);
    });

    socket.on('trivia:room_preview', preview => {
      roomPreview = preview;
      if (!state) renderLobby();
    });

    socket.on('trivia:joined', () => {
      // state will arrive via trivia:state
    });

    socket.on('trivia:state', snap => {
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
    clearTimer();
  }

  // ── main render router ────────────────────────────────────
  function render() {
    if (!state) { renderLobby(); return; }
    if (state.status === 'waiting')  { renderWaiting();  return; }
    if (state.status === 'playing')  { renderGame();     return; }
    if (state.status === 'finished') { renderFinished(); return; }
  }

  // ── LOBBY ─────────────────────────────────────────────────
  function renderLobby() {
    const inGame = roomPreview?.status === 'playing';
    const count  = roomPreview?.playerCount || 0;

    mount(`
      <div class="tv-screen tv-lobby">
        <div class="tv-logo">🎯 ТРИАДОР</div>
        <p class="tv-subtitle">Викторина-стратегия до 6 игроков</p>

        ${inGame
          ? `<div class="tv-lobby-notice">⚔️ Идёт игра (${count} игроков). Подождите окончания.</div>`
          : `<div class="tv-lobby-actions">
              <div class="tv-lobby-status">${count > 0 ? `В зале: ${count}/6 игроков` : 'Зал пустой — заходи первым!'}</div>
              <button class="tv-btn tv-btn-primary" onclick="TriviaUI.joinRoom()">🚪 Войти в зал</button>
             </div>`
        }

        <div class="tv-rules">
          <b>Как играть:</b> Захватывайте территории, отвечая на вопросы.
          Если несколько игроков ответили правильно — запускается тайбрейкер: нужно ввести год или число.
          В фазе войны атакующий и защитник соревнуются один на один.
          Потеряйте столицу — выбываете. Последний выживший — победитель!
        </div>
      </div>
    `);
  }

  // ── WAITING ROOM ──────────────────────────────────────────
  function renderWaiting() {
    if (!state) return;
    const me = state.players.find(p => p.id === myId);
    const readyCount = state.players.filter(p => p.ready).length;
    const total = state.players.length;
    const allReady = total >= 2 && readyCount === total;

    mount(`
      <div class="tv-screen tv-waiting">
        <div class="tv-room-header">
          <div class="tv-logo-sm">🎯 ТРИАДОР</div>
          <div class="tv-room-tagline">Игровой зал</div>
        </div>

        ${allReady
          ? `<div class="tv-start-notice">✅ Все готовы! Игра начинается…</div>`
          : total < 2
            ? `<div class="tv-hint">Ждём игроков (нужно минимум 2)…</div>`
            : `<div class="tv-hint">Готовы ${readyCount} из ${total}. Игра начнётся когда все нажмут «Готов».</div>`
        }

        <div class="tv-players-grid">
          ${state.players.map(p => `
            <div class="tv-player-slot${p.id === myId ? ' tv-me' : ''}">
              <div class="tv-player-avatar" style="background:${esc(p.color)}">
                ${p.teamLogo
                  ? `<img src="${esc(p.teamLogo)}" style="width:32px;height:32px;object-fit:contain;border-radius:50%">`
                  : esc(p.teamName?.charAt(0) || p.username?.charAt(0) || '?')}
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
          <button class="tv-btn tv-btn-danger-outline" onclick="TriviaUI.backToLobby()">↩ Выйти из зала</button>
        </div>
      </div>
    `);
  }

  // ── GAME ──────────────────────────────────────────────────
  function renderGame() {
    if (!state) return;
    const me = state.players.find(p => p.id === myId);
    const currentPlayer = state.players[state.turnIndex];

    mount(`
      <div class="tv-screen tv-game">
        <div class="tv-game-layout">
          <div class="tv-sidebar">
            <div class="tv-phase-badge">${state.phase === 'claim' ? '🏳️ Захват' : '⚔️ Война'}</div>
            ${state.players.map(p => renderPlayerCard(p, p.id === currentPlayer?.id)).join('')}
          </div>

          <div class="tv-map-wrap">
            ${renderMap()}
          </div>

          <div class="tv-action-panel">
            ${renderActionPanel(me, currentPlayer)}
          </div>
        </div>
      </div>
    `);

    document.querySelectorAll('.tv-territory').forEach(cell => {
      cell.addEventListener('click', () => {
        const id = parseInt(cell.dataset.id);
        if (!isNaN(id)) TriviaUI.selectTerritory(id);
      });
    });

    // Phase 2 tiebreaker: focus input + enter key
    const tbInput = el('tv-tb-input');
    if (tbInput) {
      tbInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') TriviaUI.submitTiebreaker();
      });
      tbInput.focus();
    }

    // Timer canvas only appears in phase 2
    if (state.tiebreakerActive && state.questionDeadline) {
      startTimer(state.questionDeadline, PHASE2_MS);
    } else {
      clearTimer();
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
        (state.awaitingTerritory.type === 'claim'  && isFree) ||
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

  function renderActionPanel(me, currentPlayer) {
    if (!state) return '';
    let html = '';

    if (state.questionActive) {
      if (state.tiebreakerActive) {
        html += renderTiebreakerPanel();
      } else {
        html += renderPhase1Panel();
      }
    } else if (state.lastResult && !state.questionActive) {
      html += renderLastResult();
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
    } else {
      const isMyTurn = currentPlayer?.id === myId;
      html += `
        <div class="tv-waiting-turn">
          ${!isMyTurn && currentPlayer
            ? `<div class="tv-turn-dot" style="background:${esc(currentPlayer.color)}"></div>
               <div>Ход игрока<br><b>${esc(currentPlayer.teamName || currentPlayer.username || '...')}</b></div>`
            : `<div>Ваш ход…</div>`
          }
        </div>
      `;
    }

    return html;
  }

  // Phase 1: multiple-choice, no timer shown
  function renderPhase1Panel() {
    const q = state.question;
    if (!q) return '';
    const total          = state.totalParticipants || 0;
    const answered       = state.answeredCount || 0;
    const iAmParticipant = state.questionParticipants?.includes(myId);
    const iHaveAnswered  = state.answeredPlayers?.includes(myId);

    return `
      <div class="tv-question-box">
        <div class="tv-q-phase-label">📋 Вопрос</div>
        <div class="tv-q-text">${esc(q.question)}</div>
        ${!iAmParticipant
          ? `<div class="tv-spectate-notice">👁 Наблюдаете — в этом вопросе отвечают только атакующий и защитник</div>`
          : ''
        }
        <div class="tv-options">
          ${['a','b','c','d'].map(opt => `
            <button class="tv-option${iHaveAnswered && iAmParticipant ? ' tv-option-locked' : ''}"
                    data-opt="${opt}"
                    ${iHaveAnswered || !iAmParticipant ? 'disabled' : ''}
                    onclick="TriviaUI.answer('${opt}')">
              <span class="tv-opt-letter">${opt.toUpperCase()}</span>
              <span class="tv-opt-text">${esc(q['option_'+opt])}</span>
            </button>
          `).join('')}
        </div>
        ${iHaveAnswered
          ? `<div class="tv-answered-notice">✅ Ответ принят — ждём остальных…</div>`
          : ''
        }
        ${total > 0
          ? `<div class="tv-answered-count">${answered}/${total} ответили</div>`
          : ''
        }
      </div>
    `;
  }

  // Phase 2: tiebreaker with text input and countdown timer
  function renderTiebreakerPanel() {
    const iAmTiebreaker  = state.questionParticipants?.includes(myId);
    const iHaveAnswered  = state.answeredPlayers?.includes(myId);
    const total          = state.totalParticipants || 0;
    const answered       = state.answeredCount || 0;

    return `
      <div class="tv-question-box tv-tiebreaker-box">
        <div class="tv-tb-header">⚡ Тайбрейкер</div>
        <div class="tv-q-timer"><canvas id="tv-timer-canvas" width="60" height="60"></canvas></div>
        <div class="tv-q-text">${esc(state.tiebreakerQuestion || '')}</div>
        <div class="tv-tb-hint">Введите число или год</div>
        ${iAmTiebreaker
          ? iHaveAnswered
            ? `<div class="tv-answered-notice">✅ Ответ отправлен — ждём таймер…</div>`
            : `<div class="tv-tb-input-wrap">
                 <input type="text" id="tv-tb-input" class="tv-tb-input"
                        placeholder="Ваш ответ…" autocomplete="off" inputmode="numeric">
                 <button class="tv-btn tv-btn-primary" onclick="TriviaUI.submitTiebreaker()">Ответить</button>
               </div>`
          : `<div class="tv-spectate-notice">👁 Тайбрейкер только для игроков, ответивших правильно</div>`
        }
        ${total > 0
          ? `<div class="tv-answered-count">${answered}/${total} ответили</div>`
          : ''
        }
      </div>
    `;
  }

  function renderLastResult() {
    if (!state?.lastResult) return '';
    const r = state.lastResult;
    const winner = state.players.find(p => p.id === r.winner);

    const answerRows = state.players
      .filter(p => r.answers && r.answers[p.id])
      .map(p => {
        const opt = r.answers[p.id];
        const correct = opt === r.correct;
        return `<div class="tv-answer-row">
          <span class="tv-ar-dot" style="background:${esc(p.color)}"></span>
          <span class="tv-ar-name">${esc(p.teamName || p.username)}</span>
          <span class="tv-ar-opt tv-ar-opt-${correct ? 'ok' : 'bad'}">${opt?.toUpperCase() || '–'} ${correct ? '✓' : '✗'}</span>
        </div>`;
      }).join('');

    const tiebreakerRows = r.tiebreakerAnswers
      ? state.players
          .filter(p => r.tiebreakerAnswers[p.id] !== undefined)
          .map(p => {
            const ans = r.tiebreakerAnswers[p.id];
            const correct = String(ans || '').trim().toLowerCase() ===
                            String(r.tiebreakerCorrect || '').trim().toLowerCase();
            return `<div class="tv-answer-row">
              <span class="tv-ar-dot" style="background:${esc(p.color)}"></span>
              <span class="tv-ar-name">${esc(p.teamName || p.username)}</span>
              <span class="tv-ar-opt tv-ar-opt-${correct ? 'ok' : 'bad'}">${esc(String(ans))} ${correct ? '✓' : '✗'}</span>
            </div>`;
          }).join('')
      : '';

    return `
      <div class="tv-result-box">
        ${r.tiebreakerComing
          ? `<div class="tv-result-tb-coming">🤝 Ничья! Сейчас тайбрейкер…</div>`
          : winner
            ? `<div class="tv-result-win" style="color:${esc(winner.color)}">⚡ ${esc(winner.teamName || winner.username)} победил!</div>`
            : `<div class="tv-result-nowin">❌ Никто не ответил правильно</div>`
        }
        <div class="tv-correct-ans">Правильно: <b>${r.correct?.toUpperCase()}</b></div>
        ${answerRows ? `<div class="tv-answer-breakdown">${answerRows}</div>` : ''}
        ${tiebreakerRows ? `
          <div class="tv-tb-result">
            <div class="tv-tb-result-label">Тайбрейкер (ответ: <b>${esc(String(r.tiebreakerCorrect || ''))}</b>):</div>
            ${tiebreakerRows}
          </div>` : ''
        }
        ${r.eliminated ? `<div class="tv-result-elim">💀 ${esc(state.players.find(p=>p.id===r.eliminated)?.teamName||'')} выбывает!</div>` : ''}
      </div>
    `;
  }

  // ── FINISHED ──────────────────────────────────────────────
  function renderFinished() {
    if (!state) return;
    const winner = state.players.find(p => p.id === state.winner);
    const ranking = [...state.players].sort((a, b) => {
      if (a.eliminated === b.eliminated) return (b.territories||[]).length - (a.territories||[]).length;
      return a.eliminated ? 1 : -1;
    });

    mount(`
      <div class="tv-screen tv-finished">
        <div class="tv-finish-trophy">🏆</div>
        <div class="tv-finish-title">Игра завершена!</div>
        ${winner
          ? `<div class="tv-finish-winner" style="color:${esc(winner.color)}">${esc(winner.teamName||winner.username)} победил!</div>`
          : `<div class="tv-finish-winner">Ничья!</div>`
        }
        <div class="tv-ranking">
          ${ranking.map((p, i) => `
            <div class="tv-rank-row">
              <span class="tv-rank-num">${i + 1}</span>
              <span class="tv-rank-dot" style="background:${esc(p.color)}"></span>
              <span class="tv-rank-name">${esc(p.teamName||p.username)}</span>
              <span class="tv-rank-terr">${(p.territories||[]).length} терр.</span>
            </div>
          `).join('')}
        </div>
        <div class="tv-finish-note">Зал сбросится автоматически через 30 секунд</div>
        <button class="tv-btn tv-btn-outline" style="margin-top:20px" onclick="TriviaUI.backToLobby()">↩ В лобби</button>
      </div>
    `);
  }

  // ── countdown timer canvas ────────────────────────────────
  function startTimer(deadline, totalMs) {
    clearTimer();
    function tick() {
      const cvs = el('tv-timer-canvas');
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      const remaining = Math.max(0, deadline - Date.now());
      const fraction = remaining / totalMs;
      const secs = Math.ceil(remaining / 1000);

      ctx.clearRect(0, 0, 60, 60);
      ctx.beginPath(); ctx.arc(30,30,26,0,Math.PI*2);
      ctx.strokeStyle = '#2a3f52'; ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath();
      ctx.arc(30,30,26,-Math.PI/2,-Math.PI/2 + fraction*Math.PI*2);
      ctx.strokeStyle = fraction > 0.4 ? '#2ecc71' : fraction > 0.2 ? '#f39c12' : '#e74c3c';
      ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(secs, 30, 30);

      if (remaining > 0) timerRaf = requestAnimationFrame(tick);
    }
    tick();
  }

  function clearTimer() {
    if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
  }

  // ── helpers ───────────────────────────────────────────────
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

    joinRoom() {
      if (!socket) return;
      socket.emit('trivia:join');
    },

    toggleReady() {
      if (socket) socket.emit('trivia:ready');
    },

    answer(option) {
      if (!socket) return;
      document.querySelectorAll('.tv-option').forEach(b => {
        b.disabled = true;
        if (b.dataset.opt === option) b.classList.add('tv-option-selected');
      });
      socket.emit('trivia:answer', { option });
    },

    submitTiebreaker() {
      if (!socket) return;
      const input = el('tv-tb-input');
      if (!input) return;
      const answer = input.value.trim();
      if (!answer) return;
      input.disabled = true;
      document.querySelectorAll('.tv-tb-input-wrap button').forEach(b => { b.disabled = true; });
      socket.emit('trivia:tiebreaker_answer', { answer });
    },

    selectTerritory(id) {
      if (!socket) return;
      socket.emit('trivia:select_territory', { territoryId: id });
    },

    backToLobby() {
      if (socket) socket.emit('trivia:leave');
      state = null;
      renderLobby();
    },
  };
})();

window.TriviaUI = TriviaUI;
