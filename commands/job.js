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
const { unlockAchievement } = require("../utils/achievementEngine");

// ✅ Config imports
const nineToFiveIndex = require("../data/nineToFive/index");
const contractCfg = require("../data/nineToFive/transportContract");
const skillCfg = require("../data/nineToFive/skillCheck");
const shiftCfg = require("../data/nineToFive/shift");

const nightWalker = require("../data/nightwalker/index");

/* ============================================================
   CORE TUNING (keep here; configs handle job-specific values)
   ============================================================ */

const JOB_COOLDOWN_SECONDS = 45;
const BOARD_INACTIVITY_MS = 3 * 60_000;

// Legendary (kept in command for now)
const LEGENDARY_CHANCE = 0.012;
const LEGENDARY_TTL_MS = 60_000;
const LEGENDARY_MIN = 50_000;
const LEGENDARY_MAX = 90_000;
const LEGENDARY_SKILL_TIME_MS = 7_000;

// Optional global bonus (kept in command)
const GLOBAL_BONUS_CHANCE = 0.04;
const GLOBAL_BONUS_MIN = 400;
const GLOBAL_BONUS_MAX = 2000;

/* ============================================================
   Leveling
   ============================================================ */
function xpToNext(level) {
  return 100 + (Math.max(1, level) - 1) * 60;
}
function levelMultiplier(level) {
  const mult = 1 + 0.02 * (Math.max(1, level) - 1);
  return Math.min(mult, 1.6);
}

/* ============================================================
   Helpers
   ============================================================ */
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function progressBar(pct, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((pct / 100) * size)));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function safeLabel(s) {
  const t = String(s ?? "").trim();
  if (t.length <= 80) return t;
  return t.slice(0, 77) + "...";
}
function sampleUnique(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

/* ============================================================
   Cooldowns
   ============================================================ */
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
async function getCooldownUnixIfActive(guildId, userId, key) {
  const next = await getCooldown(guildId, userId, key);
  if (!next) return null;
  if (Date.now() >= next.getTime()) return null;
  return Math.floor(next.getTime() / 1000);
}

/* ============================================================
   Job Progress DB
   ============================================================ */
async function ensureJobProgress(guildId, userId) {
  await pool.query(
    `INSERT INTO job_progress (guild_id, user_id, xp, level, total_jobs)
     VALUES ($1,$2,0,1,0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}
async function getJobProgress(guildId, userId) {
  await ensureJobProgress(guildId, userId);
  const res = await pool.query(
    `SELECT xp, level, total_jobs FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  const row = res.rows?.[0] || { xp: 0, level: 1, total_jobs: 0 };
  return {
    xp: Number(row.xp || 0),
    level: Number(row.level || 1),
    totalJobs: Number(row.total_jobs || 0),
  };
}
async function addXpAndMaybeLevel(guildId, userId, addXp, countJob = true) {
  await ensureJobProgress(guildId, userId);

  const cur = await getJobProgress(guildId, userId);
  let xp = cur.xp + Math.max(0, Number(addXp || 0));
  let level = cur.level;
  let leveledUp = false;

  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveledUp = true;
  }

  const upd = await pool.query(
    `UPDATE job_progress
     SET xp=$3,
         level=$4,
         total_jobs = total_jobs + $5,
         updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING xp, level, total_jobs`,
    [guildId, userId, xp, level, countJob ? 1 : 0]
  );

  const row = upd.rows?.[0];
  return {
    xp: Number(row?.xp ?? xp),
    level: Number(row?.level ?? level),
    totalJobs: Number(row?.total_jobs ?? (cur.totalJobs + (countJob ? 1 : 0))),
    leveledUp,
  };
}

/* ============================================================
   Achievements (Jobs)
   ============================================================ */
const JOB_MILESTONES = [
  { count: 1, id: "job_first_fin" },
  { count: 10, id: "job_10_fin" },
  { count: 50, id: "job_50_fin" },
  { count: 100, id: "job_100_win" },
  { count: 250, id: "job_250_fin" },
];

async function fetchAchievementInfo(achievementId) {
  try {
    const res = await pool.query(
      `SELECT id, name, description, category, reward_coins, reward_role_id
       FROM public.achievements
       WHERE id=$1`,
      [achievementId]
    );
    return res.rows?.[0] ?? null;
  } catch (e) {
    console.error("fetchAchievementInfo failed:", e);
    return null;
  }
}

async function announceAchievement(channel, userId, info) {
  if (!channel || !channel.send || !info) return;

  const rewardCoins = Number(info.reward_coins || 0);

  const embed = new EmbedBuilder()
    .setTitle("🏆 Achievement Unlocked!")
    .setDescription(`**<@${userId}>** unlocked **${info.name}**`)
    .addFields(
      { name: "Description", value: info.description || "—" },
      { name: "Category", value: info.category || "General", inline: true },
      {
        name: "Reward",
        value: rewardCoins > 0 ? `+$${rewardCoins.toLocaleString()}` : "None",
        inline: true,
      }
    )
    .setFooter({ text: `Achievement ID: ${info.id}` });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function handleJobMilestones({ channel, guildId, userId, totalJobs }) {
  const hit = JOB_MILESTONES.find((m) => m.count === totalJobs);
  if (!hit) return;

  const res = await unlockAchievement({
    db: pool,
    guildId,
    userId,
    achievementId: hit.id,
  });

  if (!res?.unlocked) return;

  const info = await fetchAchievementInfo(hit.id);
  await announceAchievement(channel, userId, info);
}

/* ============================================================
   UI: Hub + Category Boards
   ============================================================ */

function statusLineFromCooldown(cooldownUnix) {
  return cooldownUnix ? `⏳ **Next payout** <t:${cooldownUnix}:R>` : `✅ **Ready** — you can work now.`;
}

function buildHubEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  return new EmbedBuilder()
    .setTitle("🧰 Job Board")
    .setDescription(
      [
        `Pick what kind of work you want to do, **${user.username}**.`,
        "",
        statusLineFromCooldown(cooldownUnix),
      ].join("\n")
    )
    .addFields(
      {
        name: "Progress",
        value: `Level ${progress.level} • XP ${progress.xp}/${need} • Bonus +${bonusPct}%`,
      },
      {
        name: "Job Type",
        value: [
          "📦 **Work a 9–5** — Classic shift work",
          "🧠 **Night Walker** — Work to please the night",
          "🕒 **Grind** — Jobs that take time",
        ].join("\n"),
      },
      {
        name: "Rules",
        value: `Cooldown between payouts: **${JOB_COOLDOWN_SECONDS}s**\nAuto-clears after **3m** inactivity (or **Stop Work**)`,
      }
    )
    .setFooter({ text: "Leveling up increases payout bonus." });
}

function buildHubComponents(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_cat:95").setLabel("📦 Work a 9–5").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_cat:nw").setLabel("🧠 Night Walker").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_cat:grind").setLabel("🕒 Grind").setStyle(ButtonStyle.Primary).setDisabled(disabled)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

function buildNineToFiveEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  const jobLines = nineToFiveIndex.jobs
    .map((j) => `${j.title} — ${j.desc}`)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(nineToFiveIndex.category?.title || "📦 Work a 9–5")
    .setDescription([statusLineFromCooldown(cooldownUnix), "", nineToFiveIndex.category?.description || ""].join("\n").trim())
    .addFields(
      { name: "Progress", value: `Level ${progress.level} • XP ${progress.xp}/${need} • Bonus +${bonusPct}%` },
      { name: "Jobs", value: jobLines || "No jobs configured." }
    )
    .setFooter({ text: nineToFiveIndex.category?.footer || "Cooldown blocks payouts, not browsing." });
}

