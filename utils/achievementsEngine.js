// utils/achievementEngine.js
// Records an achievement unlock (once per guild/user/achievement) and mints rewards to the user.
// Rewards do NOT touch the server bank. Transaction logging is best-effort (won't break unlocks).

async function unlockAchievement({ db, guildId, userId, achievementId }) {
  if (!db) return { unlocked: false, reason: "No DB" };

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1) Insert “earned” record (only once)
    const ins = await client.query(
      `INSERT INTO user_achievements (guild_id, user_id, achievement_id)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [guildId, userId, achievementId]
    );

    if (ins.rowCount === 0) {
      await client.query("ROLLBACK");
      return { unlocked: false, reason: "Already unlocked" };
    }

    // 2) Pull achievement definition (reward info)
    const { rows } = await client.query(
      `SELECT name, reward_coins, reward_role_id
       FROM achievements
       WHERE id = $1`,
      [achievementId]
    );

    const ach = rows[0] || { name: achievementId, reward_coins: 0, reward_role_id: null };
    const rewardCoins = Number(ach.reward_coins || 0);
    const rewardRoleId = ach.reward_role_id || null;

    // 3) Mint coins to user (no server bank involved)
    if (rewardCoins > 0) {
      await client.query(
        `INSERT INTO user_balances (guild_id, user_id, balance)
         VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance`,
        [guildId, userId, rewardCoins]
      );

      // 4) Log transaction (best-effort; won't break unlocks)
      try {
        await client.query(
          `INSERT INTO transactions (guild_id, user_id, type, amount, note, created_at)
           VALUES ($1,$2,$3,$4,$5,NOW())`,
          [guildId, userId, "ACHIEVEMENT_REWARD", rewardCoins, `Unlocked: ${achievementId}`]
        );
      } catch (e) {
        console.warn("⚠️ Transaction log failed (achievement still granted):", e.message);
      }
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
