const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addServerBank } = require("../utils/economy");

const ALLOWED_ROLE_ID = "741251069002121236";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addserverbal")
    .setDescription("Add to the server bank (role restricted).")
    .addIntegerOption(opt =>
      opt.setName("amount").setDescription("Amount to add").setRequired(true).setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const hasRole = interaction.member?.roles?.cache?.has(ALLOWED_ROLE_ID);
    if (!hasRole) return interaction.editReply("❌ You do not have permission to use this.");

    const amount = interaction.options.getInteger("amount", true);
    const bank = await addServerBank(interaction.guildId, amount, "add_server_bank", { by: interaction.user.id });

    return interaction.editReply(`✅ Added **$${amount.toLocaleString()}** to server bank. New bank: **$${bank.toLocaleString()}**`);
  },
};
