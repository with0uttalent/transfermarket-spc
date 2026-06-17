'use strict';

// ─── Betting engine ───────────────────────────────────────────────────────────
// Parimutuel-style 1X2 betting on league matches with locked odds.
//
// • Three outcomes per match: 'home' (П1), 'draw' (X), 'away' (П2).
// • Odds are derived from how much money sits on each outcome, seeded by team
//   strength (OVR) so the market is realistic even before anyone bets.
// • When a coach places a bet, the odd is computed from the current pool
//   (including the effect of their own stake) and LOCKED for that bet.
// • Stake is debited from the team's free transfer budget immediately.
// • On settlement, winners are paid stake × locked-odd; losers forfeit stakes.

const SEED_TOTAL = 3000000;   // virtual liquidity (€3M) used only to seed odds
const MIN_ODD    = 1.05;
const MAX_ODD    = 15.0;
const HOME_ADV   = 3;         // home advantage, in OVR points
const MIN_BET    = 50000;     // €50k minimum stake
const VALID_OUTCOMES = ['home', 'draw', 'away'];

// Bets open only once the coaches' lineups are locked — i.e. from
// LINEUP_LOCK_HOURS before kickoff until the match starts. Must match the
// value used in routes/lineups.js.
const LINEUP_LOCK_HOURS = 12;

// SQLite expression for a match's kickoff datetime (local wall-clock).
const KICKOFF_SQL = `datetime(m.match_date || ' ' || COALESCE(substr(m.match_time,1,5),'16:00') || ':00')`;

// ─── Positional model (mirrors the frontend / match engine) ───────────────────
// A player fielded out of his natural zone is less effective. The penalty factor
// scales his OVR; this is what makes the lineup's SHAPE matter for the odds, and
// captures "missing position" gaps (an out-of-position filler is penalised).
const ZONE_PENALTY = {
  GK:  { GK:1.00, DEF:0.80, DMF:0.65, MID:0.55, AMF:0.50, FWD:0.45 },
  DEF: { GK:0.80, DEF:1.00, DMF:0.88, MID:0.75, AMF:0.65, FWD:0.55 },
  DMF: { GK:0.65, DEF:0.88, DMF:1.00, MID:0.90, AMF:0.80, FWD:0.68 },
  MID: { GK:0.55, DEF:0.75, DMF:0.90, MID:1.00, AMF:0.90, FWD:0.75 },
  AMF: { GK:0.50, DEF:0.65, DMF:0.80, MID:0.90, AMF:1.00, FWD:0.88 },
  FWD: { GK:0.45, DEF:0.55, DMF:0.68, MID:0.75, AMF:0.88, FWD:1.00 },
};
const ALL_ZONES = ['GK', 'DEF', 'DMF', 'MID', 'AMF', 'FWD'];

function posToZone(position) {
  if (!position) return 'MID';
  if (position === 'Goalkeeper') return 'GK';
  if (['Centre-Back', 'Left-Back', 'Right-Back'].includes(position)) return 'DEF';
  if (position === 'Defensive Midfield') return 'DMF';
  if (position === 'Central Midfield') return 'MID';
  if (['Attacking Midfield', 'Left Winger', 'Right Winger'].includes(position)) return 'AMF';
  if (['Centre-Forward', 'Striker'].includes(position)) return 'FWD';
  return 'MID';
}

// position_override stores a pitch-slot id like "FWD-1"; extract its zone.
function overrideZone(override) {
  if (!override) return null;
  const z = String(override).split('-')[0];
  return ALL_ZONES.includes(z) ? z : null;
}

function positionPenalty(naturalZone, assignedZone) {
  if (!assignedZone || assignedZone === naturalZone) return 1.0;
  return (ZONE_PENALTY[naturalZone] || {})[assignedZone] ?? 0.70;
}

