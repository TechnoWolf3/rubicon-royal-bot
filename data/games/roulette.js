// data/games/roulette.js
// Roulette game module used by /games hub (NOT a slash command).
// UI-based betting via Join + Set Bet (select + modal) + Last Bet + Clear Bet.
// Debits on bet placement. Spin is allowed by anyone once everyone joined has paid a bet.

const crypto = require("crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const { setActiveGame, updateActiveGame, clearActiveGame, updateHubMessage } = require("../../utils/gamesHubState");
const { activeGames } = require("../../utils/gameManager");

const {
  tryDebitUser,
  addServerBank,
  bankToUserIfEnough,
  getBalance,
} = require("../../utils/economy");

const { guardNotJailedComponent } = require("../../utils/jail");

const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  maybeAnnounceCasinoSecurity,
} = require("../../utils/casinoSecurity");

const MIN_BET = 500;
const MAX_BET = 250000;

// European wheel (0 only). If you want 00 later, we can extend payout table.
const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function spinPocket() {
  // 0-36 uniform
  return Math.floor(Math.random() * 37);
}

function pocketColor(n) {
  if (n === 0) return "green";
  return REDS.has(n) ? "red" : "black";
}

function parseAmount(raw) {
  const v = Number(String(raw || "").replace(/[^\d]/g, ""));
  return Number.isFinite(v) ? v : 0;
}

// ---------- bet types ----------
const BET_TYPES = [
  { id: "red", label: "Red (x2)", needs: null },
  { id: "black", label: "Black (x2)", needs: null },
  { id: "odd", label: "Odd (x2)", needs: null },
  { id: "even", label: "Even (x2)", needs: null },
  { id: "low", label: "1–18 (x2)", needs: null },
  { id: "high", label: "19–36 (x2)", needs: null },
  { id: "number", label: "Single Number (0–36) (x36)", needs: "number" },
];

function validateBet(type, valueRaw) {
  if (type === "number") {
    const n = parseInt(String(valueRaw || "").trim(), 10);
    if (!Number.isFinite(n) || n < 0 || n > 36) return { ok: false, msg: "Number bet must be 0–36." };
    return { ok: true, value: n };
  }
  return { ok: true, value: null };
}

function payoutMultiplier(type) {
  if (type === "number") return 36; // returns stake*36 (includes stake)
  return 2; // even-money bets return stake*2 (includes stake)
}

function isWinning(type, value, pocket) {
  const col = pocketColor(pocket);
  if (type === "red") return col === "red";
  if (type === "black") return col === "black";
  if (type === "odd") return pocket !== 0 && pocket % 2 === 1;
  if (type === "even") return pocket !== 0 && pocket % 2 === 0;
  if (type === "low") return pocket >= 1 && pocket <= 18;
  if (type === "high") return pocket >= 19 && pocket <= 36;
  if (type === "number") return pocket === Number(value);
  return false;
}

// ---------- Casino Security fee helper ----------
async function ensureHostSecurity(table, guildId, hostId) {
  if (table.hostSecurity) return table.hostSecurity;
  try {
    table.hostSecurity = await getHostBaseSecurity(guildId, hostId);
  } catch (e) {
    console.error("[roulette] failed to get host base security:", e);
    table.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
  }
  return table.hostSecurity;
}

async function getPlayerSecuritySafe(guildId, userId) {
  try {
    return await getUserCasinoSecurity(guildId, userId);
  } catch (e) {
    console.error("[roulette] failed to get player security:", e);
    return { level: 0, label: "Normal", feePct: 0 };
  }
}

