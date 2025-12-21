const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");

const PATCHBOARD_ROLE_ID = "741251069002121236";

// Discord embed limits
const EMBED_DESC_MAX = 4096;
const EMBED_TITLE_MAX = 256;

function hasPatchboardAccess(interaction) {
  const member = interaction.member;
  if (!member) return false;

  // Admin safety override
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  // Role-based access
  return member.roles?.cache?.has?.(PATCHBOARD_ROLE_ID) === true;
}

/**
 * Because slash-command string options are single-line, users can't Shift+Enter.
 * So we support:
 *  - "\n" => newline
 *  - "\n\n" => blank line
 *  - "\\n" => literal "\n"
 */
function parseUserText(input) {
  if (input == null) return "";
  const s = String(input);

  // Convert literal \n into real newlines, while preserving \\n as \n
  // Step 1: protect \\n
  const protectedToken = "__LITERAL_BACKSLASH_N__";
  const step1 = s.replace(/\\\\n/g, protectedToken);

  // Step 2: convert \n to newline
  const step2 = step1.replace(/\\n/g, "\n");

  // Step 3: restore protected \\n -> \n
  return step2.replace(new RegExp(protectedToken, "g"), "\\n");
}

function clampTitle(title) {
  const t = String(title ?? "").trim();
  if (!t) return "Patch Notes";
  return t.length > EMBED_TITLE_MAX ? t.slice(0, EMBED_TITLE_MAX - 1) + "…" : t;
}

function ensureNewlineForAppend(existing) {
  if (!existing) return "";
  return existing.endsWith("\n") ? existing : existing + "\n";
}

function clampDescription(desc) {
  const d = String(desc ?? "");
  if (d.length <= EMBED_DESC_MAX) return { text: d, truncated: false };

  const suffix = "\n\n*(content truncated — embed limit reached)*";
  const keep = EMBED_DESC_MAX - suffix.length;
  return { text: d.slice(0, Math.max(0, keep)) + suffix, truncated: true };
}

