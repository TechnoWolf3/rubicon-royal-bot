// utils/economy.js
// Central money movement utilities.
// NOW ALSO: updates achievement counters + unlocks economy achievements where appropriate.

const { pool } = require("./db");
const achievementEngine = require("./achievementEngine");
const achievementProgress = require("./achievementProgress");

// --- Internal: ensure counter tables once per process ---
let _countersReady = false;
async function ensureCountersReady() {
  if (_countersReady) return;
  try {
    await achievementProgress.ensureCounterTables(pool);
    _countersReady = true;
  } catch (e) {
    // Achievements must never break economy. Log and continue.
    console.warn("[ECON][ACH] ensureCounterTables failed:", e?.message || e);
  }
}

async function safeUnlock(guildId, userId, achievementId) {
  try {
    await achievementEngine.unlockAchievement({
      db: pool,
      guildId,
      userId,
      achievementId,
    });
  } catch (e) {
    console.warn("[ECON][ACH] unlock failed:", achievementId, e?.message || e);
  }
}

async function safeIncAndCheck({ guildId, userId, key, delta }) {
  await ensureCountersReady();
  try {
    const val = await achievementProgress.incCounter(pool, guildId, userId, key, delta);
    await achievementProgress.checkAndUnlockProgressAchievements({
      db: pool,
      guildId,
      userId,
      key,
      currentValue: val,
    });
    return val;
  } catch (e) {
    console.warn("[ECON][ACH] incCounter failed:", key, e?.message || e);
    return null;
  }
}

async function safeMaxAndCheck({ guildId, userId, key, candidate }) {
  await ensureCountersReady();
  try {
    const val = await achievementProgress.maxCounter(pool, guildId, userId, key, candidate);
    await achievementProgress.checkAndUnlockProgressAchievements({
      db: pool,
      guildId,
      userId,
      key,
      currentValue: val,
    });
    return val;
  } catch (e) {
    console.warn("[ECON][ACH] maxCounter failed:", key, e?.message || e);
    return null;
  }
}

async function trackCredit({ guildId, userId, amount, newBalance }) {
  // Progress counters
  const credits = await safeIncAndCheck({ guildId, userId, key: "economy_credits", delta: 1 });
  await safeIncAndCheck({ guildId, userId, key: "economy_transactions", delta: 1 });

  await safeMaxAndCheck({ guildId, userId, key: "economy_max_credit", candidate: amount });
  await safeMaxAndCheck({ guildId, userId, key: "economy_max_balance", candidate: newBalance });

  // Event-style unlocks
  if (credits === 1) await safeUnlock(guildId, userId, "eco_first_coin");
}

async function trackDebit({ guildId, userId, amount, newBalance }) {
  const debits = await safeIncAndCheck({ guildId, userId, key: "economy_debits", delta: 1 });
  await safeIncAndCheck({ guildId, userId, key: "economy_transactions", delta: 1 });

  await safeMaxAndCheck({ guildId, userId, key: "economy_max_debit", candidate: amount });
  await safeMaxAndCheck({ guildId, userId, key: "economy_max_balance", candidate: newBalance });

  if (debits === 1) await safeUnlock(guildId, userId, "eco_first_spend");
  if (Number(newBalance) === 0) await safeUnlock(guildId, userId, "eco_broke");
}

