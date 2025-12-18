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
const { guardNotJailed, guardNotJailedComponent } = require("../utils/jail"); // jail blocks ALL jobs while active
const { unlockAchievement } = require("../utils/achievementEngine");
const { getCrimeHeat, setCrimeHeat, heatTTLMinutesForOutcome } = require("../utils/crimeHeat");

// ✅ Config imports
const nineToFiveIndex = require("../data/nineToFive/index");
const contractCfg = require("../data/nineToFive/transportContract");
const skillCfg = require("../data/nineToFive/skillCheck");
const shiftCfg = require("../data/nineToFive/shift");

const nightWalker = require("../data/nightwalker/index");

// ✅ Crime
const startStoreRobbery = require("../data/crime/storeRobbery");
const startHeist = require("../data/crime/heist");

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
   Crime cooldown keys (Crime-only system)
   ============================================================ */
const CRIME_GLOBAL_KEY = "crime_global";
const CRIME_KEYS = {
  store: "crime_store",
  chase: "crime_chase",
  drugs: "crime_drugs",
  heist: "crime_heist",
  major: "crime_heist_major",
};

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
function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

/* ============================================================
   Heist Heat TTL (S4/S5)
   - Keep this local for now so you can tweak without touching utils.
   - /job persists heat AFTER the minigame via setCrimeHeat().
   ============================================================ */
function heatTTLMinutesForHeistOutcome(outcome, { identified = false, mode = "heist" } = {}) {
  // S4
  const heist = {
    clean: 180, // 3h
    spotted: 360, // 6h
    partial: 600, // 10h
    busted: 840, // 14h
    busted_hard: 1080, // 18h
  };

  // S5
  const major = {
    clean: 360, // 6h
    spotted: 720, // 12h
    partial: 1080, // 18h
    busted: 1440, // 24h
    busted_hard: 2160, // 36h
  };

  const map = mode === "major" ? major : heist;
  const base = map[outcome] ?? map.spotted;
  const add = identified ? (mode === "major" ? 240 : 120) : 0; // +4h major, +2h heist
  return base + add;
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

  const next = new Date(cd.rows[0].next_claim_at);
  if (Number.isNaN(next.getTime())) return null;
  return next;
}
async function setCooldown(guildId, userId, key, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, nextClaimAt]
  );
}

async function getCooldownUnixIfActive(guildId, userId, key) {
  const next = await getCooldown(guildId, userId, key);
  if (!next) return null;
  const now = new Date();
  if (now >= next) return null;
  return Math.floor(next.getTime() / 1000);
}

/* ============================================================
   Job Progress (xp/level)
   ============================================================ */
async function getJobProgress(guildId, userId) {
  await pool.query(
    `INSERT INTO job_progress (guild_id, user_id, xp, level, total_jobs)
     VALUES ($1,$2,0,1,0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );

  const res = await pool.query(
    `SELECT xp, level, total_jobs FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0] || { xp: 0, level: 1, total_jobs: 0 };
  return {
    xp: Number(row.xp) || 0,
    level: Number(row.level) || 1,
    totalJobs: Number(row.total_jobs) || 0,
  };
}

async function addXpAndMaybeLevel(guildId, userId, xpGain, countJob = true) {
  const p = await getJobProgress(guildId, userId);
  let xp = p.xp + (xpGain || 0);
  let level = p.level;
  let leveledUp = false;

  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveledUp = true;
  }

  const totalJobs = p.totalJobs + (countJob ? 1 : 0);

  await pool.query(
    `UPDATE job_progress
     SET xp=$1, level=$2, total_jobs=$3
     WHERE guild_id=$4 AND user_id=$5`,
    [xp, level, totalJobs, guildId, userId]
  );

  return { xp, level, totalJobs, leveledUp };
}

/* ============================================================
   Achievements — milestones on total_jobs
   ============================================================ */
