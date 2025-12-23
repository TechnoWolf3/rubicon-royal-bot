const { SlashCommandBuilder } = require("discord.js");
const { getOrCreateGuildPlayer } = require("../utils/music/playerManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music (Spotify link, SoundCloud link, or search)")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Song name or link (Spotify/SoundCloud)")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const query = interaction.options.getString("query", true);

      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.editReply("❌ You need to be in a voice channel first.");
      }

      const player = getOrCreateGuildPlayer(interaction.guildId);

      await player.connect(voiceChannel);

      const res = await player.enqueue(query, interaction.user);

      // Ensure the panel is posted/updated in the channel the command was used in
      await player.ensurePanel(interaction.channel);

      // Refresh the panel after enqueue attempt
      await player.refreshPanel(interaction.client);

      return interaction.editReply(`✅ Queued: **${res.title}**${res.count > 1 ? ` (+${res.count - 1} more)` : ""}`);
    } catch (err) {
      console.error("Command error:", err);

      const msg =
        err?.message?.includes("No playable SoundCloud match")
          ? "❌ I couldn’t find a playable SoundCloud match for that Spotify track.\nTry a different song name, or paste a SoundCloud link."
          : `❌ ${err?.message || "Something went wrong while trying to play that."}`;

      // still keep panel visible if it exists
      try {
        const player = getOrCreateGuildPlayer(interaction.guildId);
        await player.refreshPanel(interaction.client);
      } catch {}

      return interaction.editReply(msg);
    }
  },
};