function buildEmbed({ title, content, updatedAt }) {
  const safeTitle = clampTitle(title);
  const { text } = clampDescription(content);

  const embed = new EmbedBuilder().setTitle(safeTitle);

  if (text && text.trim().length > 0) embed.setDescription(text);
  else embed.setDescription("_No patch notes yet._");

  const ts = updatedAt
    ? Math.floor(new Date(updatedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  embed.setFooter({ text: `Last updated: <t:${ts}:f>` });
  return embed;
}

async function fetchBoard(db, guildId, channelId) {
  const res = await db.query(
    `SELECT guild_id, channel_id, message_id, title, content, paused, updated_at, updated_by
     FROM patch_boards
     WHERE guild_id = $1 AND channel_id = $2`,
    [guildId, channelId]
  );
  return res.rows?.[0] ?? null;
}

async function upsertBoard(db, guildId, channelId, patch) {
  const {
    messageId = null,
    title = "Patch Notes",
    content = "",
    paused = false,
    updatedBy = null,
  } = patch;

  const res = await db.query(
    `
    INSERT INTO patch_boards (guild_id, channel_id, message_id, title, content, paused, updated_at, updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
    ON CONFLICT (guild_id, channel_id)
    DO UPDATE SET
      message_id = COALESCE(EXCLUDED.message_id, patch_boards.message_id),
      title      = EXCLUDED.title,
      content    = EXCLUDED.content,
      paused     = EXCLUDED.paused,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by
    RETURNING guild_id, channel_id, message_id, title, content, paused, updated_at, updated_by
    `,
    [guildId, channelId, messageId, title, content, paused, updatedBy]
  );

  return res.rows?.[0] ?? null;
}

async function setPaused(db, guildId, channelId, paused, updatedBy) {
  const res = await db.query(
    `
    UPDATE patch_boards
    SET paused = $3, updated_at = NOW(), updated_by = $4
    WHERE guild_id = $1 AND channel_id = $2
    RETURNING guild_id, channel_id, message_id, title, content, paused, updated_at, updated_by
    `,
    [guildId, channelId, paused, updatedBy]
  );
  return res.rows?.[0] ?? null;
}

async function updateContent(db, guildId, channelId, { title, content, updatedBy }) {
  const res = await db.query(
    `
    UPDATE patch_boards
    SET title = $3, content = $4, updated_at = NOW(), updated_by = $5
    WHERE guild_id = $1 AND channel_id = $2
    RETURNING guild_id, channel_id, message_id, title, content, paused, updated_at, updated_by
    `,
    [guildId, channelId, title, content, updatedBy]
  );
  return res.rows?.[0] ?? null;
}

async function repostBoard(interaction, board) {
  const channelId = board.channel_id;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error("I can’t access that channel.");

  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement &&
    channel.isTextBased?.() !== true
  ) {
    throw new Error("That channel is not a text channel I can post in.");
  }

  if (board.message_id) {
    await channel.messages
      .fetch(board.message_id)
      .then((m) => m.delete().catch(() => {}))
      .catch(() => {});
  }

  const embed = buildEmbed({
    title: board.title,
    content: board.content,
    updatedAt: board.updated_at,
  });

  const sent = await channel.send({ embeds: [embed] });

  const db = interaction.client.db;
  await db.query(
    `
    UPDATE patch_boards
    SET message_id = $3
    WHERE guild_id = $1 AND channel_id = $2
    `,
    [interaction.guildId, channelId, sent.id]
  );

  return sent;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("patchboard")
    .setDescription("Sticky patch notes embed per channel (delete + repost on updates).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Create/update the patch board for this channel (and post it unless paused).")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("title")
            .setDescription("Embed title (defaults to Patch Notes)")
            .setRequired(false)
            .setMaxLength(EMBED_TITLE_MAX)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("append")
        .setDescription("Append formatted text to the patch board (supports markdown). Use \\n for new lines.")
        .addStringOption((opt) =>
          opt
            .setName("text")
            .setDescription("Text to append (markdown supported). Use \\n for line breaks.")
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("overwrite")
        .setDescription("Overwrite the patch board content completely (supports markdown). Use \\n for new lines.")
        .addStringOption((opt) =>
          opt
            .setName("text")
            .setDescription("Full content to set (markdown supported). Use \\n for line breaks.")
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("title")
            .setDescription("Embed title (optional)")
            .setRequired(false)
            .setMaxLength(EMBED_TITLE_MAX)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("pause")
        .setDescription("Pause reposting updates for this channel (content still saves).")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("resume")
        .setDescription("Resume reposting updates and repost the latest saved board.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("Show the stored patch board content for this channel (ephemeral).")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("repost")
        .setDescription("Force delete + repost the board using stored content (if not paused).")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel (defaults to current channel)")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!hasPatchboardAccess(interaction)) {
      return interaction.reply({
        content: "❌ You don’t have permission to use /patchboard.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const db = interaction.client.db;
    if (!db) {
      return interaction.reply({
        content: "⚠️ Database is not configured (DATABASE_URL missing).",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const channelOpt = interaction.options.getChannel("channel", false);
    const targetChannel = channelOpt ?? interaction.channel;
    const channelId = targetChannel?.id;

    if (!channelId) {
      return interaction.editReply("❌ Couldn’t determine the target channel.");
    }

    let board = await fetchBoard(db, guildId, channelId);

    try {
      if (sub === "set") {
        const titleInput = parseUserText(interaction.options.getString("title", false));
        const title = clampTitle(titleInput || board?.title || "Patch Notes");

        if (!board) {
          board = await upsertBoard(db, guildId, channelId, {
            title,
            content: "",
            paused: false,
            updatedBy: interaction.user.id,
          });
        } else {
          board = await updateContent(db, guildId, channelId, {
            title,
            content: board.content ?? "",
            updatedBy: interaction.user.id,
          });
        }

        if (board.paused) {
          return interaction.editReply(
            `✅ Patch board saved for <#${channelId}>, but updates are currently **paused**.`
          );
        }

        await repostBoard(interaction, board);
        return interaction.editReply(`✅ Patch board posted in <#${channelId}>.`);
      }

      if (sub === "append") {
        const raw = interaction.options.getString("text", true);
        const text = parseUserText(raw);

        if (!board) {
          board = await upsertBoard(db, guildId, channelId, {
            title: "Patch Notes",
            content: "",
            paused: false,
            updatedBy: interaction.user.id,
          });
        }

        const existing = String(board.content ?? "");
        const nextRaw = ensureNewlineForAppend(existing) + text;
        const { text: nextContent, truncated } = clampDescription(nextRaw);

        board = await updateContent(db, guildId, channelId, {
          title: board.title ?? "Patch Notes",
          content: nextContent,
          updatedBy: interaction.user.id,
        });

        if (board.paused) {
          return interaction.editReply(
            `✅ Appended and saved for <#${channelId}> (updates are **paused**, so nothing was reposted).`
          );
        }

        await repostBoard(interaction, board);

        return interaction.editReply(
          `✅ Updated <#${channelId}>.${truncated ? " (Note: content was truncated to fit embed limits.)" : ""}`
        );
      }

      if (sub === "overwrite") {
        const raw = interaction.options.getString("text", true);
        const text = parseUserText(raw);

        const titleInput = parseUserText(interaction.options.getString("title", false));
        const title = clampTitle(titleInput || board?.title || "Patch Notes");

        const { text: nextContent, truncated } = clampDescription(text);

        if (!board) {
          board = await upsertBoard(db, guildId, channelId, {
            title,
            content: nextContent,
            paused: false,
            updatedBy: interaction.user.id,
          });
        } else {
          board = await updateContent(db, guildId, channelId, {
            title,
            content: nextContent,
            updatedBy: interaction.user.id,
          });
        }

        if (board.paused) {
          return interaction.editReply(
            `✅ Overwrote and saved for <#${channelId}> (updates are **paused**, so nothing was reposted).`
          );
        }

        await repostBoard(interaction, board);
        return interaction.editReply(
          `✅ Overwrote <#${channelId}>.${truncated ? " (Note: content was truncated to fit embed limits.)" : ""}`
        );
      }

      if (sub === "pause") {
        if (!board) {
          board = await upsertBoard(db, guildId, channelId, {
            title: "Patch Notes",
            content: "",
            paused: true,
            updatedBy: interaction.user.id,
          });
        } else {
          board = await setPaused(db, guildId, channelId, true, interaction.user.id);
        }

        return interaction.editReply(`⏸️ Updates paused for <#${channelId}>.`);
      }

      if (sub === "resume") {
        if (!board) {
          board = await upsertBoard(db, guildId, channelId, {
            title: "Patch Notes",
            content: "",
            paused: false,
            updatedBy: interaction.user.id,
          });
        } else {
          board = await setPaused(db, guildId, channelId, false, interaction.user.id);
        }

        await repostBoard(interaction, board);
        return interaction.editReply(`▶️ Updates resumed and reposted in <#${channelId}>.`);
      }

      if (sub === "show") {
        if (!board) {
          return interaction.editReply(
            `No patch board exists for <#${channelId}> yet. Use \`/patchboard set\` first.`
          );
        }

        const status = board.paused ? "PAUSED" : "ACTIVE";
        const title = board.title ?? "Patch Notes";
        const content = String(board.content ?? "");
        const safe = content.replace(/```/g, "``\\`");

        return interaction.editReply(
          `**Patchboard for <#${channelId}>** (${status})\n` +
            `**Title:** ${title}\n` +
            `**Stored content:**\n` +
            "```md\n" +
            (safe.length ? safe : "(empty)") +
            "\n```"
        );
      }

      if (sub === "repost") {
        if (!board) {
          return interaction.editReply(
            `No patch board exists for <#${channelId}> yet. Use \`/patchboard set\` first.`
          );
        }

        if (board.paused) {
          return interaction.editReply(
            `⏸️ Updates are paused for <#${channelId}>. Use \`/patchboard resume\` to repost again.`
          );
        }

        await repostBoard(interaction, board);
        return interaction.editReply(`✅ Reposted patch board in <#${channelId}>.`);
      }

      return interaction.editReply("Unknown subcommand.");
    } catch (err) {
      console.error("[patchboard] error:", err);
      return interaction.editReply(`❌ Patchboard failed: ${err?.message || "Unknown error"}`);
    }
  },
};