const JOB_MILESTONES = [
  { id: "job_first_fin", count: 1 },
  { id: "job_10_fin", count: 10 },
  { id: "job_50_fin", count: 50 },
  { id: "job_100_win", count: 100 },
  { id: "job_250_fin", count: 250 },
];

async function fetchAchievementInfo(achievementId) {
  const res = await pool.query(`SELECT id, name, description FROM achievements WHERE id=$1`, [achievementId]);
  return res.rows[0] || { id: achievementId, name: "Achievement Unlocked", description: "" };
}

async function announceAchievement(channel, userId, info) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 Achievement Unlocked!")
    .setDescription(`<@${userId}> unlocked **${info.name}**\n${info.description || ""}`.trim())
    .setColor(0xffd54a)
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
          "🕶️ **Crime** — High risk, heat & jail",
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
      new ButtonBuilder().setCustomId("job_cat:grind").setLabel("🕒 Grind").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_cat:crime").setLabel("🕶️ Crime").setStyle(ButtonStyle.Danger).setDisabled(disabled)
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
   Crime UI builders
   ============================================================ */
function buildCrimeEmbed() {
  return new EmbedBuilder()
    .setTitle("🕶️ Crime")
    .setDescription(
      [
        "Pick a job. Heat only affects **Crime** jobs.",
        "If you get jailed, **ALL jobs** are disabled until release.",
        "",
        "• Store Robbery — 10m cooldown",
        "• Car Chase — 15m cooldown (soon)",
        "• Drug Pushing — placeholder",
        "• Heist — 12h cooldown",
        "• Major Heist — 24h cooldown",
      ].join("\n")
    )
    .setColor(0x2b2d31)
    .setFooter({ text: "Crime cooldowns are separate from the /job payout cooldown." });
}

function buildCrimeComponents(disabled = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("crime:store").setLabel("🏪 Store Robbery").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("crime:chase").setLabel("🚗 Car Chase").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("crime:drugs").setLabel("💊 Drug Pushing").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("crime:heist").setLabel("🏦 Heist").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId("crime:major").setLabel("💰 Major Heist").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [row1, row2, row3];
}

