// commands/roulette.js
const crypto = require("crypto");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const {
  ensureUser,
  tryDebitUser,
  addServerBank,
  bankToUserIfEnough,
  getBalance,
} = require("../utils/economy");

// ✅ Achievements engine
const { unlockAchievement } = require("../utils/achievementEngine");

// 🚔 Jail guards
const { guardNotJailed, guardNotJailedComponent } = require("../utils/jail");

// 🛡️ Casino Security
const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  // ✅ NEW: DB-backed announce helper (stops spam)
  maybeAnnounceCasinoSecurity,
} = require("../utils/casinoSecurity");

/**
 * One roulette table per channel (in-memory).
 * Economy is persistent in DB.
 */
const tables = new Map(); // channelId -> tableState

const MIN_BET = 500;
const MAX_BET = 250000; // adjust if you want

// Standard roulette reds (applies to 1–36)
const REDS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

// American wheel pockets: 0, 00, 1–36
const POCKETS = [0, "00", ...Array.from({ length: 36 }, (_, i) => i + 1)];

function spinPocket() {
  return POCKETS[crypto.randomInt(0, POCKETS.length)];
}

function isNumberPocket(p) {
  return typeof p === "number";
}

function getColor(pocket) {
  if (pocket === 0 || pocket === "00") return "green";
  // 1–36 only
  return REDS.has(pocket) ? "red" : "black";
}

function isEven(pocket) {
  return isNumberPocket(pocket) && pocket !== 0 && pocket % 2 === 0;
}
function isOdd(pocket) {
  return isNumberPocket(pocket) && pocket !== 0 && pocket % 2 === 1;
}
function isLow(pocket) {
  return isNumberPocket(pocket) && pocket >= 1 && pocket <= 18;
}
function isHigh(pocket) {
  return isNumberPocket(pocket) && pocket >= 19 && pocket <= 36;
}
function getDozen(pocket) {
  if (!isNumberPocket(pocket)) return null;
  if (pocket >= 1 && pocket <= 12) return 1;
  if (pocket >= 13 && pocket <= 24) return 2;
  if (pocket >= 25 && pocket <= 36) return 3;
  return null;
}
function getColumn(pocket) {
  if (!isNumberPocket(pocket) || pocket === 0) return null;
  const r = pocket % 3;
  if (r === 1) return 1;
  if (r === 2) return 2;
  return 3; // r === 0
}

function describeBet(b) {
  switch (b.type) {
    case "number":
      return `Number ${b.value}`;
    case "doublezero":
      return "00 (Double Zero)";
    case "green":
      return "Green (0 or 00)";
    case "red":
      return "Red";
    case "black":
      return "Black";
    case "even":
      return "Even";
    case "odd":
      return "Odd";
    case "low":
      return "Low (1–18)";
    case "high":
      return "High (19–36)";
    case "dozen":
      return `Dozen ${b.value} (${b.value === 1 ? "1–12" : b.value === 2 ? "13–24" : "25–36"})`;
    case "column":
      return `Column ${b.value}`;
    default:
      return b.type;
  }
}

function betWins(bet, rolled) {
  switch (bet.type) {
    case "number":
      return isNumberPocket(rolled) && rolled === bet.value;
    case "doublezero":
      return rolled === "00";
    case "green":
      return rolled === 0 || rolled === "00";
    case "red":
      return getColor(rolled) === "red";
    case "black":
      return getColor(rolled) === "black";
    case "even":
      return isEven(rolled);
    case "odd":
      return isOdd(rolled);
    case "low":
      return isLow(rolled);
    case "high":
      return isHigh(rolled);
    case "dozen":
      return getDozen(rolled) === bet.value;
    case "column":
      return getColumn(rolled) === bet.value;
    default:
      return false;
  }
}

/**
 * Multiplier includes stake:
 * - number: 36x (35:1 profit + stake)
 * - 00: 36x
 * - green (0 or 00): 19x (18:1 profit + stake)
 * - red/black/even/odd/low/high: 2x
 * - dozen/column: 3x
 */
function betMultiplier(bet) {
  switch (bet.type) {
    case "number":
    case "doublezero":
      return 36;
    case "green":
      return 19;
    case "dozen":
    case "column":
      return 3;
    case "red":
    case "black":
    case "even":
    case "odd":
    case "low":
    case "high":
      return 2;
    default:
      return 0;
  }
}

