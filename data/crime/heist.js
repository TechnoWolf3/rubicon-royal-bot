// data/crime/heist.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const { pool } = require("../../utils/db");
const { setJail } = require("../../utils/jail");

const scenarios = require("./heist.scenarios");

// ============================================================
// CONFIG (all tuning lives here)
// ============================================================

const GLOBAL_LOCKOUT_KEY = "crime_global";
const GLOBAL_LOCKOUT_MINUTES = 10;

const MODES = {
  heist: {
    label: "🏦 Heist",
    crimeKey: "crime_heist",
    cooldownMinutes: 12 * 60, // 12h
    tiers: { clean: 18, spotted: 35, partial: 60, bustedHard: 90 },
    payouts: {
      clean: [30_000, 45_000],
      spotted: [22_000, 36_000],
      partial: [6_000, 18_000],
    },
    fine: [12_000, 30_000],
    jail: {
      chanceBusted: 0.45,
      chanceBustedHard: 0.65,
      minutes: [20, 30],
    },
  },

  major: {
    label: "💰 Major Heist",
    crimeKey: "crime_heist_major",
    cooldownMinutes: 24 * 60, // 24h
    tiers: { clean: 15, spotted: 30, partial: 55, bustedHard: 85 },
    payouts: {
      clean: [55_000, 100_000],
      spotted: [48_000, 75_000],
      partial: [25_000, 40_000],
    },
    fine: [12_000, 30_000],
    jail: {
      chanceBusted: 0.55,
      chanceBustedHard: 0.75,
      minutes: [45, 60],
    },
  },
};

const PHASES = ["scout", "entry", "inside", "vault", "loot", "escape", "cleanUp"];
const STEPS_PER_PHASE_MIN = 2;
const STEPS_PER_PHASE_MAX = 3;

// Random run spice (kept subtle)
const LOOT_DROP_CHANCE = 0.14;
const VALUABLE_FIND_CHANCE = 0.12;
const LOOT_DROP_MIN = 1500;
const LOOT_DROP_MAX = 6000;
const VALUABLE_MIN = 1200;
const VALUABLE_MAX = 6500;

// UX
const RUN_TIMEOUT_MS = 6 * 60_000;
const RESULTS_LINGER_MS = 25_000;

// Heat drift after outcome (lingering heat)
const POST_DRIFT = {
  clean: -10,
  spotted: +8,
  partial: +18,
  busted: +30,
  busted_hard: +40,
};

// ============================================================
// Helpers
// ============================================================

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function safeLabel(s, max = 80) {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + "...";
}

// ============================================================
// DB helpers
// ============================================================