// Ensure guild exists
async function ensureGuild(guildId) {
  await pool.query(
    `INSERT INTO guilds (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );
}

// Ensure user exists
async function ensureUser(guildId, userId) {
  await ensureGuild(guildId);
  await pool.query(
    `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function getBalance(guildId, userId) {
  await ensureUser(guildId, userId);
  const res = await pool.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  return Number(res.rows[0]?.balance ?? 0);
}

async function getServerBank(guildId) {
  await ensureGuild(guildId);
  const res = await pool.query(
    `SELECT bank_balance FROM guilds WHERE guild_id=$1`,
    [guildId]
  );
  return Number(res.rows[0]?.bank_balance ?? 0);
}

/**
 * Debit user only if they have enough.
 * Returns { ok:true, newBalance } or { ok:false }
 */
async function tryDebitUser(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");

  await ensureUser(guildId, userId);

  const res = await pool.query(
    `UPDATE user_balances
     SET balance = balance - $3
     WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
     RETURNING balance`,
    [guildId, userId, amount]
  );

  if (res.rowCount === 0) return { ok: false };

  await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [guildId, userId, -amount, type, meta]
  );

  const newBalance = Number(res.rows[0].balance);

  // Achievements: best-effort only
  trackDebit({ guildId, userId, amount, newBalance }).catch(() => {});

  return { ok: true, newBalance };
}

async function creditUser(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");

  await ensureUser(guildId, userId);

  const res = await pool.query(
    `UPDATE user_balances
     SET balance = balance + $3
     WHERE guild_id=$1 AND user_id=$2
     RETURNING balance`,
    [guildId, userId, amount]
  );

  await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [guildId, userId, amount, type, meta]
  );

  const newBalance = Number(res.rows[0].balance);

  // Achievements: best-effort only
  trackCredit({ guildId, userId, amount, newBalance }).catch(() => {});

  return { ok: true, newBalance };
}

/**
 * Add to server bank (can be negative or positive if you choose to call it that way)
 * NOTE: Your blackjack payouts will NOT use this directly for negative changes.
 */
async function addServerBank(guildId, amount, type, meta = {}) {
  await ensureGuild(guildId);

  const res = await pool.query(
    `UPDATE guilds
     SET bank_balance = bank_balance + $2
     WHERE guild_id=$1
     RETURNING bank_balance`,
    [guildId, amount]
  );

  await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, NULL, $2, $3, $4)`,
    [guildId, amount, type, meta]
  );

  // Economy achievements: count bank contributions per-player IF you pass an actor id.
  // Callers should pass meta.userId or meta.actorId (or *_id variants) for this to track.
  if (Number(amount) > 0) {
    const actorId = meta?.userId || meta?.actorId || meta?.user_id || meta?.actor_id;
    if (actorId) {
      safeIncAndCheck({
        guildId,
        userId: String(actorId),
        key: "economy_bank_adds",
        delta: 1,
      }).catch(() => {});
    }
  }

  return Number(res.rows[0].bank_balance);
}

/**
 * Transfer from server bank -> user ONLY if bank has enough.
 * Bank will NEVER go negative.
 *
 * Returns:
 *  - { ok:true, bankBalance }
 *  - { ok:false, bankBalance }
 */
async function bankToUserIfEnough(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ensure rows
    await client.query(
      `INSERT INTO guilds (guild_id) VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [guildId]
    );

    await client.query(
      `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2)
       ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [guildId, userId]
    );

    // debit bank only if enough
    const bankUpdate = await client.query(
      `UPDATE guilds
       SET bank_balance = bank_balance - $2
       WHERE guild_id=$1 AND bank_balance >= $2
       RETURNING bank_balance`,
      [guildId, amount]
    );

    if (bankUpdate.rowCount === 0) {
      const bankNow = await client.query(
        `SELECT bank_balance FROM guilds WHERE guild_id=$1`,
        [guildId]
      );
      await client.query("ROLLBACK");
      return { ok: false, bankBalance: Number(bankNow.rows[0]?.bank_balance ?? 0) };
    }

    // credit user
    const userUpdate = await client.query(
      `UPDATE user_balances
       SET balance = balance + $3
       WHERE guild_id=$1 AND user_id=$2
       RETURNING balance`,
      [guildId, userId, amount]
    );

    const newBalance = Number(userUpdate.rows?.[0]?.balance ?? 0);

    // logs
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [guildId, userId, amount, type, meta]
    );

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, NULL, $2, $3, $4)`,
      [guildId, -amount, `${type}_bank`, meta]
    );

    await client.query("COMMIT");

    // Achievements: best-effort only (outside tx so never breaks money movement)
    trackCredit({ guildId, userId, amount, newBalance }).catch(() => {});
    safeIncAndCheck({ guildId, userId, key: "economy_bank_payouts", delta: 1 }).catch(() => {});

    return { ok: true, bankBalance: Number(bankUpdate.rows[0].bank_balance) };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureGuild,
  ensureUser,
  getBalance,
  getServerBank,
  tryDebitUser,
  creditUser,
  addServerBank,
  bankToUserIfEnough,
};
