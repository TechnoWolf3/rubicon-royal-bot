const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");
const { getOrCreateGuildPlayer } = require("./playerManager");

async function handleMusicInteraction(interaction, client) {
  const id = interaction.customId || "";
  if (!id.startsWith("music:")) return false;

  const player = getOrCreateGuildPlayer(interaction.guildId);

  // Buttons
  if (interaction.isButton()) {
    // Add button uses modal, so don’t defer for that one
    if (id === "music:add") {
      const modal = new ModalBuilder()
        .setCustomId("music:addModal")
        .setTitle("Add to queue");

      const input = new TextInputBuilder()
        .setCustomId("query")
        .setLabel("Song name or link (Spotify / SoundCloud / YouTube)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    if (id === "music:pause") await player.pauseToggle(client);
    else if (id === "music:skip") await player.skip(client);
    else if (id === "music:stop") await player.stop(client);
    else if (id === "music:shuffle") await player.shuffle(client);
    else if (id === "music:loop") await player.cycleLoop(client);

    await interaction.editReply({ content: "✅ Done." }).catch(() => {});
    return true;
  }

  // Select menu
  if (interaction.isStringSelectMenu() && id === "music:jump") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const idx = Number(interaction.values?.[0] ?? "0");
    await player.jumpTo(idx, client);
    await interaction.editReply({ content: "✅ Jumped." }).catch(() => {});
    return true;
  }

  // Modal submit
  if (interaction.isModalSubmit() && id === "music:addModal") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const query = interaction.fields.getTextInputValue("query");
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.editReply({ content: "Join a voice channel first 🙂" }).catch(() => {});
      return true;
    }

    await player.connect(voiceChannel);

    const added = await player.enqueue(query, interaction.user);
    await player.ensurePanel(interaction.channel);
    await player.refreshPanel(client);

    await interaction
      .editReply({
        content:
          added?.count > 1
            ? `✅ Queued **${added.count}** tracks.`
            : `✅ Queued: **${added.title || "track"}**`,
      })
      .catch(() => {});
    return true;
  }

  return false;
}

module.exports = { handleMusicInteraction };
