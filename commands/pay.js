// commands/pay.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Transfer money to another user (player-to-player).")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Who to pay").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount to pay")
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    if (!interaction.inGuild()) {
      return interaction.editReply("❌ Server only.").catch(() => {});
    }

    const db = interaction.client.db;
    if (!db) {
      return interaction
        .editReply("❌ Database not configured (DATABASE_URL missing).")
        .catch(() => {});
    }

    const guildId = interaction.guildId;
    const fromId = interaction.user.id;
    const target = interaction.options.getUser("user", true);
    const toId = target.id;

    const amount = interaction.options.getInteger("amount", true);

    if (toId === fromId) {
      return interaction.editReply("❌ You can’t pay yourself.").catch(() => {});
    }
    if (target.bot) {
      return interaction.editReply("❌ You can’t pay a bot.").catch(() => {});
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Ensure both balance rows exist
      await client.query(
        `INSERT INTO public.user_balances (guild_id, user_id, balance)
         VALUES ($1,$2,0)
         ON CONFLICT (guild_id, user_id) DO NOTHING`,
        [guildId, fromId]
      );

      await client.query(
        `INSERT INTO public.user_balances (guild_id, user_id, balance)
         VALUES ($1,$2,0)
         ON CONFLICT (guild_id, user_id) DO NOTHING`,
        [guildId, toId]
      );

      // Debit sender ONLY if they have enough
      const debitRes = await client.query(
        `UPDATE public.user_balances
         SET balance = balance - $1
         WHERE guild_id = $2
           AND user_id = $3
           AND balance >= $1
         RETURNING balance`,
        [amount, guildId, fromId]
      );

      if (debitRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return interaction
          .editReply(`❌ You don’t have enough balance to pay **$${amount.toLocaleString()}**.`)
          .catch(() => {});
      }

      // Credit receiver
      const creditRes = await client.query(
        `UPDATE public.user_balances
         SET balance = balance + $1
         WHERE guild_id = $2
           AND user_id = $3
         RETURNING balance`,
        [amount, guildId, toId]
      );

      // Best-effort transaction logging (schema-tolerant)
      try {
        const colsRes = await client.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'transactions'`
        );

        const cols = new Set((colsRes.rows || []).map((r) => r.column_name));
        const hasCore =
          cols.has("guild_id") &&
          cols.has("user_id") &&
          (cols.has("type") || cols.has("tx_type")) &&
          (cols.has("amount") || cols.has("value")) &&
          (cols.has("created_at") || cols.has("createdAt") || cols.has("timestamp"));

        if (hasCore) {
          const typeCol = cols.has("type") ? "type" : "tx_type";
          const amountCol = cols.has("amount") ? "amount" : "value";
          const createdCol = cols.has("created_at")
            ? "created_at"
            : cols.has("createdAt")
            ? "createdAt"
            : "timestamp";

          const noteCol = cols.has("note")
            ? "note"
            : cols.has("description")
            ? "description"
            : cols.has("reason")
            ? "reason"
            : null;

          const note = `Pay: ${fromId} -> ${toId}`;

          if (noteCol) {
            await client.query(
              `INSERT INTO public.transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${noteCol}, ${createdCol})
               VALUES ($1,$2,$3,$4,$5,NOW())`,
              [guildId, fromId, "PAY_OUT", amount, note]
            );
            await client.query(
              `INSERT INTO public.transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${noteCol}, ${createdCol})
               VALUES ($1,$2,$3,$4,$5,NOW())`,
              [guildId, toId, "PAY_IN", amount, note]
            );
          } else {
            await client.query(
              `INSERT INTO public.transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${createdCol})
               VALUES ($1,$2,$3,$4,NOW())`,
              [guildId, fromId, "PAY_OUT", amount]
            );
            await client.query(
              `INSERT INTO public.transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${createdCol})
               VALUES ($1,$2,$3,$4,NOW())`,
              [guildId, toId, "PAY_IN", amount]
            );
          }
        }
      } catch {
        // ignore logging failures
      }

      await client.query("COMMIT");

      const fromBal = Number(debitRes.rows?.[0]?.balance ?? 0);
      const toBal = Number(creditRes.rows?.[0]?.balance ?? 0);

      return interaction
        .editReply(
          `✅ Paid **$${amount.toLocaleString()}** to **${target.username}**.\n` +
            `Your balance: **$${fromBal.toLocaleString()}**\n` +
            `${target.username}'s balance: **$${toBal.toLocaleString()}**`
        )
        .catch(() => {});
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      console.error("/pay failed:", e);
      return interaction.editReply("❌ Payment failed. Check Railway logs.").catch(() => {});
    } finally {
      client.release();
    }
  },
};
