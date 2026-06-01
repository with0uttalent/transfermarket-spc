const express = require('express');
const { getDb } = require('../database/db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();

  const totalTeams = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
  const totalPlayers = db.prepare('SELECT COUNT(*) as count FROM players').get().count;
  const totalTransfers = db.prepare('SELECT COUNT(*) as count FROM transfers').get().count;
  const totalTransferValue = db.prepare('SELECT COALESCE(SUM(transfer_fee), 0) as total FROM transfers').get().total;
  const topPlayers = db.prepare(`
    SELECT p.id, p.name, p.position, p.market_value, p.image_url,
      t.name as team_name, co.flag_emoji
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN countries co ON p.nationality_id = co.id
    ORDER BY p.market_value DESC
    LIMIT 10
  `).all();

  const topTeams = db.prepare(`
    SELECT t.id, t.name, t.market_value, t.logo_url,
      co.flag_emoji, comp.name as competition_name
    FROM teams t
    LEFT JOIN countries co ON t.country_id = co.id
    LEFT JOIN competitions comp ON t.competition_id = comp.id
    ORDER BY t.market_value DESC
    LIMIT 10
  `).all();

  const recentTransfers = db.prepare(`
    SELECT tr.*,
      p.name as player_name, p.position, p.image_url as player_image,
      ft.name as from_team_name,
      tt.name as to_team_name
    FROM transfers tr
    JOIN players p ON tr.player_id = p.id
    LEFT JOIN teams ft ON tr.from_team_id = ft.id
    LEFT JOIN teams tt ON tr.to_team_id = tt.id
    ORDER BY tr.created_at DESC
    LIMIT 10
  `).all();

  res.json({
    totals: {
      teams: totalTeams,
      players: totalPlayers,
      transfers: totalTransfers,
      transfer_value: totalTransferValue,
    },
    top_players: topPlayers,
    top_teams: topTeams,
    recent_transfers: recentTransfers,
  });
});

router.get('/featured', (req, res) => {
  const db = getDb();
  const topRated = db.prepare(`
    SELECT p.id, p.name, p.position, p.image_url, p.market_value,
      t.name as team_name, AVG(pms.rating) as avg_rating, COUNT(pms.id) as matches_played
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    JOIN player_match_stats pms ON pms.player_id = p.id
    WHERE p.status = 'active'
    GROUP BY p.id
    HAVING matches_played >= 1
    ORDER BY avg_rating DESC
    LIMIT 1
  `).get();

  const topValue = db.prepare(`
    SELECT p.id, p.name, p.position, p.image_url, p.market_value,
      t.name as team_name
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    WHERE p.status = 'active' AND p.market_value > 0
    ORDER BY p.market_value DESC
    LIMIT 1
  `).get();

  const topTransfer = db.prepare(`
    SELECT tr.id, tr.transfer_fee, tr.transfer_date, tr.transfer_type,
      p.id as player_id, p.name as player_name, p.position, p.image_url as player_image,
      ft.name as from_team_name,
      tt.name as to_team_name, tt.id as to_team_id
    FROM transfers tr
    JOIN players p ON tr.player_id = p.id
    LEFT JOIN teams ft ON tr.from_team_id = ft.id
    LEFT JOIN teams tt ON tr.to_team_id = tt.id
    WHERE tr.transfer_fee > 0 AND tr.transfer_type = 'permanent'
    ORDER BY tr.transfer_fee DESC
    LIMIT 1
  `).get();

  // Top upcoming matches: future scheduled league matches ranked by combined team market value
  const topMatches = db.prepare(`
    SELECT m.id, m.match_date, m.match_time,
      ht.id as home_team_id, ht.name as home_team_name, ht.logo_url as home_logo,
      ht.market_value as home_mv,
      at.id as away_team_id, at.name as away_team_name, at.logo_url as away_logo,
      at.market_value as away_mv,
      (COALESCE(ht.market_value,0) + COALESCE(at.market_value,0)) as combined_value
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.id
    JOIN teams at ON m.away_team_id = at.id
    WHERE m.status = 'scheduled'
      AND m.league_id IS NOT NULL
      AND m.match_date >= date('now')
    ORDER BY combined_value DESC, m.match_date ASC, m.match_time ASC
    LIMIT 2
  `).all();

  const totalPlayers = db.prepare("SELECT COUNT(*) as c FROM players WHERE status='active'").get().c;
  const totalTeams   = db.prepare('SELECT COUNT(*) as c FROM teams').get().c;

  res.json({
    topRated: topRated || null,
    topValue: topValue || null,
    topTransfer: topTransfer || null,
    topMatches,
    totalPlayers,
    totalTeams,
  });
});

module.exports = router;
