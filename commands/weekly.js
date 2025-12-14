// commands/weekly.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { pool } = require("../utils/db");
const { ensureUser, creditUser } = require("../utils/economy");

// 🚔 Jail guard
const { guardNotJailed } = require("../utils/jail");

/**
 * Returns the next Monday 00:00:00 in Australia/Sydney as a UTC Date.
 * (Handles AEST/AEDT correctly.)
 */
function nextSydneyMondayMidnightUTC() {
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
    weekday: "short",
  })
    .formatToParts(now)
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});

  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  // We need to know the weekday in Sydney
  // Intl weekday short in en-AU: Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const weekday = parts.weekday;
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const isoDow = map[weekday] || 1; // fallback: Mon

  // Days until next Monday (if today is Monday, we want NEXT Monday)
  const daysUntilNextMonday = ((8 - isoDow) % 7) || 7;

  // Build a "Sydney local" target at next Monday 00:00 by creating a UTC date
  // and then adjusting offset the same way as daily.js does.
  const next = new Date(Date.UTC(y, m - 1, d + daysUntilNextMonday, 0, 0, 0));

  // Convert that “Sydney midnight” into actual UTC instant:
  const sydneyAtUTC = new Date(next.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  const utcAtUTC = new Date(next.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = sydneyAtUTC.getTime() - utcAtUTC.getTime();

  return new Date(next.getTime() - offsetMs);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("weekly")
    .setDescription("Claim your weekly bonus (resets Monday 12am AEST/AEDT)."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate for /weekly
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const now = new Date();
    const key = "weekly";

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

    /* ============================================================
       ✅ WEEKLY PAYOUT AMOUNT (EDIT HERE)
       - Set WEEKLY_MIN and WEEKLY_MAX to whatever you want.
       - This mints money directly to the user (NOT the bank).
       ============================================================ */
    const WEEKLY_MIN = 25000;
    const WEEKLY_MAX = 75000;
    const amount = Math.floor(WEEKLY_MIN + Math.random() * (WEEKLY_MAX - WEEKLY_MIN + 1));
    // ============================================================

    const nextClaim = nextSydneyMondayMidnightUTC();

    await pool.query(
      `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
      [guildId, userId, key, nextClaim]
    );

    await creditUser(guildId, userId, amount, "weekly", { reset: "monday_midnight_sydney" });

    return interaction.editReply(
      `🎁 Weekly claimed: **$${amount.toLocaleString()}** (resets Monday 12am AEST/AEDT).`
    );
  },
};