async function ensureUserRow(guildId, userId) {
  await pool.query(
    `INSERT INTO user_balances (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function addUserBalance(guildId, userId, amount) {
  await ensureUserRow(guildId, userId);
  await pool.query(
    `UPDATE user_balances
     SET balance = balance + $1
     WHERE guild_id=$2 AND user_id=$3`,
    [amount, guildId, userId]
  );
}

async function subtractUserBalanceAndSendToBank(guildId, userId, amount) {
  await ensureUserRow(guildId, userId);

  const res = await pool.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const current = Number(res.rows?.[0]?.balance || 0);
  const take = Math.min(current, Math.max(0, amount));
  if (take <= 0) return 0;

  await pool.query(
    `UPDATE user_balances
     SET balance = balance - $1
     WHERE guild_id=$2 AND user_id=$3`,
    [take, guildId, userId]
  );

  await pool.query(
    `UPDATE guilds
     SET bank_balance = bank_balance + $1
     WHERE guild_id=$2`,
    [take, guildId]
  );

  return take;
}

async function setCooldownMinutes(guildId, userId, key, minutes) {
  const next = new Date(Date.now() + minutes * 60 * 1000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, next]
  );
}

async function applyCooldowns(guildId, userId, modeCfg) {
  await setCooldownMinutes(
    guildId,
    userId,
    GLOBAL_LOCKOUT_KEY,
    GLOBAL_LOCKOUT_MINUTES
  );
  await setCooldownMinutes(guildId, userId, modeCfg.crimeKey, modeCfg.cooldownMinutes);
}

// ============================================================
// Outcome logic
// ============================================================

function determineOutcomeFromHeat(heat, tiers) {
  if (heat < tiers.clean) return "clean";
  if (heat < tiers.spotted) return "spotted";
  if (heat < tiers.partial) return "partial";
  if (heat >= tiers.bustedHard) return "busted_hard";
  return "busted";
}

function computePayout(outcome, modeCfg) {
  const range = modeCfg.payouts[outcome];
  if (!range) return 0;
  return randInt(range[0], range[1]);
}

function computeFine(outcome, modeCfg) {
  if (outcome !== "busted" && outcome !== "busted_hard") return 0;
  return randInt(modeCfg.fine[0], modeCfg.fine[1]);
}

// ============================================================
// Scenario selection: 2–3 steps per phase, avoid repeats
// ============================================================

function buildRunPlan() {
  const plan = [];
  const usedIds = new Set();

  for (const phase of PHASES) {
    const poolList = scenarios?.[phase] || [];
    if (!Array.isArray(poolList) || poolList.length === 0) continue;

    const stepsThisPhase = randInt(STEPS_PER_PHASE_MIN, STEPS_PER_PHASE_MAX);

    for (let i = 0; i < stepsThisPhase; i++) {
      const available = poolList.filter((s) => s?.id && !usedIds.has(s.id));
      const chosen = (available.length ? pick(available) : pick(poolList)) || null;
      if (!chosen) continue;

      if (chosen?.id) usedIds.add(chosen.id);
      plan.push({ phase, scenario: chosen });
    }
  }

  return plan;
}

// ============================================================
// Rendering
// ============================================================

function renderScenario({ modeCfg, phase, stepIndex, totalSteps, scenario, heat }) {
  const embed = new EmbedBuilder()
    .setTitle(`${modeCfg.label} • ${safeLabel(String(phase).toUpperCase(), 24)}`)
    .setDescription(
      [
        `Step **${stepIndex + 1}** / **${totalSteps}**`,
        `🔥 Heat: **${clamp(heat, 0, 100)}** / 100`,
        "",
        safeLabel(scenario?.text || "…", 3500),
      ].join("\n")
    )
    .setFooter({ text: "Choices shape heat, risk, and payout. No obvious “correct” answers." });

  const row = new ActionRowBuilder();
  const choices = Array.isArray(scenario?.choices) ? scenario.choices.slice(0, 5) : [];

  if (choices.length) {
    choices.forEach((c, idx) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`heist:${stepIndex}:${idx}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel(safeLabel(c?.label || `Choice ${idx + 1}`))
      );
    });
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`heist:${stepIndex}:continue`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Continue")
    );
  }

  return { embed, components: [row] };
}

// ============================================================
// Random run events
// ============================================================

function applyRandomRunEvents() {
  const notes = [];
  let payoutDelta = 0;

  if (Math.random() < LOOT_DROP_CHANCE) {
    const loss = randInt(LOOT_DROP_MIN, LOOT_DROP_MAX);
    payoutDelta -= loss;
    notes.push(`💸 You dropped part of the take while moving — **-$${loss.toLocaleString()}**.`);
  }

  if (Math.random() < VALUABLE_FIND_CHANCE) {
    const gain = randInt(VALUABLE_MIN, VALUABLE_MAX);
    payoutDelta += gain;
    notes.push(`💎 You found extra valuables in the chaos — **+$${gain.toLocaleString()}**.`);
  }

  return { payoutDelta, notes };
}

// ============================================================
// ID / evidence roll (based on your boolean flags)
// ============================================================

