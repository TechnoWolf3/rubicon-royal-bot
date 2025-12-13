// commands/roulette.js
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

/**
 * One roulette table per channel.
 * State is kept in-memory. Economy is persistent in DB.
 */
const tables = new Map(); // channelId -> tableState

const MIN_BET = 500;
const MAX_BET = 250000; // tweak as you like

// Standard European roulette reds
const REDS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36
]);

function getColor(n) {
  if (n === 0) return "green";
  return REDS.has(n) ? "red" : "black";
}

function isEven(n) {
  return n !== 0 && n % 2 === 0;
}
function isOdd(n) {
  return n !== 0 && n % 2 === 1;
}
function isLow(n) {
  return n >= 1 && n <= 18;
}
function isHigh(n) {
  return n >= 19 && n <= 36;
}
function getDozen(n) {
  if (n >= 1 && n <= 12) return 1;
  if (n >= 13 && n <= 24) return 2;
  if (n >= 25 && n <= 36) return 3;
  return null;
}
function getColumn(n) {
  if (n === 0) return null;
  const r = n % 3;
  if (r === 1) return 1;
  if (r === 2) return 2;
  return 3; // r === 0
}

function describeBet(b) {
  switch (b.type) {
    case "number": return `Number ${b.value}`;
    case "red": return "Red";
    case "black": return "Black";
    case "even": return "Even";
    case "odd": return "Odd";
    case "low": return "Low (1–18)";
    case "high": return "High (19–36)";
    case "dozen": return `Dozen ${b.value} (${b.value === 1 ? "1–12" : b.value === 2 ? "13–24" : "25–36"})`;
    case "column": return `Column ${b.value}`;
    default: return b.type;
  }
}

