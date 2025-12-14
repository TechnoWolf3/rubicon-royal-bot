// utils/achievementEngine.js
// Records achievement unlocks ONCE per player, mints rewards, and best-effort logs a transaction.
// IMPORTANT: transaction logging must never rollback the achievement unlock.

async function unlockAchievement({ db, guildId, userId, achievementId }) {
  if (!db) return { unlocked: false, reason: "No DB" };

  const cleanUserId = String(userId).replace(/[<@!>]/g, "");

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1) Insert “earned” record (only once)
    const ins = await client.query(
      `INSERT INTO user_achievements (guild_id, user_id, achievement_id)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [guildId, cleanUserId, achievementId]
    );

    if (ins.rowCount === 0) {
      await client.query("ROLLBACK");
      return { unlocked: false, reason: "Already unlocked" };
    }

    // 2) Pull achievement definition (reward info)
    const achRes = await client.query(
      `SELECT id, name, reward_coins, reward_role_id
       FROM achievements
       WHERE id = $1`,
      [achievementId]
    );

    const ach = achRes.rows[0] || {
      id: achievementId,
      name: achievementId,
      reward_coins: 0,
      reward_role_id: null,
    };

    const rewardCoins = Number(ach.reward_coins || 0);
    const rewardRoleId = ach.reward_role_id || null;

    // 3) Mint coins to user (no server bank involved)
    if (rewardCoins > 0) {
      await client.query(
        `INSERT INTO user_balances (guild_id, user_id, balance)
         VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance`,
        [guildId, cleanUserId, rewardCoins]
      );
    }

    // 4) Best-effort transaction log (MUST NOT FAIL THE TRANSACTION)
    // We detect which columns exist, then insert only what matches.
    try {
      const colsRes = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'transactions'`
      );

      const cols = new Set((colsRes.rows || []).map((r) => r.column_name));

      // We only log if the minimal expected columns exist.
      // Common variants: (guild_id, user_id, type, amount, created_at)
      const hasCore =
        cols.has("guild_id") &&
        cols.has("user_id") &&
        (cols.has("type") || cols.has("tx_type")) &&
        (cols.has("amount") || cols.has("value")) &&
        (cols.has("created_at") || cols.has("createdAt") || cols.has("timestamp"));

      if (hasCore && rewardCoins > 0) {
        const typeCol = cols.has("type") ? "type" : "tx_type";
        const amountCol = cols.has("amount") ? "amount" : "value";
        const createdCol = cols.has("created_at")
          ? "created_at"
          : cols.has("createdAt")
          ? "createdAt"
          : "timestamp";

        // optional note-like columns
        const noteCol = cols.has("note")
          ? "note"
          : cols.has("description")
          ? "description"
          : cols.has("reason")
          ? "reason"
          : null;

        if (noteCol) {
          await client.query(
            `INSERT INTO transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${noteCol}, ${createdCol})
             VALUES ($1,$2,$3,$4,$5,NOW())`,
            [guildId, cleanUserId, "ACHIEVEMENT_REWARD", rewardCoins, `Unlocked: ${achievementId}`]
          );
        } else {
          await client.query(
            `INSERT INTO transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${createdCol})
             VALUES ($1,$2,$3,$4,NOW())`,
            [guildId, cleanUserId, "ACHIEVEMENT_REWARD", rewardCoins]
          );
        }
      } else {
        // silently skip if schema doesn't match
        // console.log("[achievements] transactions schema not compatible; skipping log");
      }
    } catch (logErr) {
      // DO NOT throw — logging is optional
      console.warn("⚠️ Transaction log skipped (achievement still granted):", logErr?.message || logErr);
    }

    await client.query("COMMIT");
    return { unlocked: true, name: ach.name, rewardCoins, rewardRoleId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { unlockAchievement };