function uniquePlayerCount(bets) {
  return new Set(bets.map((b) => b.userId)).size;
}

function potTotal(bets) {
  return bets.reduce((sum, b) => sum + b.amount, 0);
}

function formatPocket(p) {
  return p === "00" ? "00" : String(p);
}

function pctText(pct) {
  return `${Math.round(Number(pct || 0) * 100)}%`;
}

/* -----------------------------
   🏆 Roulette achievement helpers (same style as blackjack)
-------------------------------- */
async function rouFetchAchievementInfo(db, achievementId) {
  if (!db) return null;
  try {
    const res = await db.query(
      `SELECT id, name, description, category, reward_coins
       FROM public.achievements
       WHERE id = $1`,
      [achievementId]
    );
    return res.rows?.[0] ?? null;
  } catch (e) {
    console.error("rouFetchAchievementInfo failed:", e);
    return null;
  }
}

async function rouAnnounceAchievement(channel, userId, info) {
  if (!channel || !channel.send) return;
  if (!info) return;

  const rewardCoins = Number(info.reward_coins || 0);

  const embed = new EmbedBuilder()
    .setTitle("🏆 Achievement Unlocked!")
    .setDescription(`**<@${userId}>** unlocked **${info.name}**`)
    .addFields(
      { name: "Description", value: info.description || "—" },
      { name: "Category", value: info.category || "General", inline: true },
      { name: "Reward", value: rewardCoins > 0 ? `+$${rewardCoins.toLocaleString()}` : "None", inline: true }
    )
    .setFooter({ text: `Achievement ID: ${info.id}` });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function rouUnlock(thing, guildId, userId, achievementId) {
  try {
    const db = thing?.client?.db;
    if (!db) return null;

    const cleanUserId = String(userId).replace(/[<@!>]/g, "");

    const res = await unlockAchievement({
      db,
      guildId,
      userId: cleanUserId,
      achievementId,
    });

    if (!res?.unlocked) return res;

    const info = await rouFetchAchievementInfo(db, achievementId);
    await rouAnnounceAchievement(thing.channel, cleanUserId, info);

    console.log("[ROU ACH] unlocked", { guildId, userId: cleanUserId, achievementId });
    return res;
  } catch (e) {
    console.error("Roulette achievement unlock failed:", e);
    return null;
  }
}

async function incrementRouletteWins(db, guildId, userId) {
  // Requires roulette_stats table to exist
  const res = await db.query(
    `INSERT INTO public.roulette_stats (guild_id, user_id, wins)
     VALUES ($1, $2, 1)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET wins = public.roulette_stats.wins + 1
     RETURNING wins`,
    [guildId, userId]
  );
  return Number(res.rows?.[0]?.wins ?? 0);
}

function buildPanelEmbed(table) {
  const pot = potTotal(table.bets);
  const players = uniquePlayerCount(table.bets);

  const embed = new EmbedBuilder()
    .setTitle("🎰 Rubicon Roulette")
    .setDescription(
      [
        `**Round:** #${table.round}`,
        `**Bets placed:** ${table.bets.length}`,
        `**Players in round:** ${players}`,
        `**Pot (buy-ins):** $${pot.toLocaleString()}`,
        "",
        // 🛡️ Casino Security UI (host base locked)
        table.hostSecurity
          ? `🛡️ **Casino Security (Host Base):** Level ${table.hostSecurity.level} — **${pctText(table.hostSecurity.feePct)}**`
          : `🛡️ **Casino Security:** Initializing…`,
        `Fee per bet = higher of **your** security and the **host base**. (Fee is an extra charge and goes to the bank.)`,
        "",
        `Use **/roulette bet** to place a bet.`,
        `Press **🎡 Spin** to resolve the round.`,
      ].join("\n")
    )
    .setFooter({
      text: "American wheel (0, 00, 1–36). Losses feed the server bank. Payouts come from the bank.",
    });

  if (table.lastRoll !== null) {
    embed.addFields({
      name: "Last spin",
      value: `${formatPocket(table.lastRoll)} (${getColor(table.lastRoll)})`,
      inline: true,
    });
  }

  return embed;
}

function buildPanelComponents(disabled = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("roulette_spin")
      .setLabel("🎡 Spin")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId("roulette_view")
      .setLabel("🧾 View Bets")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId("roulette_reset")
      .setLabel("🧹 Reset Round")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId("roulette_end")
      .setLabel("🛑 End Game")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return [row];
}

async function ensureTable(interaction) {
  const channelId = interaction.channelId;

  let table = tables.get(channelId);
  if (!table) {
    table = {
      guildId: interaction.guildId,
      channelId,
      hostId: interaction.user.id,
      messageId: null,
      round: 1,
      bets: [],
      spinning: false,
      collector: null,
      lastRoll: null,

      // 🛡️ Casino Security
      hostSecurity: null, // snapshot locked at table creation
      // ✅ removed: lastAnnouncedSecurityByUser (caused spam)
    };
    tables.set(channelId, table);
  }

  return table;
}

async function upsertPanel(interaction, table) {
  const embed = buildPanelEmbed(table);
  const components = buildPanelComponents(table.spinning);

  let msg = null;

  if (table.messageId) {
    try {
      msg = await interaction.channel.messages.fetch(table.messageId);
      await msg.edit({ embeds: [embed], components });
    } catch {
      table.messageId = null;
      msg = null;
    }
  }

  if (!msg) {
    msg = await interaction.channel.send({ embeds: [embed], components });
    table.messageId = msg.id;
  }

  attachCollectorIfNeeded(msg, table);
  return msg;
}

function attachCollectorIfNeeded(message, table) {
  if (table.collector && !table.collector.ended) return;

  const collector = message.createMessageComponentCollector({
    time: 1000 * 60 * 60 * 6, // 6 hours
  });

  table.collector = collector;

  collector.on("collect", async (i) => {
    // 🚔 Jail gate for button actions
    if (await guardNotJailedComponent(i)) return;

    if (!i.inGuild()) {
      try {
        await i.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral });
      } catch {}
      return;
    }

    try {
      // 🧾 View Bets
      if (i.customId === "roulette_view") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const bets = table.bets;
        if (bets.length === 0) return i.editReply("No bets placed yet for this round.");

        const lines = bets.slice(0, 20).map((b, idx) => {
          return `${idx + 1}. <@${b.userId}> — **$${b.amount.toLocaleString()}** on **${describeBet(b)}**`;
        });

        const extra = bets.length > 20 ? `\n…and ${bets.length - 20} more.` : "";
        return i.editReply(`🧾 **Current Bets (Round #${table.round})**\n${lines.join("\n")}${extra}`);
      }

      // 🧹 Reset Round (refunds bets if possible)
      if (i.customId === "roulette_reset") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const isHost = i.user.id === table.hostId;
        const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isHost && !isAdmin) return i.editReply("❌ Only the table host or an admin can reset the round.");

        if (table.spinning) return i.editReply("⏳ A spin is currently resolving.");

        const refundsList = table.bets;
        table.bets = [];

        let refundedCount = 0;
        let failedCount = 0;

        for (const b of refundsList) {
          const res = await bankToUserIfEnough(
            table.guildId,
            b.userId,
            b.amount,
            "roulette_reset_refund",
            { channelId: table.channelId, round: table.round }
          );

          if (res.ok) refundedCount++;
          else failedCount++;
        }

        table.round += 1;

        await upsertPanel(i, table);
        return i.editReply(
          `🧹 Round reset.\n✅ Refunded: **${refundedCount}** bet(s)\n⚠️ Failed refunds (bank low): **${failedCount}**`
        );
      }

      // 🛑 End Game (refunds bets if possible, deletes panel after 15s)
      if (i.customId === "roulette_end") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const isHost = i.user.id === table.hostId;
        const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isHost && !isAdmin) return i.editReply("❌ Only the table host or an admin can end the game.");

        if (table.spinning) return i.editReply("⏳ A spin is currently resolving. Try again in a moment.");

        const refundsList = table.bets;
        table.bets = [];

        let refundedCount = 0;
        let failedCount = 0;

        for (const b of refundsList) {
          const res = await bankToUserIfEnough(
            table.guildId,
            b.userId,
            b.amount,
            "roulette_end_refund",
            { channelId: table.channelId, round: table.round }
          );

          if (res.ok) refundedCount++;
          else failedCount++;
        }

        // Disable panel immediately
        table.spinning = true;
        try {
          await i.message.edit({
            embeds: [buildPanelEmbed(table)],
            components: buildPanelComponents(true),
          });
        } catch {}

        // Stop collector + cleanup state
        try {
          table.collector?.stop("ended");
        } catch {}
        tables.delete(table.channelId);

        // Delete panel after 15 seconds
        setTimeout(() => {
          i.message.delete().catch(() => {});
        }, 15000);

        return i.editReply(
          `🛑 Game ended. Panel will delete in **15 seconds**.\n` +
            `✅ Refunded: **${refundedCount}** bet(s)\n` +
            `⚠️ Failed refunds (bank low): **${failedCount}**`
        );
      }

      // 🎡 Spin (host/admin only)
      if (i.customId === "roulette_spin") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const isHost = i.user.id === table.hostId;
        const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isHost && !isAdmin) return i.editReply("❌ Only the table host or an admin can spin.");

        if (table.spinning) return i.editReply("⏳ A spin is already in progress.");
        if (table.bets.length === 0) return i.editReply("❌ No bets placed yet.");

        table.spinning = true;
        await upsertPanel(i, table);

        const rolled = spinPocket(); // 0, "00", 1–36
        table.lastRoll = rolled;

        // Resolve bets
        const betsThisRound = table.bets;
        table.bets = []; // clear immediately to prevent double-paying
        const roundNumber = table.round;
        table.round += 1;

        const lines = [];
        lines.push(`**Result:** 🎯 **${formatPocket(rolled)}** (${getColor(rolled)})`);
        lines.push("");

        let winners = 0;
        let refunds = 0;
        let apologies = 0;

        // ✅ Track outcomes per user for achievements
        const participants = new Set(betsThisRound.map((b) => b.userId));
        const roundWinners = new Set();
        const wonOn00 = new Set();

        for (const b of betsThisRound) {
          const win = betWins(b, rolled);

          if (win) {
            roundWinners.add(b.userId);
            if (b.type === "doublezero" && rolled === "00") {
              wonOn00.add(b.userId);
            }
          }

          if (!win) continue;

          winners++;
          const mult = betMultiplier(b);
          const payout = b.amount * mult;

          const pay = await bankToUserIfEnough(
            table.guildId,
            b.userId,
            payout,
            "roulette_payout",
            { channelId: table.channelId, round: roundNumber, bet: b, rolled }
          );

          if (pay.ok) {
            lines.push(`✅ <@${b.userId}> won **$${payout.toLocaleString()}** on **${describeBet(b)}**`);
          } else {
            // Bank can't cover payout: attempt refund of base bet
            const refund = await bankToUserIfEnough(
              table.guildId,
              b.userId,
              b.amount,
              "roulette_payout_refund",
              { channelId: table.channelId, round: roundNumber, bet: b, note: "bank_insufficient_payout", rolled }
            );

            if (refund.ok) {
              refunds++;
              lines.push(
                `⚠️ <@${b.userId}> should’ve won, but the bank was low. Refunded **$${b.amount.toLocaleString()}**.`
              );
            } else {
              apologies++;
              lines.push(`😬 <@${b.userId}> should’ve won, but the bank was empty. Paid **$0** (sorry!).`);
            }
          }
        }

        if (winners === 0) {
          lines.push("House wins this round. 🏦");
        } else if (refunds > 0 || apologies > 0) {
          lines.push("");
          if (refunds > 0) lines.push(`🧾 Refunds due to low bank: **${refunds}**`);
          if (apologies > 0) lines.push(`😬 Unpaid wins due to empty bank: **${apologies}**`);
        }

        // 🏆 Achievements
        try {
          const db = i.client.db;

          for (const uid of roundWinners) {
            await rouUnlock(i, table.guildId, uid, "rou_first_win");

            if (wonOn00.has(uid)) {
              await rouUnlock(i, table.guildId, uid, "rou_00");
            }

            if (db) {
              const winsCount = await incrementRouletteWins(db, table.guildId, uid);
              if (winsCount >= 10) {
                await rouUnlock(i, table.guildId, uid, "rou_10wins");
              }
            }
          }

          for (const uid of participants) {
            if (!roundWinners.has(uid)) {
              await rouUnlock(i, table.guildId, uid, "rou_house_wins");
            }
          }
        } catch (e) {
          console.error("Roulette achievement awarding failed:", e);
        }

        await i.editReply("🎡 Spin complete.");

        const resultEmbed = new EmbedBuilder()
          .setTitle("🎡 Roulette Spin Results")
          .setDescription(lines.join("\n"))
          .setFooter({ text: `Round #${roundNumber} resolved.` });

        const resultMsg = await i.channel.send({ embeds: [resultEmbed] });
        setTimeout(() => {
          resultMsg.delete().catch(() => {});
        }, 15000);

        table.spinning = false;
        await upsertPanel(i, table);
        return;
      }

      // Unknown button
      try {
        if (!i.deferred && !i.replied) {
          await i.reply({ content: "❌ Unknown action.", flags: MessageFlags.Ephemeral });
        } else {
          await i.editReply("❌ Unknown action.");
        }
      } catch {}
    } catch (err) {
      console.error("Roulette panel interaction error:", err);
      try {
        if (i.deferred || i.replied) {
          await i.editReply("❌ Something went wrong. Check Railway logs.");
        } else {
          await i.reply({ content: "❌ Something went wrong. Check Railway logs.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
    }
  });

  collector.on("end", () => {
    table.collector = null;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("Play shared-table roulette (one table per channel).")
    .addSubcommand((sub) =>
      sub.setName("table").setDescription("Create or refresh the roulette panel for this channel.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("bet")
        .setDescription("Place a bet for the current round (charged immediately).")
        .addIntegerOption((opt) =>
          opt
            .setName("amount")
            .setDescription("Bet amount")
            .setRequired(true)
            .setMinValue(MIN_BET)
            .setMaxValue(MAX_BET)
        )
        .addStringOption((opt) =>
          opt
            .setName("type")
            .setDescription("Bet type")
            .setRequired(true)
            .addChoices(
              { name: "Number (0–36)", value: "number" },
              { name: "00 (Double Zero)", value: "doublezero" },
              { name: "Green (0 or 00)", value: "green" },
              { name: "Red", value: "red" },
              { name: "Black", value: "black" },
              { name: "Even", value: "even" },
              { name: "Odd", value: "odd" },
              { name: "Low (1–18)", value: "low" },
              { name: "High (19–36)", value: "high" },
              { name: "Dozen (1/2/3)", value: "dozen" },
              { name: "Column (1/2/3)", value: "column" }
            )
        )
        .addIntegerOption((opt) =>
          opt
            .setName("value")
            .setDescription("Required for Number/Dozen/Column. (Number: 0–36, Dozen: 1–3, Column: 1–3)")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ Server only.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    // 🚔 Jail gate for /roulette (do this BEFORE deferring)
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const sub = interaction.options.getSubcommand();
    const table = await ensureTable(interaction);

    if (sub === "table") {
      // 🛡️ Snapshot host base security ONCE per table lifetime (lock)
      if (!table.hostSecurity) {
        try {
          table.hostSecurity = await getHostBaseSecurity(interaction.guildId, table.hostId);
        } catch (e) {
          console.error("[roulette] failed to get host security:", e);
          table.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
        }
      }

      await upsertPanel(interaction, table);
      return interaction.editReply("✅ Roulette table is live in this channel.");
    }

    if (sub === "bet") {
      const amount = interaction.options.getInteger("amount", true);
      const type = interaction.options.getString("type", true);
      const value = interaction.options.getInteger("value", false);

      if (table.spinning) return interaction.editReply("⏳ A spin is currently resolving. Try again in a moment.");

      // Validate value requirements
      if (type === "number") {
        if (value === null || value < 0 || value > 36) {
          return interaction.editReply("❌ For **Number**, you must provide **value: 0–36**.");
        }
      } else if (type === "dozen" || type === "column") {
        if (value === null || value < 1 || value > 3) {
          return interaction.editReply(`❌ For **${type}**, you must provide **value: 1–3**.`);
        }
      } else if (type === "doublezero" || type === "green") {
        if (value !== null) {
          return interaction.editReply(`❌ For **${type}**, you don’t need a value.`);
        }
      }

      await upsertPanel(interaction, table);

      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      await ensureUser(guildId, userId);

      // 🛡️ Ensure host base security exists (if someone bets before /roulette table refresh)
      if (!table.hostSecurity) {
        try {
          table.hostSecurity = await getHostBaseSecurity(guildId, table.hostId);
        } catch (e) {
          console.error("[roulette] failed to get host security (lazy init):", e);
          table.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
        }
      }

      // 🛡️ Get player's current security (rolling 24h)
      let playerSec = null;
      try {
        playerSec = await getUserCasinoSecurity(guildId, userId);
      } catch (e) {
        console.error("[roulette] failed to get player security:", e);
        playerSec = { level: 0, label: "Normal", feePct: 0 };
      }

      // ✅ DB-backed announcement (NO SPAM):
      // - announces once on first ever casino play
      // - then only when the user's level actually changes
      try {
        const db = interaction.client?.db || null;
        const displayName =
          interaction.member?.displayName ||
          interaction.user?.globalName ||
          interaction.user?.username ||
          "Unknown";

        await maybeAnnounceCasinoSecurity({
          db,
          channel: interaction.channel,
          guildId,
          userId,
          displayName,
          current: playerSec,
        });
      } catch (e) {
        // don't block gameplay if announcements fail
      }

      // Effective fee = max(player fee NOW, host base fee LOCKED)
      const effectiveFeePct = getEffectiveFeePct({
        playerFeePct: playerSec.feePct,
        hostBaseFeePct: table.hostSecurity.feePct,
      });

      const feeCalc = computeFeeForBet(amount, effectiveFeePct);
      const betAmount = feeCalc.betAmount;
      const feeAmount = feeCalc.feeAmount;
      const totalCharge = feeCalc.totalCharge;

      // Debit user for BET + FEE as one charge (fee is an additional charge)
      const debit = await tryDebitUser(
        guildId,
        userId,
        totalCharge,
        "roulette_bet",
        {
          channelId: table.channelId,
          round: table.round,
          type,
          value,
          casinoSecurity: {
            hostBaseLevel: table.hostSecurity.level,
            hostBaseFeePct: table.hostSecurity.feePct,
            playerLevel: playerSec.level,
            playerFeePct: playerSec.feePct,
            effectiveFeePct,
            feeAmount,
            betAmount,
            totalCharge,
          },
        }
      );

      if (!debit.ok) {
        const bal = await getBalance(guildId, userId);
        return interaction.editReply(
          `❌ You need **$${totalCharge.toLocaleString()}** (bet **$${betAmount.toLocaleString()}** + fee **$${feeAmount.toLocaleString()}**), ` +
          `but you only have **$${bal.toLocaleString()}**.`
        );
      }

      // 🏆 High roller achievement (bet >= 50,000) — based on bet amount only
      if (betAmount >= 50000) {
        await rouUnlock(interaction, guildId, userId, "rou_high_roller");
      }

      // Send bet amount to server bank
      await addServerBank(
        guildId,
        betAmount,
        "roulette_bet_bank",
        { channelId: table.channelId, round: table.round, by: userId, type, value }
      );

      // Send fee amount to server bank
      if (feeAmount > 0) {
        await addServerBank(
          guildId,
          feeAmount,
          "roulette_fee_bank",
          {
            channelId: table.channelId,
            round: table.round,
            by: userId,
            effectiveFeePct,
            hostBaseFeePct: table.hostSecurity.feePct,
          }
        );
      }

      // Store bet (stake only; payouts use stake)
      table.bets.push({
        userId,
        amount: betAmount,
        type,
        value: type === "number" || type === "dozen" || type === "column" ? value : null,
        placedAt: Date.now(),
      });

      await upsertPanel(interaction, table);

      const feeLine =
        feeAmount > 0
          ? `\n🛡️ Casino Security fee applied: **${pctText(effectiveFeePct)}** → **$${feeAmount.toLocaleString()}**`
          : `\n🛡️ Casino Security fee applied: **0%**`;

      return interaction.editReply(
        `✅ Bet placed: **$${betAmount.toLocaleString()}** on **${describeBet({ type, value })}**.\n` +
          `Total charged: **$${totalCharge.toLocaleString()}** (bet + fee).` +
          feeLine +
          `\nFunds sent to the server bank.`
      );
    }

    return interaction.editReply("❌ Unknown subcommand.");
  },
};
