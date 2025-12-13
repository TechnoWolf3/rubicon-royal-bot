// commands/addbalance.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

function getDbQuery() {
  // Tries to support whichever style your utils/db.js exports
  const db = require("../utils/db");
  if (typeof db.query === "function") return db.query.bind(db);
  if (db.pool && typeof db.pool.query === "function") return db.pool.query.bind(db.pool);
  throw new Error("utils/db.js must export either { query } or { pool }");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addbalance")
    .setDescription("Add money to a user's balance (admin only). Does NOT use the server bank.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to credit").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount to add")
        .setRequired(true)
        .setMinValue(1)
    )
    // Discord-side permission gate
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      if (!interaction.inGuild()) {
        return interaction.editReply("❌ This command can only be used in a server.");
      }

      // Extra safety gate (in case perms were edited)
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("❌ You need **Administrator** permissions to use this.");
      }

      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);

      if (!Number.isFinite(amount) || amount <= 0) {
        return interaction.editReply("❌ Amount must be a positive number.");
      }

      const query = getDbQuery();
      const guildId = interaction.guildId;
      const userId = target.id;

      // Ensure guild exists
      await query(
        `INSERT INTO guilds (guild_id) VALUES ($1)
         ON CONFLICT (guild_id) DO NOTHING`,
        [guildId]
      );

      // Upsert + add
      const updated = await query(
        `INSERT INTO user_balances (guild_id, user_id, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance
         RETURNING balance`,
        [guildId, userId, amount]
      );

      const newBal = Number(updated.rows?.[0]?.balance ?? 0);

      // Optional audit log
      await query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          guildId,
          userId,
          amount,
          "admin_addbalance_mint",
          JSON.stringify({
            by: interaction.user.id,
            to: userId,
            channelId: interaction.channelId,
          }),
        ]
      );

      return interaction.editReply(
        `✅ Added **$${amount.toLocaleString()}** to ${target}.\n` +
          `New balance: **$${newBal.toLocaleString()}**`
      );
    } catch (err) {
      console.error("AddBalance crashed:", err);
      return interaction.editReply(
        "❌ Something went wrong running that command. Check Railway logs."
      );
    }
  },
};
