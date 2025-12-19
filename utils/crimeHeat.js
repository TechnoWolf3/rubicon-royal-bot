// utils/crimeHeat.js
const { pool } = require("./db");

/*
  Crime Heat — Progressive Decay (NO DB MIGRATIONS)

  Heat decays when READ, based on remaining TTL
  relative to a 12-hour decay window.
*/

// 🔥 Progressive decay window (tuning knob)
const MAX_DECAY_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

async function getCrimeHeat(guildId, userId) {
  const res = await pool.query(
    `
    SELECT heat, expires_at
    FROM crime_heat
    WHERE guild_id = $1 AND user_id = $2
    `,
    [guildId, userId]
  );

  if (res.rowCount === 0) return 0;

  const heat = Number(res.rows[0].heat) || 0;
  const expiresAt = new Date(res.rows[0].expires_at);
  const now = Date.now();

  // Expired → delete + reset
  if (now >= expiresAt.getTime()) {
    await pool.query(
      `DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId]
    );
    return 0;
  }

  const remainingMs = expiresAt.getTime() - now;

  // Progressive decay factor (0 → 1)
  const decayFactor = Math.min(1, remainingMs / MAX_DECAY_WINDOW_MS);

  return Math.max(0, Math.round(heat * decayFactor));
}

async function setCrimeHeat(guildId, userId, heat, ttlMinutes) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await pool.query(
    `
    INSERT INTO crime_heat (guild_id, user_id, heat, expires_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
      heat = EXCLUDED.heat,
      expires_at = EXCLUDED.expires_at
    `,
    [guildId, userId, Math.max(0, Math.min(100, heat)), expiresAt]
  );
}

function heatTTLMinutesForOutcome(outcome, { identified = false } = {}) {
  const base = {
    clean: 60,
    spotted: 120,
    partial: 180,
    busted: 240,
    busted_hard: 360,
  };

  let ttl = base[outcome] ?? 120;
  if (identified) ttl += 60;
  return ttl;
}

module.exports = {
  getCrimeHeat,
  setCrimeHeat,
  heatTTLMinutesForOutcome,
};
