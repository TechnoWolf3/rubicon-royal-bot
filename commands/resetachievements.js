const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const RESET_ROLE_ID = "741251069002121236";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resetachievements")
    .setDescription("Reset ALL achievements for a user.")
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("User whose achievements will be reset")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral });
    }

    // Permission check
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(RESET_ROLE_ID)) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getUser("user");
    const guildId = interaction.guildId;
    const db = interaction.client.db;

    if (!db) {
      return interaction.reply({
        content: "❌ Database not configured.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const cleanUserId = String(target.id);

    try {
      // 1️⃣ Delete earned achievements
      const achRes = await db.query(
        `DELETE FROM public.user_achievements
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, cleanUserId]
      );

      // ✅ NEW: wipe progress counters so progress bars reset too
      await db.query(
        `DELETE FROM public.user_achievement_counters
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, cleanUserId]
      );

      // 2️⃣ Reset blackjack progress (prevents instant re-unlock)
      await db.query(
        `DELETE FROM public.blackjack_stats
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, cleanUserId]
      );

      // Reset message progress (needed for msg_* achievements)
      await db.query(
        `DELETE FROM public.message_stats
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, cleanUserId]
      );

      // (Optional) If you add roulette_stats later, you can also clear it here safely:
      // await db.query(
      //   `DELETE FROM public.roulette_stats WHERE guild_id = $1 AND user_id = $2`,
      //   [guildId, cleanUserId]
      // );

      return interaction.editReply(
        `✅ Reset achievements for **${target.username}**.\n` +
        `🏆 Removed **${achRes.rowCount}** unlocked achievement(s).`
      );
    } catch (e) {
      console.error("resetachievements failed:", e);
      return interaction.editReply("❌ Failed to reset achievements. Check logs.");
    }
  },
};
