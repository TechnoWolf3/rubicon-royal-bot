require("dotenv").config();
// 🎮 Games UI routing (buttons/selects/modals)
const blackjackGame = require("./data/games/blackjack");
const rouletteGame = require("./data/games/roulette");

const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  MessageFlags,
  EmbedBuilder,
  Partials,
} = require("discord.js");

// ✅ Use the shared DB pool (single pool for whole bot)
const { pool } = require("./utils/db");

// ✅ Achievements loader (modular categories in /data/achievements)
// NOTE: this expects utils/achievementsLoader.js to export loadAchievements()
const { loadAchievements } = require("./utils/achievementsLoader");

// ✅ Achievement engine
const achievementEngine = require("./utils/achievementEngine");
const unlockAchievement = achievementEngine.unlockAchievement;

const fetchAchievementInfo =
  achievementEngine.fetchAchievementInfo ||
  (async (db, achievementId) => {
    try {
      const res = await db.query(
        `SELECT id, name, description, category, hidden, reward_coins, reward_role_id, sort_order
         FROM achievements
         WHERE id = $1`,
        [achievementId]
      );
      return res.rows?.[0] ?? null;
    } catch (e) {
      console.error("[ACH] fetchAchievementInfo fallback failed:", e);
      return null;
    }
  });

const announceAchievement =
  achievementEngine.announceAchievement ||
  (async (channel, userId, info) => {
    try {
      if (!channel || !info) return;

      const reward = Number(info.reward_coins || 0);
      const embed = new EmbedBuilder()
        .setTitle("🏆 Achievement Unlocked!")
        .setDescription(`**<@${userId}>** unlocked **${info.name}**`)
        .addFields(
          { name: "Description", value: info.description || "—" },
          { name: "Category", value: info.category || "General", inline: true },
          {
            name: "Reward",
            value: reward > 0 ? `+$${reward.toLocaleString()}` : "None",
            inline: true,
          }
        );

      await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
      console.error("[ACH] announceAchievement fallback failed:", e);
    }
  });

// -----------------------------
// Discord client
// -----------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    // ✅ Removed GuildVoiceStates (music system removed)
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();

// ✅ Attach DB pool to client (used by commands via interaction.client.db)
client.db = pool;

