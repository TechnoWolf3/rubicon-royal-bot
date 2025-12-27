// data/games/blackjack.js
// Blackjack game module used by /games hub (NOT a slash command).
// UI-based betting via buttons + modal. Debits on bet placement.

const {
  MessageFlags,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { activeGames } = require("../../utils/gameManager");
const { setActiveGame, updateActiveGame, clearActiveGame } = require("../../utils/gamesHubState");
const { BlackjackSession, cardStr } = require("../../utils/blackjackSession");

const {
  tryDebitUser,
  addServerBank,
  bankToUserIfEnough,
  getServerBank,
  getBalance,
} = require("../../utils/economy");

const { unlockAchievement } = require("../../utils/achievementEngine");
const { guardNotJailedComponent } = require("../../utils/jail");

const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  maybeAnnounceCasinoSecurity,
} = require("../../utils/casinoSecurity");

const MIN_BET = 500;

/* =========================================================
   🏆 ACHIEVEMENTS (BLACKJACK) — same IDs as before
========================================================= */
const BJ_ACH = {
  FIRST_WIN: "bj_first_win",
  BLACKJACK: "bj_blackjack",
  BUST: "bj_bust",
  HIGH_ROLLER: "bj_high_roller",
  TEN_WINS: "bj_10_wins",
};
const BJ_RULES = { HIGH_ROLLER_BET: 50_000 };

async function bjFetchAchievementInfo(db, achievementId) {
  if (!db) return null;
  try {
    const res = await db.query(
      `SELECT id, name, description, category, hidden, reward_coins, reward_role_id
       FROM achievements
       WHERE id = $1`,
      [achievementId]
    );
    return res.rows?.[0] ?? null;
  } catch (e) {
    console.error("bjFetchAchievementInfo failed:", e);
    return null;
  }
}

async function bjAnnounceAchievement(channel, userId, info) {
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

async function bjUnlock(thing, guildId, userId, achievementId) {
  try {
    const db = thing?.client?.db;
    if (!db) return null;

    const cleanUserId = String(userId).replace(/[<@!>]/g, "");
    const res = await unlockAchievement({ db, guildId, userId: cleanUserId, achievementId });
    if (!res?.unlocked) return res;

    const info = await bjFetchAchievementInfo(db, achievementId);
    await bjAnnounceAchievement(thing.channel, cleanUserId, info);

    return res;
  } catch (e) {
    console.error("Achievement unlock failed:", e);
    return null;
  }
}

async function bjIncrementWinsAndMaybeUnlock(thing, guildId, userId) {
  try {
    const db = thing?.client?.db;
    if (!db) return;

    const cleanUserId = String(userId).replace(/[<@!>]/g, "");

    const res = await db.query(
      `INSERT INTO blackjack_stats (guild_id, user_id, wins)
       VALUES ($1, $2, 1)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET wins = blackjack_stats.wins + 1
       RETURNING wins`,
      [guildId, cleanUserId]
    );

    const wins = Number(res.rows?.[0]?.wins ?? 0);
    if (wins === 10) await bjUnlock(thing, guildId, cleanUserId, BJ_ACH.TEN_WINS);
  } catch (e) {
    console.error("bjIncrementWinsAndMaybeUnlock failed:", e);
  }
}

async function bjOnBetPaid(thing, guildId, userId, betAmount) {
  if (Number(betAmount) >= BJ_RULES.HIGH_ROLLER_BET) {
    await bjUnlock(thing, guildId, userId, BJ_ACH.HIGH_ROLLER);
  }
}

async function bjOnFinalOutcome(thing, guildId, outcome) {
  const pv = Number(outcome.playerValue ?? 0);

  if (pv > 21) await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.BUST);

  if (outcome.result === "win" || outcome.result === "blackjack_win") {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.FIRST_WIN);
    await bjIncrementWinsAndMaybeUnlock(thing, guildId, outcome.userId);
  }

  if (outcome.result === "blackjack_win") {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.BLACKJACK);
  }
}

/* ========================================================= */

