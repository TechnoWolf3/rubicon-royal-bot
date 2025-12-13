const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { getServerBank } = require("../utils/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serverbal")
    .setDescription("Show the server bank balance (admin only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const bank = await getServerBank(interaction.guildId);
    return interaction.editReply(`🏦 Server bank balance: **$${bank.toLocaleString()}**`);
  },
};