/* -----------------------------
   ✅ Achievements + Stats + Job/Crime/Jail Tables
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
      sort_order BIGINT NOT NULL DEFAULT 0,
      progress_key TEXT NULL,
      progress_target BIGINT NULL,
      progress_mode TEXT NOT NULL DEFAULT 'count',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE achievements
    ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS progress_key TEXT NULL;
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS progress_target BIGINT NULL;
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS progress_mode TEXT NOT NULL DEFAULT 'count';

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

    CREATE TABLE IF NOT EXISTS roulette_stats (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      wins     BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    -- ✅ Generic achievement counters (for progress bars)
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

    CREATE TABLE IF NOT EXISTS job_progress (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      xp       BIGINT NOT NULL DEFAULT 0,
      level    BIGINT NOT NULL DEFAULT 1,
      total_jobs BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS crime_heat (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      heat     INT  NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_crime_heat_expires
    ON crime_heat (expires_at);

    CREATE TABLE IF NOT EXISTS jail (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      jailed_until TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_jail_jailed_until
    ON jail (jailed_until);
  `;

  const clientConn = await db.connect();
  try {
    await clientConn.query(sql);
  } finally {
    clientConn.release();
  }
}

/* -----------------------------
   ✅ Economy + Patchboard + Store Tables
-------------------------------- */
async function ensureEconomyTables(db) {
  const sql = `
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      bank_balance BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_balances (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      balance  BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS cooldowns (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      key      TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id, key)
    );

    ALTER TABLE IF EXISTS cooldowns
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cooldowns' AND column_name='expires'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cooldowns' AND column_name='expires_at'
      ) THEN
        ALTER TABLE cooldowns RENAME COLUMN expires TO expires_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cooldowns' AND column_name='expiry'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cooldowns' AND column_name='expires_at'
      ) THEN
        ALTER TABLE cooldowns RENAME COLUMN expiry TO expires_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cooldowns' AND column_name='expires_on'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cooldowns' AND column_name='expires_at'
      ) THEN
        ALTER TABLE cooldowns RENAME COLUMN expires_on TO expires_at;
      END IF;
    END $$;

    UPDATE cooldowns SET expires_at = NOW() WHERE expires_at IS NULL;
    ALTER TABLE cooldowns ALTER COLUMN expires_at SET NOT NULL;
    ALTER TABLE cooldowns ALTER COLUMN expires_at SET DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS idx_cooldowns_expires
    ON cooldowns (expires_at);

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id  TEXT NULL,
      amount   BIGINT NOT NULL,
      type     TEXT NOT NULL,
      meta     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE IF EXISTS transactions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS idx_transactions_guild_user_created
    ON transactions (guild_id, user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_transactions_type_created
    ON transactions (type, created_at DESC);

    CREATE TABLE IF NOT EXISTS casino_security_state (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      last_level INT NOT NULL DEFAULT 0,
      last_fee_pct INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_casino_security_state_updated
    ON casino_security_state (updated_at DESC);

    CREATE TABLE IF NOT EXISTS patch_boards (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title      TEXT NOT NULL DEFAULT 'Patch Notes',
      content    TEXT NOT NULL DEFAULT '',
      paused     BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      PRIMARY KEY (guild_id, channel_id)
    );

    -- ✅ Reaction Role Boards (opt-in ping roles)
    CREATE TABLE IF NOT EXISTS role_boards (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      board_name TEXT NOT NULL,
      role_id    TEXT NOT NULL,
      emoji      TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sticky     BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_role_boards_guild_message
    ON role_boards (guild_id, message_id);

    CREATE INDEX IF NOT EXISTS idx_patch_boards_guild
    ON patch_boards (guild_id);

    CREATE TABLE IF NOT EXISTS store_items (
      guild_id    TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price       BIGINT NOT NULL DEFAULT 0,
      kind        TEXT NOT NULL DEFAULT 'item',
      stackable   BOOLEAN NOT NULL DEFAULT TRUE,
      enabled     BOOLEAN NOT NULL DEFAULT TRUE,
      meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order  INT NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_store_items_guild_enabled
    ON store_items (guild_id, enabled);

    CREATE TABLE IF NOT EXISTS user_inventory (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      qty         INT  NOT NULL DEFAULT 0,
      uses_remaining INT NOT NULL DEFAULT 0,
      meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_inventory_lookup
    ON user_inventory (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS store_purchases (
      id          BIGSERIAL PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      qty         INT  NOT NULL,
      unit_price  BIGINT NOT NULL,
      total_price BIGINT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS grind_runs (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      job_key  TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at    TIMESTAMPTZ NOT NULL,
      payout_base BIGINT NOT NULL DEFAULT 0,
      xp_gain     BIGINT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS grind_fatigue (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      fatigue_ms BIGINT NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_grind_fatigue_locked_until
    ON grind_fatigue (locked_until);

    -- ✅ Store limits (safe upgrades)
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS max_owned INT NOT NULL DEFAULT 0;
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS max_uses INT NOT NULL DEFAULT 0;
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS max_purchase_ever INT NOT NULL DEFAULT 0;
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS cooldown_seconds INT NOT NULL DEFAULT 0;
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS daily_stock INT NOT NULL DEFAULT 0;

    -- ✅ NEW: Sell system (global)
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS sell_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE store_items ADD COLUMN IF NOT EXISTS sell_price BIGINT NOT NULL DEFAULT 0;

    -- ✅ Inventory uses (safe upgrade)
    ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS uses_remaining INT NOT NULL DEFAULT 0;
  `;

  const clientConn = await db.connect();
  try {
    await clientConn.query(sql);
  } finally {
    clientConn.release();
  }
}

/* -----------------------------
   ✅ Achievements auto-sync
-------------------------------- */
async function syncAchievements(db) {
  const data = loadAchievements();
  if (!Array.isArray(data) || data.length === 0) return 0;

  const clientConn = await db.connect();
  try {
    for (const a of data) {
      const progressKey = a.progress?.key ?? null;
      const progressTarget = a.progress?.target ?? null;
      const progressMode = a.progress?.mode ?? "count";

      await clientConn.query(
        `
        INSERT INTO achievements (
          id, name, description, category, hidden,
          reward_coins, reward_role_id,
          sort_order, updated_at,
          progress_key, progress_target, progress_mode
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          hidden = EXCLUDED.hidden,
          reward_coins = EXCLUDED.reward_coins,
          reward_role_id = EXCLUDED.reward_role_id,
          sort_order = EXCLUDED.sort_order,
          progress_key = EXCLUDED.progress_key,
          progress_target = EXCLUDED.progress_target,
          progress_mode = EXCLUDED.progress_mode,
          updated_at = NOW()
        `,
        [
          a.id,
          a.name,
          a.description,
          a.category ?? "General",
          !!a.hidden,
          Number(a.reward_coins ?? 0),
          a.reward_role_id ?? null,
          Number(a.sort_order ?? 0),
          progressKey,
          progressTarget != null ? Number(progressTarget) : null,
          String(progressMode),
        ]
      );
    }
  } finally {
    clientConn.release();
  }

  return data.length;
}