// Average effective OVR of a team's STARTING XI — the same eleven the simulator
// fields, scaled by positional penalties so the lineup's shape affects the odds.
// Falls back to an auto-best-XI only when no real lineup is set.
function teamOvr(db, teamId) {
  const starters = db.prepare(`
    SELECT COALESCE(p.ovr_fixed, 65) AS ovr, p.position, tl.position_override
    FROM team_lineups tl JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ? AND tl.slot BETWEEN 1 AND 11 AND p.status = 'active'
  `).all(teamId);
  // Trust the set starting XI once it's mostly filled (≥7 of 11).
  if (starters.length >= 7) {
    const sum = starters.reduce((a, r) => {
      const natural = posToZone(r.position);
      const assigned = overrideZone(r.position_override) || natural;
      return a + r.ovr * positionPenalty(natural, assigned);
    }, 0);
    return sum / starters.length;
  }
  // No real lineup set → estimate the XI the team would realistically field.
  const auto = db.prepare(`
    SELECT COALESCE(ovr_fixed, 65) AS ovr FROM players
    WHERE team_id = ? AND status = 'active'
    ORDER BY ovr_fixed DESC LIMIT 11
  `).all(teamId);
  if (!auto.length) return 65;
  return auto.reduce((a, r) => a + r.ovr, 0) / auto.length;
}

// Base outcome probabilities from team strengths (sums to 1).
function baseProbabilities(db, homeTeamId, awayTeamId) {
  const oh = teamOvr(db, homeTeamId) + HOME_ADV;
  const oa = teamOvr(db, awayTeamId);
  const eh = Math.pow(10, oh / 20);
  const ea = Math.pow(10, oa / 20);
  let pHome = eh / (eh + ea);
  let pAway = ea / (eh + ea);
  const closeness = 1 - Math.abs(pHome - pAway);        // 1 when teams are equal
  const pDraw = 0.23 + 0.05 * closeness;                 // ~0.23 … 0.28 (home win stays favourite)
  pHome *= (1 - pDraw);
  pAway *= (1 - pDraw);
  return { home: pHome, draw: pDraw, away: pAway };
}

// Confirmed money on each outcome for a match.
function getPools(db, matchId) {
  const rows = db.prepare(
    `SELECT outcome, COALESCE(SUM(amount),0) AS s FROM bets WHERE match_id=? AND status='open' GROUP BY outcome`
  ).all(matchId);
  const pools = { home: 0, draw: 0, away: 0 };
  for (const r of rows) pools[r.outcome] = r.s;
  return pools;
}

function seededValues(db, match, extraOutcome = null, extraAmount = 0) {
  const probs = baseProbabilities(db, match.home_team_id, match.away_team_id);
  const pools = getPools(db, match.id);
  const v = {
    home: pools.home + SEED_TOTAL * probs.home,
    draw: pools.draw + SEED_TOTAL * probs.draw,
    away: pools.away + SEED_TOTAL * probs.away,
  };
  if (extraOutcome) v[extraOutcome] += extraAmount;
  return { v, pools };
}

const clampOdd = o => Math.min(MAX_ODD, Math.max(MIN_ODD, o));

// Current displayed odds + pool state for a match (no new stake).
function currentOdds(db, match) {
  const { v, pools } = seededValues(db, match);
  const total = v.home + v.draw + v.away;
  return {
    home: +clampOdd(total / v.home).toFixed(2),
    draw: +clampOdd(total / v.draw).toFixed(2),
    away: +clampOdd(total / v.away).toFixed(2),
    pools,
    total_pool: pools.home + pools.draw + pools.away,
  };
}

// Locked odd for a stake of `amount` on `outcome` (includes own-stake effect).
function quoteOdd(db, match, outcome, amount) {
  const { v } = seededValues(db, match, outcome, amount);
  const total = v.home + v.draw + v.away;
  return +clampOdd(total / v[outcome]).toFixed(2);
}

