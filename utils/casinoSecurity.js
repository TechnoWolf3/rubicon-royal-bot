// utils/casinoSecurity.js
// Casino Security (Rolling 24h net casino profit → tiered table fee)
//
// Uses your existing transaction types:
// - blackjack_*
// - roulette_*
//
// Requirements:
// - transactions table has: guild_id, user_id, amount (signed), type, created_at
// - user transactions record wins as +amount and losses as -amount (your economy.js does this)

function getPool() {
  // supports either module.exports = { pool } OR module.exports = pool
  // eslint-disable-next-line global-require
  const dbMod = require("./db");
  const pool = dbMod?.pool ?? dbMod;

  if (!pool || typeof pool.query !== "function") {
    throw new TypeError(
      "[casinoSecurity] DB pool not available. Ensure utils/db.js exports { pool } (or a pool with query())."
    );
  }
  return pool;
}

/**
 * Single source of truth config — change here anytime.
 * Add new casino games by adding a prefix to typePrefixes.
 */
const CASINO_SECURITY = Object.freeze({
  windowHours: 24,

  // ✅ Match your current economy transaction type names:
  typePrefixes: ["blackjack_", "roulette_"],

  // Placeholders — edit freely
  // Rule: pick the highest tier whose minNetProfit <= netProfit24h
  tiers: [
    { level: 0, label: "Normal", minNetProfit: 0, feePct: 0.0 },
    { level: 1, label: "Watched", minNetProfit: 50_000, feePct: 0.02 },
    { level: 2, label: "Tight", minNetProfit: 150_000, feePct: 0.04 },
    { level: 3, label: "High Risk", minNetProfit: 300_000, feePct: 0.06 },
    { level: 4, label: "Lockdown", minNetProfit: 600_000, feePct: 0.08 },
  ],

  // Safety rails (prevents accidental nuking via config)
  minFeePct: 0.0,
  maxFeePct: 0.25, // 25% hard cap
});

function clampPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return CASINO_SECURITY.minFeePct;
  return Math.max(CASINO_SECURITY.minFeePct, Math.min(CASINO_SECURITY.maxFeePct, n));
}

function pctToText(pct) {
  return `${Math.round(clampPct(pct) * 100)}%`;
}

function getTierForNetProfit(netProfit24h) {
  const net = Number(netProfit24h) || 0;
  const tiers = [...CASINO_SECURITY.tiers].sort(
    (a, b) => Number(a.minNetProfit) - Number(b.minNetProfit)
  );

  let chosen = tiers[0] ?? { level: 0, label: "Normal", minNetProfit: 0, feePct: 0.0 };

  for (const t of tiers) {
    if (net >= Number(t.minNetProfit)) chosen = t;
    else break;
  }

  return {
    level: Number(chosen.level) || 0,
    label: String(chosen.label ?? "Normal"),
    feePct: clampPct(chosen.feePct),
  };
}

function buildTypePrefixWhereClause(prefixes) {
  const clean = (prefixes || [])
    .map((p) => String(p || "").trim())
    .filter(Boolean);

  if (clean.length === 0) {
    // If misconfigured, match nothing (safer than matching everything)
    return { whereSql: "FALSE", params: [] };
  }

  const clauses = clean.map((_, idx) => `type LIKE $${idx + 1}`);
  const params = clean.map((p) => `${p}%`);
  return { whereSql: `(${clauses.join(" OR ")})`, params };
}

/**
 * Internal: get user's casino net profit over rolling window.
 * Returns number (can be negative).
 */
async function getCasinoNetProfitRolling(guildId, userId) {
  const pool = getPool();
  const hours = Number(CASINO_SECURITY.windowHours) || 24;

  const { whereSql, params } = buildTypePrefixWhereClause(CASINO_SECURITY.typePrefixes);

  // params: the LIKE patterns for prefixes; add guildId/userId/hours after
  // We'll place guildId/userId/hours first for clarity.
  const values = [guildId, userId, String(hours), ...params];

  // guildId = $1, userId = $2, hours = $3, prefix patterns start at $4...
  // NOTE: We include only user_id = $2 so bank-only rows (user_id NULL) are excluded automatically.
  const { rows } = await pool.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS net
    FROM transactions
    WHERE guild_id = $1
      AND user_id  = $2
      AND created_at >= NOW() - ($3 || ' hours')::interval
      AND ${whereSql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 3}`)}
    `,
    values
  );

  return Number(rows?.[0]?.net ?? 0);
}

/**
 * Public: get user's current security (rolling 24h)
 * Does NOT expose net profit
 */
async function getUserCasinoSecurity(guildId, userId) {
  const net = await getCasinoNetProfitRolling(guildId, userId);
  return getTierForNetProfit(net);
}

/**
 * Public: snapshot host base security at table start (lock this in your table state)
 */
async function getHostBaseSecurity(guildId, hostUserId) {
  return getUserCasinoSecurity(guildId, hostUserId);
}

/**
 * Rule: fee per bet is max(player fee NOW, host base fee LOCKED)
 */
function getEffectiveFeePct({ playerFeePct, hostBaseFeePct }) {
  const p = clampPct(playerFeePct);
  const h = clampPct(hostBaseFeePct);
  return Math.max(p, h);
}

/**
 * Fee is additional charge on top of bet
 * Example: bet=100k, pct=0.1 => fee=10k, total=110k
 */
function computeFeeForBet(betAmount, feePct) {
  const bet = Math.max(0, Number(betAmount) || 0);
  const pct = clampPct(feePct);

  const fee = pct > 0 ? Math.max(1, Math.ceil(bet * pct)) : 0;
  const totalCharge = bet + fee;

  return { betAmount: bet, feePct: pct, feeAmount: fee, totalCharge };
}

/**
 * Plain-text level change messages (no @mention).
 * Call this only when you detect a change vs lastKnownState.
 */
function formatSecurityLevelChangeMessage(displayName, oldState, newState) {
  const name = String(displayName ?? "Unknown");

  if (!oldState) return `Casino Security is now active for ${name} — Level ${newState.level} (${pctToText(newState.feePct)} table fee).`;
  if (newState.level > oldState.level) return `Casino Security has increased for ${name} — Level ${newState.level} (${pctToText(newState.feePct)} table fee).`;
  if (newState.level < oldState.level) return `Casino Security has decreased for ${name} — Level ${newState.level} (${pctToText(newState.feePct)} table fee).`;

  return null;
}

/**
 * Optional: embed helper lines (no profit shown)
 */
function formatSecurityEmbedLines({ hostBaseState } = {}) {
  const lines = [];
  if (hostBaseState) {
    lines.push(`🛡️ **Casino Security (Host Base):** Level ${hostBaseState.level} — **${pctToText(hostBaseState.feePct)}**`);
  } else {
    lines.push(`🛡️ **Casino Security:** Enabled`);
  }

  lines.push(`Table fee per bet is the higher of your personal security and the host base. (Fee is an additional charge and goes to the bank.)`);
  return lines;
}

module.exports = {
  CASINO_SECURITY,

  // state
  getUserCasinoSecurity,
  getHostBaseSecurity,

  // fee
  getEffectiveFeePct,
  computeFeeForBet,

  // UI helpers
  formatSecurityLevelChangeMessage,
  formatSecurityEmbedLines,
};