function buildNineToFiveComponents({ disabled = false, legendary = false } = {}) {
  const row = new ActionRowBuilder();

  for (const j of nineToFiveIndex.jobs) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(j.button.id)
        .setLabel(j.button.label)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  // Legendary appears only if enabled in config AND currently available
  if (nineToFiveIndex.legendary?.enabled && legendary) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(nineToFiveIndex.legendary.button.id)
        .setLabel(nineToFiveIndex.legendary.button.label)
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );
  }

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

function buildNightWalkerEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  const list = nightWalker?.list || [];
  const jobs = nightWalker?.jobs || {};
  const lines = list
    .map((k) => {
      const cfg = jobs[k];
      if (!cfg) return null;
      // keep this short; the config can have more detail later
      return `• **${cfg.title || k}** — ${cfg.rounds ? `${cfg.rounds} rounds` : "interactive"}`;
    })
    .filter(Boolean)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(nightWalker.category?.title || "🧠 Night Walker")
    .setDescription([statusLineFromCooldown(cooldownUnix), "", nightWalker.category?.description || ""].join("\n").trim())
    .addFields(
      { name: "Progress", value: `Level ${progress.level} • XP ${progress.xp}/${need} • Bonus +${bonusPct}%` },
      { name: "Jobs", value: lines || "No jobs configured." }
    )
    .setFooter({ text: nightWalker.category?.footer || "Choices matter." });
}

