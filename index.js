require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits, Events, MessageFlags } = require("discord.js");
const { Pool } = require("pg");

// ✅ Achievements JSON loader
const { loadAchievementsFromJson } = require("./utils/achievementsLoader");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages], // slash commands only
});

client.commands = new Collection();

/* -----------------------------
   ✅ Database (Railway Postgres)
-------------------------------- */
if (process.env.DATABASE_URL) {
  client.db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  client.db.on("error", (err) => {
    console.error("🔥 Unexpected PG pool error:", err);
  });
} else {
  client.db = null;
  console.warn("⚠️ DATABASE_URL is not set. Achievements/Economy features requiring DB will not work.");
}

/* -----------------------------
   ✅ Achievements: ensure tables + auto-sync JSON
-------------------------------- */
async function ensureAchievementTables(db) {
  const sql = `
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      reward_coins BIGINT NOT NULL DEFAULT 0,
      reward_role_id TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL REFERENCES achievements(id),
      earned_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS blackjack_stats (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      wins     BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS message_stats (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      messages BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
);

  `;

  const clientConn = await db.connect();
  try {
    await clientConn.query(sql);
  } finally {
    clientConn.release();
  }
}

async function syncAchievementsFromJson(db) {
  const list = loadAchievementsFromJson();

  const upsertSql = `
    INSERT INTO achievements (id, name, description, category, hidden, reward_coins, reward_role_id, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      hidden = EXCLUDED.hidden,
      reward_coins = EXCLUDED.reward_coins,
      reward_role_id = EXCLUDED.reward_role_id,
      updated_at = NOW();
  `;

  const clientConn = await db.connect();
  try {
    await clientConn.query("BEGIN");
    for (const a of list) {
      await clientConn.query(upsertSql, [
        a.id,
        a.name,
        a.description,
        a.category ?? "General",
        Boolean(a.hidden),
        Number(a.reward_coins ?? 0),
        a.reward_role_id ?? null,
      ]);
    }
    await clientConn.query("COMMIT");
    console.log(`🏆 [achievements] auto-synced ${list.length} from data/achievements.json`);
  } catch (e) {
    await clientConn.query("ROLLBACK");
    console.error("🏆 [achievements] auto-sync failed:", e);
  } finally {
    clientConn.release();
  }
}

/* -----------------------------
   ✅ Load commands
-------------------------------- */
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

/* -----------------------------
   ✅ Ready
-------------------------------- */
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  if (client.db) {
    try {
      await ensureAchievementTables(client.db);
      await syncAchievementsFromJson(client.db);

      // Optional: re-sync every hour
      setInterval(() => syncAchievementsFromJson(client.db), 60 * 60_000);
    } catch (e) {
      console.error("🏆 [achievements] init failed:", e);
    }
  }
});

/* -----------------------------
   ✅ Interaction handler (FIXED: no crash loops)
-------------------------------- */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error("Command error:", err);

    // If the interaction is already expired/invalid, Discord won't allow any response.
    if (err?.code === 10062) return; // Unknown interaction

    // Try to notify user, but NEVER crash if this fails.
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "There was an error executing that command.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "There was an error executing that command.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyErr) {
      // Ignore common response failures
      if (replyErr?.code === 10062) return; // Unknown interaction
      if (replyErr?.code === 40060) return; // Interaction already acknowledged
      console.error("Failed to send error reply:", replyErr);
    }
  }
});

const { unlockAchievement } = require("./utils/achievementEngine");

// --- Message achievement config ---
const MSG_COOLDOWN_MS = 5000; // anti-farm: count max 1 message per 5s per user
const MSG_THRESHOLDS = [
  { count: 10,   id: "msg_10" },
  { count: 100,  id: "msg_100" },
  { count: 500,  id: "msg_500" },
  { count: 1000, id: "msg_1000" },
];

// simple in-memory rate limit: key = `${guildId}:${userId}`
const lastCountedAt = new Map();

client.on(Events.MessageCreate, async (message) => {
  try {
    // Only count real user messages in guilds
    if (!message.inGuild()) return;
    if (message.author?.bot) return;

    const db = client.db;
    if (!db) return;

    const guildId = message.guildId;
    const userId = message.author.id;

    // Anti-farm: only count 1 message per 5 seconds per user
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    const last = lastCountedAt.get(key) ?? 0;
    if (now - last < MSG_COOLDOWN_MS) return;
    lastCountedAt.set(key, now);

    // Increment message count
    const res = await db.query(
      `INSERT INTO public.message_stats (guild_id, user_id, messages)
       VALUES ($1, $2, 1)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET messages = public.message_stats.messages + 1
       RETURNING messages`,
      [guildId, userId]
    );

    const messages = Number(res.rows?.[0]?.messages ?? 0);

    // Unlock milestones exactly when hit
    for (const t of MSG_THRESHOLDS) {
      if (messages === t.count) {
        await unlockAchievement({
          db,
          guildId,
          userId,
          achievementId: t.id,
        });

        // Optional: announce in channel (you can remove this if you want quiet unlocks)
        await message.channel.send(`🏆 **${message.author.username}** unlocked a message milestone! (**${t.count.toLocaleString()} messages**)`).catch(() => {});
      }
    }
  } catch (e) {
    console.error("Message achievement handler error:", e);
  }
});

/* -----------------------------
   ✅ Extra safety: never crash on unhandled errors
-------------------------------- */
client.on("error", (e) => console.error("Discord client error:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled promise rejection:", e));

client.login(process.env.DISCORD_TOKEN);