// Free budget available for betting (mirrors auction commitment logic).
function availableBudget(db, teamId) {
  const team = db.prepare('SELECT transfer_budget, transfer_budget_spent FROM teams WHERE id=?').get(teamId);
  const available = (team?.transfer_budget || 10000000) - (team?.transfer_budget_spent || 0);
  const { committed } = db.prepare(
    `SELECT COALESCE(SUM(current_bid),0) AS committed FROM fa_auctions WHERE status='active' AND bidder_team_id=?`
  ).get(teamId);
  return Math.max(0, available - committed);
}

// Matches currently open for betting, with live odds. Shared by the web
// betting page (routes/bets.js) and the Telegram bot.
function listBettableMatches(db) {
  const matches = db.prepare(`
    SELECT m.id, m.home_team_id, m.away_team_id, m.match_date, m.match_time, m.matchday, m.league_id,
           ht.name AS home_team_name, ht.logo_url AS home_logo,
           at.name AS away_team_name, at.logo_url AS away_logo,
           lg.name AS league_name
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    LEFT JOIN leagues lg ON m.league_id = lg.id
    WHERE m.status = 'scheduled' AND m.league_id IS NOT NULL
      AND ${KICKOFF_SQL} > datetime('now','localtime')
      AND ${KICKOFF_SQL} <= datetime('now','localtime','+${LINEUP_LOCK_HOURS} hours')
    ORDER BY m.match_date ASC, m.match_time ASC
    LIMIT 60
  `).all();
  return matches.map(m => ({ ...m, odds: currentOdds(db, m) }));
}

// Validate and place a bet for a coach. Shared by the web betting route
// (routes/bets.js) and the Telegram bot, so both enforce identical rules.
function placeBet(db, coach, matchId, outcome, rawAmount) {
  if (!coach.team_id) return { error: 'У вас нет команды для ставок' };
  if (!VALID_OUTCOMES.includes(outcome)) return { error: 'Неверный исход' };

  const amount = Math.round(Number(rawAmount));
  if (!Number.isFinite(amount) || amount < MIN_BET) {
    return { error: `Минимальная ставка — ${MIN_BET.toLocaleString()} €` };
  }

  const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(matchId);
  if (!match) return { error: 'Матч не найден' };
  if (match.status !== 'scheduled') return { error: 'Ставки на этот матч закрыты' };
  if (!match.league_id) return { error: 'Ставки доступны только на матчи лиги' };

  const kickoff = new Date(`${match.match_date}T${(match.match_time || '16:00').slice(0, 5)}:00`);
  const now = new Date();
  if (!isNaN(kickoff.getTime())) {
    if (now >= kickoff) return { error: 'Матч уже начался — ставки закрыты' };
    const opensAt = new Date(kickoff.getTime() - LINEUP_LOCK_HOURS * 3600 * 1000);
    if (now < opensAt) {
      const opens = opensAt.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return { error: `Ставки откроются после блокировки составов — за ${LINEUP_LOCK_HOURS} ч до матча (с ${opens}).` };
    }
  }

  // No arbitrage: can't bet on a different outcome of a match you've already
  // bet on (only the same outcome may be topped up).
  const existing = db.prepare(
    `SELECT DISTINCT outcome FROM bets WHERE match_id=? AND coach_id=? AND status='open'`
  ).all(matchId, coach.id);
  if (existing.some(b => b.outcome !== outcome)) {
    const label = { home: 'победу хозяев', draw: 'ничью', away: 'победу гостей' };
    return { error: `Вы уже поставили на ${label[existing[0].outcome]} в этом матче. Ставить на другой исход нельзя.` };
  }

  const free = availableBudget(db, coach.team_id);
  if (amount > free) {
    return { error: `Недостаточно средств. Доступно: ${Math.round(free).toLocaleString()} €` };
  }

  const odds = currentOdds(db, match)[outcome];

  db.transaction(() => {
    db.prepare(`INSERT INTO bets (match_id, coach_id, team_id, outcome, amount, odds) VALUES (?,?,?,?,?,?)`)
      .run(matchId, coach.id, coach.team_id, outcome, amount, odds);
    db.prepare(`UPDATE teams SET transfer_budget_spent = transfer_budget_spent + ? WHERE id=?`)
      .run(amount, coach.team_id);
  })();

  return { ok: true, odds, potential_payout: Math.round(amount * odds), free_budget: availableBudget(db, coach.team_id) };
}