function buildNightWalkerComponents(disabled = false) {
  const list = nightWalker?.list || [];
  const jobs = nightWalker?.jobs || {};

  const row = new ActionRowBuilder();
  for (const k of list) {
    const cfg = jobs[k];
    if (!cfg) continue;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_nw:${k}`)
        .setLabel(cfg.title ? safeLabel(cfg.title) : safeLabel(k))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

function buildGrindEmbed(cooldownUnix) {
  return new EmbedBuilder()
    .setTitle("🕒 Grind")
    .setDescription([statusLineFromCooldown(cooldownUnix), "", "Coming soon. These jobs will take time and pay bigger."].join("\n"))
    .setFooter({ text: "Use ⬅ Back to return." });
}

function buildGrindComponents(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

/* ============================================================
   9–5: Contract UI builders (from contract config)
   ============================================================ */

function getContractChoices(step, level) {
  const out = [...(step.baseChoices || [])];

  const vipLevel = contractCfg.unlocks?.vipLevel ?? 10;
  const dangerLevel = contractCfg.unlocks?.dangerLevel ?? 20;

  if (level >= vipLevel) out.push(...(step.vipChoices || []));
  if (level >= dangerLevel) out.push(...(step.dangerChoices || []));

  return out;
}

function buildContractEmbed(stepIndex, pickedSoFar = [], level = 1) {
  const step = contractCfg.steps[stepIndex];
  const choices = getContractChoices(step, level);

  const pickedText =
    pickedSoFar.length > 0
      ? `\n\n**Chosen so far:** ${pickedSoFar.map((p) => `\`${p}\``).join(", ")}`
      : "";

  return new EmbedBuilder()
    .setTitle(step.title)
    .setDescription(`${step.desc}${pickedText}`)
    .addFields(
      choices.map((c) => ({
        name: c.label,
        value: `Bonus: +$${c.modMin}–$${c.modMax} | Risk: ${(c.risk * 100).toFixed(0)}%`,
        inline: false,
      }))
    )
    .setFooter({ text: contractCfg.footer || "Finish all 3 steps to get paid." });
}

function buildContractButtons(stepIndex, level, disabled = false) {
  const step = contractCfg.steps[stepIndex];
  const choices = getContractChoices(step, level);

  // auto-split into rows so VIP/Danger can grow without disappearing
  const rows = [];
  let row = new ActionRowBuilder();

  for (const c of choices) {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_contract:${stepIndex}:${c.id}`)
        .setLabel(safeLabel(c.label))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
  }
  if (row.components.length) rows.push(row);

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    )
  );

  return rows.slice(0, 5);
}

/* ============================================================
   9–5: Skill UI builders (from skill config)
   ============================================================ */
function buildSkillEmbed(title, targetEmoji, expiresAt, color) {
  const unix = Math.floor(expiresAt / 1000);
  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription([`Click the **correct emoji**: **${targetEmoji}**`, `⏳ Expires: <t:${unix}:R>`].join("\n"))
    .setFooter({ text: skillCfg.footer || "Succeed for full pay. Fail for a tiny payout." });
  if (color) e.setColor(color);
  return e;
}

