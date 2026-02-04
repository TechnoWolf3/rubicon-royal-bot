// commands/achievements.js
const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const PAGE_SIZE = 12;

// Heat-style progress bar (easy to tweak)
function makeProgressBar(current, target, length = 14, filled = "■", empty = "□") {
  const safeTarget = Math.max(1, Number(target || 1));
  const safeCurrent = Math.max(0, Number(current || 0));
  const pct = Math.max(0, Math.min(1, safeCurrent / safeTarget));
  const fillCount = Math.round(pct * length);
  return filled.repeat(fillCount) + empty.repeat(Math.max(0, length - fillCount));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("achievements")
    .setDescription("View achievements and what a user has unlocked.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Whose achievements to view (defaults to you).").setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt.setName("public").setDescription("Post publicly in the channel (default: false / ephemeral).").setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only." }).catch(() => {});
    }

    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser("user") ?? interaction.user;
    const isPublic = interaction.options.getBoolean("public") ?? false;

    const replyOpts = isPublic ? {} : { flags: MessageFlags.Ephemeral };
    await interaction.deferReply(replyOpts).catch(() => {});

    const db = interaction.client.db;
    if (!db) return interaction.editReply("❌ Database not configured (DATABASE_URL missing).").catch(() => {});

    // Fetch member so we can show SERVER display name (nickname)
    let member = null;
    try {
      member = await interaction.guild.members.fetch(targetUser.id);
    } catch {}
    const displayName = member?.displayName ?? targetUser.username;

    // 1) Fetch all achievements
    const all = await db.query(
      `SELECT id, name, description, category, hidden, reward_coins,
              progress_key, progress_target, progress_mode
       FROM achievements
       ORDER BY category ASC, sort_order ASC`
    );

    const achievements = all.rows || [];
    if (!achievements.length) {
      return interaction.editReply("No achievements found yet.").catch(() => {});
    }

    // 2) Fetch user's unlocked achievements — schema tolerant
    const idA = targetUser.id;            // correct
    const idB = `<@${targetUser.id}>`;    // possible old storage
    const idC = `<@!${targetUser.id}>`;   // possible old storage

    // Common column name variants we’ll try
    const guildCols = ["guild_id", "guildid", "guildId"];
    const userCols = ["user_id", "userid", "userId"];
    const achCols = ["achievement_id", "achievementId", "achievementid", "achievement", "id"];

    let unlockedRows = [];
    let used = null;

    // Try combinations until one works
    for (const gCol of guildCols) {
      for (const uCol of userCols) {
        for (const aCol of achCols) {
          try {
            const res = await db.query(
              `SELECT ${aCol} AS aid
               FROM public.user_achievements
               WHERE ${gCol} = $1
                 AND (${uCol} = $2 OR ${uCol} = $3 OR ${uCol} = $4)`,
              [guildId, idA, idB, idC]
            );

            // If query succeeded, we accept it even if empty — but we’ll keep looking
            // only if it’s empty, because a wrong combo could “work” but never match.
            if (res?.rows) {
              if (res.rows.length > 0) {
                unlockedRows = res.rows;
                used = { gCol, uCol, aCol };
                break;
              } else {
                // remember a working combo (in case nothing returns rows)
                if (!used) used = { gCol, uCol, aCol };
              }
            }
          } catch {
            // try next combo
          }
        }
        if (unlockedRows.length) break;
      }
      if (unlockedRows.length) break;
    }

    // If nothing returned rows, but we found a “working” combo, run it once (empty is still valid)
    if (!unlockedRows.length && used) {
      try {
        const res = await db.query(
          `SELECT ${used.aCol} AS aid
           FROM public.user_achievements
           WHERE ${used.gCol} = $1
             AND (${used.uCol} = $2 OR ${used.uCol} = $3 OR ${used.uCol} = $4)`,
          [guildId, idA, idB, idC]
        );
        unlockedRows = res.rows || [];
      } catch (e) {
        console.error("[/achievements] final read failed:", e);
      }
    }

    if (used) {
      console.log(`[ACH] read user_achievements via ${used.gCol}/${used.uCol}/${used.aCol} -> ${unlockedRows.length} rows`);
    } else {
      console.warn("[ACH] could not find compatible columns in user_achievements");
    }

    const unlockedSet = new Set(unlockedRows.map((r) => r.aid).filter(Boolean));

    // 2.5) Fetch progress counters (for progress bars)
    let counters = new Map();
    try {
      const countersRes = await db.query(
        `SELECT key, value
         FROM public.user_achievement_counters
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, String(targetUser.id)]
      );
      counters = new Map((countersRes.rows || []).map((r) => [r.key, Number(r.value || 0)]));
    } catch (e) {
      // Table may not exist yet if DB hasn't been migrated — don't break command.
      counters = new Map();
    }

    // 3) Build pages
    const pages = buildPages({
      achievements,
      unlockedSet,
      targetUser,
      displayName,
      counters,
    });

    let pageIndex = 0;

    const message = await interaction
      .editReply({
        embeds: [pages[pageIndex]],
        components: pages.length > 1 ? [buildRow(pageIndex, pages.length, interaction.user.id, targetUser.id)] : [],
        ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
      })
      .catch(() => null);

    if (!message || pages.length <= 1) return;

    const collector = message.createMessageComponentCollector({ time: 3 * 60_000 });

    collector.on("collect", async (btn) => {
      try {
        const [prefix, action, invokerId, viewedUserId] = btn.customId.split(":");
        if (prefix !== "ach") return;

        if (btn.user.id !== invokerId) {
          return btn
            .reply({ content: "❌ Only the person who ran the command can use these buttons.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }

        if (viewedUserId !== targetUser.id) {
          return btn.reply({ content: "❌ Those buttons don’t match this view.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        await btn.deferUpdate().catch(() => {});

        if (action === "prev") pageIndex = Math.max(0, pageIndex - 1);
        if (action === "next") pageIndex = Math.min(pages.length - 1, pageIndex + 1);

        await interaction
          .editReply({
            embeds: [pages[pageIndex]],
            components: [buildRow(pageIndex, pages.length, interaction.user.id, targetUser.id)],
            ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
          })
          .catch(() => {});
      } catch (e) {
        console.error("Achievements pager error:", e);
      }
    });

    collector.on("end", async () => {
      try {
        await interaction.editReply({ components: [], ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }) }).catch(() => {});
      } catch {}
    });
  },
};

function buildRow(pageIndex, totalPages, invokerId, viewedUserId) {
  const prev = new ButtonBuilder()
    .setCustomId(`ach:prev:${invokerId}:${viewedUserId}`)
    .setLabel("Prev")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pageIndex <= 0);

  const next = new ButtonBuilder()
    .setCustomId(`ach:next:${invokerId}:${viewedUserId}`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pageIndex >= totalPages - 1);

  return new ActionRowBuilder().addComponents(prev, next);
}

function buildPages({ achievements, unlockedSet, targetUser, displayName, counters }) {
  const lines = [];
  let currentCategory = null;

  let unlockedCount = 0;

  for (const a of achievements) {
    const cat = a.category || "General";
    if (cat !== currentCategory) {
      currentCategory = cat;
      lines.push(`\n__**${currentCategory}**__`);
    }

    const unlocked = unlockedSet.has(a.id);
    if (unlocked) unlockedCount++;

    const reward = Number(a.reward_coins || 0);
    const rewardText = reward > 0 ? ` (+$${reward.toLocaleString()})` : "";

    if (a.hidden && !unlocked) {
      lines.push(`🔒 **Hidden achievement**`);
      continue;
    }

    const mark = unlocked ? "✅" : "🔒";
    lines.push(`${mark} **${a.name}**${rewardText} — ${a.description}`);

    // Progress bar line (only for locked progress-based achievements)
    const hasProgress = !!(a.progress_key && a.progress_target);
    if (!unlocked && hasProgress) {
      const cur = counters?.get(a.progress_key) ?? 0;
      const target = Number(a.progress_target || 0) || 1;
      const bar = makeProgressBar(cur, target);
      lines.push(`   🔥 ${cur.toLocaleString()} / ${target.toLocaleString()}  \`${bar}\``);
    }
  }

  const total = achievements.length;
  const progress = `${unlockedCount}/${total}`;

  const chunks = chunkLines(lines, PAGE_SIZE);

  return chunks.map((chunk, idx) => {
    return new EmbedBuilder()
      .setTitle(`🏆 Achievements — ${displayName}`)
      .setDescription(
        `**User:** <@${targetUser.id}>\n` +
        `**Tag:** ${targetUser.tag}\n` +
        `**ID:** \`${targetUser.id}\`\n` +
        `**Unlocked:** **${unlockedCount}**\n\n` +
        chunk.join("\n").trim()
      )
      .setFooter({ text: `Progress: ${progress} • Page ${idx + 1}/${chunks.length}` });
  });
}

function chunkLines(lines, size) {
  const chunks = [];
  let buf = [];

  for (const line of lines) {
    buf.push(line);

    if (buf.length >= size) {
      const last = buf[buf.length - 1];
      if (isHeader(last) && buf.length > 1) {
        const header = buf.pop();
        chunks.push(buf);
        buf = [header];
      } else {
        chunks.push(buf);
        buf = [];
      }
    }
  }

  if (buf.length) chunks.push(buf);
  return chunks;
}

function isHeader(line) {
  return typeof line === "string" && line.startsWith("\n__**") && line.endsWith("**__");
}