async function chargeWithCasinoFee({ guildId, userId, amountStake, type, meta, table, channel, hostId }) {
  const hostSec = await ensureHostSecurity(table, guildId, hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);

  try {
    const db = channel?.client?.db;
    const displayName = meta?.displayName || meta?.username || "Unknown";
    await maybeAnnounceCasinoSecurity({ db, channel, guildId, userId, displayName, current: playerSec });
  } catch {}

  const effectiveFeePct = getEffectiveFeePct({
    playerFeePct: playerSec.feePct,
    hostBaseFeePct: hostSec.feePct,
  });

  const feeCalc = computeFeeForBet(amountStake, effectiveFeePct);

  const debit = await tryDebitUser(guildId, userId, feeCalc.totalCharge, type, {
    ...meta,
    casinoSecurity: {
      hostBaseLevel: hostSec.level,
      hostBaseFeePct: hostSec.feePct,
      playerLevel: playerSec.level,
      playerFeePct: playerSec.feePct,
      effectiveFeePct,
      feeAmount: feeCalc.feeAmount,
      betAmount: feeCalc.betAmount,
      totalCharge: feeCalc.totalCharge,
    },
  });

  return {
    ok: debit.ok,
    betAmount: feeCalc.betAmount,
    feeAmount: feeCalc.feeAmount,
    totalCharge: feeCalc.totalCharge,
    effectiveFeePct,
    playerSec,
  };
}

// ---------- UI helpers ----------
async function sendEphemeralToast(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  } catch {}
}

function buildTableEmbed(table) {
  const players = [...table.players.values()];
  const lines =
    players.length === 0
      ? ["_No players yet._"]
      : players.map((p) => {
          const amt = p.betAmount ? `$${Number(p.betAmount).toLocaleString()}` : "No bet";
          const t = p.betType ? p.betType : "—";
          const v = p.betType === "number" && p.betValue != null ? ` (${p.betValue})` : "";
          const paid = p.paid ? "✅" : "⏳";
          return `${paid} ${p.user} — **${amt}** on **${t}${v}**`;
        });

  const ready = table.players.size > 0 && allPlayersPaid(table);
  const status = ready ? "✅ All bets placed — ready to spin!" : "🟡 Waiting for everyone to place a bet";

  return new EmbedBuilder()
    .setTitle("🎡 Roulette")
    .setDescription(
      `${status}\n\n**Players (${table.players.size}/${table.maxPlayers}):**\n${lines.join("\n")}\n\n` +
      `Default join bet: **$${Number(table.defaultBetAmount || MIN_BET).toLocaleString()}**`
    )
    .setFooter({ text: `Table ID: ${table.tableId}` });
}

function buildComponents(table) {
  const ready = table.players.size > 0 && allPlayersPaid(table);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:join`).setLabel("Join").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:leave`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:setbet`).setLabel("Set Bet").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:lastbet`).setLabel("Last Bet").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:clearbet`).setLabel("Clear Bet").setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:spin`).setLabel("Spin").setStyle(ButtonStyle.Primary).setDisabled(!ready),
    new ButtonBuilder().setCustomId(`rou:${table.tableId}:end`).setLabel("End").setStyle(ButtonStyle.Danger),
  );

  return [row1, row2];
}

function allPlayersPaid(table) {
  if (table.players.size === 0) return false;
  for (const p of table.players.values()) {
    if (!p.paid || !p.betAmount || !p.betType) return false;
    if (p.betType === "number" && (p.betValue == null || p.betValue === "")) return false;
  }
  return true;
}

async function render(table) {
  if (!table.message) return;
  await table.message
    .edit({
      embeds: [buildTableEmbed(table)],
      components: buildComponents(table),
    })
    .catch(() => {});
}

// ---------- bet flow ----------
function buildBetTypeSelect(tableId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`roupick:${tableId}`)
      .setPlaceholder("Choose a bet type…")
      .addOptions(
        BET_TYPES.map((t) => ({
          label: t.label,
          value: t.id,
        }))
      )
  );
}

async function promptAmountModal(i, tableId, betType) {
  const needs = BET_TYPES.find((t) => t.id === betType)?.needs || null;

  const modal = new ModalBuilder()
    .setCustomId(`roubet:${tableId}:${betType}`)
    .setTitle("Set Roulette Bet")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Bet amount (min 500)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 2500")
          .setRequired(true)
      )
    );

  if (needs === "number") {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("Number (0–36)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 17")
          .setRequired(true)
      )
    );
  }

  await i.showModal(modal);

  const submitted = await i
    .awaitModalSubmit({
      time: 60_000,
      filter: (m) => m.customId === `roubet:${tableId}:${betType}` && m.user.id === i.user.id,
    })
    .catch(() => null);

  return submitted;
}