function rollIdentifiedLater(flags) {
  let chance = 0.08; // base (higher than store robbery)

  if (flags.leftEvidence) chance += 0.20;
  if (flags.timeOverrun) chance += 0.12;
  if (flags.usedGetawayCar) chance += 0.10;
  if (flags.witnesses) chance += 0.10;
  if (flags.camerasSeenYou) chance += 0.10;
  if (flags.maskless) chance += 0.10;
  if (flags.shotsFired) chance += 0.18;
  if (flags.alarmTriggered) chance += 0.14;

  // mitigations
  if (flags.scrubbedFootage) chance -= 0.12;
  if (flags.changedClothes) chance -= 0.08;
  if (flags.ditchedTools) chance -= 0.08;
  if (flags.routeSwapped) chance -= 0.06;
  if (flags.jammedCameras) chance -= 0.06;

  chance = clamp(chance, 0, 0.70);
  return Math.random() < chance;
}

// ============================================================
// Jail
// ============================================================

async function maybeJail(guildId, userId, outcome, modeCfg) {
  if (outcome !== "busted" && outcome !== "busted_hard") return 0;

  const chance =
    outcome === "busted_hard"
      ? modeCfg.jail.chanceBustedHard
      : modeCfg.jail.chanceBusted;

  if (Math.random() >= chance) return 0;

  const minutes = randInt(modeCfg.jail.minutes[0], modeCfg.jail.minutes[1]);

  // ✅ IMPORTANT: Pass minutes (not a Date) — jail util handles timestamp safely
  await setJail(guildId, userId, minutes);

  return minutes;
}

// ============================================================
// MAIN EXPORT
// ============================================================