function betWins(bet, rolled) {
  switch (bet.type) {
    case "number":
      return rolled === bet.value;
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

// Returns multiplier including stake (like: win payout = bet * multiplier)
// - number: 36x (35:1 profit + stake)
// - red/black/even/odd/low/high: 2x
// - dozen/column: 3x
function betMultiplier(bet) {
  switch (bet.type) {
    case "number": return 36;
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
  return new Set(bets.map(b => b.userId)).size;
}

function potTotal(bets) {
  return bets.reduce((sum, b) => sum + b.amount, 0);
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
        `Use **/roulette bet** to place a bet.`,
        `Press **🎡 Spin** to resolve the round.`,
      ].join("\n")
    )
    .setFooter({ text: "Single-zero wheel (0–36). Losses feed the server bank. Payouts come from the bank." });

  if (table.lastRoll !== null) {
    const c = getColor(table.lastRoll);
    embed.addFields({
      name: "Last spin",
      value: `${table.lastRoll} (${c})`,
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
    };
    tables.set(channelId, table);
  }

  return table;
}

async function upsertPanel(interaction, table) {
  // If we have a messageId, try editing it; if missing/deleted, create a new one.
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
  // Always ensure a collector exists and is attached to the current panel message.
  if (table.collector && !table.collector.ended) return;

  const collector = message.createMessageComponentCollector({
    time: 1000 * 60 * 60 * 6, // 6h; long-lived but not forever
  });

  table.collector = collector;

  collector.on("collect", async (i) => {
    // Guard: must be same guild
    if (!i.inGuild()) {
      try { await i.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }); } catch {}
      return;
    }

    try {
      if (i.customId === "roulette_view") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const bets = table.bets;
        if (bets.length === 0) return i.editReply("No bets placed yet for this round.");

        // Show up to 20 lines to keep it readable
        const lines = bets.slice(0, 20).map((b, idx) => {
          return `${idx + 1}. <@${b.userId}> — **$${b.amount.toLocaleString()}** on **${describeBet(b)}**`;
        });

        const extra = bets.length > 20 ? `\n…and ${bets.length - 20} more.` : "";
        return i.editReply(`🧾 **Current Bets (Round #${table.round})**\n${lines.join("\n")}${extra}`);
      }

      if (i.customId === "roulette_reset") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const isHost = i.user.id === table.hostId;
        const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isHost && !isAdmin) return i.editReply("❌ Only the table host or an admin can reset the round.");

        if (table.spinning) return i.editReply("⏳ A spin is currently resolving.");

        // Refund all current bets if possible (bank protected)
        const refunds = table.bets;
        table.bets = [];

        let refundedCount = 0;
        let failedCount = 0;

        for (const b of refunds) {
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
        return i.editReply(`🧹 Round reset.\n✅ Refunded: **${refundedCount}** bet(s)\n⚠️ Failed refunds (bank low): **${failedCount}**`);
      }

      if (i.customId === "roulette_spin") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        const isHost = i.user.id === table.hostId;
        const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isHost && !isAdmin) return i.editReply("❌ Only the table host or an admin can spin.");

        if (table.spinning) return i.editReply("⏳ A spin is already in progress.");
        if (table.bets.length === 0) return i.editReply("❌ No bets placed yet.");

        table.spinning = true;
        await upsertPanel(i, table);

        const rolled = Math.floor(Math.random() * 37); // 0–36
        table.lastRoll = rolled;

        // Resolve bets
        const betsThisRound = table.bets;
        table.bets = []; // clear immediately to prevent double-paying
        const roundNumber = table.round;
        table.round += 1;

        let totalWon = 0;
        let totalPaid = 0;
        let winners = 0;
        let refunds = 0;
        let apologies = 0;

        const lines = [];
        lines.push(`**Result:** 🎯 **${rolled}** (${getColor(rolled)})`);
        lines.push("");

        for (const b of betsThisRound) {
          const win = betWins(b, rolled);
          if (!win) continue;

          winners++;
          const mult = betMultiplier(b);
          const payout = b.amount * mult;
          totalWon += payout;

          const pay = await bankToUserIfEnough(
            table.guildId,
            b.userId,
            payout,
            "roulette_payout",
            { channelId: table.channelId, round: roundNumber, bet: b }
          );

          if (pay.ok) {
            totalPaid += payout;
            lines.push(`✅ <@${b.userId}> won **$${payout.toLocaleString()}** on **${describeBet(b)}**`);
          } else {
            // Bank can't cover payout: attempt refund of base bet
            const refund = await bankToUserIfEnough(
              table.guildId,
              b.userId,
              b.amount,
              "roulette_payout_refund",
              { channelId: table.channelId, round: roundNumber, bet: b, note: "bank_insufficient_payout" }
            );

            if (refund.ok) {
              refunds++;
              lines.push(`⚠️ <@${b.userId}> should’ve won, but the bank was low. Refunded **$${b.amount.toLocaleString()}**.`);
            } else {
              apologies++;
              lines.push(`😬 <@${b.userId}> should’ve won, but the bank was empty. Paid **$0** (sorry!).`);
            }
          }
        }

        if (winners === 0) {
          lines.push("House wins this round. 🏦");
        }

        // Post ephemeral confirmation + public results (auto-delete)
        await i.editReply("🎡 Spin complete.");

        const resultEmbed = new EmbedBuilder()
          .setTitle("🎡 Roulette Spin Results")
          .setDescription(lines.join("\n"))
          .setFooter({ text: `Round #${roundNumber} resolved.` });

        const resultMsg = await message.channel.send({ embeds: [resultEmbed] });
        setTimeout(() => {
          resultMsg.delete().catch(() => {});
        }, 15000);

        table.spinning = false;
        await upsertPanel(i, table);
        return;
      }

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

  collector.on("end", async () => {
    // If collector ends (timeout/restart), we leave the panel message as-is.
    // Next /roulette call will re-attach a fresh collector.
    table.collector = null;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("Play shared-table roulette (one table per channel).")
    .addSubcommand((sub) =>
      sub
        .setName("table")
        .setDescription("Create or refresh the roulette panel for this channel.")
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const sub = interaction.options.getSubcommand();

    const table = await ensureTable(interaction);

    // Hard rule: only one table per channel (we're already channel-scoped).
    // Ensure panel exists and collector is attached.
    if (sub === "table") {
      // If someone else uses /roulette table later, we keep the original host by default.
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
      } else {
        // value should not be required; we just ignore it if provided
      }

      // Ensure panel exists (also attaches collector)
      await upsertPanel(interaction, table);

      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      await ensureUser(guildId, userId);

      // Balance check + charge immediately
      const debit = await tryDebitUser(
        guildId,
        userId,
        amount,
        "roulette_bet",
        { channelId: table.channelId, round: table.round, type, value }
      );

      if (!debit.ok) {
        const bal = await getBalance(guildId, userId);
        return interaction.editReply(
          `❌ You need **$${amount.toLocaleString()}**, but you only have **$${bal.toLocaleString()}**.`
        );
      }

      // Route buy-in to server bank
      await addServerBank(
        guildId,
        amount,
        "roulette_bet_bank",
        { channelId: table.channelId, round: table.round, by: userId, type, value }
      );

      // Store bet
      table.bets.push({
        userId,
        amount,
        type,
        value: (type === "number" || type === "dozen" || type === "column") ? value : null,
        placedAt: Date.now(),
      });

      await upsertPanel(interaction, table);

      return interaction.editReply(
        `✅ Bet placed: **$${amount.toLocaleString()}** on **${describeBet({ type, value })}**.\n` +
        `Charged immediately and sent to the server bank.`
      );
    }

    return interaction.editReply("❌ Unknown subcommand.");
  },
};
