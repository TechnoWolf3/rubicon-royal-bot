const achievementEngine = require("./achievementEngine");

async function ensureCounterTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_achievement_counters (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      key      TEXT NOT NULL,
      value    BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_uac_guild_user
    ON public.user_achievement_counters (guild_id, user_id);
  `);
}

async function setCounter(db, guildId, userId, key, value) {
  await db.query(
    `INSERT INTO public.user_achievement_counters (guild_id, user_id, key, value)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [guildId, String(userId), String(key), Number(value || 0)]
  );
}

async function incCounter(db, guildId, userId, key, delta = 1) {
  const res = await db.query(
    `INSERT INTO public.user_achievement_counters (guild_id, user_id, key, value)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET value = public.user_achievement_counters.value + EXCLUDED.value, updated_at = NOW()
     RETURNING value`,
    [guildId, String(userId), String(key), Number(delta || 1)]
  );
  return Number(res.rows?.[0]?.value ?? 0);
}

async function maxCounter(db, guildId, userId, key, candidateValue) {
  const res = await db.query(
    `INSERT INTO public.user_achievement_counters (guild_id, user_id, key, value)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET value = GREATEST(public.user_achievement_counters.value, EXCLUDED.value), updated_at = NOW()
     RETURNING value`,
    [guildId, String(userId), String(key), Number(candidateValue || 0)]
  );
  return Number(res.rows?.[0]?.value ?? 0);
}

async function checkAndUnlockProgressAchievements({
  db,
  guildId,
  userId,
  key,
  currentValue,
  channel,
  fetchAchievementInfo,
  announceAchievement,
}) {
  // Find progress achievements tied to this key that are now complete
  const res = await db.query(
    `SELECT id
     FROM public.achievements
     WHERE progress_key = $1
       AND progress_target IS NOT NULL
       AND progress_target <= $2`,
    [String(key), Number(currentValue || 0)]
  );

  for (const row of res.rows || []) {
    const result = await achievementEngine.unlockAchievement({
      db,
      guildId,
      userId,
      achievementId: row.id,
    });

    if (result?.unlocked && channel && fetchAchievementInfo && announceAchievement) {
      const info = await fetchAchievementInfo(db, row.id);
      await announceAchievement(channel, userId, info);
    }
  }
}

module.exports = {
  ensureCounterTables,
  setCounter,
  incCounter,
  maxCounter,
  checkAndUnlockProgressAchievements,
};
