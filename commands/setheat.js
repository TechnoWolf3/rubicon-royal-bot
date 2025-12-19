// commands/setheat.js
const { SlashCommandBuilder } = require("discord.js");
const { pool } = require("../utils/db");

// Role allowed to manage heat
const HEAT_ADMIN_ROLE_ID = "741251069002121236";

function hasPermission(interaction) {
  return interaction.member?.roles?.cache?.has(HEAT_ADMIN_ROLE_ID);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setheat")
    .setDescription("Admin: set or clear crime heat for a user (role restricted).")
    // ✅ REQUIRED options must come before optional ones
    .addIntegerOption((o) =>
      o
        .setName("value")
        .setDescription("Heat value (0–100). Use 0 to clear heat.")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("User to modify (default: you)")
        .setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName("ttl")
        .setDescription("How long the heat should last (minutes). Default: 60")
        .setMinValue(1)
        .setMaxValue(4320) // 3 days
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      return interaction.editReply("❌ This command can only be used in a server.");
    }

    if (!hasPermission(interaction)) {
      return interaction.editReply("❌ You do not have permission to use this command.");
    }

    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const heatValue = clamp(interaction.options.getInteger("value"), 0, 100);
    const ttlMinutes = interaction.options.getInteger("ttl") ?? 60;

    try {
      // Clear heat entirely
      if (heatValue === 0) {
        const res = await pool.query(
          `DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`,
          [guildId, targetUser.id]
        );

        return interaction.editReply(
          `🧊 Heat cleared for **${targetUser.username}** (${res.rowCount} row removed).`
        );
      }

      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      await pool.query(
        `
        INSERT INTO crime_heat (guild_id, user_id, heat, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET
          heat = EXCLUDED.heat,
          expires_at = EXCLUDED.expires_at
        `,
        [guildId, targetUser.id, heatValue, expiresAt]
      );

      return interaction.editReply(
        `🔥 Heat set for **${targetUser.username}**\n` +
          `• Heat: **${heatValue}/100**\n` +
          `• Duration: **${ttlMinutes} min** (expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>)`
      );
    } catch (err) {
      console.error("SetHeat error:", err);
      return interaction.editReply("❌ Failed to set heat. Check Railway logs.");
    }
  },
};
