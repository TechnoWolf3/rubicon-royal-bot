// commands/roles.js
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { listBoardIds, loadBoard, buildBoardMessage } = require("../utils/roleBoards");


async function upsertBoardMessage(db, { guildId, boardId, channelId, messageId }) {
  await db.query(
    `
    INSERT INTO role_boards (guild_id, board_id, channel_id, message_id, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (guild_id, board_id)
    DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id, updated_at = NOW()
    `,
    [guildId, boardId, channelId, messageId]
  );
}

async function getBoardMessageRow(db, { guildId, boardId }) {
  const res = await db.query(
    `SELECT guild_id, board_id, channel_id, message_id FROM role_boards WHERE guild_id=$1 AND board_id=$2`,
    [guildId, boardId]
  );
  return res.rows[0] || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription("Manage self-assign role boards")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("List available role boards from /data/roleboards")
    )
    .addSubcommand((s) =>
      s
        .setName("post")
        .setDescription("Post a role board (stores the message for persistence)")
        .addStringOption((o) =>
          o.setName("board").setDescription("Board ID (filename)").setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post in (overrides file)")
        )
    )
    .addSubcommand((s) =>
      s
        .setName("sync")
        .setDescription("Sync (edit) an existing posted board from the JSON file")
        .addStringOption((o) =>
          o.setName("board").setDescription("Board ID (filename)").setRequired(true)
        )
    ),

  async execute(interaction) {
    const db = interaction.client?.db;
    if (!db?.query) {
      return interaction.reply({ content: "Database is not initialised on the client.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const ids = listBoardIds();
      if (!ids.length) {
        return interaction.reply({ content: "No boards found in `data/roleboards/*.json`.", ephemeral: true });
      }
      return interaction.reply({ content: `Boards:\n- ${ids.join("\n- ")}`, ephemeral: true });
    }

    if (sub === "post") {
      const boardId = interaction.options.getString("board", true);
      const board = loadBoard(boardId);

      const overrideChannel = interaction.options.getChannel("channel");
      const channelId = overrideChannel?.id || board.channelId || interaction.channelId;

      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ content: "That channel isn't a text channel I can post in.", ephemeral: true });
      }

      const payload = buildBoardMessage(board);

      // Post new message
      const msg = await channel.send(payload);

      // Save message id so restart is fine
      await upsertBoardMessage(db, {
        guildId: interaction.guildId,
        boardId,
        channelId: channel.id,
        messageId: msg.id,
      });

      return interaction.reply({
        content: `Posted **${boardId}** in ${channel}. (Saved for persistence)`,
        ephemeral: true,
      });
    }

    if (sub === "sync") {
      const boardId = interaction.options.getString("board", true);
      const board = loadBoard(boardId);

      const row = await getBoardMessageRow(db, { guildId: interaction.guildId, boardId });
      if (!row) {
        return interaction.reply({
          content: `I don't have a posted message saved for **${boardId}** yet. Use \`/roles post board:${boardId}\` first.`,
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ content: "Saved channel no longer exists or isn't text-based.", ephemeral: true });
      }

      const msg = await channel.messages.fetch(row.message_id).catch(() => null);
      if (!msg) {
        return interaction.reply({
          content: "I couldn't find the saved message (it may have been deleted). Re-post it with `/roles post`.",
          ephemeral: true,
        });
      }

      const payload = buildBoardMessage(board);
      await msg.edit(payload);

      return interaction.reply({ content: `Synced **${boardId}**.`, ephemeral: true });
    }
  },
};