// Settle all open bets on a finished match. `match` needs id, team ids, scores.
function settleBetsForMatch(db, match) {
  const open = db.prepare(`SELECT * FROM bets WHERE match_id=? AND status='open'`).all(match.id);
  if (!open.length) return;

  let result;
  if (match.home_score > match.away_score) result = 'home';
  else if (match.home_score < match.away_score) result = 'away';
  else result = 'draw';

  const outcomeLabel = { home: 'победу хозяев', draw: 'ничью', away: 'победу гостей' };
  const fmtV = v => v >= 1e6 ? '€' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '€' + Math.round(v / 1e3) + 'K' : '€' + Math.round(v);
  const tgMessages = []; // sent after the transaction commits

  db.transaction(() => {
    for (const b of open) {
      const coach = db.prepare('SELECT id, telegram_chat_id FROM coaches WHERE id=?').get(b.coach_id);
      if (b.outcome === result) {
        const payout = Math.round(b.amount * b.odds);
        db.prepare(`UPDATE bets SET status='won', payout=?, settled_at=CURRENT_TIMESTAMP WHERE id=?`).run(payout, b.id);
        // Return stake + profit to the team's transfer budget.
        db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent - ? WHERE id=?').run(payout, b.team_id);
        if (coach) {
          const text = `Ваша ставка на ${outcomeLabel[b.outcome]} (кэф ${b.odds}) принесла ${fmtV(payout)} (ставка ${fmtV(b.amount)}).`;
          db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
            b.coach_id, '✅ Ставка сыграла!', text, 'success'
          );
          if (coach.telegram_chat_id) tgMessages.push({ chatId: coach.telegram_chat_id, text: `✅ <b>Ставка сыграла!</b>\n${text}` });
        }
      } else {
        db.prepare(`UPDATE bets SET status='lost', payout=0, settled_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.id);
        if (coach) {
          const text = `Ваша ставка ${fmtV(b.amount)} на ${outcomeLabel[b.outcome]} не сыграла. Итог матча: ${outcomeLabel[result]}.`;
          db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
            b.coach_id, '❌ Ставка не сыграла', text, 'warning'
          );
          if (coach.telegram_chat_id) tgMessages.push({ chatId: coach.telegram_chat_id, text: `❌ <b>Ставка не сыграла</b>\n${text}` });
        }
      }
    }
  })();

  if (tgMessages.length) {
    const { sendDirectMessage } = require('./telegramBot');
    for (const m of tgMessages) sendDirectMessage(m.chatId, m.text).catch(() => {});
  }
}

// Safety-net sweeper: settle any open bets whose match is already finished but
// wasn't settled (e.g. finished via a path that skipped settlement, or before
// the settlement hook existed). Idempotent — only touches status='open' bets.
function settleOrphanedBets(db) {
  const stuck = db.prepare(`
    SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score
    FROM matches m
    WHERE m.status='finished'
      AND EXISTS (SELECT 1 FROM bets b WHERE b.match_id=m.id AND b.status='open')
  `).all();
  let settled = 0;
  for (const m of stuck) {
    try { settleBetsForMatch(db, m); settled++; }
    catch (e) { console.warn('[Betting] orphaned-bet settle error (match ' + m.id + '):', e.message); }
  }
  if (settled) console.log(`[Betting] Settled orphaned bets for ${settled} finished match(es)`);
  return settled;
}

module.exports = {
  currentOdds, quoteOdd, settleBetsForMatch, settleOrphanedBets, availableBudget, baseProbabilities,
  listBettableMatches, placeBet,
  MIN_BET, MIN_ODD, MAX_ODD, VALID_OUTCOMES, LINEUP_LOCK_HOURS,
};
