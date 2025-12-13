const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getBalance } = require("../utils/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bal")
    .setDescription("Show your balance."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const bal = await getBalance(interaction.guildId, interaction.user.id);
    return interaction.editReply(`💰 Your balance: **$${bal.toLocaleString()}**`);
  },
};
