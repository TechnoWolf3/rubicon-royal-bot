const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { pool } = require("../utils/db");
const { ensureUser, creditUser } = require("../utils/economy");

function nextSydneyMidnightUTC() {
  // Get "now" in Australia/Sydney, then compute next midnight there
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {});

  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  // Next day at 00:00 Sydney time
  const next = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  // Convert that “Sydney midnight” into actual UTC instant:
  // Trick: format that UTC instant back into Sydney time; adjust by offset
  const sydneyAtUTC = new Date(next.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  const utcAtUTC = new Date(next.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = sydneyAtUTC.getTime() - utcAtUTC.getTime();

  return new Date(next.getTime() - offsetMs);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily bonus (resets at midnight AEST/AEDT)."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const now = new Date();
    const key = "daily";

    const cd = await pool.query(
      `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
      [guildId, userId, key]
    );

    if (cd.rowCount > 0) {
      const next = new Date(cd.rows[0].next_claim_at);
      if (now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        return interaction.editReply(`⏳ You’ve already claimed. Come back <t:${unix}:R>.`);
      }
    }

    const amount = Math.floor(100 + Math.random() * 401); // 100–500
    const nextClaim = nextSydneyMidnightUTC();

    await pool.query(
      `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
      [guildId, userId, key, nextClaim]
    );

    await creditUser(guildId, userId, amount, "daily", { reset: "midnight_sydney" });

    return interaction.editReply(`🎁 Daily claimed: **$${amount.toLocaleString()}** (resets at midnight AEST/AEDT).`);
  },
};