// 🛡️ Casino Security helpers
async function ensureHostSecurity(session, guildId, hostId) {
  if (session.hostSecurity) return session.hostSecurity;
  try {
    session.hostSecurity = await getHostBaseSecurity(guildId, hostId);
  } catch (e) {
    console.error("[blackjack] failed to get host base security:", e);
    session.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
  }
  return session.hostSecurity;
}

async function getPlayerSecuritySafe(guildId, userId) {
  try {
    return await getUserCasinoSecurity(guildId, userId);
  } catch (e) {
    console.error("[blackjack] failed to get player security:", e);
    return { level: 0, label: "Normal", feePct: 0 };
  }
}

async function chargeWithCasinoFee({ guildId, userId, amountStake, type, meta, session, channel, hostId }) {
  const hostSec = await ensureHostSecurity(session, guildId, hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);

  // announcements: only first + changes
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

async function sendTempNotice(channel, content, ms = 6000) {
  if (!channel?.send) return;
  try {
    const m = await channel.send({ content });
    setTimeout(() => m.delete().catch(() => {}), ms);
  } catch {}
}

async function sendEphemeralToast(interaction, content) {
  try {
    // component interactions prefer followUp to avoid edit wars
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  } catch {}
}

async function applyBetChange({ i, session, guildId, channelId, amount }) {
  const userId = i.user.id;

  if (!Number.isFinite(amount) || amount < MIN_BET) {
    await sendEphemeralToast(i, `❌ Minimum bet is **$${MIN_BET.toLocaleString()}**.`);
    return false;
  }

  const p = session.players.get(userId);
  if (!p) {
    await sendEphemeralToast(i, "❌ You’re not in the game.");
    return false;
  }

  await ensureHostSecurity(session, guildId, session.hostId);

  // If already paid, treat as change
  if (p.paid && p.bet != null) {
    const oldBet = Number(p.bet);
    const newBet = Number(amount);
    if (newBet === oldBet) {
      await sendEphemeralToast(i, "✅ Your bet is already set to that amount.");
      return true;
    }

    const delta = newBet - oldBet;

    if (delta > 0) {
      const charge = await chargeWithCasinoFee({
        guildId,
        userId,
        amountStake: delta,
        type: "blackjack_bet_increase",
        meta: {
          channelId,
          gameId: session.gameId,
          from: oldBet,
          to: newBet,
          username: i.user.username,
          displayName: i.member?.displayName || i.user.globalName || i.user.username,
        },
        session,
        channel: i.channel,
        hostId: session.hostId,
      });

      if (!charge.ok) {
        await sendEphemeralToast(i, "❌ You don’t have enough balance to increase your bet (including table fee).");
        return false;
      }

      await addServerBank(guildId, delta, "blackjack_bank_buyin_delta", {
        channelId,
        gameId: session.gameId,
        userId,
        delta,
      });

      if (charge.feeAmount > 0) {
        await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_delta", {
          channelId,
          gameId: session.gameId,
          userId,
          feeAmount: charge.feeAmount,
          effectiveFeePct: charge.effectiveFeePct,
        });
      }

      p.bet = newBet;
      p.paid = true;
      await bjOnBetPaid(i, guildId, userId, newBet);
      await session.updatePanel();

      await sendEphemeralToast(
        i,
        `✅ Bet increased to **$${newBet.toLocaleString()}**.\nTotal charged: **$${charge.totalCharge.toLocaleString()}** (delta + fee).`
      );
      return true;
    }

    // delta < 0: refund stake only (no fee refunds)
    const refundAmt = Math.abs(delta);
    const refund = await bankToUserIfEnough(guildId, userId, refundAmt, "blackjack_bet_decrease_refund", {
      channelId,
      gameId: session.gameId,
      from: oldBet,
      to: newBet,
      refundAmt,
    });

    if (!refund.ok) {
      await sendEphemeralToast(
        i,
        "⚠️ The server bank can’t cover that bet decrease refund right now. Try again later or pick a higher bet."
      );
      return false;
    }

    p.bet = newBet;
    p.paid = true;
    await session.updatePanel();
    await sendEphemeralToast(i, `✅ Bet decreased to **$${newBet.toLocaleString()}** (refunded **$${refundAmt.toLocaleString()}**).`);
    return true;
  }

  // Not paid yet: set + debit stake+fee
  const setRes = session.setBet(userId, amount);
  if (!setRes.ok) {
    await sendEphemeralToast(i, `❌ ${setRes.msg}`);
    return false;
  }

  const charge = await chargeWithCasinoFee({
    guildId,
    userId,
    amountStake: amount,
    type: "blackjack_buyin",
    meta: {
      channelId,
      gameId: session.gameId,
      username: i.user.username,
      displayName: i.member?.displayName || i.user.globalName || i.user.username,
    },
    session,
    channel: i.channel,
    hostId: session.hostId,
  });

  if (!charge.ok) {
    p.bet = null;
    p.paid = false;
    await session.updatePanel();
    await sendEphemeralToast(i, "❌ You don’t have enough balance for that bet + fee.");
    return false;
  }

  await addServerBank(guildId, amount, "blackjack_bank_buyin", {
    channelId,
    gameId: session.gameId,
    userId,
  });

  if (charge.feeAmount > 0) {
    await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_buyin", {
      channelId,
      gameId: session.gameId,
      userId,
      feeAmount: charge.feeAmount,
      effectiveFeePct: charge.effectiveFeePct,
    });
  }

  p.paid = true;
  await bjOnBetPaid(i, guildId, userId, amount);

  await session.updatePanel();
  const bankNow = await getServerBank(guildId);
  await sendEphemeralToast(
    i,
    `✅ Bet set: **$${amount.toLocaleString()}** (buy-in paid).\n🛡️ Fee: **$${charge.feeAmount.toLocaleString()}**\n🏦 Server bank: **$${bankNow.toLocaleString()}**`
  );
  return true;
}