async function placeBet({ interaction, table, amount, betType, betValue }) {
  const guildId = table.guildId;
  const channelId = table.channelId;
  const userId = interaction.user.id;

  if (amount < MIN_BET) {
    await sendEphemeralToast(interaction, `❌ Minimum bet is **$${MIN_BET.toLocaleString()}**.`);
    return false;
  }
  if (amount > MAX_BET) {
    await sendEphemeralToast(interaction, `❌ Max bet is **$${MAX_BET.toLocaleString()}**.`);
    return false;
  }

  const p = table.players.get(userId);
  if (!p) {
    await sendEphemeralToast(interaction, "❌ You’re not in the table. Hit **Join** first.");
    return false;
  }

  const v = validateBet(betType, betValue);
  if (!v.ok) {
    await sendEphemeralToast(interaction, `❌ ${v.msg}`);
    return false;
  }

  await ensureHostSecurity(table, guildId, table.hostId);

  // If already paid, treat as change: refund stake only then re-buy (fees never refunded)
  if (p.paid && p.betAmount) {
    const oldStake = Number(p.betAmount);
    if (oldStake > 0) {
      await bankToUserIfEnough(guildId, userId, oldStake, "roulette_rebet_refund", {
        channelId,
        tableId: table.tableId,
        userId,
        oldStake,
      }).catch(() => {});
    }
    p.paid = false;
  }

  const charge = await chargeWithCasinoFee({
    guildId,
    userId,
    amountStake: amount,
    type: "roulette_bet",
    meta: {
      channelId,
      tableId: table.tableId,
      username: interaction.user.username,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      betType,
      betValue: v.value,
    },
    table,
    channel: interaction.channel,
    hostId: table.hostId,
  });

  if (!charge.ok) {
    await sendEphemeralToast(interaction, "❌ Not enough balance for that bet + table fee.");
    return false;
  }

  await addServerBank(guildId, amount, "roulette_bank_buyin", { channelId, tableId: table.tableId, userId });
  if (charge.feeAmount > 0) {
    await addServerBank(guildId, charge.feeAmount, "roulette_fee_bank_buyin", {
      channelId,
      tableId: table.tableId,
      userId,
      feeAmount: charge.feeAmount,
      effectiveFeePct: charge.effectiveFeePct,
    });
  }

  p.betAmount = amount;
  p.betType = betType;
  p.betValue = v.value;
  p.paid = true;

  // Host bet becomes default for joiners (amount + type/value)
  if (userId === table.hostId) {
    table.defaultBetAmount = amount;
    table.defaultBetType = betType;
    table.defaultBetValue = v.value;
  }

  // store last bet for session
  table.lastBets.set(userId, { betAmount: amount, betType, betValue: v.value });

  await render(table);
  await sendEphemeralToast(interaction, `✅ Bet placed: **$${amount.toLocaleString()}** on **${betType}${betType === "number" ? ` (${v.value})` : ""}**`);
  return true;
}

async function clearBet({ interaction, table }) {
  const guildId = table.guildId;
  const userId = interaction.user.id;

  const p = table.players.get(userId);
  if (!p || !p.paid || !p.betAmount) {
    await sendEphemeralToast(interaction, "ℹ️ You don’t have a paid bet to clear.");
    return;
  }

  const stake = Number(p.betAmount);
  const refund = await bankToUserIfEnough(guildId, userId, stake, "roulette_clearbet_refund", {
    channelId: table.channelId,
    tableId: table.tableId,
    userId,
    stake,
  });

  if (!refund.ok) {
    await sendEphemeralToast(interaction, "⚠️ Couldn’t refund stake (low server bank). Fees are not refunded.");
    return;
  }

  p.betAmount = null;
  p.betType = null;
  p.betValue = null;
  p.paid = false;
  await render(table);
  await sendEphemeralToast(interaction, "✅ Bet cleared (stake refunded).");
}

