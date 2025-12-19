// commands/setjail.js
const { SlashCommandBuilder } = require("discord.js");
const { setJail, clearJail, getJailInfo } = require("../utils/jail");

const JAIL_ADMIN_ROLE_ID = "741251069002121236";

function hasPermission(interaction) {
  return interaction.member?.roles?.cache?.has(JAIL_ADMIN_ROLE_ID);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setjail")
    .setDescription("Admin: set, extend, or clear jail time for a user.")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("User to jail / modify")
        .setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("Minutes to jail. Use 0 to clear jail.")
        .setMinValue(0)
        .setMaxValue(720) // safety cap: 12 hours
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Reason (optional)")
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      return interaction.editReply("❌ Server only.");
    }

    if (!hasPermission(interaction)) {
      return interaction.editReply("❌ You do not have permission to use this command.");
    }

    const guildId = interaction.guildId;
    const target = interaction.options.getUser("user");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason") || "Admin action";

    try {
      // CLEAR JAIL
      if (minutes === 0) {
        await clearJail(guildId, target.id);
        return interaction.editReply(`🟢 Jail cleared for **${target.username}**.`);
      }

      const existing = await getJailInfo(guildId, target.id);

      let totalMinutes = minutes;

      if (existing) {
        const remaining = Math.ceil(existing.remainingMs / 60000);
        totalMinutes += remaining;
      }

      const releaseAt = new Date(Date.now() + totalMinutes * 60 * 1000);
      await setJail(guildId, target.id, releaseAt);

      return interaction.editReply(
        `⛓️ **${target.username}** jailed\n` +
        `• Time: **${totalMinutes} minutes**\n` +
        `• Release: <t:${Math.floor(releaseAt.getTime() / 1000)}:R>\n` +
        `• Reason: *${reason}*`
      );
    } catch (err) {
      console.error("setjail error:", err);
      return interaction.editReply("❌ Failed to modify jail time. Check logs.");
    }
  },
};
