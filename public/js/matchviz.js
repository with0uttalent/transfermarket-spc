'use strict';
// ─── Match visualization ──────────────────────────────────────────────────────
// Horizontal football pitch with both line-ups as avatar tokens and a ball that
// acts out the real event feed: buildup passes travel between the actual
// players, goals fly into the net (with a save/near-miss variant), cards and
// substitutions happen on the token itself. Driven by the same match_events
// rows the text feed shows, so the picture always matches the commentary.
//
// Public API (window.MatchViz):
//   init(container, cfg)  cfg = { homeId, awayId, homeColor, awayColor,
//                                 homePlayers:[{id,name,image_url,shirt_number,zone}],
//                                 awayPlayers:[...] }   zone ∈ GK/DEF/DMF/MID/AMF/FWD
//   playEvent(ev)         queue a match_events row for animation
//   replay(events, hooks) play a finished match back; hooks = {onMinute, onScore, onDone}
//   stopReplay() / destroy()

(function () {
  // Pitch geometry (SVG user units)
  const W = 1050, H = 680;
  const FX = 25, FY = 20, FW = 1000, FH = 640;          // field rect
  const CX = W / 2, CY = FY + FH / 2;
  const GOAL_HALF = 60;                                  // goal mouth half-height
  const LEFT_GOAL_X = FX, RIGHT_GOAL_X = FX + FW;

  // Zone depth (distance from own goal) as a fraction of half the field width
  const ZONE_DEPTH = { GK: 0.07, DEF: 0.30, DMF: 0.52, MID: 0.72, AMF: 0.92, FWD: 1.12 };

  const S = {}; // module state

  function el(tag, attrs, parent) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Pitch ──────────────────────────────────────────────────────────────────
  function drawPitch(svg) {
    const g = el('g', {}, svg);
    el('rect', { x: FX, y: FY, width: FW, height: FH, rx: 8, class: 'mv-grass' }, g);
    // mowing stripes
    for (let i = 0; i < 10; i++) {
      if (i % 2) el('rect', { x: FX + i * FW / 10, y: FY, width: FW / 10, height: FH, class: 'mv-stripe' }, g);
    }
    const line = a => el(a.tag || 'rect', Object.assign({ class: 'mv-line' }, a), g);
    // outline, halfway, centre circle & spot
    el('rect', { x: FX, y: FY, width: FW, height: FH, rx: 8, class: 'mv-line', fill: 'none' }, g);
    el('line', { x1: CX, y1: FY, x2: CX, y2: FY + FH, class: 'mv-line' }, g);
    el('circle', { cx: CX, cy: CY, r: 74, class: 'mv-line', fill: 'none' }, g);
    el('circle', { cx: CX, cy: CY, r: 3.5, class: 'mv-line-fill' }, g);
    // penalty boxes / six-yard / spots / arcs (both ends)
    for (const side of [-1, 1]) {
      const gx = side === -1 ? LEFT_GOAL_X : RIGHT_GOAL_X;
      const dir = side === -1 ? 1 : -1;
      el('rect', { x: side === -1 ? gx : gx - 132, y: CY - 176, width: 132, height: 352, class: 'mv-line', fill: 'none' }, g);
      el('rect', { x: side === -1 ? gx : gx - 48,  y: CY - 88,  width: 48,  height: 176, class: 'mv-line', fill: 'none' }, g);
      el('circle', { cx: gx + dir * 88, cy: CY, r: 3.5, class: 'mv-line-fill' }, g);
      const ax = gx + dir * 132;
      el('path', { d: `M ${ax} ${CY - 58} A 74 74 0 0 ${side === -1 ? 1 : 0} ${ax} ${CY + 58}`, class: 'mv-line', fill: 'none' }, g);
      // goal frame + net (drawn outside the field)
      const net = el('g', { class: 'mv-goal', 'data-side': side === -1 ? 'left' : 'right' }, g);
      el('rect', { x: side === -1 ? gx - 16 : gx, y: CY - GOAL_HALF, width: 16, height: GOAL_HALF * 2, class: 'mv-net' }, net);
      for (let i = 1; i < 4; i++) {
        el('line', { x1: side === -1 ? gx - 16 : gx, y1: CY - GOAL_HALF + i * GOAL_HALF / 2, x2: side === -1 ? gx : gx + 16, y2: CY - GOAL_HALF + i * GOAL_HALF / 2, class: 'mv-net-line' }, net);
      }
      el('line', { x1: side === -1 ? gx - 8 : gx + 8, y1: CY - GOAL_HALF, x2: side === -1 ? gx - 8 : gx + 8, y2: CY + GOAL_HALF, class: 'mv-net-line' }, net);
    }
    // corner arcs
    for (const [cx, cy, sweep] of [[FX, FY, 0], [FX + FW, FY, 1], [FX, FY + FH, 1], [FX + FW, FY + FH, 0]]) {
      const r = 14;
      const sx = cx === FX ? cx + r : cx - r;
      el('path', { d: `M ${sx} ${cy} A ${r} ${r} 0 0 ${sweep} ${cx} ${cy === FY ? cy + r : cy - r}`, class: 'mv-line', fill: 'none' }, g);
    }
  }

  // ── Players ────────────────────────────────────────────────────────────────
  function layoutTeam(players, isHome) {
    // group by zone, spread each zone vertically
    const zones = {};
    for (const p of players) (zones[p.zone || 'MID'] ||= []).push(p);
    for (const [zone, list] of Object.entries(zones)) {
      const depth = ZONE_DEPTH[zone] ?? 0.7;
      const x = isHome ? FX + depth * (FW / 2 - 40) + 22 : FX + FW - depth * (FW / 2 - 40) - 22;
      list.forEach((p, i) => {
        p.x = x;
        p.y = FY + FH * (i + 1) / (list.length + 1);
      });
    }
  }

  function drawPlayer(p, color, isHome) {
    const g = el('g', { class: 'mv-player', transform: `translate(${p.x},${p.y})`, 'data-pid': p.id }, S.playersLayer);
    el('circle', { r: 21, class: 'mv-p-ring', fill: color }, g);
    const ini = (p.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const t = el('text', { class: 'mv-p-ini', y: 5 }, g);
    t.textContent = ini;
    if (p.image_url) {
      const clipId = 'mvclip' + p.id;
      const clip = el('clipPath', { id: clipId }, S.defs);
      el('circle', { r: 19, cx: 0, cy: 0 }, clip);
      const img = el('image', { href: p.image_url, x: -19, y: -19, width: 38, height: 38, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice' }, g);
      img.addEventListener('error', () => img.remove());
    }
    const label = el('text', { class: 'mv-p-name', y: 34 }, g);
    label.textContent = (p.name || '').split(' ').slice(-1)[0];
    if (p.shirt_number) {
      const numG = el('g', { transform: 'translate(14,-14)' }, g);
      el('circle', { r: 8, class: 'mv-p-numbg' }, numG);
      const nt = el('text', { class: 'mv-p-num', y: 3 }, numG);
      nt.textContent = p.shirt_number;
    }
    p.node = g;
    p.color = color;
    p.isHome = isHome;
    return g;
  }

  // ── Ball ───────────────────────────────────────────────────────────────────
  function drawBall() {
    const g = el('g', { class: 'mv-ballg', transform: `translate(${CX},${CY})` }, S.svg);
    el('ellipse', { class: 'mv-ball-shadow', cx: 0, cy: 7, rx: 8, ry: 3 }, g);
    const b = el('g', { class: 'mv-ball-lift' }, g);
    el('circle', { r: 7, class: 'mv-ball' }, b);
    el('path', { d: 'M -3 -1 L 0 -4 L 3 -1 L 2 3 L -2 3 Z', class: 'mv-ball-patch' }, b);
    S.ballG = g; S.ballLift = b;
    S.ball = { x: CX, y: CY };
  }

  function tween(ms, step) {
    return new Promise(resolve => {
      const t0 = performance.now();
      function frame(now) {
        if (S.dead) return resolve();
        let t = Math.min(1, (now - t0) / ms);
        step(t);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  // Ball flight with a simulated loft (arc height in px)
  function moveBall(to, ms, arc = 0) {
    const from = { ...S.ball };
    return tween(ms, t => {
      const e = t * (2 - t); // easeOut
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e;
      S.ball = { x, y };
      S.ballG.setAttribute('transform', `translate(${x},${y})`);
      const h = arc * 4 * t * (1 - t);
      S.ballLift.setAttribute('transform', `translate(0,${-h}) scale(${1 + h / 90})`);
    });
  }

  function nudge(p, dx, dy, ms = 260) {
    if (!p || !p.node) return Promise.resolve();
    return tween(ms, t => {
      const k = Math.sin(t * Math.PI); // out and back
      p.node.setAttribute('transform', `translate(${p.x + dx * k},${p.y + dy * k})`);
    });
  }

  function highlight(p, cls = 'mv-glow', ms = 900) {
    if (!p || !p.node) return;
    p.node.classList.add(cls);
    setTimeout(() => p.node && p.node.classList.remove(cls), ms);
  }

  // ── Overlays (HTML on top of the SVG) ─────────────────────────────────────
  function overlay(html, cls, ms = 1600) {
    const d = document.createElement('div');
    d.className = 'mv-overlay ' + (cls || '');
    d.innerHTML = html;
    S.wrap.appendChild(d);
    requestAnimationFrame(() => d.classList.add('show'));
    setTimeout(() => { d.classList.remove('show'); setTimeout(() => d.remove(), 350); }, ms);
  }

  function ticker(text) {
    if (!S.tickerEl) return;
    S.tickerEl.textContent = text || '';
    S.tickerEl.classList.remove('flash');
    void S.tickerEl.offsetWidth;
    S.tickerEl.classList.add('flash');
  }

  function confetti(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const r = el('rect', { x: 0, y: 0, width: 6, height: 9, fill: i % 2 ? color : '#ffd54f', class: 'mv-conf' }, S.svg);
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
      const dx = Math.cos(a) * v, dy = Math.sin(a) * v - 60;
      tween(900 + Math.random() * 400, t => {
        r.setAttribute('transform', `translate(${x + dx * t},${y + dy * t + 130 * t * t}) rotate(${t * 500})`);
        r.setAttribute('opacity', String(1 - t));
      }).then(() => r.remove());
    }
  }

  function shakeGoal(side) {
    const net = S.svg.querySelector(`.mv-goal[data-side="${side}"]`);
    if (!net) return;
    net.classList.add('mv-goal-shake');
    setTimeout(() => net.classList.remove('mv-goal-shake'), 600);
  }

  // ── Actors & targets ───────────────────────────────────────────────────────
  const player = id => (id != null && S.players.get(Number(id))) || null;

  function teamFallback(teamId) {
    // roughly "someone in midfield" of that team
    const isHome = Number(teamId) === S.homeId;
    return { x: isHome ? CX - 130 : CX + 130, y: CY, node: null };
  }
  const actor = ev => player(ev.player_id) || teamFallback(ev.team_id);
  const isHomeTeam = teamId => Number(teamId) === S.homeId;

  // goal the team ATTACKS
  const attackedGoalX = teamId => isHomeTeam(teamId) ? RIGHT_GOAL_X : LEFT_GOAL_X;
  // goal the team DEFENDS (own net — for own goals and saves)
  const ownGoalX = teamId => isHomeTeam(teamId) ? LEFT_GOAL_X : RIGHT_GOAL_X;
  const goalSide = x => x === LEFT_GOAL_X ? 'left' : 'right';

  // ── Choreography per event type ───────────────────────────────────────────
  async function animateEvent(ev, speed = 1) {
    const dur = ms => Math.max(140, ms / speed);
    const t = ev.event_type;
    ticker(`${ev.minute}′  ${ev.description || ''}`);

    if (t === 'buildup') {
      const a = actor(ev), b = player(ev.player2_id);
      if (a.node && S.ball && (Math.abs(S.ball.x - a.x) > 30 || Math.abs(S.ball.y - a.y) > 30)) {
        await moveBall(a, dur(340), 8);
      }
      if (b) {
        highlight(a, 'mv-glow');
        await Promise.all([moveBall(b, dur(520), 26), nudge(b, (a.x - b.x) * 0.06, (a.y - b.y) * 0.06)]);
        highlight(b, 'mv-glow');
      } else {
        // dribble: player and ball push forward together
        const dx = isHomeTeam(ev.team_id) ? 46 : -46;
        highlight(a, 'mv-glow');
        await Promise.all([nudge(a, dx, 0, dur(560)), moveBall({ x: a.x + dx, y: a.y }, dur(560), 6)]);
      }
      return;
    }

    if (t === 'goal' || t === 'own_goal') {
      const own = t === 'own_goal';
      const shooter = actor(ev);
      const gx = own ? ownGoalX(ev.team_id) : attackedGoalX(ev.team_id);
      const gy = CY + (Math.random() * 2 - 1) * (GOAL_HALF - 14);
      const assister = player(ev.player2_id);
      if (!own && assister && assister !== shooter) {
        await moveBall(assister, dur(300), 10);
        highlight(assister, 'mv-glow');
        await moveBall(shooter, dur(480), 24);
      } else {
        await moveBall(shooter, dur(340), 12);
      }
      highlight(shooter, own ? 'mv-glow-red' : 'mv-glow');
      await nudge(shooter, (gx - shooter.x) * 0.05, (gy - shooter.y) * 0.05, dur(200));
      await moveBall({ x: gx + (goalSide(gx) === 'left' ? -8 : 8), y: gy }, dur(380), 18);
      shakeGoal(goalSide(gx));
      confetti(gx, gy, own ? '#e57373' : (isHomeTeam(ev.team_id) ? S.homeColor : S.awayColor));
      overlay(own ? `<div class="mv-goal-txt og">АВТОГОЛ</div>` :
        `<div class="mv-goal-txt">⚽ ГОЛ!</div><div class="mv-goal-sub">${esc((shooter.name) || '')}</div>`, 'mv-ov-goal', dur(1700));
      await sleep(dur(1250));
      await moveBall({ x: CX, y: CY }, dur(420), 30);
      return;
    }

    if (t === 'save') {
      // team_id = the SAVING side; the shot flies toward their own goal, the GK stops it
      const gk = actor(ev);
      const gx = ownGoalX(ev.team_id);
      const dir = goalSide(gx) === 'left' ? 1 : -1;
      const stopX = gx + dir * 26;
      const stopY = CY + (Math.random() * 2 - 1) * (GOAL_HALF - 20);
      await moveBall({ x: CX + (gx - CX) * 0.45, y: CY + (Math.random() * 160 - 80) }, dur(300), 14);
      const dive = gk.node ? nudge(gk, stopX - gk.x, stopY - gk.y, dur(520)) : Promise.resolve();
      await Promise.all([moveBall({ x: stopX, y: stopY }, dur(360), 16), dive]);
      highlight(gk, 'mv-glow-save');
      overlay(`<div class="mv-mini">🧤 Сейв!</div>`, 'mv-ov-mini', dur(1000));
      await moveBall({ x: gx + dir * 120, y: CY + (Math.random() * 200 - 100) }, dur(420), 30);
      return;
    }

    if (t === 'near_miss') {
      const shooter = actor(ev);
      const gx = attackedGoalX(ev.team_id);
      const missY = CY + (GOAL_HALF + 26 + Math.random() * 60) * (Math.random() < 0.5 ? -1 : 1);
      await moveBall(shooter, dur(300), 10);
      highlight(shooter, 'mv-glow');
      await moveBall({ x: gx, y: missY }, dur(420), 34);
      overlay(`<div class="mv-mini">🎯 Мимо!</div>`, 'mv-ov-mini', dur(900));
      await moveBall({ x: gx + (goalSide(gx) === 'left' ? 90 : -90), y: CY + (Math.random() * 240 - 120) }, dur(380), 22);
      return;
    }

    if (t === 'corner_kick') {
      const taker = actor(ev);
      const gx = attackedGoalX(ev.team_id);
      const cornerY = Math.random() < 0.5 ? FY + 6 : FY + FH - 6;
      const cornerX = gx === LEFT_GOAL_X ? FX + 6 : FX + FW - 6;
      await moveBall({ x: cornerX, y: cornerY }, dur(420), 20);
      if (taker.node) await nudge(taker, (cornerX - taker.x) * 0.1, (cornerY - taker.y) * 0.1, dur(280));
      await moveBall({ x: gx + (gx === LEFT_GOAL_X ? 80 : -80), y: CY }, dur(520), 48);
      return;
    }

    if (t === 'free_kick') {
      const taker = actor(ev);
      const gx = attackedGoalX(ev.team_id);
      const spotX = CX + (gx - CX) * 0.55, spotY = CY + (Math.random() * 240 - 120);
      await moveBall({ x: spotX, y: spotY }, dur(380), 14);
      highlight(taker, 'mv-glow');
      overlay(`<div class="mv-mini">🟡 Штрафной</div>`, 'mv-ov-mini', dur(900));
      return;
    }

    if (t === 'penalty_awarded') {
      const gx = attackedGoalX(ev.team_id);
      const dir = gx === LEFT_GOAL_X ? 1 : -1;
      await moveBall({ x: gx + dir * 88, y: CY }, dur(480), 18);
      overlay(`<div class="mv-mini">🚨 Пенальти!</div>`, 'mv-ov-mini', dur(1200));
      await sleep(dur(350));
      return;
    }

    if (t === 'penalty_miss') {
      const gx = attackedGoalX(ev.team_id);
      const dir = gx === LEFT_GOAL_X ? 1 : -1;
      const shooter = actor(ev);
      await moveBall({ x: gx + dir * 88, y: CY }, dur(300), 8);
      highlight(shooter, 'mv-glow-red');
      const missY = CY + (GOAL_HALF + 30) * (Math.random() < 0.5 ? -1 : 1);
      await moveBall({ x: gx, y: missY }, dur(340), 30);
      overlay(`<div class="mv-mini">❌ Промах с пенальти</div>`, 'mv-ov-mini', dur(1100));
      await moveBall({ x: CX, y: CY }, dur(420), 24);
      return;
    }

    if (t === 'yellow_card' || t === 'red_card') {
      const p = actor(ev);
      if (p.node) {
        const card = el('rect', { x: -7, y: -46, width: 14, height: 20, rx: 2, class: t === 'red_card' ? 'mv-card-red' : 'mv-card-yellow' }, p.node);
        setTimeout(() => card.remove(), 1900 / speed);
        if (t === 'red_card') p.node.classList.add('mv-sent-off');
      }
      overlay(`<div class="mv-mini">${t === 'red_card' ? '🟥 Красная карточка' : '🟨 Жёлтая карточка'}</div>`, 'mv-ov-mini', dur(1100));
      await sleep(dur(650));
      return;
    }

    if (t === 'injury') {
      const p = actor(ev);
      highlight(p, 'mv-glow-red', 1500);
      overlay(`<div class="mv-mini">🚑 Травма</div>`, 'mv-ov-mini', dur(1000));
      await sleep(dur(500));
      return;
    }

    if (t === 'substitution') {
      // player_id = coming ON, player2_id = going OFF
      const off = player(ev.player2_id);
      if (off && off.node) {
        const pos = { x: off.x, y: off.y, zone: off.zone };
        await tween(dur(360), k => off.node.setAttribute('opacity', String(1 - k)));
        off.node.remove();
        S.players.delete(Number(ev.player2_id));
        const name2 = (ev.description || '').match(/:\s*(.+?)\s+вместо/);
        const on = {
          id: Number(ev.player_id), name: ev.player_name || (name2 ? name2[1] : '↑'),
          image_url: ev.player_image_url || null, shirt_number: null,
          zone: pos.zone, x: pos.x, y: pos.y,
        };
        drawPlayer(on, isHomeTeam(ev.team_id) ? S.homeColor : S.awayColor, isHomeTeam(ev.team_id));
        on.node.setAttribute('opacity', '0');
        await tween(dur(360), k => on.node.setAttribute('opacity', String(k)));
        S.players.set(on.id, on);
        highlight(on, 'mv-glow');
      }
      overlay(`<div class="mv-mini">🔄 Замена</div>`, 'mv-ov-mini', dur(900));
      return;
    }

    // anything else — just tick the commentary
    await sleep(dur(350));
  }

  // ── Queue ──────────────────────────────────────────────────────────────────
  async function pump() {
    if (S.pumping) return;
    S.pumping = true;
    while (S.queue.length && !S.dead) {
      // catch-up: burst arrivals play faster
      const speed = S.queue.length > 5 ? 2.2 : S.queue.length > 2 ? 1.5 : 1;
      const ev = S.queue.shift();
      try { await animateEvent(ev, speed * (S.speed || 1)); } catch (e) { /* keep the show going */ }
    }
    S.pumping = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.MatchViz = {
    init(container, cfg) {
      this.destroy();
      S.dead = false;
      S.queue = [];
      S.players = new Map();
      S.homeId = Number(cfg.homeId);
      S.awayId = Number(cfg.awayId);
      S.homeColor = cfg.homeColor || '#2e7d32';
      S.awayColor = cfg.awayColor || '#c62828';
      if (S.homeColor.toLowerCase() === S.awayColor.toLowerCase()) S.awayColor = '#c62828';

      container.innerHTML = '';
      S.wrap = document.createElement('div');
      S.wrap.className = 'mv-wrap';
      container.appendChild(S.wrap);

      S.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mv-svg', preserveAspectRatio: 'xMidYMid meet' });
      S.wrap.appendChild(S.svg);
      S.defs = el('defs', {}, S.svg);
      drawPitch(S.svg);
      S.playersLayer = el('g', {}, S.svg);

      for (const [list, isHome, color] of [[cfg.homePlayers || [], true, S.homeColor], [cfg.awayPlayers || [], false, S.awayColor]]) {
        const ps = list.map(p => ({ ...p, id: Number(p.id) }));
        layoutTeam(ps, isHome);
        for (const p of ps) { drawPlayer(p, color, isHome); S.players.set(p.id, p); }
      }
      drawBall();

      S.tickerEl = document.createElement('div');
      S.tickerEl.className = 'mv-ticker';
      S.wrap.appendChild(S.tickerEl);
    },

    playEvent(ev) {
      if (!S.svg || S.dead) return;
      // Joining mid-match reveals a big backlog at once — keep the key moments,
      // skip filler passes so the pitch catches up to real time quickly.
      if (S.queue.length > 10 && ev.event_type === 'buildup') return;
      S.queue.push(ev);
      pump();
    },

    async replay(events, hooks = {}) {
      if (!S.svg) return;
      this.stopReplay();
      S.replaying = true;
      S.speed = 1.35;
      let h = 0, a = 0;
      for (const ev of events) {
        if (!S.replaying || S.dead) break;
        if (hooks.onMinute) hooks.onMinute(ev.minute);
        if (ev.event_type === 'goal' || ev.event_type === 'own_goal') {
          const scoringHome = ev.event_type === 'own_goal' ? !isHomeTeam(ev.team_id) : isHomeTeam(ev.team_id);
          scoringHome ? h++ : a++;
        }
        S.queue.push(ev);
        await pump();
        if (hooks.onScore) hooks.onScore(h, a);
      }
      S.speed = 1;
      S.replaying = false;
      if (hooks.onDone) hooks.onDone();
    },

    stopReplay() { S.replaying = false; S.queue.length = 0; S.speed = 1; },

    destroy() {
      S.dead = true;
      S.replaying = false;
      if (S.queue) S.queue.length = 0;
      if (S.wrap && S.wrap.parentNode) S.wrap.parentNode.removeChild(S.wrap);
      S.svg = S.wrap = S.tickerEl = null;
    },
  };
})();
