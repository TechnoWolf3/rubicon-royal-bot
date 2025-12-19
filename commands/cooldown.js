// commands/cooldown.js
const { SlashCommandBuilder } = require("discord.js");
const { pool } = require("../utils/db");

// Role allowed to manage cooldowns
const COOLDOWN_ADMIN_ROLE_ID = "741251069002121236";

function hasPermission(interaction) {
  return interaction.member?.roles?.cache?.has(COOLDOWN_ADMIN_ROLE_ID);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cooldown")
    .setDescription("Clear job or crime cooldowns (role restricted).")
    .addSubcommand((s) =>
      s
        .setName("clear")
        .setDescription("Clear cooldown(s) for a user in this guild.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("User to clear cooldowns for (default: you)")
            .setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription('Cooldown key (e.g. "job", "crime_heist") or "all"')
            .setRequired(false)
        )
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
    const keyRaw = interaction.options.getString("key") || "all";

    try {
      let result;

      if (keyRaw.toLowerCase() === "all") {
        result = await pool.query(
          `DELETE FROM cooldowns WHERE guild_id=$1 AND user_id=$2`,
          [guildId, targetUser.id]
        );
      } else {
        result = await pool.query(
          `DELETE FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
          [guildId, targetUser.id, keyRaw]
        );
      }

      const cleared = result?.rowCount ?? 0;

      return interaction.editReply(
        `✅ Cleared **${cleared}** cooldown(s) for **${targetUser.username}**\n` +
        `Key: **${keyRaw === "all" ? "ALL" : keyRaw}**`
      );
    } catch (err) {
      console.error("Cooldown clear error:", err);
      return interaction.editReply("❌ Failed to clear cooldowns. Check Railway logs.");
    }
  },
};
