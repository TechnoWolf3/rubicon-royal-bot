// commands/job.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { pool } = require("../utils/db");
const { ensureUser, creditUser } = require("../utils/economy");
const { guardNotJailed } = require("../utils/jail");

/* ============================================================
   ✅ EASY BALANCE TUNING (EDIT HERE)
   ============================================================ */
const JOB_COOLDOWN_SECONDS = 30;       // per-user cooldown between payouts
const BOARD_INACTIVITY_MS = 3 * 60_000; // board auto-clears after 3 minutes idle

const JOBS = [
  {
    id: "courier",
    name: "📦 Courier Run",
    desc: "Deliver a package across the city.",
    min: 800,
    max: 1500,
    bonusChance: 0.06,
    bonusMin: 1000,
    bonusMax: 2500,
    successLines: [
      "Smooth delivery. No drama, easy money.",
      "Traffic was cooked, but you made it on time.",
      "Customer tipped you for the hustle.",
    ],
    bonusLines: [
      "Big tip day. Somebody’s feeling generous!",
      "VIP delivery — you got paid extra.",
    ],
  },
  {
    id: "fishing",
    name: "🎣 Fishing Trip",
    desc: "Cast a line and see what bites.",
    min: 500,
    max: 1200,
    bonusChance: 0.04,
    bonusMin: 1500,
    bonusMax: 4000,
    successLines: [
      "Decent haul. Fresh fish, fresh cash.",
      "You didn’t catch a monster, but you sold enough.",
      "Quiet waters, steady profit.",
    ],
    bonusLines: [
      "You pulled a rare one — collectors paid up.",
      "Legendary catch! That’s rent money.",
    ],
  },
  {
    id: "mining",
    name: "⛏️ Mining Shift",
    desc: "Chip away at rock for ore and valuables.",
    min: 900,
    max: 1800,
    bonusChance: 0.05,
    bonusMin: 2000,
    bonusMax: 5000,
    successLines: [
      "Ore prices were good today. Nice work.",
      "Solid run — you filled a few crates.",
      "Dusty, loud, profitable.",
    ],
    bonusLines: [
      "You hit a gem vein! Jackpot.",
      "Rare find — you sold it immediately.",
    ],
  },
];
/* ============================================================ */

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildJobMenuEmbed(user) {
  return new EmbedBuilder()
    .setTitle("🧰 Job Board")
    .setDescription(
      [
        `Pick a job to do right now, **${user.username}**.`,
        `Cooldown between payouts: **${JOB_COOLDOWN_SECONDS}s**.`,
        `Board auto-clears after **3 minutes** of inactivity (or press **Stop Work**).`,
        "",
        ...JOBS.map((j) => `**${j.name}** — ${j.desc}`),
      ].join("\n")
    )
    .setFooter({ text: "Jobs pay instantly. Use Stop Work to clear the board." });
}

function buildJobButtons(disabled = false) {
  const rows = [];

  // Row 1: up to 5 job buttons
  const row1 = new ActionRowBuilder();
  for (const j of JOBS.slice(0, 5)) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_pick:${j.id}`)
        .setLabel(j.name)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }
  rows.push(row1);

  // Row 2: Stop Work
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel("🛑 Stop Work")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
  rows.push(row2);

  return rows;
}

async function getCooldown(guildId, userId, key) {
  const cd = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, key]
  );
  if (cd.rowCount === 0) return null;
  return new Date(cd.rows[0].next_claim_at);
}

async function setCooldown(guildId, userId, key, nextClaim) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [guildId, userId, key, nextClaim]
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("job")
    .setDescription("Open the job board and work for quick money."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    // Post the board publicly (cleaner if you use a bot-games channel)
    const menuMsg = await interaction.channel.send({
      embeds: [buildJobMenuEmbed(interaction.user)],
      components: buildJobButtons(false),
    });

    await interaction.editReply("✅ Job board posted. Use the buttons to work (press **Stop Work** when done).");

    const collector = menuMsg.createMessageComponentCollector({
      time: BOARD_INACTIVITY_MS,
    });

    collector.on("collect", async (btn) => {
      try {
        // Only the caller can use this board
        if (btn.user.id !== userId) {
          return btn
            .reply({ content: "❌ This job board isn’t for you.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }

        // Any interaction resets inactivity timer
        collector.resetTimer({ time: BOARD_INACTIVITY_MS });

        // Stop Work
        if (btn.customId === "job_stop") {
          await btn.deferUpdate().catch(() => {});
          collector.stop("stopped");
          return;
        }

        // Job pick
        if (!btn.customId.startsWith("job_pick:")) return;

        await btn.deferUpdate().catch(() => {});

        // Cooldown check happens on payout (NOT on /job)
        const key = "job";
        const now = new Date();
        const next = await getCooldown(guildId, userId, key);

        if (next && now < next) {
          const unix = Math.floor(next.getTime() / 1000);
          // Update the message briefly (no spam). Keep board alive.
          const embed = new EmbedBuilder()
            .setTitle("⏳ Slow down")
            .setDescription(`You can work again <t:${unix}:R>.`)
            .setFooter({ text: "Board stays open. Pick a job when ready." });

          await menuMsg.edit({ embeds: [embed], components: buildJobButtons(false) }).catch(() => {});
          return;
        }

        const [, choice] = btn.customId.split(":");
        const job = JOBS.find((j) => j.id === choice);
        if (!job) return;

        // Set next claim time now (so no double-click abuse)
        const nextClaim = new Date(Date.now() + JOB_COOLDOWN_SECONDS * 1000);
        await setCooldown(guildId, userId, key, nextClaim);

        // Roll payout
        let amount = randInt(job.min, job.max);
        let line = pick(job.successLines);

        if (job.bonusChance && Math.random() < job.bonusChance) {
          const bonus = randInt(job.bonusMin ?? 0, job.bonusMax ?? 0);
          amount += bonus;
          line = `✨ ${pick(job.bonusLines)} (+$${bonus.toLocaleString()})`;
        }

        // Mint to user (NOT bank)
        await creditUser(guildId, userId, amount, `job_${job.id}`, {
          job: job.id,
          reset: `${JOB_COOLDOWN_SECONDS}s`,
        });

        // Update the same board message (no spam)
        const resultEmbed = new EmbedBuilder()
          .setTitle(`🧰 Working: ${job.name}`)
          .setDescription(
            [
              line,
              "",
              `✅ You earned **$${amount.toLocaleString()}**`,
              `⏳ Next work: <t:${Math.floor(nextClaim.getTime() / 1000)}:R>`,
              "",
              "Pick another job whenever you’re off cooldown, or press **Stop Work**.",
            ].join("\n")
          )
          .setFooter({ text: `Job ID: ${job.id}` });

        await menuMsg.edit({
          embeds: [resultEmbed],
          components: buildJobButtons(false),
        }).catch(() => {});
      } catch (e) {
        console.error("/job button error:", e);
        collector.stop("error");
      }
    });

    collector.on("end", async (_collected, reason) => {
      // Disable then delete (clear) — per your requirement
      try {
        await menuMsg.edit({
          components: buildJobButtons(true),
        });
      } catch {}

      // Clear after stop or inactivity
      setTimeout(() => menuMsg.delete().catch(() => {}), 1000);
    });
  },
};