/* -----------------------------
   ✅ Load commands
-------------------------------- */
function loadCommands() {
  const commandsPath = path.join(__dirname, "commands");
  if (!fs.existsSync(commandsPath)) return;

  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);

    try {
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);

      if (command?.data?.name && typeof command.execute === "function") {
        client.commands.set(command.data.name, command);
      } else {
        console.warn(`[CMD] Skipped ${file}: missing data.name or execute()`);
      }
    } catch (e) {
      console.error(`[CMD] Failed to load ${file}:`, e);
    }
  }
}

/* -----------------------------
   ✅ Ready
-------------------------------- */
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  loadCommands();

  if (client.db) {
    try {
      await ensureAchievementTables(client.db);
      await ensureEconomyTables(client.db);

      const count = await syncAchievements(client.db);
      if (count) console.log(`🏆 [achievements] auto-synced ${count} from data/achievements/*`);

      setInterval(async () => {
        try {
          const n = await syncAchievements(client.db);
          if (n) console.log(`🏆 [achievements] auto-synced ${n} from data/achievements/*`);
        } catch (err) {
          console.error("[achievements] hourly sync failed:", err);
        }
      }, 60 * 60_000);
    } catch (e) {
      console.error("[init] DB init failed:", e);
    }
  }
});

/* -----------------------------
   ✅ Interaction handler
   - slash commands
-------------------------------- */
client.on(Events.InteractionCreate, async (interaction) => {

  // ✅ Let /help handle its own dropdowns/buttons via its collector
  // Prevents the global games UI router from consuming help interactions.
  if (
    (interaction.isButton?.() || interaction.isAnySelectMenu?.()) &&
    interaction.customId?.startsWith("help:")
  ) {
    return;
  }


  // 🎮 Games UI routing (ephemeral select menus + modals)
  // Buttons are handled by the per-game message collectors; ephemeral selects/modals must be routed here.
  if (!interaction.isChatInputCommand()) {
    if (interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.()) {
      try {
        if (typeof rouletteGame.handleInteraction === "function") {
          const handled = await rouletteGame.handleInteraction(interaction);
          if (handled) return;
        }
        if (typeof blackjackGame.handleInteraction === "function") {
          const handled = await blackjackGame.handleInteraction(interaction);
          if (handled) return;
        }
      } catch (e) {
        console.error("[GAMES-UI] handler error:", e);
        try {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: "❌ Interaction failed.", flags: MessageFlags.Ephemeral });
          }
        } catch {}
        return;
      }

      // If nothing claimed it, ACK so Discord doesn't show 'This interaction failed'
      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: "⚠️ That interaction wasn't handled.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
      return;
    }
    return;
  }

  // ✅ Slash commands
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`[CMD] Command not loaded: /${interaction.commandName}`);
    try {
      return await interaction.reply({
        content:
          `❌ Command **/${interaction.commandName}** is registered, but the bot hasn’t loaded it.\n` +
          `Check Railway logs for a command load/require error.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      return;
    }
  }

  try {
    await command.execute(interaction);
  } catch (e) {
    console.error("Command error:", e);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "❌ There was an error executing that command." });
      } else {
        await interaction.reply({
          content: "❌ There was an error executing that command.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {}
  }
});

/* -----------------------------
   ✅ Message milestones
-------------------------------- */
const MSG_THRESHOLDS = [
  { count: 100, id: "msg_100" },
  { count: 500, id: "msg_500" },
  { count: 1000, id: "msg_1000" },
  { count: 5000, id: "msg_5000" },
];

async function setAchievementCounter(db, guildId, userId, key, value) {
  // Keep counters in sync for progress-bar style achievements.
  await db.query(
    `INSERT INTO public.user_achievement_counters (guild_id, user_id, key, value)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [String(guildId), String(userId), String(key), Number(value || 0)]
  );
}

async function unlockProgressAchievementsForKey({ db, guildId, userId, key, currentValue, channel }) {
  try {
    const res = await db.query(
      `SELECT id
       FROM achievements
       WHERE progress_key = $1
         AND progress_target IS NOT NULL
         AND progress_target <= $2`,
      [String(key), Number(currentValue || 0)]
    );

    for (const row of res.rows || []) {
      const result = await unlockAchievement({ db, guildId, userId, achievementId: row.id });
      if (result?.unlocked) {
        const info = await fetchAchievementInfo(db, row.id);
        await announceAchievement(channel, userId, info);
      }
    }
  } catch (e) {
    console.error("[ACH] progress unlock error:", e);
  }
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!client.db) return;
    if (!message.guild || message.author?.bot) return;

    const db = client.db;
    const guildId = message.guild.id;
    const userId = message.author.id;

    const res = await db.query(
      `INSERT INTO public.message_stats (guild_id, user_id, messages)
       VALUES ($1, $2, 1)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET messages = public.message_stats.messages + 1
       RETURNING messages`,
      [guildId, userId]
    );

    const messages = Number(res.rows?.[0]?.messages ?? 0);

    // ✅ Progress-counter mirror for modular achievements
    await setAchievementCounter(db, guildId, userId, "messages_sent", messages);
    await unlockProgressAchievementsForKey({
      db,
      guildId,
      userId,
      key: "messages_sent",
      currentValue: messages,
      channel: message.channel,
    });

    // ✅ Keep your existing exact-threshold unlocks (optional / legacy)
    for (const t of MSG_THRESHOLDS) {
      if (messages === t.count) {
        const result = await unlockAchievement({ db, guildId, userId, achievementId: t.id });
        if (result?.unlocked) {
          const info = await fetchAchievementInfo(db, t.id);
          await announceAchievement(message.channel, userId, info);
        }
      }
    }
  } catch (e) {
    console.error("Message achievement handler error:", e);
  }
});