// ---------- spin ----------
async function spinRound({ interaction, table }) {
  if (!allPlayersPaid(table)) {
    await sendEphemeralToast(interaction, "❌ Everyone must place a bet before spinning.");
    return;
  }

  const pocket = spinPocket();
  const color = pocketColor(pocket);

  const lines = [];
  const notes = [];
  const guildId = table.guildId;

  for (const p of table.players.values()) {
    const stake = Number(p.betAmount || 0);
    const win = isWinning(p.betType, p.betValue, pocket);
    const mult = payoutMultiplier(p.betType);
    const payoutWanted = win ? stake * mult : 0;

    let paid = 0;
    if (payoutWanted > 0) {
      const full = await bankToUserIfEnough(guildId, p.userId, payoutWanted, "roulette_payout", {
        channelId: table.channelId,
        tableId: table.tableId,
        userId: p.userId,
        betType: p.betType,
        betValue: p.betValue,
        pocket,
        payoutWanted,
      });

      if (full.ok) {
        paid = payoutWanted;
      } else {
        // fallback: refund stake
        const refund = await bankToUserIfEnough(guildId, p.userId, stake, "roulette_refund", {
          channelId: table.channelId,
          tableId: table.tableId,
          userId: p.userId,
          wanted: payoutWanted,
          fallback: "refund_stake",
        });
        if (refund.ok) {
          paid = stake;
          notes.push(`⚠️ <@${p.userId}>: Bank couldn’t cover winnings — refunded stake instead.`);
        } else {
          notes.push(`⚠️ <@${p.userId}>: Bank couldn’t cover payout/refund. Ping an admin.`);
        }
      }
    }

    const betDesc = p.betType === "number" ? `number (${p.betValue})` : p.betType;
    const result = win ? `✅ Win → Paid **$${paid.toLocaleString()}**` : "❌ Lose";
    lines.push(`${p.user} — **$${stake.toLocaleString()}** on **${betDesc}** — ${result}`);

    // reset for next round (keep last bet)
    p.paid = false;
    p.betAmount = table.defaultBetAmount || MIN_BET; // "suggested" amount for next bet
    p.betType = null;
    p.betValue = null;
  }

  await render(table);

  const embed = new EmbedBuilder()
    .setTitle("🎡 Roulette Spin")
    .setDescription(`Result: **${pocket}** (${color})\n\n${lines.join("\n")}${notes.length ? `\n\n${notes.join("\n")}` : ""}`)
    .setFooter({ text: `Table ID: ${table.tableId}` });

  await interaction.channel.send({ embeds: [embed] }).catch(() => {});
}

