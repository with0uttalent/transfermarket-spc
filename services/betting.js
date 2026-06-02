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

// Average OVR of a team's STARTING XI — the same eleven the simulator fields.
// Odds must reflect who actually starts, not the whole squad. We only fall back
// to an auto-best-XI when the coach hasn't set a (near-)complete lineup at all.
function teamOvr(db, teamId) {
  const starters = db.prepare(`
    SELECT COALESCE(p.ovr_fixed, 65) AS ovr
    FROM team_lineups tl JOIN players p ON tl.player_id = p.id
    WHERE tl.team_id = ? AND tl.slot BETWEEN 1 AND 11 AND p.status = 'active'
  `).all(teamId);
  // Trust the set starting XI once it's mostly filled (≥7 of 11).
  if (starters.length >= 7) {
    return starters.reduce((a, r) => a + r.ovr, 0) / starters.length;
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

  db.transaction(() => {
    for (const b of open) {
      const coach = db.prepare('SELECT id FROM coaches WHERE id=?').get(b.coach_id);
      if (b.outcome === result) {
        const payout = Math.round(b.amount * b.odds);
        db.prepare(`UPDATE bets SET status='won', payout=?, settled_at=CURRENT_TIMESTAMP WHERE id=?`).run(payout, b.id);
        // Return stake + profit to the team's transfer budget.
        db.prepare('UPDATE teams SET transfer_budget_spent = transfer_budget_spent - ? WHERE id=?').run(payout, b.team_id);
        if (coach) {
          db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
            b.coach_id, '✅ Ставка сыграла!',
            `Ваша ставка на ${outcomeLabel[b.outcome]} (кэф ${b.odds}) принесла ${fmtV(payout)} (ставка ${fmtV(b.amount)}).`,
            'success'
          );
        }
      } else {
        db.prepare(`UPDATE bets SET status='lost', payout=0, settled_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.id);
        if (coach) {
          db.prepare(`INSERT INTO coach_notifications (coach_id, title, body, type) VALUES (?,?,?,?)`).run(
            b.coach_id, '❌ Ставка не сыграла',
            `Ваша ставка ${fmtV(b.amount)} на ${outcomeLabel[b.outcome]} не сыграла. Итог матча: ${outcomeLabel[result]}.`,
            'warning'
          );
        }
      }
    }
  })();
}

module.exports = {
  currentOdds, quoteOdd, settleBetsForMatch, availableBudget, baseProbabilities,
  MIN_BET, MIN_ODD, MAX_ODD,
};