client.on("error", (e) => console.error("Discord client error:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled promise rejection:", e));

/* -----------------------------
   ✅ Reaction Role Boards
   - Add role on react
   - Remove role on unreact
-------------------------------- */

function emojiMatches(storedEmoji, reactionEmoji) {
  if (!storedEmoji || !reactionEmoji) return false;
  const s = String(storedEmoji);

  // Custom emoji can be stored like:
  //  - "123456789012345678" (id)
  //  - "name:123456789012345678"
  //  - "<:name:123456789012345678>" or "<a:name:...>"
  const m = s.match(/^(?:<a?:\w+:(\d+)>|\w+:(\d+)|(\d+))$/);
  const storedId = m?.[1] || m?.[2] || m?.[3] || null;

  if (storedId) return String(reactionEmoji.id) === String(storedId);
  // Otherwise treat as unicode emoji
  return String(reactionEmoji.name) === s;
}

async function fetchRoleBoardByMessage(db, guildId, messageId) {
  if (!db || !guildId || !messageId) return null;
  try {
    const res = await db.query(
      `SELECT guild_id, channel_id, message_id, board_name, role_id, emoji, sticky
       FROM role_boards
       WHERE guild_id = $1 AND message_id = $2`,
      [guildId, String(messageId)]
    );
    return res.rows?.[0] ?? null;
  } catch (e) {
    console.error("[role_boards] lookup failed:", e);
    return null;
  }
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (!client.db) return;
    if (!user || user.bot) return;

    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();

    const guild = reaction.message?.guild;
    if (!guild) return;

    const board = await fetchRoleBoardByMessage(client.db, guild.id, reaction.message.id);
    if (!board) return;
    if (!emojiMatches(board.emoji, reaction.emoji)) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await member.roles.add(board.role_id, "Role board opt-in").catch(() => {});
  } catch (e) {
    console.error("[role_boards] reaction add handler error:", e);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (!client.db) return;
    if (!user || user.bot) return;

    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();

    const guild = reaction.message?.guild;
    if (!guild) return;

    const board = await fetchRoleBoardByMessage(client.db, guild.id, reaction.message.id);
    if (!board) return;
    if (!emojiMatches(board.emoji, reaction.emoji)) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await member.roles.remove(board.role_id, "Role board opt-out").catch(() => {});
  } catch (e) {
    console.error("[role_boards] reaction remove handler error:", e);
  }
});

client.login(process.env.DISCORD_TOKEN);