// ---------- lifecycle ----------
async function startFromHub(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (await guardNotJailedComponent(interaction)) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  const existing = activeGames.get(channelId);
  if (existing && existing.type === "roulette" && existing.state !== "ended") {
    await interaction.editReply("❌ A roulette table is already active in this channel.");
    return;
  }

  const table = {
    type: "roulette",
    state: "lobby",
    tableId: crypto.randomBytes(6).toString("hex"),
    channelId,
    guildId,
    hostId: interaction.user.id,
    maxPlayers: 10,
    players: new Map(), // userId -> player
    lastBets: new Map(), // userId -> { betAmount, betType, betValue }
    defaultBetAmount: MIN_BET,
    defaultBetType: "red",
    defaultBetValue: null,
    hostSecurity: null,
    message: null,
  };

  await ensureHostSecurity(table, guildId, table.hostId);

  // register under gameManager map so hub knows channel is busy
  activeGames.set(channelId, table);
  setActiveGame(channelId, { type: "roulette", state: "lobby", gameId: table.tableId, hostId: table.hostId });
  await updateHubMessage(channel).catch(() => {});

  // host auto-joins (no bet paid yet)
  const hostUser = interaction.user;
  table.players.set(hostUser.id, {
    userId: hostUser.id,
    user: `<@${hostUser.id}>`,
    betAmount: table.defaultBetAmount,
    betType: null,
    betValue: null,
    paid: false,
  });

  table.message = await interaction.channel.send({
    embeds: [buildTableEmbed(table)],
    components: buildComponents(table),
  });

  const collector = table.message.createMessageComponentCollector({ time: 30 * 60_000 });

  collector.on("collect", async (i) => {
    if (await guardNotJailedComponent(i)) return;

    // buttons / select menu
    const cid = String(i.customId || "");

    // select bet type
    if (cid === `roupick:${table.tableId}`) {
      await i.deferUpdate().catch(() => {});
      const betType = i.values?.[0];
      if (!betType) return;

      const submitted = await promptAmountModal(i, table.tableId, betType);
      if (!submitted) return;

      await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const amount = parseAmount(submitted.fields.getTextInputValue("amount"));
      const value = submitted.fields.fields.get("value") ? submitted.fields.getTextInputValue("value") : null;

      await placeBet({ interaction: submitted, table, amount, betType, betValue: value });
      return submitted.editReply("✅ Done.");
    }

    // roulette buttons
    const [prefix, tableId, action] = cid.split(":");
    if (prefix !== "rou" || tableId !== table.tableId) return;

    await i.deferUpdate().catch(() => {});

    const isHost = i.user.id === table.hostId;

    if (action === "join") {
      if (table.players.has(i.user.id)) return sendEphemeralToast(i, "ℹ️ You’re already in.");

      if (table.players.size >= table.maxPlayers) return sendEphemeralToast(i, "❌ Table is full.");

      table.players.set(i.user.id, {
        userId: i.user.id,
        user: `<@${i.user.id}>`,
        betAmount: table.defaultBetAmount,
        betType: table.defaultBetType ? null : null,
        betValue: null,
        paid: false,
      });

      await render(table);
      return sendEphemeralToast(i, `✅ Joined. Default bet amount is **$${Number(table.defaultBetAmount).toLocaleString()}** — use **Set Bet** to place it.`);
    }

    if (action === "leave") {
      const p = table.players.get(i.user.id);
      if (!p) return sendEphemeralToast(i, "ℹ️ You’re not in the table.");

      // refund stake only if paid
      if (p.paid && p.betAmount) {
        await bankToUserIfEnough(guildId, i.user.id, Number(p.betAmount), "roulette_leave_refund", {
          channelId,
          tableId: table.tableId,
          userId: i.user.id,
        }).catch(() => {});
      }

      table.players.delete(i.user.id);

      // host leaving ends table
      if (i.user.id === table.hostId) {
        collector.stop("host_left");
        return;
      }

      await render(table);
      return sendEphemeralToast(i, "✅ Left the table.");
    }

    if (action === "setbet") {
      // ephemeral select menu to choose type; modal comes next
      try {
        await i.followUp({
          content: "Choose your bet type:",
          components: [buildBetTypeSelect(table.tableId)],
          flags: MessageFlags.Ephemeral,
        });
      } catch {}
      return;
    }

    if (action === "lastbet") {
      const last = table.lastBets.get(i.user.id);
      if (!last) return sendEphemeralToast(i, "ℹ️ No last bet saved for you (this table).");

      await placeBet({
        interaction: i,
        table,
        amount: Number(last.betAmount),
        betType: last.betType,
        betValue: last.betValue,
      });
      return;
    }

    if (action === "clearbet") {
      await clearBet({ interaction: i, table });
      return;
    }

    if (action === "spin") {
      // anyone can spin, but must be ready
      await spinRound({ interaction: i, table });
      return;
    }

    if (action === "end") {
      if (!isHost) return sendEphemeralToast(i, "❌ Only the host can end the table.");
      collector.stop("ended_by_host");
      return;
    }
  });

  collector.on("end", async () => {
    activeGames.delete(channelId);
    clearActiveGame(channelId);
    await updateHubMessage(channel).catch(() => {});

    setTimeout(() => {
      table.message?.delete().catch(() => {});
    }, 15_000);
  });

  await interaction.editReply("🎡 Roulette table launched. Use **Set Bet** to place your bet.");
}

module.exports = {
  startFromHub,
};
