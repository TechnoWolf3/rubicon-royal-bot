const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { getServerBank, bankToUser } = require("../utils/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addbalance")
    .setDescription("Give a user money from the server bank (admin only).")
    .addUserOption(opt => opt.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);

    const bank = await getServerBank(interaction.guildId);
    if (bank < amount) {
      return interaction.editReply(`❌ Server bank has **$${bank.toLocaleString()}** — not enough for **$${amount.toLocaleString()}**.`);
    }

    await bankToUser(interaction.guildId, user.id, amount, "add_balance", { by: interaction.user.id });

    return interaction.editReply(`✅ Gave <@${user.id}> **$${amount.toLocaleString()}** (from server bank).`);
  },
};
