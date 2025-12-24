// data/crime/storeRobbery.js
const {
  return new Promise(async (resolve) => {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const { pool } = require("../../utils/db");
const { setJail } = require("../../utils/jail");

// Scenarios (data-only)
let scenarios = require("./storeRobbery.scenarios");

// =====================
// CONFIG (LOCKED RULES)
// =====================

// 3–5 step minigame
const MIN_STEPS = 3;
const MAX_STEPS = 5;

// Cooldowns (minutes)
const GLOBAL_LOCKOUT_MINUTES = 10;
const STORE_COOLDOWN_MINUTES = 10;

// Heat tiers => outcomes
const HEAT_TIERS = {
  CLEAN: 20,        // < 20 => clean
  SPOTTED: 35,      // 20–34 => spotted
  PARTIAL: 60,      // 35–59 => partial
  BUSTED_HARD: 90,  // >= 90 => busted hard
  // 60–89 => busted
};

// Payouts / fines
const PAYOUT_MIN = 2000;
const PAYOUT_MAX = 6000;

const FINE_MIN = 3000;
const FINE_MAX = 8000;

// Jail chance (only on busted tiers)
const JAIL_CHANCE_BUSTED = 0.18;       // uncommon
const JAIL_CHANCE_BUSTED_HARD = 0.28;  // rare-ish
const JAIL_MIN_MINUTES = 2;
const JAIL_MAX_MINUTES = 5;

// Random run events
const LOOT_DROP_CHANCE = 0.12;
const VALUABLE_FIND_CHANCE = 0.10;
const LOOT_DROP_MIN = 300;
const LOOT_DROP_MAX = 1200;
const VALUABLE_MIN = 250;
const VALUABLE_MAX = 1500;

// UI / timeout
const RUN_TIMEOUT_MS = 3 * 60_000;

// =====================
// OPTIONAL BONUS ITEM (ID ONLY)
// =====================
const THEFT_KIT_ITEM_ID = "Crime_Kit";
// Each decision: reduce heat by extra 1–2 if kit active
const THEFT_KIT_EXTRA_MIN = 1;
const THEFT_KIT_EXTRA_MAX = 2;

// ✅ Theft kit: read current uses_remaining
async function getTheftKitUses(guildId, userId) {
  const res = await pool.query(
    `SELECT qty, uses_remaining
     FROM user_inventory
     WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
    [guildId, userId, THEFT_KIT_ITEM_ID]
  );

  if (!res.rowCount) return 0;
  const qty = Number(res.rows[0].qty || 0);
  const uses = Number(res.rows[0].uses_remaining || 0);
  if (qty <= 0) return 0;
  return uses;
}

// ✅ Bulletproof: consume uses directly (atomic) and delete row at 0
async function consumeItemUse(guildId, userId, itemId, usesToConsume = 1) {
  const n = Math.max(1, Number(usesToConsume || 1));

  const res = await pool.query(
    `
    UPDATE user_inventory
    SET uses_remaining = uses_remaining - $4,
        updated_at = NOW()
    WHERE guild_id=$1
      AND user_id=$2
      AND item_id=$3
      AND uses_remaining >= $4
    RETURNING uses_remaining
    `,
    [guildId, userId, itemId, n]
  );

  if (!res.rowCount) return { ok: false };

  const usesRemaining = Number(res.rows[0].uses_remaining || 0);

  if (usesRemaining <= 0) {
    await pool.query(
      `DELETE FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
      [guildId, userId, itemId]
    );
  }

  return { ok: true, usesRemaining };
}

// =====================
// DB HELPERS
// =====================
async function addUserBalance(guildId, userId, amount) {
  await pool.query(
    `UPDATE user_balances
     SET balance = balance + $1
     WHERE guild_id=$2 AND user_id=$3`,
    [amount, guildId, userId]
  );
}

async function subtractUserBalanceAndSendToBank(guildId, userId, amount) {
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

async function setCooldown(guildId, userId, key, minutes) {
  const next = new Date(Date.now() + minutes * 60 * 1000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, next]
  );
}

async function applyCooldowns(guildId, userId) {
  await setCooldown(guildId, userId, "crime_global", GLOBAL_LOCKOUT_MINUTES);
  await setCooldown(guildId, userId, "crime_store", STORE_COOLDOWN_MINUTES);
}

// =====================
// RANDOM HELPERS
// =====================
function randInt(min, maxIncl) {
  return Math.floor(min + Math.random() * (maxIncl - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function safeStr(v, fallback = "…") {
  if (v === null || v === undefined) return fallback;
  const s = String(v);
  return s.trim().length ? s : fallback;
}
function safeId(v, fallback = "x") {
  const s = safeStr(v, fallback);
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

// =====================
// SCENARIO NORMALIZATION
// Supports: prompt OR text OR description
// =====================
function normalizeScenarios(raw) {
  const src = raw?.phases ? raw.phases : raw;
  const out = {};

  for (const [phase, list] of Object.entries(src || {})) {
    if (!Array.isArray(list)) continue;

    out[phase] = list
      .filter(Boolean)
      .map((s, idx) => {
        const id = safeId(s.id ?? `${phase}_${idx}`);
        const prompt = safeStr(
          s.prompt ?? s.text ?? s.description,
          "You size up the situation…"
        );
        const choices = Array.isArray(s.choices) ? s.choices : [];

        const normChoices = choices
          .filter(Boolean)
          .map((c, cIdx) => ({
            label: safeStr(
              c.label ?? c.text ?? `Option ${cIdx + 1}`,
              `Option ${cIdx + 1}`
            ),
            heat: typeof c.heat === "number" ? c.heat : 0,
            lootAdd: typeof c.lootAdd === "number" ? c.lootAdd : 0,

            evidenceRisk: !!c.evidenceRisk,
            evidenceClear: !!c.evidenceClear,
            usedCar: !!c.usedCar,
            timerRisk: !!c.timerRisk,
            witnessRisk: !!c.witnessRisk,
            crowdBlend: !!c.crowdBlend,
          }));

        const finalChoices =
          normChoices.length >= 2
            ? normChoices
            : [
                { label: "Act casual", heat: 0, evidenceRisk: true },
                { label: "Grab and go", heat: 12, timerRisk: true },
              ];

        return { id, prompt, choices: finalChoices };
      });
  }

  return out;
}

scenarios = normalizeScenarios(scenarios);

// =====================
// RENDER HELPERS
// =====================
function buildRow(phaseKey, scenarioId, choices) {
  const row = new ActionRowBuilder();
  choices.slice(0, 5).forEach((c, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sr|${phaseKey}|${scenarioId}|${idx}`)
        .setLabel(safeStr(c.label, `Option ${idx + 1}`))
        .setStyle(ButtonStyle.Primary)
    );
  });
  return row;
}

function renderScenario(phaseKey, scenario, heat, theftKitInfo = null) {
  const embed = new EmbedBuilder()
    .setTitle("🏪 Store Robbery")
    .setDescription(safeStr(scenario?.prompt, "You hesitate, watching the counter…"))
    .addFields({ name: "🔥 Heat", value: `${clamp(heat, 0, 100)}/100`, inline: true });

  if (theftKitInfo?.active) {
    const uses = Number(theftKitInfo.usesStart || 0);
    embed.addFields({
      name: "🛠️ Theft Kit",
      value: `Active (${uses} uses left)\nBonus: -${theftKitInfo.bonusTotal || 0} heat so far`,
      inline: true,
    });
    if (typeof theftKitInfo.lastBonus === "number") {
      embed.addFields({
        name: "✨ Last Bonus",
        value: `-${theftKitInfo.lastBonus} heat`,
        inline: true,
      });
    }
  }

  embed.setFooter({ text: "Heat carries forward only in Crime." });

  const row = buildRow(phaseKey, safeId(scenario?.id, "x"), scenario?.choices || []);
  return { embed, components: [row] };
}

function applyRandomRunEvents() {
  const notes = [];

  if (Math.random() < LOOT_DROP_CHANCE) {
    const drop = randInt(LOOT_DROP_MIN, LOOT_DROP_MAX);
    notes.push(`💨 You fumbled and dropped **$${drop.toLocaleString()}** worth of loot.`);
    return { payoutDelta: -drop, notes };
  }

  if (Math.random() < VALUABLE_FIND_CHANCE) {
    const find = randInt(VALUABLE_MIN, VALUABLE_MAX);
    notes.push(`✨ You found an extra **$${find.toLocaleString()}** hidden away.`);
    return { payoutDelta: +find, notes };
  }

  return { payoutDelta: 0, notes };
}

function determineOutcomeFromHeat(heat) {
  if (heat < HEAT_TIERS.CLEAN) return "clean";
  if (heat < HEAT_TIERS.SPOTTED) return "spotted";
  if (heat < HEAT_TIERS.PARTIAL) return "partial";
  if (heat >= HEAT_TIERS.BUSTED_HARD) return "busted_hard";
  return "busted";
}

function computeSuccessPayout(outcome) {
  let base = randInt(PAYOUT_MIN, PAYOUT_MAX);
  if (outcome === "partial") base = Math.floor(base * 0.75);
  return Math.max(0, base);
}

function computeFine(outcome) {
  let fine = randInt(FINE_MIN, FINE_MAX);
  if (outcome === "busted_hard") fine = Math.floor(fine * 1.1);
  return fine;
}

// =====================
// MAIN EXPORT
// =====================
module.exports = function startStoreRobbery(interaction, context = {}) {
  return new Promise(async (resolve) => {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    let heat = clamp(Number(context.lingeringHeat || 0), 0, 100);

    let evidenceRisk = false;
    let evidenceCleared = false;
    let usedCar = false;
    let timerRisk = false;
    let witnessRisk = false;
    let crowdBlendUsed = false;

    // ✅ Theft kit run state (optional bonus)
    let theftKitUsesStart = 0;
    let theftKitActive = false;
    let theftKitBonusTotal = 0;
    let theftKitLastBonus = null;
    let theftKitConsumed = false;
    let theftKitUsesRemainingAfter = null;

    try {
      theftKitUsesStart = await getTheftKitUses(guildId, userId);
      theftKitActive = theftKitUsesStart > 0;
    } catch {
      theftKitActive = false;
      theftKitUsesStart = 0;
    }

    let finished = false;
    const finishOnce = (payload) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    const phases = ["approach", "method", "greed", "exit", "aftermath"];
    const stepCount = randInt(MIN_STEPS, MAX_STEPS);
    const chosenPhases = phases.slice(0, stepCount);

    const chosenScenarios = [];
    const usedIds = new Set();

    for (const phase of chosenPhases) {
      const poolList = scenarios[phase] || [];
      if (!poolList.length) continue;

      const available = poolList.filter((s) => s && !usedIds.has(s.id));
      const s = (available.length ? pick(available) : pick(poolList)) || null;

      if (s) {
        usedIds.add(s.id);
        chosenScenarios.push({ phase, scenario: s });
      }
    }

    let phaseIndex = 0;

    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      time: RUN_TIMEOUT_MS,
    });

    async function showCurrentPhase() {
      const current = chosenScenarios[phaseIndex];
      if (!current || !current.scenario) {
        return resolveAndFinish();
      }

      const { phase, scenario } = current;
      const { embed, components } = renderScenario(
        phase,
        scenario,
        heat,
        theftKitActive
          ? {
              active: true,
              usesStart: theftKitUsesStart,
              bonusTotal: theftKitBonusTotal,
              lastBonus: theftKitLastBonus,
            }
          : null
      );

      await interaction.editReply({ content: null, embeds: [embed], components });
    }

    function rollIdentifiedLater() {
      let chance = 0.05;

      if (evidenceRisk) chance += 0.18;
      if (timerRisk) chance += 0.10;
      if (usedCar) chance += 0.10;
      if (witnessRisk) chance += 0.08;

      if (crowdBlendUsed) chance -= 0.08;
      if (evidenceCleared) chance -= 0.12;

      chance = clamp(chance, 0, 0.60);
      return Math.random() < chance;
    }

    async function maybeJail(outcome) {
      const roll = Math.random();
      const chance = outcome === "busted_hard" ? JAIL_CHANCE_BUSTED_HARD : JAIL_CHANCE_BUSTED;

      if (roll >= chance) return 0;

      const minutes = randInt(JAIL_MIN_MINUTES, JAIL_MAX_MINUTES);
      await setJail(guildId, userId, minutes);
      return minutes;
    }

    async function resolveAndFinish() {
      await applyCooldowns(guildId, userId);

      // ✅ Consume 1 theft kit use per run (only if active at start)
      if (theftKitActive && !theftKitConsumed) {
        try {
          const useRes = await consumeItemUse(guildId, userId, THEFT_KIT_ITEM_ID, 1);
          if (useRes?.ok) {
            theftKitConsumed = true;
            theftKitUsesRemainingAfter = Number(useRes.usesRemaining ?? 0);
          }
        } catch {
          // Avoid punishing player due to DB errors
        }
      }

      const eventNotes = applyRandomRunEvents();

      let outcome = determineOutcomeFromHeat(heat);
      const identified = rollIdentifiedLater();
      if (identified && outcome === "clean") outcome = "spotted";

      const resultLines = [];

      if (outcome === "clean" || outcome === "spotted") {
        const payout = computeSuccessPayout(outcome) + eventNotes.payoutDelta;
        const finalPayout = Math.max(0, payout);
        await addUserBalance(guildId, userId, finalPayout);

        resultLines.push(
          outcome === "clean"
            ? `✅ Clean getaway. You pocket **$${finalPayout.toLocaleString()}**.`
            : `⚠️ You got out, but it felt risky. You pocket **$${finalPayout.toLocaleString()}**.`
        );

        if (identified) resultLines.push("🧾 You might’ve been **identified later**.");
      } else if (outcome === "partial") {
        const payout = computeSuccessPayout("partial") + eventNotes.payoutDelta;
        const finalPayout = Math.max(0, payout);
        await addUserBalance(guildId, userId, finalPayout);

        resultLines.push(`😬 You got something, but not much. You pocket **$${finalPayout.toLocaleString()}**.`);
      } else {
        const fine = computeFine(outcome);
        const taken = await subtractUserBalanceAndSendToBank(guildId, userId, fine);

        resultLines.push(
          outcome === "busted_hard"
            ? `🚨 **BUSTED HARD.** Fine: **$${fine.toLocaleString()}** (paid **$${taken.toLocaleString()}**).`
            : `🚓 **BUSTED.** Fine: **$${fine.toLocaleString()}** (paid **$${taken.toLocaleString()}**).`
        );

        const jailedMinutes = await maybeJail(outcome);
        if (jailedMinutes > 0) {
          resultLines.push(`⛓️ You were jailed for **${jailedMinutes} minutes**. (All jobs blocked)`);
        } else {
          resultLines.push("😮‍💨 You avoided jail this time.");
        }
      }

      if (theftKitActive) {
        const usesLeftText =
          typeof theftKitUsesRemainingAfter === "number"
            ? `${theftKitUsesRemainingAfter}`
            : "unknown";

        resultLines.push(
          "",
          `🛠️ Theft Kit bonus applied: **-${theftKitBonusTotal} heat** across decisions.`,
          theftKitConsumed
            ? `🧰 Theft Kit use consumed: **1** (uses left: **${usesLeftText}**)`
            : `🧰 Theft Kit: **active** (use not consumed due to an error)`
        );
      }

      if (eventNotes.notes?.length) resultLines.push("", ...eventNotes.notes);

      if (outcome === "clean") heat = clamp(heat - 8, 0, 100);
      if (outcome === "spotted") heat = clamp(heat + 5, 0, 100);
      if (outcome === "partial") heat = clamp(heat + 12, 0, 100);
      if (outcome === "busted") heat = clamp(heat + 22, 0, 100);
      if (outcome === "busted_hard") heat = clamp(heat + 35, 0, 100);

      if (typeof context.onStoreRobberyComplete === "function") {
        try {
          await context.onStoreRobberyComplete({
            guildId,
            userId,
            outcome,
            finalHeat: heat,
            evidenceRisk,
            identified,
          });
        } catch {}
      }

      const embed = new EmbedBuilder()
        .setTitle("🏁 Store Robbery Complete")
        .setDescription(resultLines.join("\n"))
        .addFields(
          { name: "🔥 Final Heat", value: `${heat}/100`, inline: true },
          { name: "🧾 Identified?", value: identified ? "Yes (possible)" : "No", inline: true }
        )
        .setFooter({ text: "Crime heat only affects Crime jobs." })
        .setColor(outcome.startsWith("busted") ? 0xaa0000 : 0x22aa55);

      await interaction.editReply({ content: null, embeds: [embed], components: [] }).catch(() => {});

      try { collector.stop("done");
      resolve(); } catch {}
      finishOnce({ outcome, finalHeat: heat, identified });
    }

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ Not your robbery.", flags: 64 }).catch(() => {});
      }

      await i.deferUpdate().catch(() => {});

      const parts = String(i.customId || "").split("|");
      if (parts.length !== 4 || parts[0] !== "sr") return;

      const phase = parts[1];
      const scenarioId = parts[2];
      const choiceIndex = Number(parts[3]);

      const poolList = scenarios[phase] || [];
      const scenario = poolList.find((s) => s.id === scenarioId);
      const choice = scenario?.choices?.[choiceIndex];
      if (!choice) return;

      if (typeof choice.heat === "number") heat += choice.heat;

      if (choice.evidenceRisk) evidenceRisk = true;
      if (choice.evidenceClear) evidenceCleared = true;
      if (choice.usedCar) usedCar = true;
      if (choice.timerRisk) timerRisk = true;
      if (choice.witnessRisk) witnessRisk = true;
      if (choice.crowdBlend) crowdBlendUsed = true;

      if (theftKitActive) {
        const extra = randInt(THEFT_KIT_EXTRA_MIN, THEFT_KIT_EXTRA_MAX);
        heat -= extra;
        theftKitBonusTotal += extra;
        theftKitLastBonus = extra;
      }

      heat = clamp(heat, 0, 100);

      phaseIndex++;
      if (phaseIndex >= chosenScenarios.length) return resolveAndFinish();
      return showCurrentPhase();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "done") return;
      await interaction
        .editReply({
          content: "⏱️ You hesitated too long. The opportunity passed.",
          embeds: [],
          components: [],
        })
        .catch(() => {});
      finishOnce({ outcome: "timeout", finalHeat: heat, identified: false });
    });

    await showCurrentPhase();
      resolve();
  });
};