function buildQuickBetRow(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bjq:${gameId}:500`).setLabel("$500").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bjq:${gameId}:2000`).setLabel("$2,000").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bjq:${gameId}:10000`).setLabel("$10,000").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bjq:${gameId}:50000`).setLabel("$50,000").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bjq:${gameId}:max`).setLabel("Max").setStyle(ButtonStyle.Primary),
  );
}

async function promptBetModal(i, gameId) {
  const modal = new ModalBuilder()
    .setCustomId(`bjbet:${gameId}`)
    .setTitle("Set Blackjack Bet")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Bet amount (min 500)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 5000")
          .setRequired(true)
      )
    );

  await i.showModal(modal);

  const submitted = await i
    .awaitModalSubmit({
      time: 60_000,
      filter: (m) => m.customId === `bjbet:${gameId}` && m.user.id === i.user.id,
    })
    .catch(() => null);

  return submitted;
}

async function startLobbyFromHub(interaction) {
  if (!interaction.inGuild()) {
    // this is a component interaction; ephemeral
    return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // Jail gate for component actions
  if (await guardNotJailedComponent(interaction)) return;

  // IMPORTANT: don't double-defer if hub already deferred
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  // Block if already running
  if (activeGames.has(channelId)) {
    const s = activeGames.get(channelId);
    if (s?.state !== "ended") {
      await interaction.editReply("❌ A blackjack game is already active in this channel.");
      return;
    }
    activeGames.delete(channelId);
  }

  const session = new BlackjackSession({
    channel: interaction.channel,
    hostId: interaction.user.id,
    guildId,
    maxPlayers: 10,
    defaultBet: null, // host can set; joiners won't be charged until bet placed
  });

  await ensureHostSecurity(session, guildId, interaction.user.id);

  activeGames.set(channelId, session);
  setActiveGame(channelId, { type: "blackjack", state: "lobby", gameId: session.gameId, hostId: session.hostId });

  session.addPlayer(interaction.user);
  await session.postOrEditPanel();

  const collector = session.message.createMessageComponentCollector({ time: 30 * 60_000 });
  wireCollectorHandlers({ collector, session, guildId, channelId });

  await interaction.editReply("🃏 Blackjack lobby launched. Use **Set Bet** to place your buy-in.");
}

function wireCollectorHandlers({ collector, session, guildId, channelId }) {
  async function handleGameEnd(triggerInteraction) {
    if (session.endHandled) return;
    session.endHandled = true;

    const meta = { channelId, gameId: session.gameId };
    const { dealerHand, dealerValue, outcomes } = session.buildOutcomeData();

    const payoutNotes = [];
    const resultsLines = [];

    const payoutPlan = outcomes.map((o) => {
      const B = Number(o.bet || 0);
      let payoutWanted = 0;

      if (o.result === "push") payoutWanted = B;
      else if (o.result === "win") payoutWanted = B * 2;
      else if (o.result === "blackjack_win") payoutWanted = Math.floor(B * 2.5);
      else payoutWanted = 0;

      return { ...o, payoutWanted };
    });

    const pushes = payoutPlan.filter((p) => p.result === "push" && p.payoutWanted > 0);
    const wins = payoutPlan.filter((p) => (p.result === "win" || p.result === "blackjack_win") && p.payoutWanted > 0);
    const loses = payoutPlan.filter((p) => p.payoutWanted === 0);

    const ordered = [...pushes, ...wins, ...loses];

    for (const p of ordered) {
      const B = Number(p.bet || 0);
      const pv = p.playerValue;

      await bjOnFinalOutcome(triggerInteraction, guildId, p);

      let label = "❌ Lose";
      if (p.result === "push") label = "🤝 Push";
      if (p.result === "win") label = "✅ Win";
      if (p.result === "blackjack_win") label = "🟣 Blackjack";

      let paid = 0;

      if (p.payoutWanted > 0) {
        const full = await bankToUserIfEnough(guildId, p.userId, p.payoutWanted, "blackjack_payout", {
          ...meta,
          userId: p.userId,
          wanted: p.payoutWanted,
          handIndex: p.handIndex,
        });

        if (full.ok) {
          paid = p.payoutWanted;
        } else {
          if (p.payoutWanted > B && B > 0) {
            const refund = await bankToUserIfEnough(guildId, p.userId, B, "blackjack_refund", {
              ...meta,
              userId: p.userId,
              wanted: p.payoutWanted,
              fallback: "refund_bet",
              handIndex: p.handIndex,
            });

            if (refund.ok) {
              paid = B;
              payoutNotes.push(
                `⚠️ <@${p.userId}> (${p.handLabel || "Hand"}): Bank couldn’t cover full winnings, refunded bet (**$${B.toLocaleString()}**) instead.`
              );
            } else {
              payoutNotes.push(`⚠️ <@${p.userId}> (${p.handLabel || "Hand"}): Bank couldn’t cover payout/refund. Ping an admin.`);
            }
          } else {
            payoutNotes.push(`⚠️ <@${p.userId}> (${p.handLabel || "Hand"}): Bank couldn’t cover payout/refund. Ping an admin.`);
          }
        }
      }

      const handTag = p.handLabel ? ` (${p.handLabel})` : "";
      const paidText = paid > 0 ? ` → Paid **$${paid.toLocaleString()}**` : "";
      resultsLines.push(`${p.user}${handTag} — **${pv}** — ${label}${paidText}`);
    }

    const dealerLine = `${dealerHand.map(cardStr).join(" ")} (**${dealerValue}**)`;
    const desc =
      `**Dealer:** ${dealerLine}\n\n` +
      resultsLines.join("\n") +
      (payoutNotes.length ? `\n\n${payoutNotes.join("\n")}` : "");

    session.resultsMessage = await session.channel.send({
      embeds: [{ title: "🃏 Blackjack Results", description: desc }],
    });

    collector.stop("game_finished");
  }

  collector.on("collect", async (i) => {
    if (await guardNotJailedComponent(i)) return;

    // Quick-bet buttons are ephemeral replies, but still route here if clicked on panel? We'll handle both prefixes.
    if (String(i.customId || "").startsWith("bjq:")) {
      await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const parts = i.customId.split(":"); // bjq:gameId:amount
      const gameId = parts[1];
      if (gameId !== session.gameId) return i.editReply("❌ This quick bet is for a different table.");

      const amtRaw = parts[2];
      let amount = 0;
      if (amtRaw === "max") {
        const bal = await getBalance(guildId, i.user.id);
        amount = Math.max(MIN_BET, Math.min(250000, Number(bal || 0)));
      } else {
        amount = Number(amtRaw);
      }

      await applyBetChange({ i, session, guildId, channelId, amount });
      return i.editReply("✅ Bet updated.");
    }

    await i.deferUpdate().catch(() => {});
    const [prefix, gameId, action] = String(i.customId || "").split(":");
    if (prefix !== "bj" || gameId !== session.gameId) return;

    const isHost = session.isHost(i.user.id);

    // LOBBY
    if (action === "join") {
      const res = session.addPlayer(i.user);
      if (!res.ok) return sendEphemeralToast(i, `❌ ${res.msg}`);

      // If host has a default bet set, joiners get it as "suggested" but not charged until they Set Bet.
      if (session.defaultBet != null) {
        session.setBet(i.user.id, Number(session.defaultBet));
      }

      await session.updatePanel();
      return sendEphemeralToast(i, "✅ Joined. Use **Set Bet** to pay your buy-in.");
    }

    if (action === "leave") {
      if (session.state !== "lobby") return;

      const p = session.players.get(i.user.id);
      const wasPaid = Boolean(p?.paid && p?.bet);

      const rem = session.removePlayer(i.user.id);
      if (!rem.ok) return sendEphemeralToast(i, `❌ ${rem.msg}`);

      // Refund stake only (no fee refunds)
      if (wasPaid) {
        const refund = await bankToUserIfEnough(guildId, i.user.id, Number(p.bet), "blackjack_leave_refund", {
          channelId, gameId: session.gameId, userId: i.user.id,
        });

        if (!refund.ok) {
          await sendEphemeralToast(i, "⚠️ Couldn’t refund buy-in (low server bank). Ping an admin.");
        } else {
          await sendEphemeralToast(i, `✅ Left game. Refunded **$${Number(p.bet).toLocaleString()}** (fees are not refunded).`);
        }
      } else {
        await sendEphemeralToast(i, "✅ Left game.");
      }

      await session.updatePanel();
      return;
    }

    if (action === "setbet") {
      // Show modal and handle submission inline
      const submitted = await promptBetModal(i, session.gameId);
      if (!submitted) return;

      await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const amountStr = submitted.fields.getTextInputValue("amount") || "";
      const amount = Number(String(amountStr).replace(/[^\d]/g, ""));

      await applyBetChange({ i: submitted, session, guildId, channelId, amount });

      // If host set their bet, treat as default bet for joiners
      if (submitted.user.id === session.hostId) {
        const p = session.players.get(session.hostId);
        if (p?.bet) session.defaultBet = Number(p.bet);
      }

      return submitted.editReply("✅ Done.");
    }

    if (action === "quickbet") {
      // Ephemeral buttons with presets
      try {
        await i.followUp({
          content: "Pick a quick bet amount:",
          components: [buildQuickBetRow(session.gameId)],
          flags: MessageFlags.Ephemeral,
        });
      } catch {}
      return;
    }

    if (action === "clearbet") {
      if (session.state !== "lobby") return;

      const p = session.players.get(i.user.id);
      if (!p?.paid || !p?.bet) {
        await sendEphemeralToast(i, "ℹ️ You don’t have a paid bet to clear.");
        return;
      }

      const refund = await bankToUserIfEnough(guildId, i.user.id, Number(p.bet), "blackjack_clearbet_refund", {
        channelId, gameId: session.gameId, userId: i.user.id,
      });

      if (!refund.ok) {
        await sendEphemeralToast(i, "⚠️ Couldn’t refund (low server bank). Fees are never refunded.");
        return;
      }

      p.bet = null;
      p.paid = false;
      await session.updatePanel();
      await sendEphemeralToast(i, "✅ Bet cleared (stake refunded).");
      return;
    }

    if (action === "start") {
      if (!isHost) return sendTempNotice(i.channel, "❌ Only the host can start.", 4000);

      if (!session.allPlayersPaid()) {
        return sendTempNotice(i.channel, "❌ Everyone must set + pay a bet before starting.", 5000);
      }

      await session.start();
      updateActiveGame(channelId, { state: session.state === "ended" ? "ended" : "playing" });
      if (session.state === "ended") await handleGameEnd(i);
      return;
    }

    if (action === "end") {
      if (!isHost) return sendTempNotice(i.channel, "❌ Only the host can end.", 4000);
      collector.stop("ended_by_host");
      return;
    }

    // PLAY
    if (session.state !== "playing") return;

    if (action === "hit") {
      const res = await session.hit(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      if (session.state === "ended") await handleGameEnd(i);
      return;
    }

    if (action === "stand") {
      const res = await session.stand(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      if (session.state === "ended") await handleGameEnd(i);
      return;
    }

    // DOUBLE DOWN + SPLIT continue to debit stake+fee (unchanged)
    if (action === "double") {
      if (!session.canDoubleDown?.(i.user.id)) return sendTempNotice(i.channel, "❌ Double Down not allowed right now.", 4500);

      const extraStake = Number(session.getCurrentHandBet(i.user.id) || 0);
      if (!extraStake) return sendEphemeralToast(i, "❌ Couldn’t find your current bet to double.");

      const charge = await chargeWithCasinoFee({
        guildId,
        userId: i.user.id,
        amountStake: extraStake,
        type: "blackjack_double_down",
        meta: {
          channelId,
          gameId: session.gameId,
          username: i.user.username,
          displayName: i.member?.displayName || i.user.globalName || i.user.username,
          extraStake,
        },
        session,
        channel: i.channel,
        hostId: session.hostId,
      });

      if (!charge.ok) return sendEphemeralToast(i, "❌ Not enough balance to double down (including table fee).");

      await addServerBank(guildId, extraStake, "blackjack_bank_double_down", { channelId, gameId: session.gameId, userId: i.user.id, extraStake });

      if (charge.feeAmount > 0) {
        await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_double_down", {
          channelId, gameId: session.gameId, userId: i.user.id, feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
        });
      }

      await sendEphemeralToast(i, `✅ Double Down paid.\nExtra stake: **$${extraStake.toLocaleString()}**\nFee: **$${charge.feeAmount.toLocaleString()}**`);

      const res = await session.doubleDown(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      if (session.state === "ended") await handleGameEnd(i);
      return;
    }

    if (action === "split") {
      if (!session.canSplit?.(i.user.id)) return sendTempNotice(i.channel, "❌ Split not allowed right now.", 4500);

      const extraStake = Number(session.getCurrentHandBet(i.user.id) || 0);
      if (!extraStake) return sendEphemeralToast(i, "❌ Couldn’t find your current bet to split.");

      const charge = await chargeWithCasinoFee({
        guildId,
        userId: i.user.id,
        amountStake: extraStake,
        type: "blackjack_split",
        meta: {
          channelId,
          gameId: session.gameId,
          username: i.user.username,
          displayName: i.member?.displayName || i.user.globalName || i.user.username,
          extraStake,
        },
        session,
        channel: i.channel,
        hostId: session.hostId,
      });

      if (!charge.ok) return sendEphemeralToast(i, "❌ Not enough balance to split (including table fee).");

      await addServerBank(guildId, extraStake, "blackjack_bank_split", { channelId, gameId: session.gameId, userId: i.user.id, extraStake });

      if (charge.feeAmount > 0) {
        await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_split", {
          channelId, gameId: session.gameId, userId: i.user.id, feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
        });
      }

      await sendEphemeralToast(i, `✅ Split paid.\nExtra stake: **$${extraStake.toLocaleString()}**\nFee: **$${charge.feeAmount.toLocaleString()}**`);

      const res = await session.split(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      return;
    }
  });

  collector.on("end", async () => {
    activeGames.delete(channelId);
    clearActiveGame(channelId);
    if (session.timeout) clearTimeout(session.timeout);

    setTimeout(() => {
      session.message?.delete().catch(() => {});
      session.resultsMessage?.delete().catch(() => {});
    }, 15_000);
  });
}

module.exports = {
  startFromHub: startLobbyFromHub,
};
