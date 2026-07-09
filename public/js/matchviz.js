'use strict';
// ─── Match visualization ──────────────────────────────────────────────────────
// A horizontal pitch where both line-ups play out the real match_events feed.
// Players don't stand still: a continuous simulation loop makes the whole team
// shift up/down the pitch with the ball (FC-style block movement), roam around
// their tactical slot, and the nearest man presses the ball. On top of that the
// event feed is choreographed — passes travel between the actual players, goals
// fly into the net, keepers dive to saves, etc.
//
// Ordering guarantee: the text/feed line for an event is emitted AFTER its
// animation has played (see pump()), so the viewer always sees the action first
// and the caption second — never the other way round.
//
// Public API (window.MatchViz):
//   init(container, cfg)   cfg = { homeId, awayId, homeColor, awayColor,
//                                  homePlayers:[{id,name,image_url,shirt_number,zone}],
//                                  awayPlayers:[...], onEvent(ev) }
//   playEvent(ev)          queue a live event for animation
//   replay(events, {onDone})  replay a finished match
//   stopReplay() / destroy() / isBusy()

(function () {
  const W = 1050, H = 680;
  const FX = 25, FY = 20, FW = 1000, FH = 640;
  const CX = W / 2, CY = FY + FH / 2;
  const GOAL_HALF = 60;
  const LEFT_GOAL_X = FX, RIGHT_GOAL_X = FX + FW;

  // Home attacks →, away attacks ←. Depth = distance from own goal (fraction of half-width).
  const ZONE_DEPTH = { GK: 0.06, DEF: 0.28, DMF: 0.50, MID: 0.70, AMF: 0.90, FWD: 1.10 };
  // How strongly each line follows the ball up/down the pitch.
  const ZONE_SHIFT = { GK: 0.03, DEF: 0.11, DMF: 0.16, MID: 0.19, AMF: 0.23, FWD: 0.27 };

  const S = {};

  function el(tag, attrs, parent) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clampX = x => Math.max(FX + 18, Math.min(FX + FW - 18, x));
  const clampY = y => Math.max(FY + 18, Math.min(FY + FH - 18, y));

  // ── Pitch ──────────────────────────────────────────────────────────────────
  function drawPitch(svg) {
    const g = el('g', {}, svg);
    el('rect', { x: FX, y: FY, width: FW, height: FH, rx: 8, class: 'mv-grass' }, g);
    for (let i = 0; i < 10; i++) if (i % 2) el('rect', { x: FX + i * FW / 10, y: FY, width: FW / 10, height: FH, class: 'mv-stripe' }, g);
    el('rect', { x: FX, y: FY, width: FW, height: FH, rx: 8, class: 'mv-line', fill: 'none' }, g);
    el('line', { x1: CX, y1: FY, x2: CX, y2: FY + FH, class: 'mv-line' }, g);
    el('circle', { cx: CX, cy: CY, r: 74, class: 'mv-line', fill: 'none' }, g);
    el('circle', { cx: CX, cy: CY, r: 3.5, class: 'mv-line-fill' }, g);
    for (const side of [-1, 1]) {
      const gx = side === -1 ? LEFT_GOAL_X : RIGHT_GOAL_X;
      const dir = side === -1 ? 1 : -1;
      el('rect', { x: side === -1 ? gx : gx - 132, y: CY - 176, width: 132, height: 352, class: 'mv-line', fill: 'none' }, g);
      el('rect', { x: side === -1 ? gx : gx - 48, y: CY - 88, width: 48, height: 176, class: 'mv-line', fill: 'none' }, g);
      el('circle', { cx: gx + dir * 88, cy: CY, r: 3.5, class: 'mv-line-fill' }, g);
      const ax = gx + dir * 132;
      el('path', { d: `M ${ax} ${CY - 58} A 74 74 0 0 ${side === -1 ? 1 : 0} ${ax} ${CY + 58}`, class: 'mv-line', fill: 'none' }, g);
      const net = el('g', { class: 'mv-goal', 'data-side': side === -1 ? 'left' : 'right' }, g);
      el('rect', { x: side === -1 ? gx - 16 : gx, y: CY - GOAL_HALF, width: 16, height: GOAL_HALF * 2, class: 'mv-net' }, net);
      for (let i = 1; i < 4; i++) el('line', { x1: side === -1 ? gx - 16 : gx, y1: CY - GOAL_HALF + i * GOAL_HALF / 2, x2: side === -1 ? gx : gx + 16, y2: CY - GOAL_HALF + i * GOAL_HALF / 2, class: 'mv-net-line' }, net);
      el('line', { x1: side === -1 ? gx - 8 : gx + 8, y1: CY - GOAL_HALF, x2: side === -1 ? gx - 8 : gx + 8, y2: CY + GOAL_HALF, class: 'mv-net-line' }, net);
    }
    for (const [cx, cy, sweep] of [[FX, FY, 0], [FX + FW, FY, 1], [FX, FY + FH, 1], [FX + FW, FY + FH, 0]]) {
      const r = 14, sx = cx === FX ? cx + r : cx - r;
      el('path', { d: `M ${sx} ${cy} A ${r} ${r} 0 0 ${sweep} ${cx} ${cy === FY ? cy + r : cy - r}`, class: 'mv-line', fill: 'none' }, g);
    }
  }

  // ── Players ────────────────────────────────────────────────────────────────
  function layoutTeam(players, isHome) {
    const zones = {};
    for (const p of players) (zones[p.zone || 'MID'] ||= []).push(p);
    for (const [zone, list] of Object.entries(zones)) {
      const depth = ZONE_DEPTH[zone] ?? 0.7;
      const x = isHome ? FX + depth * (FW / 2 - 40) + 22 : FX + FW - depth * (FW / 2 - 40) - 22;
      list.forEach((p, i) => { p.hx = x; p.hy = FY + FH * (i + 1) / (list.length + 1); });
    }
  }

  function drawPlayer(p, color, isHome) {
    const g = el('g', { class: 'mv-player', 'data-pid': p.id }, S.playersLayer);
    el('circle', { r: 21, class: 'mv-p-ring', fill: color }, g);
    const ini = (p.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const t = el('text', { class: 'mv-p-ini', y: 5 }, g); t.textContent = ini;
    if (p.image_url) {
      const clipId = 'mvclip' + p.id + '_' + Math.round(p.hx);
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
      const nt = el('text', { class: 'mv-p-num', y: 3 }, numG); nt.textContent = p.shirt_number;
    }
    p.node = g; p.color = color; p.isHome = isHome;
    p.x = p.hx; p.y = p.hy; p.tx = p.hx; p.ty = p.hy;
    p.phase = Math.random() * Math.PI * 2;
    p.shiftK = ZONE_SHIFT[p.zone] ?? 0.18;
    p.locked = false;
    g.setAttribute('transform', `translate(${p.x},${p.y})`);
    return g;
  }

  // ── Continuous field simulation ─────────────────────────────────────────────
  function stepField(t) {
    const nearest = { home: null, away: null }, nd = { home: Infinity, away: Infinity };
    for (const p of S.players.values()) {
      if (p.zone === 'GK') continue;
      const side = p.isHome ? 'home' : 'away';
      const dx = p.x - S.ball.x, dy = p.y - S.ball.y, d = dx * dx + dy * dy;
      if (d < nd[side]) { nd[side] = d; nearest[side] = p; }
    }
    const rf = S.speed || 1;
    for (const p of S.players.values()) {
      if (!p.locked) {
        let tx, ty;
        if (p.zone === 'GK') {
          const gx = p.isHome ? LEFT_GOAL_X + 34 : RIGHT_GOAL_X - 34;
          tx = gx + (S.ball.x - CX) * 0.02;
          ty = CY + (S.ball.y - CY) * 0.30;
        } else {
          tx = p.hx + (S.ball.x - CX) * p.shiftK + Math.sin(t * 0.0016 * rf + p.phase) * 7;
          ty = p.hy + (S.ball.y - CY) * 0.12 + Math.cos(t * 0.0013 * rf + p.phase * 1.3) * 6;
          if (p === nearest[p.isHome ? 'home' : 'away']) {
            const dir = p.isHome ? -1 : 1;
            tx = tx * 0.35 + (S.ball.x + dir * 22) * 0.65;
            ty = ty * 0.35 + S.ball.y * 0.65;
          }
        }
        p.tx = clampX(tx); p.ty = clampY(ty);
        p.x += (p.tx - p.x) * Math.min(0.14, 0.05 * rf);
        p.y += (p.ty - p.y) * Math.min(0.14, 0.05 * rf);
      }
      p.node.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    }
    // Idle possession: the ball hangs with the pressing player of the team on the ball.
    if (!S.eventActive && S.ballG) {
      const carrier = nearest[S.possTeam || 'home'] || nearest.home || nearest.away;
      if (carrier) {
        const dir = carrier.isHome ? 1 : -1;
        S.ball.x += (carrier.x + dir * 14 - S.ball.x) * 0.05 * rf;
        S.ball.y += (carrier.y - S.ball.y) * 0.05 * rf;
        S.ballG.setAttribute('transform', `translate(${S.ball.x.toFixed(1)},${S.ball.y.toFixed(1)})`);
      }
    }
  }

  function startLoop() {
    S.loopOn = true;
    const frame = now => { if (S.dead || !S.loopOn) return; stepField(now); S.raf = requestAnimationFrame(frame); };
    S.raf = requestAnimationFrame(frame);
  }

  // ── Ball ───────────────────────────────────────────────────────────────────
  function drawBall() {
    const g = el('g', { class: 'mv-ballg', transform: `translate(${CX},${CY})` }, S.svg);
    el('ellipse', { class: 'mv-ball-shadow', cx: 0, cy: 7, rx: 8, ry: 3 }, g);
    const b = el('g', { class: 'mv-ball-lift' }, g);
    el('circle', { r: 7, class: 'mv-ball' }, b);
    el('path', { d: 'M -3 -1 L 0 -4 L 3 -1 L 2 3 L -2 3 Z', class: 'mv-ball-patch' }, b);
    S.ballG = g; S.ballLift = b; S.ball = { x: CX, y: CY };
  }

  function tween(ms, step) {
    return new Promise(resolve => {
      const t0 = performance.now();
      const frame = now => {
        if (S.dead) return resolve();
        const t = Math.min(1, (now - t0) / ms);
        step(t);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // Ball flight to a fixed point (with loft). Player targets are sampled live so
  // passes land on the receiver even as he keeps moving.
  function moveBall(to, ms, arc = 0) {
    const from = { ...S.ball };
    return tween(ms, t => {
      const e = t * (2 - t);
      const tx = typeof to.getX === 'function' ? to.getX() : to.x;
      const ty = typeof to.getY === 'function' ? to.getY() : to.y;
      const x = from.x + (tx - from.x) * e, y = from.y + (ty - from.y) * e;
      S.ball = { x, y };
      S.ballG.setAttribute('transform', `translate(${x},${y})`);
      const h = arc * 4 * t * (1 - t);
      S.ballLift.setAttribute('transform', `translate(0,${-h}) scale(${1 + h / 90})`);
    });
  }
  const at = p => ({ getX: () => p.x, getY: () => p.y });

  // Drive a player to a spot (locks him out of the ambient loop for the duration).
  function moveTo(p, x, y, ms) {
    if (!p || !p.node) return Promise.resolve();
    p.locked = true;
    const fx = p.x, fy = p.y;
    return tween(ms, t => { const e = t * (2 - t); p.x = fx + (x - fx) * e; p.y = fy + (y - fy) * e; })
      .then(() => { p.locked = false; });
  }

  function highlight(p, cls = 'mv-glow', ms = 900) {
    if (!p || !p.node) return;
    p.node.classList.add(cls);
    setTimeout(() => p.node && p.node.classList.remove(cls), ms);
  }

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
    S.tickerEl.classList.remove('flash'); void S.tickerEl.offsetWidth; S.tickerEl.classList.add('flash');
  }
  function confetti(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const r = el('rect', { x: 0, y: 0, width: 6, height: 9, fill: i % 2 ? color : '#ffd54f', class: 'mv-conf' }, S.svg);
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90, dx = Math.cos(a) * v, dy = Math.sin(a) * v - 60;
      tween(900 + Math.random() * 400, t => { r.setAttribute('transform', `translate(${x + dx * t},${y + dy * t + 130 * t * t}) rotate(${t * 500})`); r.setAttribute('opacity', String(1 - t)); }).then(() => r.remove());
    }
  }
  function shakeGoal(side) {
    const net = S.svg.querySelector(`.mv-goal[data-side="${side}"]`);
    if (!net) return;
    net.classList.add('mv-goal-shake'); setTimeout(() => net.classList.remove('mv-goal-shake'), 600);
  }

  const player = id => (id != null && S.players.get(Number(id))) || null;
  const isHomeTeam = teamId => Number(teamId) === S.homeId;
  function teamFallback(teamId) { return { x: isHomeTeam(teamId) ? CX - 130 : CX + 130, y: CY, node: null }; }
  const actor = ev => player(ev.player_id) || teamFallback(ev.team_id);
  const attackedGoalX = teamId => isHomeTeam(teamId) ? RIGHT_GOAL_X : LEFT_GOAL_X;
  const ownGoalX = teamId => isHomeTeam(teamId) ? LEFT_GOAL_X : RIGHT_GOAL_X;
  const goalSide = x => x === LEFT_GOAL_X ? 'left' : 'right';

  // ── Event choreography ──────────────────────────────────────────────────────
  async function animateEvent(ev, speed = 1) {
    const dur = ms => Math.max(120, ms / speed);
    const t = ev.event_type;
    S.possTeam = isHomeTeam(ev.team_id) ? 'home' : 'away';
    ticker(`${ev.minute}′  ${ev.description || ''}`);

    if (t === 'buildup') {
      const a = actor(ev), b = player(ev.player2_id);
      await moveBall(at(a.node ? a : { x: a.x, y: a.y }), dur(300), 8);
      if (b) {
        highlight(a, 'mv-glow');
        await moveBall(at(b), dur(520), 26);
        highlight(b, 'mv-glow');
      } else if (a.node) {
        const dx = isHomeTeam(ev.team_id) ? 60 : -60;
        highlight(a, 'mv-glow');
        await Promise.all([moveTo(a, clampX(a.x + dx), a.y, dur(560)), moveBall({ x: clampX(a.x + dx) + (isHomeTeam(ev.team_id) ? 14 : -14), y: a.y }, dur(560), 6)]);
      }
      return;
    }

    if (t === 'goal' || t === 'own_goal') {
      const own = t === 'own_goal';
      const shooter = actor(ev);
      const gx = own ? ownGoalX(ev.team_id) : attackedGoalX(ev.team_id);
      const gy = CY + (Math.random() * 2 - 1) * (GOAL_HALF - 14);
      // A converted penalty arrives as a plain 'goal' event right after
      // 'penalty_awarded' (and its description says so) — stage it from the
      // spot, not as open play.
      const isPen = !own && (S.penaltyPending || /пенальти/i.test(ev.description || ''));
      S.penaltyPending = false;
      if (isPen) {
        const dir = goalSide(gx) === 'left' ? 1 : -1;
        const spotX = gx + dir * 88;
        // shooter walks up, ball placed on the spot, everyone waits…
        await Promise.all([moveBall({ x: spotX, y: CY }, dur(360), 8), moveTo(shooter, spotX + dir * 26, CY, dur(420))]);
        highlight(shooter, 'mv-glow');
        await sleep(dur(600)); // the run-up pause — penalty tension
        const corner = CY + (Math.random() < 0.5 ? -1 : 1) * (GOAL_HALF - 18);
        await moveBall({ x: gx + (dir === 1 ? -8 : 8), y: corner }, dur(240), 10);
        shakeGoal(goalSide(gx));
        confetti(gx, corner, isHomeTeam(ev.team_id) ? S.homeColor : S.awayColor);
        overlay(`<div class="mv-goal-txt pen">⚽ ПЕНАЛЬТИ ЗАБИТ!</div><div class="mv-goal-sub">${esc(shooter.name || '')}</div>`, 'mv-ov-goal', dur(1700));
        await sleep(dur(1150));
        await moveBall({ x: CX, y: CY }, dur(420), 30);
        return;
      }
      const assister = player(ev.player2_id);
      if (!own && assister && assister !== shooter) {
        await moveBall(at(assister), dur(300), 10); highlight(assister, 'mv-glow');
        await moveBall(at(shooter), dur(460), 22);
      } else {
        await moveBall(at(shooter), dur(320), 12);
      }
      highlight(shooter, own ? 'mv-glow-red' : 'mv-glow');
      if (shooter.node) await moveTo(shooter, clampX(shooter.x + (gx - shooter.x) * 0.12), shooter.y + (gy - shooter.y) * 0.12, dur(200));
      await moveBall({ x: gx + (goalSide(gx) === 'left' ? -8 : 8), y: gy }, dur(360), 18);
      shakeGoal(goalSide(gx));
      confetti(gx, gy, own ? '#e57373' : (isHomeTeam(ev.team_id) ? S.homeColor : S.awayColor));
      overlay(own ? `<div class="mv-goal-txt og">АВТОГОЛ</div>` :
        `<div class="mv-goal-txt">⚽ ГОЛ!</div><div class="mv-goal-sub">${esc(shooter.name || '')}</div>`, 'mv-ov-goal', dur(1700));
      await sleep(dur(1150));
      await moveBall({ x: CX, y: CY }, dur(420), 30);
      return;
    }

    if (t === 'save') {
      const gk = actor(ev);
      const gx = ownGoalX(ev.team_id), dir = goalSide(gx) === 'left' ? 1 : -1;
      const stopX = gx + dir * 26, stopY = CY + (Math.random() * 2 - 1) * (GOAL_HALF - 20);
      await moveBall({ x: CX + (gx - CX) * 0.45, y: CY + (Math.random() * 160 - 80) }, dur(300), 14);
      await Promise.all([moveBall({ x: stopX, y: stopY }, dur(340), 16), moveTo(gk, stopX, stopY, dur(500))]);
      highlight(gk, 'mv-glow-save');
      overlay(`<div class="mv-mini">🧤 Сейв!</div>`, 'mv-ov-mini', dur(1000));
      await moveBall({ x: gx + dir * 120, y: CY + (Math.random() * 200 - 100) }, dur(420), 30);
      return;
    }

    if (t === 'near_miss') {
      const shooter = actor(ev), gx = attackedGoalX(ev.team_id);
      const missY = CY + (GOAL_HALF + 26 + Math.random() * 60) * (Math.random() < 0.5 ? -1 : 1);
      await moveBall(at(shooter), dur(300), 10); highlight(shooter, 'mv-glow');
      await moveBall({ x: gx, y: missY }, dur(420), 34);
      overlay(`<div class="mv-mini">🎯 Мимо!</div>`, 'mv-ov-mini', dur(900));
      await moveBall({ x: gx + (goalSide(gx) === 'left' ? 90 : -90), y: CY + (Math.random() * 240 - 120) }, dur(360), 22);
      return;
    }

    if (t === 'corner_kick') {
      const taker = actor(ev), gx = attackedGoalX(ev.team_id);
      const cornerY = Math.random() < 0.5 ? FY + 6 : FY + FH - 6;
      const cornerX = gx === LEFT_GOAL_X ? FX + 6 : FX + FW - 6;
      if (taker.node) await Promise.all([moveTo(taker, cornerX, cornerY, dur(400)), moveBall({ x: cornerX, y: cornerY }, dur(400), 16)]);
      else await moveBall({ x: cornerX, y: cornerY }, dur(400), 16);
      await moveBall({ x: gx + (gx === LEFT_GOAL_X ? 80 : -80), y: CY }, dur(520), 48);
      return;
    }

    if (t === 'free_kick') {
      const taker = actor(ev), gx = attackedGoalX(ev.team_id);
      const spotX = CX + (gx - CX) * 0.55, spotY = CY + (Math.random() * 240 - 120);
      if (taker.node) await Promise.all([moveTo(taker, clampX(spotX - (gx > CX ? 22 : -22)), spotY, dur(380)), moveBall({ x: spotX, y: spotY }, dur(380), 14)]);
      else await moveBall({ x: spotX, y: spotY }, dur(380), 14);
      highlight(taker, 'mv-glow');
      overlay(`<div class="mv-mini">🟡 Штрафной</div>`, 'mv-ov-mini', dur(900));
      return;
    }

    if (t === 'penalty_awarded') {
      S.penaltyPending = true; // the next goal/penalty_miss is taken from the spot
      const gx = attackedGoalX(ev.team_id), dir = gx === LEFT_GOAL_X ? 1 : -1;
      await moveBall({ x: gx + dir * 88, y: CY }, dur(480), 18);
      overlay(`<div class="mv-mini">🚨 Пенальти!</div>`, 'mv-ov-mini', dur(1100));
      await sleep(dur(300));
      return;
    }

    if (t === 'penalty_miss') {
      S.penaltyPending = false;
      const gx = attackedGoalX(ev.team_id), dir = gx === LEFT_GOAL_X ? 1 : -1, shooter = actor(ev);
      await moveBall({ x: gx + dir * 88, y: CY }, dur(300), 8); highlight(shooter, 'mv-glow-red');
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
        if (t === 'red_card') { p.node.classList.add('mv-sent-off'); p.sentOff = true; }
      }
      overlay(`<div class="mv-mini">${t === 'red_card' ? '🟥 Красная карточка' : '🟨 Жёлтая карточка'}</div>`, 'mv-ov-mini', dur(1100));
      await sleep(dur(600));
      return;
    }

    if (t === 'injury') {
      highlight(actor(ev), 'mv-glow-red', 1500);
      overlay(`<div class="mv-mini">🚑 Травма</div>`, 'mv-ov-mini', dur(1000));
      await sleep(dur(450));
      return;
    }

    if (t === 'substitution') {
      const off = player(ev.player2_id);
      if (off && off.node) {
        const home = { hx: off.hx, hy: off.hy, x: off.x, y: off.y, zone: off.zone };
        await tween(dur(340), k => off.node.setAttribute('opacity', String(1 - k)));
        off.node.remove(); S.players.delete(Number(ev.player2_id));
        const nameM = (ev.description || '').match(/:\s*(.+?)\s+вместо/);
        const on = { id: Number(ev.player_id), name: ev.player_name || (nameM ? nameM[1] : '↑'), image_url: ev.player_image_url || null, shirt_number: null, zone: home.zone };
        drawPlayer(on, isHomeTeam(ev.team_id) ? S.homeColor : S.awayColor, isHomeTeam(ev.team_id));
        on.hx = home.hx; on.hy = home.hy; on.x = home.x; on.y = home.y; on.tx = home.x; on.ty = home.y;
        on.node.setAttribute('opacity', '0');
        await tween(dur(340), k => on.node.setAttribute('opacity', String(k)));
        S.players.set(on.id, on); highlight(on, 'mv-glow');
      }
      overlay(`<div class="mv-mini">🔄 Замена</div>`, 'mv-ov-mini', dur(900));
      return;
    }

    await sleep(dur(300));
  }

  // ── Queue: animate, THEN emit the feed line (order guarantee) ────────────────
  async function pump() {
    if (S.pumping) return;
    S.pumping = true;
    while (S.queue.length && !S.dead) {
      const speed = S.queue.length > 5 ? 2.4 : S.queue.length > 2 ? 1.5 : 1;
      const ev = S.queue.shift();
      S.eventActive = true;
      try { await animateEvent(ev, speed * (S.speed || 1)); } catch (e) { /* keep going */ }
      S.eventActive = false;
      try { S.onEvent && S.onEvent(ev); } catch (e) { /* caller feed error — ignore */ }
    }
    S.pumping = false;
  }

  window.MatchViz = {
    init(container, cfg) {
      this.destroy();
      Object.assign(S, { dead: false, queue: [], players: new Map(), pumping: false, eventActive: false, possTeam: 'home', speed: 1, penaltyPending: false });
      S.homeId = Number(cfg.homeId); S.awayId = Number(cfg.awayId);
      S.homeColor = cfg.homeColor || '#2e7d32';
      S.awayColor = cfg.awayColor || '#c62828';
      if (S.homeColor.toLowerCase() === S.awayColor.toLowerCase()) S.awayColor = '#c62828';
      S.onEvent = typeof cfg.onEvent === 'function' ? cfg.onEvent : null;

      container.innerHTML = '';
      S.wrap = document.createElement('div'); S.wrap.className = 'mv-wrap'; container.appendChild(S.wrap);
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
      S.tickerEl = document.createElement('div'); S.tickerEl.className = 'mv-ticker'; S.wrap.appendChild(S.tickerEl);
      startLoop();
    },

    playEvent(ev) {
      if (!S.svg || S.dead) return;
      if (S.queue.length > 10 && ev.event_type === 'buildup') return; // catch-up: drop filler
      S.queue.push(ev); pump();
    },

    async replay(events, hooks = {}) {
      if (!S.svg) return;
      this.stopReplay();
      S.replaying = true; S.speed = 1.35;
      for (const ev of events) {
        if (!S.replaying || S.dead) break;
        S.queue.push(ev); await pump();
      }
      S.speed = 1; S.replaying = false;
      if (hooks.onDone) hooks.onDone();
    },

    stopReplay() { S.replaying = false; if (S.queue) S.queue.length = 0; S.speed = 1; },
    isBusy() { return !!(S.pumping || (S.queue && S.queue.length)); },

    destroy() {
      S.dead = true; S.loopOn = false; S.replaying = false;
      if (S.raf) cancelAnimationFrame(S.raf);
      if (S.queue) S.queue.length = 0;
      if (S.wrap && S.wrap.parentNode) S.wrap.parentNode.removeChild(S.wrap);
      S.svg = S.wrap = S.tickerEl = S.ballG = null;
    },
  };
})();
