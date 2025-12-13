const { SlashCommandBuilder } = require("discord.js");
const { pool } = require("../utils/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show top 5 balances."),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: "❌ Server only.", ephemeral: true });

    const res = await pool.query(
      `SELECT user_id, balance
       FROM user_balances
       WHERE guild_id=$1
       ORDER BY balance DESC
       LIMIT 5`,
      [interaction.guildId]
    );

    if (res.rowCount === 0) {
      return interaction.reply({ content: "No balances yet.", ephemeral: true });
    }

    const lines = res.rows.map((r, idx) => {
      const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][idx] ?? "•";
      return `${medal} <@${r.user_id}> — **$${Number(r.balance).toLocaleString()}**`;
    });

    return interaction.reply({ content: `🏆 **Top 5**\n${lines.join("\n")}` });
  },
};