module.exports = function startHeist(interaction, context = {}) {
  return new Promise(async (resolve) => {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const mode = context.mode === "major" ? "major" : "heist";
    const modeCfg = MODES[mode];

    // heat starts from lingering crime heat
    let heat = clamp(Number(context.lingeringHeat || 0), 0, 100);

    // roll-up flags (booleans like your scenarios file)
    const flags = {
      maskless: false,
      camerasSeenYou: false,
      leftEvidence: false,
      witnesses: false,
      alarmTriggered: false,
      timeOverrun: false,
      usedGetawayCar: false,
      shotsFired: false,
      insideMan: false,

      scrubbedFootage: false,
      changedClothes: false,
      ditchedTools: false,
      routeSwapped: false,
      jammedCameras: false,
    };

    // loot additions from scenario choices (applied to final payout)
    let lootAddTotal = 0;

    // resolve once
    let finished = false;
    const finishOnce = (payload) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    const runPlan = buildRunPlan();
    let stepIndex = 0;

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: RUN_TIMEOUT_MS });

    async function showStep() {
      const current = runPlan[stepIndex];
      if (!current?.scenario) return resolveAndFinish("no_scenario");

      const { embed, components } = renderScenario({
        modeCfg,
        phase: current.phase,
        stepIndex,
        totalSteps: runPlan.length,
        scenario: current.scenario,
        heat,
      });

      await interaction.editReply({ content: null, embeds: [embed], components }).catch(() => {});
    }

    function finalizeHeat(outcome) {
      heat = clamp(heat + (POST_DRIFT[outcome] ?? 0), 0, 100);
      return heat;
    }

    async function resolveAndFinish(reason = "done") {
      collector.stop(reason);

      // Apply cooldowns regardless of outcome
      await applyCooldowns(guildId, userId, modeCfg);

      // Determine outcome BEFORE post drift
      let outcome = determineOutcomeFromHeat(heat, modeCfg.tiers);

      // Identification roll (may bump clean → spotted)
      const identified = rollIdentifiedLater(flags);
      if (identified && outcome === "clean") outcome = "spotted";

      // Random run spice
      const eventNotes = applyRandomRunEvents();

      const resultLines = [];
      const extraLines = [];

      // Compute payout / fine
      if (outcome === "clean" || outcome === "spotted" || outcome === "partial") {
        let payout = computePayout(outcome, modeCfg);

        // Apply scenario loot adds + random events
        payout += lootAddTotal;
        payout += eventNotes.payoutDelta;

        const finalPayout = Math.max(0, payout);

        if (finalPayout > 0) await addUserBalance(guildId, userId, finalPayout);

        if (outcome === "clean") resultLines.push(`✅ Clean run. You pocket **$${finalPayout.toLocaleString()}**.`);
        if (outcome === "spotted") resultLines.push(`⚠️ Spotted on the way out. You pocket **$${finalPayout.toLocaleString()}**.`);
        if (outcome === "partial") resultLines.push(`😬 Partial take. You pocket **$${finalPayout.toLocaleString()}**.`);

        if (identified) resultLines.push("🧾 You might’ve been **identified later**.");
      } else {
        const fine = computeFine(outcome, modeCfg);
        const paid = await subtractUserBalanceAndSendToBank(guildId, userId, fine);

        resultLines.push(
          outcome === "busted_hard"
            ? `🚨 **BUSTED HARD.** Fine: **$${fine.toLocaleString()}** (paid **$${paid.toLocaleString()}**).`
            : `🚓 **BUSTED.** Fine: **$${fine.toLocaleString()}** (paid **$${paid.toLocaleString()}**).`
        );

        const jailedMinutes = await maybeJail(guildId, userId, outcome, modeCfg);
        if (jailedMinutes > 0) {
          resultLines.push(`⛓️ You were jailed for **${jailedMinutes} minutes**. (All jobs blocked)`);
        } else {
          resultLines.push("😮‍💨 You avoided jail this time.");
        }
      }

      if (lootAddTotal !== 0) {
        extraLines.push(
          lootAddTotal > 0
            ? `👜 Extra take decisions: **+$${lootAddTotal.toLocaleString()}**`
            : `👜 Extra take decisions: **-$${Math.abs(lootAddTotal).toLocaleString()}**`
        );
      }

      if (eventNotes.notes?.length) extraLines.push(...eventNotes.notes);

      const finalHeat = finalizeHeat(outcome);

      const embed = new EmbedBuilder()
        .setTitle(`${modeCfg.label} — Results`)
        .setDescription([...resultLines, ...(extraLines.length ? ["", ...extraLines] : [])].join("\n"))
        .addFields({ name: "🔥 Heat (lingering)", value: `**${finalHeat}** / 100`, inline: true })
        .setFooter({ text: "Cooldowns applied: crime_global + heist cooldown." });

      await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});

      // callback so /job can persist heat TTL
      try {
        if (typeof context.onHeistComplete === "function") {
          await context.onHeistComplete({ outcome, finalHeat, identified, mode });
        }
      } catch {}

      setTimeout(() => finishOnce({ outcome, finalHeat, identified, mode }), RESULTS_LINGER_MS);
    }

    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== userId) {
          // ✅ Use flags instead of deprecated ephemeral: true
          return btn.reply({ content: "❌ This run isn’t for you.", flags: 64 }).catch(() => {});
        }
        await btn.deferUpdate().catch(() => {});

        const current = runPlan[stepIndex];
        if (!current?.scenario) return resolveAndFinish("no_scenario");

        const parts = String(btn.customId || "").split(":");
        const picked = parts[2];

        let choice = null;

        if (picked === "continue") {
          choice = { heat: +6, timeOverrun: true };
        } else {
          const idx = Number(picked);
          const list = Array.isArray(current.scenario.choices) ? current.scenario.choices : [];
          choice = list[idx] || null;
        }

        if (choice) {
          // heat uses heatMajor if major mode
          const heatDelta =
            mode === "major" && typeof choice.heatMajor === "number"
              ? Number(choice.heatMajor)
              : Number(choice.heat || 0);

          heat = clamp(heat + heatDelta, 0, 100);

          // loot add uses lootAddMajor if major mode
          const lootDelta =
            mode === "major" && typeof choice.lootAddMajor === "number"
              ? Number(choice.lootAddMajor)
              : Number(choice.lootAdd || 0);

          lootAddTotal += lootDelta;

          // flags: pull booleans directly (matches your scenarios file)
          Object.keys(flags).forEach((k) => {
            if (choice[k] === true) flags[k] = true;
          });
        }

        stepIndex++;

        if (stepIndex >= runPlan.length) return resolveAndFinish("completed");

        await showStep();
      } catch {
        return resolveAndFinish("error");
      }
    });

    collector.on("end", async () => {
      if (!finished) await resolveAndFinish("collector_end");
    });

    await showStep();
  });
};
