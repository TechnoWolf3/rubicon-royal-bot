// utils/economy.js
const { pool } = require("./db");

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

  return { ok: true, newBalance: Number(res.rows[0].balance) };
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

  return { ok: true, newBalance: Number(res.rows[0].balance) };
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
    await client.query(
      `UPDATE user_balances
       SET balance = balance + $3
       WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId, amount]
    );

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