async function checkCrimeCooldownOrTell(btn, guildId, userId, jobKey, jobLabel) {
  const now = new Date();

  const globalNext = await getCooldown(guildId, userId, CRIME_GLOBAL_KEY);
  if (globalNext && now < globalNext) {
    await btn
      .followUp({
        content: `⏳ Crime lockout active. Try again <t:${toUnix(globalNext)}:R>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  const jobNext = await getCooldown(guildId, userId, jobKey);
  if (jobNext && now < jobNext) {
    await btn
      .followUp({
        content: `⏳ **${jobLabel}** cooldown. Try again <t:${toUnix(jobNext)}:R>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  return false;
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

  const rows = [];
  let row = new ActionRowBuilder();

  for (const c of choices) {
    if (row.components.length >= 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_contract:${stepIndex}:${c.label}`)
        .setLabel(safeLabel(c.label))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }
  rows.push(row);

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    )
  );

  return rows;
}

/* ============================================================
   9–5: Skill UI builders
   ============================================================ */
function buildSkillEmbed(title, targetEmoji, expiresAtMs) {
  const unix = Math.floor(expiresAtMs / 1000);
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Click **${targetEmoji}** before time runs out!\n⏳ Ends: <t:${unix}:R>`)
    .setFooter({ text: "Failing doesn't pay, but browsing is still allowed." });
}

function buildSkillButtons(targetEmoji, disabled = false, prefix = "job_skill") {
  const decoys = sampleUnique(skillCfg.emojis.filter((e) => e !== targetEmoji), 4);
  const options = sampleUnique([targetEmoji, ...decoys], 5);

  const row = new ActionRowBuilder();
  for (const e of options) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}:${e}`)
        .setLabel(e)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

/* ============================================================
   9–5: Shift UI builders
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
   Night Walker round builders
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
    if (await guardNotJailed(interaction)) return; // slash guard

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

      // Night Walker state
      nw: null,
    };

    const collector = msg.createMessageComponentCollector({ time: BOARD_INACTIVITY_MS });

    function resetInactivity() {
      collector.resetTimer({ time: BOARD_INACTIVITY_MS });
    }

    async function stopWork(reason = "stop") {
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

      if (session.view === "crime") {
        return msg
          .edit({
            embeds: [buildCrimeEmbed()],
            components: buildCrimeComponents(false),
          })
          .catch(() => {});
      }
    }

    // Adapter so Crime minigames (which use interaction.editReply/fetchReply) work on our board message
    const boardAdapter = {
      guildId,
      user: interaction.user,
      channel: msg.channel,
      editReply: (payload) => msg.edit(payload),
      fetchReply: () => Promise.resolve(msg),
    };

    /* ============================================================
       Collector handlers
       ============================================================ */
    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This board isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // ✅ Jail blocks ALL job interactions
        if (await guardNotJailedComponent(btn)) return;

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

        // Category nav (allowed even on /job payout cooldown — but jail still blocks)
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
        if (btn.customId === "job_cat:crime") {
          await btn.deferUpdate().catch(() => {});
          session.view = "crime";
          await redraw();
          return;
        }

        /* ============================================================
           CRIME MENU (Store Robbery + Heists live)
           ============================================================ */
        if (btn.customId.startsWith("crime:")) {
          await btn.deferUpdate().catch(() => {});
          const key = btn.customId.split(":")[1];

          if (key === "store") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.store, "Store Robbery")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startStoreRobbery(boardAdapter, {
              lingeringHeat,
              onStoreRobberyComplete: async ({ outcome, finalHeat, identified }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForOutcome(outcome, { identified });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "heist") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.heist, "Heist")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startHeist(boardAdapter, {
              mode: "heist",
              lingeringHeat,
              onHeistComplete: async ({ outcome, finalHeat, identified, mode }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForHeistOutcome(outcome, { identified, mode });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "major") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.major, "Major Heist")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startHeist(boardAdapter, {
              mode: "major",
              lingeringHeat,
              onHeistComplete: async ({ outcome, finalHeat, identified, mode }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForHeistOutcome(outcome, { identified, mode });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "chase") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.chase, "Car Chase")) return;
            await btn
              .followUp({ content: "🚗 Car Chase is coming soon.", flags: MessageFlags.Ephemeral })
              .catch(() => {});
            return;
          }

          if (key === "drugs") {
            await btn
              .followUp({ content: "💊 Drug Pushing is a placeholder for now.", flags: MessageFlags.Ephemeral })
              .catch(() => {});
            return;
          }
        }

        /* ============================================================
           9–5 ENTRY (buttons from data/nineToFive/index.js)
           ============================================================ */
        if (btn.customId.startsWith("job_95:")) {
          await btn.deferUpdate().catch(() => {});

          const mode = btn.customId.split(":")[1];

          // Block starting a job if on /job payout cooldown
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
            if (!session.legendaryAvailable) return;

            if (await checkCooldownOrTell(btn)) return;

            session.view = "legendary";
            const target = pick(skillCfg.emojis);
            session.skillExpiresAt = Date.now() + LEGENDARY_SKILL_TIME_MS;

            await msg
              .edit({
                embeds: [buildSkillEmbed("🌟 Legendary Job", target, session.skillExpiresAt)],
                components: buildSkillButtons(target, false, "job_leg"),
              })
              .catch(() => {});
            return;
          }
        }

        // Contract clicks
        if (btn.customId.startsWith("job_contract:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const parts = btn.customId.split(":");
          const stepIndex = Number(parts[1]);
          const label = parts.slice(2).join(":");

          const step = contractCfg.steps[stepIndex];
          const choices = getContractChoices(step, session.level);
          const chosen = choices.find((c) => c.label === label);
          if (!chosen) return;

          session.contractPicks.push(label);
          session.contractBonusTotal += randInt(chosen.modMin, chosen.modMax);
          session.contractRiskTotal += chosen.risk;

          const nextStep = stepIndex + 1;

          if (nextStep >= contractCfg.steps.length) {
            const failRoll = Math.random() < session.contractRiskTotal;
            if (failRoll) {
              const embed = new EmbedBuilder()
                .setTitle("📦 Transport Contract — Failed")
                .setDescription(
                  [
                    "The contract went sideways.",
                    "",
                    `❌ No payout (risk caught up to you).`,
                    "",
                    "Back to Work a 9–5.",
                  ].join("\n")
                )
                .setColor(0xaa0000);

              session.view = "95";
              await msg.edit({ embeds: [embed], components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }) }).catch(() => {});
              return;
            }

            const base = randInt(contractCfg.payout?.min ?? 2000, contractCfg.payout?.max ?? 5000);
            const amountBase = base + session.contractBonusTotal;

            const paid = await payUser(
              amountBase,
              "job_95_contract",
              contractCfg.xp?.success ?? 0,
              { picks: session.contractPicks, bonusTotal: session.contractBonusTotal, riskTotal: session.contractRiskTotal },
              { countJob: true, allowLegendarySpawn: true }
            );

            const embed = new EmbedBuilder()
              .setTitle("📦 Transport Contract — Complete")
              .setDescription(
                [
                  `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                  paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Work a 9–5.",
                ]
                  .filter(Boolean)
                  .join("\n")
              )
              .setColor(0x22aa55);

            session.view = "95";
            await msg.edit({ embeds: [embed], components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }) }).catch(() => {});
            return;
          }

          session.contractStep = nextStep;

          await msg
            .edit({
              embeds: [buildContractEmbed(nextStep, session.contractPicks, session.level)],
              components: buildContractButtons(nextStep, session.level, false),
            })
            .catch(() => {});
          return;
        }

        // Skill checks (normal + legendary)
        if (btn.customId.startsWith("job_skill:") || btn.customId.startsWith("job_leg:")) {
          await btn.deferUpdate().catch(() => {});

          const isLegendary = btn.customId.startsWith("job_leg:");
          const chosen = btn.customId.split(":")[1];

          const now = Date.now();
          const expired = now > session.skillExpiresAt;

          if (expired || !chosen) {
            const embed = new EmbedBuilder()
              .setTitle(isLegendary ? "🌟 Legendary — Failed" : "🧠 Skill Check — Failed")
              .setDescription("❌ Too slow. No payout.")
              .setColor(0xaa0000);

            session.view = "95";
            await msg.edit({ embeds: [embed], components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }) }).catch(() => {});
            return;
          }

          if (await checkCooldownOrTell(btn)) return;

          const base = isLegendary
            ? randInt(LEGENDARY_MIN, LEGENDARY_MAX)
            : randInt(skillCfg.payout?.min ?? 1000, skillCfg.payout?.max ?? 2000);

          const paid = await payUser(
            base,
            isLegendary ? "job_95_legendary" : "job_95_skill",
            isLegendary ? (skillCfg.xp?.legendary ?? 30) : (skillCfg.xp?.success ?? 10),
            { legendary: isLegendary },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle(isLegendary ? "🌟 Legendary — Complete" : "🧠 Skill Check — Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            )
            .setColor(0x22aa55);

          session.view = "95";
          await msg.edit({ embeds: [embed], components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }) }).catch(() => {});
          return;
        }

        // Shift collect
        if (btn.customId === "job_shift_collect") {
          await btn.deferUpdate().catch(() => {});
          if (!session.shiftReady) return;
          if (await checkCooldownOrTell(btn)) return;

          const base = randInt(shiftCfg.payout?.min ?? 1200, shiftCfg.payout?.max ?? 2500);

          const paid = await payUser(
            base,
            "job_95_shift",
            shiftCfg.xp?.success ?? 12,
            { shift: true },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle("🕒 Shift — Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            )
            .setColor(0x22aa55);

          session.view = "95";
          await msg.edit({ embeds: [embed], components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }) }).catch(() => {});
          return;
        }

        /* ============================================================
           Night Walker ENTRY
           ============================================================ */
        if (btn.customId.startsWith("job_nw:")) {
          await btn.deferUpdate().catch(() => {});
          const jobKey = btn.customId.split(":")[1];

          if (await checkCooldownOrTell(btn)) return;

          const cfg = nightWalker?.jobs?.[jobKey];
          if (!cfg) return;

          const rounds = cfg.rounds || 1;
          const poolList = cfg.scenarios || [];
          const pickedScenarios = sampleUnique(poolList, rounds);

          while (pickedScenarios.length < rounds && poolList.length) {
            pickedScenarios.push(pick(poolList));
          }

          session.view = "nw_round";
          session.nw = {
            jobKey,
            cfg,
            roundIndex: 0,
            pickedScenarios,
            wrongCount: 0,
            penaltyTokens: 0,
            risk: 0,
            payoutModPct: 0,
          };

          const sc = session.nw.pickedScenarios[0];
          await msg
            .edit({
              embeds: [
                buildNWRoundEmbed({
                  title: cfg.title || jobKey,
                  round: 1,
                  rounds,
                  prompt: sc?.prompt || "…",
                  statusLines: [],
                }),
              ],
              components: buildNWChoiceComponents({
                jobKey,
                roundIndex: 0,
                choices: sc?.choices || [],
              }),
            })
            .catch(() => {});
          return;
        }

        // NW round choice clicks
        if (btn.customId.startsWith("nw:")) {
          await btn.deferUpdate().catch(() => {});
          if (!session.nw) return;

          const [, jobKey, roundIndexStr, choiceIndexStr] = btn.customId.split(":");
          const roundIndex = Number(roundIndexStr);
          const choiceIndex = Number(choiceIndexStr);

          const cfg = nightWalker?.jobs?.[jobKey];
          if (!cfg) return;

          const sc = session.nw.pickedScenarios?.[roundIndex];
          const choice = sc?.choices?.[choiceIndex];
          if (!choice) return;

          if (jobKey === "flirt") {
            if (choice.correct === false) session.nw.wrongCount++;
          }
          if (jobKey === "lapDance") {
            if (choice.penalty) session.nw.penaltyTokens += choice.penalty;
          }
          if (jobKey === "prostitute") {
            session.nw.risk = clamp(session.nw.risk + (choice.riskDelta || 0), 0, 200);
          }

          session.nw.payoutModPct = clamp(session.nw.payoutModPct + (choice.payoutDeltaPct || 0), -80, 200);

          if (jobKey === "flirt" && session.nw.wrongCount >= (cfg.failOnWrongs || 2)) {
            session.view = "nw";
            session.nw = null;

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Failed`)
              .setDescription("❌ Too many wrong answers. No payout.")
              .setColor(0xaa0000);

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            return;
          }

          if (jobKey === "lapDance" && session.nw.penaltyTokens >= (cfg.penalties?.failAt || 3)) {
            session.view = "nw";
            session.nw = null;

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Failed`)
              .setDescription("❌ You messed up too many times. No payout.")
              .setColor(0xaa0000);

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            return;
          }

          if (jobKey === "prostitute" && session.nw.risk >= (cfg.risk?.failAt || 100)) {
            session.view = "nw";
            session.nw = null;

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Failed`)
              .setDescription("❌ Heat got too high. No payout.")
              .setColor(0xaa0000);

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            return;
          }

          session.nw.roundIndex++;

          if (session.nw.roundIndex >= (cfg.rounds || 1)) {
            if (await checkCooldownOrTell(btn)) return;

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
                  `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                  paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Night Walker.",
                ]
                  .filter(Boolean)
                  .join("\n")
              )
              .setColor(0x22aa55);

            session.view = "nw";
            session.nw = null;

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            return;
          }

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
      if (["hub", "95", "nw", "grind", "crime"].includes(session.view)) {
        await redraw();
      }
    }, 10_000);
  },
};
