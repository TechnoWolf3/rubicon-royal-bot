const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getOrCreateGuildPlayer } = require("../utils/music/playerManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song (name or link) and open the music panel")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Song name or link").setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query", true);

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "Join a voice channel first, then use `/play` 🙂",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const player = getOrCreateGuildPlayer(interaction.guild.id);

    await player.connect(voiceChannel);

    const added = await player.enqueue(query, interaction.user);

    await player.ensurePanel(interaction.channel);
    await player.refreshPanel(interaction.client);

    await interaction.editReply({
      content:
        added?.count > 1
          ? `✅ Queued **${added.count}** tracks.`
          : `✅ Queued: **${added.title || "track"}**`,
    });
  },
};
