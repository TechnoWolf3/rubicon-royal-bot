const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

function buildBoardEmbed({ boardName, description, emoji, roleId }) {
  const title = `🔔 Updates: ${boardName}`;
  const desc =
    `${description?.trim() ? `${description.trim()}\n\n` : ""}` +
    `React with ${emoji} to receive updates about **${boardName}**.\n` +
    `React again (remove your reaction) to opt out.\n\n` +
    `Role: <@&${roleId}>`;

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: "Rubicon Royal • Opt-in update pings" });
}

async function getBoardByChannel(db, guildId, channelId) {
  const res = await db.query(
    `SELECT * FROM role_boards WHERE guild_id = $1 AND channel_id = $2`,
    [guildId, channelId]
  );
  return res.rows?.[0] ?? null;
}

async function upsertBoard(db, guildId, channelId, data) {
  const res = await db.query(
    `INSERT INTO role_boards (guild_id, channel_id, message_id, board_name, role_id, emoji, description, sticky, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (guild_id, channel_id) DO UPDATE SET
       message_id = EXCLUDED.message_id,
       board_name = EXCLUDED.board_name,
       role_id = EXCLUDED.role_id,
       emoji = EXCLUDED.emoji,
       description = EXCLUDED.description,
       sticky = EXCLUDED.sticky,
       updated_at = NOW()
     RETURNING *`,
    [
      guildId,
      channelId,
      data.message_id ?? null,
      data.board_name,
      data.role_id,
      data.emoji,
      data.description ?? "",
      !!data.sticky,
    ]
  );
  return res.rows?.[0] ?? null;
}

async function deleteBoard(db, guildId, channelId) {
  await db.query(`DELETE FROM role_boards WHERE guild_id = $1 AND channel_id = $2`, [
    guildId,
    channelId,
  ]);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("board")
    .setDescription("Create/update a reaction role board for opt-in game pings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create (or replace) the role board in a channel.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to post the board in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption((o) =>
          o.setName("name").setDescription("Board name (e.g., Rust, FiveM, ARK)").setRequired(true)
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role to grant on react").setRequired(true))
        .addStringOption((o) =>
          o.setName("emoji").setDescription("Emoji to react with (unicode or custom emoji)").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("Optional extra text under the title").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("update")
        .setDescription("Update the existing board in a channel (edits the message).")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel that contains the board")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption((o) => o.setName("name").setDescription("New board name").setRequired(false))
        .addRoleOption((o) => o.setName("role").setDescription("New role").setRequired(false))
        .addStringOption((o) => o.setName("emoji").setDescription("New emoji").setRequired(false))
        .addStringOption((o) => o.setName("description").setDescription("New description").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("bump")
        .setDescription("Repost the board so it becomes the latest message in the channel.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel that contains the board")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List all boards in this server.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete the board config (optionally delete the message).")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel that contains the board")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((o) =>
          o.setName("delete_message").setDescription("Also delete the board message").setRequired(false)
        )
    ),

  async execute(interaction) {
    const db = interaction.client.db;
    if (!db) {
      return interaction.reply({
        content: "❌ Database is not available (DATABASE_URL missing).",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "list") {
      const res = await db.query(
        `SELECT channel_id, message_id, board_name, role_id, emoji, updated_at
         FROM role_boards
         WHERE guild_id = $1
         ORDER BY updated_at DESC`,
        [guildId]
      );

      if (!res.rows?.length) {
        return interaction.reply({ content: "No boards set up yet.", flags: MessageFlags.Ephemeral });
      }

      const lines = res.rows.map((r) => {
        return `• <#${r.channel_id}> — **${r.board_name}** ${r.emoji} → <@&${r.role_id}>`;
      });

      return interaction.reply({
        content: `**Role Boards:**\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.options.getChannel("channel", true);

    if (sub === "create") {
      const name = interaction.options.getString("name", true);
      const role = interaction.options.getRole("role", true);
      const emoji = interaction.options.getString("emoji", true).trim();
      const description = interaction.options.getString("description") ?? "";

      // Post new message
      const embed = buildBoardEmbed({ boardName: name, description, emoji, roleId: role.id });

      const msg = await channel.send({ embeds: [embed] });

      // React with the emoji
      try {
        await msg.react(emoji);
      } catch (e) {
        // If the emoji react fails, cleanly warn but keep the board created (they can fix emoji and /board update)
        console.warn("[board] react failed:", e?.message ?? e);
      }

      await upsertBoard(db, guildId, channel.id, {
        message_id: msg.id,
        board_name: name,
        role_id: role.id,
        emoji,
        description,
        sticky: false,
      });

      return interaction.reply({
        content: `✅ Board created in ${channel} for **${name}** using ${emoji} → <@&${role.id}>`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "update") {
      const existing = await getBoardByChannel(db, guildId, channel.id);
      if (!existing?.message_id) {
        return interaction.reply({
          content: `❌ No board found for ${channel}. Use \`/board create\` first.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const name = interaction.options.getString("name") ?? existing.board_name;
      const role = interaction.options.getRole("role") ?? { id: existing.role_id };
      const emoji = (interaction.options.getString("emoji") ?? existing.emoji).trim();
      const description = interaction.options.getString("description");
      const newDesc = description !== null && description !== undefined ? description : existing.description;

      const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
      if (!msg) {
        return interaction.reply({
          content: `❌ I couldn't fetch the existing board message in ${channel}. Try \`/board bump\` to recreate it.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = buildBoardEmbed({ boardName: name, description: newDesc, emoji, roleId: role.id });
      await msg.edit({ embeds: [embed] });

      // Ensure the reaction exists (best effort)
      try {
        await msg.react(emoji);
      } catch {}

      await upsertBoard(db, guildId, channel.id, {
        message_id: msg.id,
        board_name: name,
        role_id: role.id,
        emoji,
        description: newDesc,
        sticky: false,
      });

      return interaction.reply({
        content: `✅ Board updated in ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "bump") {
      const existing = await getBoardByChannel(db, guildId, channel.id);
      if (!existing) {
        return interaction.reply({
          content: `❌ No board found for ${channel}. Use \`/board create\` first.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Try delete old message (optional, best effort)
      if (existing.message_id) {
        const oldMsg = await channel.messages.fetch(existing.message_id).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      }

      const embed = buildBoardEmbed({
        boardName: existing.board_name,
        description: existing.description,
        emoji: existing.emoji,
        roleId: existing.role_id,
      });

      const newMsg = await channel.send({ embeds: [embed] });
      try {
        await newMsg.react(existing.emoji);
      } catch {}

      await upsertBoard(db, guildId, channel.id, {
        message_id: newMsg.id,
        board_name: existing.board_name,
        role_id: existing.role_id,
        emoji: existing.emoji,
        description: existing.description,
        sticky: false,
      });

      return interaction.reply({
        content: `✅ Board bumped in ${channel} (now the latest message).`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "delete") {
      const deleteMessage = interaction.options.getBoolean("delete_message") ?? false;
      const existing = await getBoardByChannel(db, guildId, channel.id);

      if (deleteMessage && existing?.message_id) {
        const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }

      await deleteBoard(db, guildId, channel.id);

      return interaction.reply({
        content: `✅ Board deleted for ${channel}.${deleteMessage ? " (Message deleted too.)" : ""}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
