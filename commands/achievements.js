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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("achievements")
    .setDescription("View achievements and what a user has unlocked.")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Whose achievements to view (defaults to you).")
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("public")
        .setDescription("Post publicly in the channel (default: false / ephemeral).")
        .setRequired(false)
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

    // Fetch member to show SERVER display name (nickname)
    let member = null;
    try {
      member = await interaction.guild.members.fetch(targetUser.id);
    } catch {
      member = null;
    }
    const displayName = member?.displayName ?? targetUser.username;

    // 1) Fetch all achievements
    const all = await db.query(
      `SELECT id, name, description, category, hidden, reward_coins
       FROM achievements
       ORDER BY category ASC, name ASC`
    );

    const achievements = all.rows || [];
    if (!achievements.length) {
      return interaction.editReply("No achievements found yet.").catch(() => {});
    }

    // 2) Fetch user's unlocked achievements (ID-based)
    const unlockedRes = await db.query(
      `SELECT achievement_id
       FROM user_achievements
       WHERE guild_id = $1 AND user_id = $2`,
      [guildId, targetUser.id]
    );

    const unlockedSet = new Set((unlockedRes.rows || []).map((r) => r.achievement_id));

    // 3) Build pages
    const pages = buildPages({
      achievements,
      unlockedSet,
      targetUser,
      displayName,
    });

    let pageIndex = 0;

    const message = await interaction
      .editReply({
        embeds: [pages[pageIndex]],
        components:
          pages.length > 1
            ? [buildRow(pageIndex, pages.length, interaction.user.id, targetUser.id)]
            : [],
        ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
      })
      .catch(() => null);

    if (!message || pages.length <= 1) return;

    // 4) Button pagination (only invoker can flip pages)
    const collector = message.createMessageComponentCollector({ time: 3 * 60_000 });

    collector.on("collect", async (btn) => {
      try {
        const [prefix, action, invokerId, viewedUserId] = btn.customId.split(":");
        if (prefix !== "ach") return;

        if (btn.user.id !== invokerId) {
          return btn
            .reply({
              content: "❌ Only the person who ran the command can use these buttons.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }

        if (viewedUserId !== targetUser.id) {
          return btn
            .reply({ content: "❌ Those buttons don’t match this view.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
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

function buildPages({ achievements, unlockedSet, targetUser, displayName }) {
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

    // Hidden + locked stays hidden
    if (a.hidden && !unlocked) {
      lines.push(`🔒 **Hidden achievement**`);
      continue;
    }

    // 🔒 locked, ✅ unlocked
    const mark = unlocked ? "✅" : "🔒";
    lines.push(`${mark} **${a.name}**${rewardText} — ${a.description}`);
  }

  const total = achievements.length;
  const progress = `${unlockedCount}/${total}`;

  const chunks = chunkLines(lines, PAGE_SIZE);

  return chunks.map((chunk, idx) => {
    return new EmbedBuilder()
      .setTitle(`🏆 Achievements — ${displayName}`)
      .setDescription(
        `**User:** <@${targetUser.id}>  \n` +
          `**Tag:** ${targetUser.tag}  \n` +
          `**ID:** \`${targetUser.id}\`\n\n` +
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
