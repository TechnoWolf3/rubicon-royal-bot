// utils/crimeHeat.js
const { pool } = require("./db");

/**
 * Crime Heat — Progressive decay WITHOUT DB migrations
 *
 * DB table expected:
 * crime_heat(guild_id, user_id, heat, expires_at)
 *
 * Heat is stored as a raw number + expiry time.
 * On READ we compute a "decayed" heat value based on time remaining.
 *
 * This file adds:
 *  - getCrimeHeatInfo(): returns decayed heat + expires_at (for UI)
 * While preserving:
 *  - getCrimeHeat(): returns just decayed heat (existing callers)
 *  - setCrimeHeat()
 *  - heatTTLMinutesForOutcome()
 */

// 🔥 TUNING KNOB: smaller = heat feels like it cools faster
// User preference: 12 hours
const MAX_DECAY_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Returns rich info for UI:
 * { heat, rawHeat, expiresAt, remainingMs }
 */
async function getCrimeHeatInfo(guildId, userId) {
  const res = await pool.query(
    `
    SELECT heat, expires_at
    FROM crime_heat
    WHERE guild_id = $1 AND user_id = $2
    `,
    [guildId, userId]
  );

  if (res.rowCount === 0) {
    return { heat: 0, rawHeat: 0, expiresAt: null, remainingMs: 0 };
  }

  const rawHeat = clamp(Number(res.rows[0].heat) || 0, 0, 100);
  const expiresAt = new Date(res.rows[0].expires_at);
  const now = Date.now();

  const expMs = expiresAt.getTime();

  // Bad date in DB? Fail safe: treat as no heat.
  if (Number.isNaN(expMs)) {
    // attempt cleanup so it doesn't keep causing weirdness
    await pool
      .query(`DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`, [guildId, userId])
      .catch(() => {});
    return { heat: 0, rawHeat: 0, expiresAt: null, remainingMs: 0 };
  }

  // Expired → delete row and return 0
  if (now >= expMs) {
    await pool
      .query(`DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`, [guildId, userId])
      .catch(() => {});
    return { heat: 0, rawHeat: 0, expiresAt: null, remainingMs: 0 };
  }

  const remainingMs = expMs - now;

  // Progressive decay:
  // decayedHeat = rawHeat * (remaining / window)
  // (clamped so it never rises above rawHeat)
  const decayFactor = Math.min(1, remainingMs / MAX_DECAY_WINDOW_MS);
  const heat = clamp(Math.round(rawHeat * decayFactor), 0, 100);

  return { heat, rawHeat, expiresAt, remainingMs };
}

/**
 * Backwards compatible: return the decayed heat number only.
 */
async function getCrimeHeat(guildId, userId) {
  const info = await getCrimeHeatInfo(guildId, userId);
  return info.heat;
}

/**
 * Set/refresh heat and expiry.
 * heat is clamped to 0..100.
 */
async function setCrimeHeat(guildId, userId, heat, ttlMinutes) {
  const expiresAt = new Date(Date.now() + (Number(ttlMinutes) || 0) * 60 * 1000);

  await pool.query(
    `
    INSERT INTO crime_heat (guild_id, user_id, heat, expires_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
      heat = EXCLUDED.heat,
      expires_at = EXCLUDED.expires_at
    `,
    [guildId, userId, clamp(Number(heat) || 0, 0, 100), expiresAt]
  );
}

/**
 * Store Robbery TTL helper (kept as-is for non-heist crimes).
 * (Heists currently use a separate TTL map in job.js — fine.)
 */
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
  getCrimeHeatInfo, // ✅ NEW for job.js heat bar/timer UI
  getCrimeHeat,
  setCrimeHeat,
  heatTTLMinutesForOutcome,
};