function buildSkillButtons(targetEmoji, disabled = false, prefix = "job_skill") {
  const shuffled = [...skillCfg.emojis].sort(() => Math.random() - 0.5);

  const row = new ActionRowBuilder();
  for (const e of shuffled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}:${e}:${targetEmoji}`)
        .setLabel(e)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [row, row2];
}

/* ============================================================
   9–5: Shift UI builders (from shift config)
   ============================================================ */
function buildShiftEmbed(startMs, durationMs) {
  const now = Date.now();
  const elapsed = Math.min(durationMs, Math.max(0, now - startMs));
  const pct = Math.floor((elapsed / durationMs) * 100);
  const doneAtUnix = Math.floor((startMs + durationMs) / 1000);

  return new EmbedBuilder()
    .setTitle(shiftCfg.inProgressTitle || "🕒 Shift In Progress")
    .setDescription(
      [
        `${progressBar(pct)} **${pct}%**`,
        `⏳ Shift ends: <t:${doneAtUnix}:R>`,
        elapsed >= durationMs ? "✅ Shift complete! Press **Collect Pay**." : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({ text: shiftCfg.footer || "Stay on the board. Collect when ready." });
}

function buildShiftButtons({ canCollect, disabled = false }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_shift_collect")
      .setLabel("💵 Collect Pay")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || !canCollect)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [row, row2];
}

/* ============================================================
   Night Walker round builders (from data/nightwalker configs)
   ============================================================ */

function buildNWRoundEmbed({ title, round, rounds, prompt, statusLines = [] }) {
  return new EmbedBuilder()
    .setTitle(`${title} — Round ${round}/${rounds}`)
    .setDescription([prompt, "", ...statusLines].filter(Boolean).join("\n"));
}

function buildNWChoiceComponents({ jobKey, roundIndex, choices, disabled = false }) {
  const row = new ActionRowBuilder();
  choices.slice(0, 5).forEach((c, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`nw:${jobKey}:${roundIndex}:${idx}`)
        .setLabel(safeLabel(c.label))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  });

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:nw").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

/* ============================================================
   Main command
   ============================================================ */
module.exports = {
  data: new SlashCommandBuilder().setName("job").setDescription("Open the job board and work for money."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const prog = await getJobProgress(guildId, userId);
    const cdUnix = await getCooldownUnixIfActive(guildId, userId, "job");

    const msg = await interaction.channel.send({
      embeds: [buildHubEmbed(interaction.user, prog, cdUnix)],
      components: buildHubComponents(false),
    });

    await interaction.editReply("✅ Job board posted.");

    const session = {
      view: "hub",

      level: prog.level,
      legendaryAvailable: false,
      legendaryExpiresAt: 0,

      // Contract state
      contractStep: 0,
      contractPicks: [],
      contractBonusTotal: 0,
      contractRiskTotal: 0,

      // Skill state
      skillExpiresAt: 0,

      // Shift state
      shiftStartMs: 0,
      shiftInterval: null,
      shiftDurationMs: (shiftCfg.durationSeconds || 45) * 1000,
      shiftReady: false,

      // Legendary state
      legExpiresAt: 0,

      // Night Walker state
      nw: null,
    };

    const collector = msg.createMessageComponentCollector({ time: BOARD_INACTIVITY_MS });

    function resetInactivity() {
      collector.resetTimer({ time: BOARD_INACTIVITY_MS });
    }

    async function stopWork(reason = "stopped") {
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }
      try {
        await msg.edit({ components: buildHubComponents(true) });
      } catch {}
      collector.stop(reason);
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    }

    async function checkCooldownOrTell(btn) {
      const next = await getCooldown(guildId, userId, "job");
      const now = new Date();
      if (next && now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        await btn
          .followUp({
            content: `⏳ You’re on cooldown. Next payout <t:${unix}:R>.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return true;
      }
      return false;
    }

    async function maybeSpawnLegendary() {
      if (session.legendaryAvailable) return;
      if (Math.random() < LEGENDARY_CHANCE) {
        session.legendaryAvailable = true;
        session.legendaryExpiresAt = Date.now() + LEGENDARY_TTL_MS;
      }
    }

    async function payUser(amountBase, reason, xpGain, meta = {}, { countJob = true, allowLegendarySpawn = true } = {}) {
      const mult = levelMultiplier(session.level);
      let amount = Math.floor(amountBase * mult);

      if (GLOBAL_BONUS_CHANCE > 0 && Math.random() < GLOBAL_BONUS_CHANCE) {
        const bonus = randInt(GLOBAL_BONUS_MIN, GLOBAL_BONUS_MAX);
        amount += bonus;
        meta.globalBonus = bonus;
      }

      const nextClaim = new Date(Date.now() + JOB_COOLDOWN_SECONDS * 1000);
      await setCooldown(guildId, userId, "job", nextClaim);

      await creditUser(guildId, userId, amount, reason, meta);

      const progUpdate = await addXpAndMaybeLevel(guildId, userId, xpGain, countJob);

      if (countJob) {
        await handleJobMilestones({
          channel: msg.channel,
          guildId,
          userId,
          totalJobs: progUpdate.totalJobs,
        });
      }

      if (allowLegendarySpawn && countJob) {
        await maybeSpawnLegendary();
      }

      return { amount, nextClaim, prog: progUpdate };
    }

    async function redraw() {
      // only redraw on navigation screens, not during interactive modes
      const p = await getJobProgress(guildId, userId);
      session.level = p.level;

      if (session.legendaryAvailable && Date.now() > session.legendaryExpiresAt) {
        session.legendaryAvailable = false;
      }

      const cd = await getCooldownUnixIfActive(guildId, userId, "job");

      if (session.view === "hub") {
        return msg
          .edit({
            embeds: [buildHubEmbed(interaction.user, p, cd)],
            components: buildHubComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "95") {
        return msg
          .edit({
            embeds: [buildNineToFiveEmbed(interaction.user, p, cd)],
            components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
          })
          .catch(() => {});
      }

      if (session.view === "nw") {
        return msg
          .edit({
            embeds: [buildNightWalkerEmbed(interaction.user, p, cd)],
            components: buildNightWalkerComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "grind") {
        return msg
          .edit({
            embeds: [buildGrindEmbed(cd)],
            components: buildGrindComponents(false),
          })
          .catch(() => {});
      }
    }

    /* ============================================================
       Collector handlers
       ============================================================ */
    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This board isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        resetInactivity();

        // Stop
        if (btn.customId === "job_stop") {
          await btn.deferUpdate().catch(() => {});
          return stopWork("stop_button");
        }

        // Back buttons
        if (btn.customId === "job_back:hub") {
          await btn.deferUpdate().catch(() => {});
          session.view = "hub";
          session.nw = null;
          await redraw();
          return;
        }

        if (btn.customId === "job_back:95") {
          await btn.deferUpdate().catch(() => {});
          session.view = "95";
          session.nw = null;
          await redraw();
          return;
        }

        if (btn.customId === "job_back:nw") {
          await btn.deferUpdate().catch(() => {});
          session.view = "nw";
          session.nw = null;
          await redraw();
          return;
        }

        // Category nav (always allowed even on cooldown)
        if (btn.customId === "job_cat:95") {
          await btn.deferUpdate().catch(() => {});
          session.view = "95";
          await redraw();
          return;
        }
        if (btn.customId === "job_cat:nw") {
          await btn.deferUpdate().catch(() => {});
          session.view = "nw";
          await redraw();
          return;
        }
        if (btn.customId === "job_cat:grind") {
          await btn.deferUpdate().catch(() => {});
          session.view = "grind";
          await redraw();
          return;
        }

        /* ============================================================
           9–5 ENTRY (buttons from data/nineToFive/index.js)
           ============================================================ */
        if (btn.customId.startsWith("job_95:")) {
          await btn.deferUpdate().catch(() => {});

          const mode = btn.customId.split(":")[1];

          // Keep your current philosophy: block starting a job if on cooldown
          if (await checkCooldownOrTell(btn)) return;

          if (mode === "contract") {
            session.view = "contract";
            session.contractStep = 0;
            session.contractPicks = [];
            session.contractBonusTotal = 0;
            session.contractRiskTotal = 0;

            await msg
              .edit({
                embeds: [buildContractEmbed(0, session.contractPicks, session.level)],
                components: buildContractButtons(0, session.level, false),
              })
              .catch(() => {});
            return;
          }

          if (mode === "skill") {
            session.view = "skill";
            const target = pick(skillCfg.emojis);
            session.skillExpiresAt = Date.now() + (skillCfg.timeLimitMs || 12_000);

            await msg
              .edit({
                embeds: [buildSkillEmbed(skillCfg.title || "🧠 Skill Check", target, session.skillExpiresAt)],
                components: buildSkillButtons(target, false, "job_skill"),
              })
              .catch(() => {});
            return;
          }

          if (mode === "shift") {
            session.view = "shift";

            if (session.shiftInterval) clearInterval(session.shiftInterval);
            session.shiftStartMs = Date.now();
            session.shiftReady = false;

            await msg
              .edit({
                embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
                components: buildShiftButtons({ canCollect: false, disabled: false }),
              })
              .catch(() => {});

            const tickMs = (shiftCfg.tickSeconds || 5) * 1000;

            session.shiftInterval = setInterval(async () => {
              try {
                const done = Date.now() - session.shiftStartMs >= session.shiftDurationMs;
                if (done) session.shiftReady = true;

                await msg
                  .edit({
                    embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
                    components: buildShiftButtons({ canCollect: session.shiftReady, disabled: false }),
                  })
                  .catch(() => {});

                if (done) {
                  clearInterval(session.shiftInterval);
                  session.shiftInterval = null;
                }
              } catch {}
            }, tickMs);

            return;
          }

          if (mode === "legendary") {
            // legendary button only appears if available, but still guard
            if (!session.legendaryAvailable) return;

            session.view = "legendary";
            session.legendaryAvailable = false;

            const target = pick(skillCfg.emojis);
            session.legExpiresAt = Date.now() + LEGENDARY_SKILL_TIME_MS;

            await msg
              .edit({
                embeds: [buildSkillEmbed("🌟 LEGENDARY JOB", target, session.legExpiresAt, 0xFFD700)],
                components: buildSkillButtons(target, false, "job_leg"),
              })
              .catch(() => {});
            return;
          }
        }

        /* ============================================================
           CONTRACT step choice (cooldown checked only when paying)
           ============================================================ */
        if (btn.customId.startsWith("job_contract:")) {
          await btn.deferUpdate().catch(() => {});

          const [, stepStr, choiceId] = btn.customId.split(":");
          const stepIndex = Number(stepStr);
          if (stepIndex !== session.contractStep) return;

          const step = contractCfg.steps[stepIndex];
          const choices = getContractChoices(step, session.level);
          const choice = choices.find((c) => c.id === choiceId);
          if (!choice) return;

          session.contractPicks.push(choice.label);
          session.contractBonusTotal += randInt(choice.modMin, choice.modMax);
          session.contractRiskTotal += choice.risk;
          session.contractStep += 1;

          if (session.contractStep < contractCfg.steps.length) {
            await msg
              .edit({
                embeds: [buildContractEmbed(session.contractStep, session.contractPicks, session.level)],
                components: buildContractButtons(session.contractStep, session.level, false),
              })
              .catch(() => {});
            return;
          }

          // payout gate here
          if (await checkCooldownOrTell(btn)) return;

          const base = randInt(contractCfg.basePay.min, contractCfg.basePay.max);
          const amountBase = base + session.contractBonusTotal;
          const fail = Math.random() < session.contractRiskTotal;

          if (fail) {
            const consolationBase = randInt(contractCfg.consolationPay.min, contractCfg.consolationPay.max);

            const paid = await payUser(
              consolationBase,
              "job_contract_fail",
              contractCfg.xp.fail ?? 0,
              { picks: session.contractPicks, risk: session.contractRiskTotal, base, bonus: session.contractBonusTotal },
              { countJob: false, allowLegendarySpawn: false }
            );

            const embed = new EmbedBuilder()
              .setTitle("📦 Contract Failed")
              .setDescription(
                [
                  `You hit a snag and the contract fell through. 😬`,
                  "",
                  `🪙 Consolation pay: **$${paid.amount.toLocaleString()}**`,
                  paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Work a 9–5.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            session.view = "95";
            await msg
              .edit({
                embeds: [embed],
                components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
            return;
          }

          const paid = await payUser(
            amountBase,
            "job_contract",
            contractCfg.xp.success ?? 0,
            { picks: session.contractPicks, risk: session.contractRiskTotal, base, bonus: session.contractBonusTotal },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle("📦 Contract Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            );

          session.view = "95";
          await msg
            .edit({
              embeds: [embed],
              components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          return;
        }

        /* ============================================================
           SKILL (normal)
           ============================================================ */
        if (btn.customId.startsWith("job_skill:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const [, clickedEmoji, targetEmoji] = btn.customId.split(":");
          const expired = Date.now() > session.skillExpiresAt;
          const correct = clickedEmoji === targetEmoji && !expired;

          if (correct) {
            const amountBase = randInt(skillCfg.payout.success.min, skillCfg.payout.success.max);

            const paid = await payUser(
              amountBase,
              "job_skill_success",
              skillCfg.xp.success ?? 0,
              { target: targetEmoji },
              { countJob: true, allowLegendarySpawn: true }
            );

            const embed = new EmbedBuilder()
              .setTitle("🧩 Skill Check — Success")
              .setDescription(
                [
                  `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Work a 9–5.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            session.view = "95";
            await msg
              .edit({
                embeds: [embed],
                components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
          } else {
            const amountBase = randInt(skillCfg.payout.fail.min, skillCfg.payout.fail.max);

            const paid = await payUser(
              amountBase,
              "job_skill_fail",
              skillCfg.xp.fail ?? 0,
              { target: targetEmoji, clicked: clickedEmoji, expired },
              { countJob: false, allowLegendarySpawn: false }
            );

            const embed = new EmbedBuilder()
              .setTitle("🧩 Skill Check — Fail")
              .setDescription(
                [
                  expired ? "Too slow. 😴" : `Wrong one. Target was **${targetEmoji}**`,
                  `🪙 Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Work a 9–5.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            session.view = "95";
            await msg
              .edit({
                embeds: [embed],
                components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
          }
          return;
        }

        /* ============================================================
           LEGENDARY
           ============================================================ */
        if (btn.customId.startsWith("job_leg:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const [, clickedEmoji, targetEmoji] = btn.customId.split(":");
          const expired = Date.now() > session.legExpiresAt;
          const correct = clickedEmoji === targetEmoji && !expired;

          if (!correct) {
            const embed = new EmbedBuilder()
              .setTitle("🌟 Legendary Job — Failed")
              .setColor(0xFFD700)
              .setDescription(
                [
                  expired ? "Too slow… the moment passed." : `Wrong choice. It was **${targetEmoji}**`,
                  "",
                  "Legendary jobs don’t pay if you fail. Brutal, but fair. 😅",
                  "Back to Work a 9–5.",
                ].join("\n")
              );

            session.view = "95";
            await msg
              .edit({ embeds: [embed], components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }) })
              .catch(() => {});
            return;
          }

          const amountBase = randInt(LEGENDARY_MIN, LEGENDARY_MAX);

          const paid = await payUser(
            amountBase,
            "job_legendary",
            30,
            { legendary: true, target: targetEmoji },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle("🌟 LEGENDARY JOB COMPLETE")
            .setColor(0xFFD700)
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            );

          session.view = "95";
          await msg
            .edit({
              embeds: [embed],
              components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          return;
        }

        /* ============================================================
           SHIFT collect
           ============================================================ */
        if (btn.customId === "job_shift_collect") {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          if (!session.shiftReady) {
            return btn.followUp({ content: "⏳ Shift isn’t finished yet.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          const amountBase = randInt(shiftCfg.payout.min, shiftCfg.payout.max);

          const paid = await payUser(
            amountBase,
            "job_shift",
            shiftCfg.xp.success ?? 0,
            { duration_s: shiftCfg.durationSeconds || 45 },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle(shiftCfg.completeTitle || "🕒 Shift Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            );

          session.view = "95";
          await msg
            .edit({
              embeds: [embed],
              components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          return;
        }

        /* ============================================================
           Night Walker: start job
           ============================================================ */
        if (btn.customId.startsWith("job_nw:")) {
          await btn.deferUpdate().catch(() => {});
          const key = btn.customId.split(":")[1];

          if (await checkCooldownOrTell(btn)) return;

          const cfg = nightWalker.jobs?.[key];
          if (!cfg) return;

          session.view = "nw_run";
          session.nw = {
            key,
            roundIndex: 0,
            wrongCount: 0,
            penaltyTokens: 0,
            risk: cfg.risk ? (cfg.risk.start ?? 0) : 0,
            payoutModPct: 0,
            pickedScenarios: sampleUnique(cfg.scenarios || [], cfg.rounds || 1),
          };

          const sc = session.nw.pickedScenarios[0];
          const statusLines = [];

          if (key === "flirt") statusLines.push(`Wrong answers: **${session.nw.wrongCount}/${cfg.failOnWrongs || 2}**`);
          if (key === "lapDance") statusLines.push(`Mistakes: **${session.nw.penaltyTokens}/${cfg.penalties?.failAt || 3}**`);
          if (key === "prostitute") statusLines.push(`Risk: **${session.nw.risk}/${cfg.risk?.failAt || 100}**`);

          await msg
            .edit({
              embeds: [
                buildNWRoundEmbed({
                  title: cfg.title || key,
                  round: 1,
                  rounds: cfg.rounds || 1,
                  prompt: sc?.prompt || "…",
                  statusLines,
                }),
              ],
              components: buildNWChoiceComponents({ jobKey: key, roundIndex: 0, choices: sc?.choices || [] }),
            })
            .catch(() => {});
          return;
        }

        /* ============================================================
           Night Walker: choice
           ============================================================ */
        if (btn.customId.startsWith("nw:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const [, jobKey, roundStr, choiceStr] = btn.customId.split(":");
          const roundIndex = Number(roundStr);
          const choiceIndex = Number(choiceStr);

          if (!session.nw || session.nw.key !== jobKey) return;
          if (roundIndex !== session.nw.roundIndex) return;

          const cfg = nightWalker.jobs?.[jobKey];
          const sc = session.nw.pickedScenarios?.[roundIndex];
          const choice = sc?.choices?.[choiceIndex];
          if (!cfg || !sc || !choice) return;

          // Apply job-type rules based on config shape
          if (jobKey === "flirt") {
            const failOn = cfg.failOnWrongs ?? 2;
            const mods = cfg.modifiers || { goodBonusPct: 8, neutralBonusPct: 0, wrongPenaltyPct: 12 };

            if (choice.tag === "wrong") {
              session.nw.wrongCount += 1;
              session.nw.payoutModPct -= mods.wrongPenaltyPct || 0;
            } else if (choice.tag === "good") {
              session.nw.payoutModPct += mods.goodBonusPct || 0;
            } else {
              session.nw.payoutModPct += mods.neutralBonusPct || 0;
            }

            if (session.nw.wrongCount >= failOn) {
              const embed = new EmbedBuilder()
                .setTitle(`${cfg.title || "Flirt"} — Failed`)
                .setDescription(
                  [
                    choice.feedback || "That didn’t land.",
                    "",
                    "❌ You fumbled it twice. No payout this time.",
                    "Back to Night Walker.",
                  ].join("\n")
                );

              await payUser(0, "job_nw_flirt_fail", cfg.xp?.fail ?? 0, { job: "flirt", fail: true }, { countJob: false, allowLegendarySpawn: false });

              session.view = "nw";
              session.nw = null;

              await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
              return;
            }
          }

          if (jobKey === "lapDance") {
            const failAt = cfg.penalties?.failAt ?? 3;
            const awkwardAdds = cfg.penalties?.awkwardAdds ?? 1;
            const smoothRemoves = cfg.penalties?.smoothRemoves ?? 1;

            if (choice.tag === "awkward") {
              session.nw.penaltyTokens += awkwardAdds;
            } else if (choice.tag === "smooth") {
              session.nw.penaltyTokens = Math.max(0, session.nw.penaltyTokens - smoothRemoves);
            }

            if (session.nw.penaltyTokens >= failAt) {
              const embed = new EmbedBuilder()
                .setTitle(`${cfg.title || "Lap Dance"} — Failed`)
                .setDescription(
                  [
                    choice.feedback || "That didn’t work.",
                    "",
                    "❌ Too many stumbles. No payout this time.",
                    "Back to Night Walker.",
                  ].join("\n")
                );

              await payUser(0, "job_nw_lap_fail", cfg.xp?.fail ?? 0, { job: "lapDance", fail: true }, { countJob: false, allowLegendarySpawn: false });

              session.view = "nw";
              session.nw = null;

              await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
              return;
            }
          }

          if (jobKey === "prostitute") {
            const riskFailAt = cfg.risk?.failAt ?? 100;

            const riskDelta = Number(choice.riskDelta || 0);
            const payoutDeltaPct = Number(choice.payoutDeltaPct || 0);

            session.nw.risk += riskDelta;
            session.nw.payoutModPct += payoutDeltaPct;

            if (session.nw.risk >= riskFailAt) {
              const embed = new EmbedBuilder()
                .setTitle(`${cfg.title || "Prostitute"} — Failed`)
                .setDescription(
                  [
                    choice.feedback || "Bad timing.",
                    "",
                    "❌ You pushed it too far. The night turns on you.",
                    "Back to Night Walker.",
                  ].join("\n")
                );

              await payUser(0, "job_nw_pro_fail", cfg.xp?.fail ?? 0, { job: "prostitute", fail: true, risk: session.nw.risk }, { countJob: false, allowLegendarySpawn: false });

              session.view = "nw";
              session.nw = null;

              await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
              return;
            }
          }

          // advance
          session.nw.roundIndex += 1;

          // finished -> payout
          if (session.nw.roundIndex >= (cfg.rounds || 1)) {
            const base = randInt(cfg.payout?.min ?? 1000, cfg.payout?.max ?? 2000);
            const mod = 1 + (session.nw.payoutModPct / 100);
            const amountBase = Math.max(0, Math.floor(base * mod));

            const paid = await payUser(
              amountBase,
              `job_nw_${jobKey}`,
              cfg.xp?.success ?? 0,
              { job: jobKey, modPct: session.nw.payoutModPct },
              { countJob: true, allowLegendarySpawn: true }
            );

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Complete`)
              .setDescription(
                [
                  choice.feedback || "Nice.",
                  "",
                  `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Night Walker.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            session.view = "nw";
            session.nw = null;

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            return;
          }

          // next round
          const nextSc = session.nw.pickedScenarios?.[session.nw.roundIndex];
          const statusLines = [];

          if (jobKey === "flirt") statusLines.push(`Wrong answers: **${session.nw.wrongCount}/${cfg.failOnWrongs || 2}**`);
          if (jobKey === "lapDance") statusLines.push(`Mistakes: **${session.nw.penaltyTokens}/${cfg.penalties?.failAt || 3}**`);
          if (jobKey === "prostitute") statusLines.push(`Risk: **${session.nw.risk}/${cfg.risk?.failAt || 100}**`);

          await msg
            .edit({
              embeds: [
                buildNWRoundEmbed({
                  title: cfg.title || jobKey,
                  round: session.nw.roundIndex + 1,
                  rounds: cfg.rounds || 1,
                  prompt: nextSc?.prompt || "…",
                  statusLines: [choice.feedback || "", "", ...statusLines].filter(Boolean),
                }),
              ],
              components: buildNWChoiceComponents({
                jobKey,
                roundIndex: session.nw.roundIndex,
                choices: nextSc?.choices || [],
              }),
            })
            .catch(() => {});
          return;
        }
      } catch (e) {
        console.error("/job interaction error:", e);
        try {
          await btn.followUp({ content: "❌ Something went wrong. Check Railway logs.", flags: MessageFlags.Ephemeral });
        } catch {}
      }
    });

    collector.on("end", async () => {
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }
      try {
        await msg.edit({ components: buildHubComponents(true) });
      } catch {}
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    });

    // refresh only updates navigation views
    const refresh = setInterval(async () => {
      if (collector.ended) return clearInterval(refresh);
      if (["hub", "95", "nw", "grind"].includes(session.view)) {
        await redraw();
      }
    }, 10_000);
  },
};
