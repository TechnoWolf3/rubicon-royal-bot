// commands/blackjack.js
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require("discord.js");
const { activeGames } = require("../utils/gameManager");
const { BlackjackSession, handValue, cardStr } = require("../utils/blackjackSession");
const {
  tryDebitUser,
  addServerBank,
  bankToUserIfEnough,
  getServerBank,
} = require("../utils/economy");

// 🏆 Achievement engine (records unlock + mints reward)
const { unlockAchievement } = require("../utils/achievementEngine");

// 🚔 Jail guards
const { guardNotJailed, guardNotJailedComponent } = require("../utils/jail");

// 🛡️ Casino Security
const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  maybeAnnounceCasinoSecurity,
} = require("../utils/casinoSecurity");

const MIN_BET = 500;

/* =========================================================
   🏆 ACHIEVEMENTS (BLACKJACK)
========================================================= */

const BJ_ACH = {
  FIRST_WIN: "bj_first_win",
  BLACKJACK: "bj_blackjack",
  BUST: "bj_bust",
  HIGH_ROLLER: "bj_high_roller",
  TEN_WINS: "bj_10_wins",
};

const BJ_RULES = {
  HIGH_ROLLER_BET: 50_000,
};

// Public announcements toggle (server embed to channel)
const BJ_ANNOUNCE = {
  ENABLED: true,
  USE_GAME_CHANNEL: true,
};

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
  if (!BJ_ANNOUNCE.ENABLED) return;
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
    const channel = BJ_ANNOUNCE.USE_GAME_CHANNEL ? thing.channel : null;
    await bjAnnounceAchievement(channel, cleanUserId, info);

    console.log("[BJ ACH] unlocked", { guildId, userId: cleanUserId, achievementId });
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

  if (pv > 21) {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.BUST);
  }

  if (outcome.result === "win" || outcome.result === "blackjack_win") {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.FIRST_WIN);
    await bjIncrementWinsAndMaybeUnlock(thing, guildId, outcome.userId);
  }

  if (outcome.result === "blackjack_win") {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.BLACKJACK);
  }
}

/* ========================================================= */

// ------------------------------
// 🛡️ Casino Security helpers (per-session)
// ------------------------------
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

/**
 * Charge stake + security fee as a single debit.
 * Returns { ok, betAmount, feeAmount, totalCharge, effectiveFeePct, playerSec }.
 */
async function chargeWithCasinoFee({
  guildId,
  userId,
  amountStake,
  type,
  meta,
  session,
  channel,
  hostId,
}) {
  const hostSec = await ensureHostSecurity(session, guildId, hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);

  // ✅ DB-backed announcements: only first activation + up/down changes
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

// Non-ephemeral “toast” message that auto-deletes (good for table-level notices)
async function sendTempNotice(channel, content, ms = 6000) {
  if (!channel?.send) return;
  try {
    const m = await channel.send({ content });
    setTimeout(() => m.delete().catch(() => {}), ms);
  } catch {}
}

// Ephemeral “toast” (good for money / personal info)
async function sendEphemeralToast(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  } catch {}
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Start/join blackjack. Optional bet (min $500).")
    .addIntegerOption((opt) =>
      opt
        .setName("bet")
        .setDescription("Your buy-in for this game (min $500).")
        .setRequired(false)
        .setMinValue(MIN_BET)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // 🚔 Jail gate: blocks /blackjack entirely while jailed
    if (await guardNotJailed(interaction)) return;

    // ✅ Make slash command feedback ephemeral to reduce channel clutter.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const channelId = interaction.channelId;
    const guildId = interaction.guildId;

    try {
      const stale = activeGames.get(channelId);
      if (stale && stale.state === "ended") activeGames.delete(channelId);

      const bet = interaction.options.getInteger("bet", false);

      // Existing lobby: join + optionally set/adjust bet
      if (activeGames.has(channelId)) {
        const session = activeGames.get(channelId);

        if (session.state !== "lobby") {
          return interaction.editReply("❌ A blackjack game is already in progress in this channel.");
        }

        if (!session.players.has(interaction.user.id)) {
          const joinRes = session.addPlayer(interaction.user);
          if (!joinRes.ok) return interaction.editReply(`❌ ${joinRes.msg}`);
          await session.updatePanel();
        }

        await ensureHostSecurity(session, guildId, session.hostId);

        if (bet != null) {
          if (bet < MIN_BET) return interaction.editReply(`❌ Minimum bet is $${MIN_BET.toLocaleString()}.`);

          const p = session.players.get(interaction.user.id);
          if (!p) return interaction.editReply("❌ You’re not in the game.");

          // already paid and changing bet
          if (p.paid && p.bet != null) {
            const oldBet = Number(p.bet);
            const newBet = Number(bet);
            if (newBet === oldBet) return interaction.editReply("✅ Your bet is already set to that amount.");

            const delta = newBet - oldBet;

            if (delta > 0) {
              const charge = await chargeWithCasinoFee({
                guildId,
                userId: interaction.user.id,
                amountStake: delta,
                type: "blackjack_bet_increase",
                meta: {
                  channelId,
                  gameId: session.gameId,
                  from: oldBet,
                  to: newBet,
                  username: interaction.user.username,
                  displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
                },
                session,
                channel: interaction.channel,
                hostId: session.hostId,
              });

              if (!charge.ok) return interaction.editReply("❌ You don’t have enough balance to increase your bet.");

              await addServerBank(guildId, delta, "blackjack_bank_buyin_delta", {
                channelId, gameId: session.gameId, userId: interaction.user.id, delta,
              });

              if (charge.feeAmount > 0) {
                await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_delta", {
                  channelId, gameId: session.gameId, userId: interaction.user.id,
                  feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
                });
              }

              p.bet = newBet;
              p.paid = true;

              await bjOnBetPaid(interaction, guildId, interaction.user.id, newBet);
              await session.updatePanel();

              return interaction.editReply(
                `✅ Bet increased to **$${newBet.toLocaleString()}**.\n` +
                `Total charged: **$${charge.totalCharge.toLocaleString()}** (delta $${delta.toLocaleString()} + fee $${charge.feeAmount.toLocaleString()}).`
              );
            }

            // delta < 0: refund only stake (no fee refunds)
            const refundAmt = Math.abs(delta);
            const refund = await bankToUserIfEnough(
              guildId,
              interaction.user.id,
              refundAmt,
              "blackjack_bet_decrease_refund",
              { channelId, gameId: session.gameId, from: oldBet, to: newBet, refundAmt }
            );

            if (!refund.ok) {
              return interaction.editReply(
                "⚠️ The server bank can’t cover that bet decrease refund right now. Try again later or pick a higher bet."
              );
            }

            p.bet = newBet;
            p.paid = true;
            await session.updatePanel();

            return interaction.editReply(
              `✅ Bet decreased to **$${newBet.toLocaleString()}** (refunded **$${refundAmt.toLocaleString()}**).`
            );
          }

          // Not paid yet: set + debit stake+fee
          const setRes = session.setBet(interaction.user.id, bet);
          if (!setRes.ok) return interaction.editReply(`❌ ${setRes.msg}`);

          const charge = await chargeWithCasinoFee({
            guildId,
            userId: interaction.user.id,
            amountStake: bet,
            type: "blackjack_buyin",
            meta: {
              channelId,
              gameId: session.gameId,
              username: interaction.user.username,
              displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
            },
            session,
            channel: interaction.channel,
            hostId: session.hostId,
          });

          if (!charge.ok) {
            p.bet = null;
            p.paid = false;
            await session.updatePanel();
            return interaction.editReply("❌ You don’t have enough balance for that bet + fee.");
          }

          await addServerBank(guildId, bet, "blackjack_bank_buyin", {
            channelId, gameId: session.gameId, userId: interaction.user.id,
          });

          if (charge.feeAmount > 0) {
            await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_buyin", {
              channelId, gameId: session.gameId, userId: interaction.user.id,
              feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
            });
          }

          p.paid = true;
          await bjOnBetPaid(interaction, guildId, interaction.user.id, bet);

          await session.updatePanel();
          const bankNow = await getServerBank(guildId);

          return interaction.editReply(
            `✅ Bet set: **$${bet.toLocaleString()}** (buy-in paid).\n` +
            `🛡️ Fee: **$${charge.feeAmount.toLocaleString()}**\n` +
            `🏦 Server bank: **$${bankNow.toLocaleString()}**`
          );
        }

        await session.updatePanel();
        return interaction.editReply("✅ You’re in. Set/change your bet with **/blackjack bet:<amount>**.");
      }

      // Create new session
      if (bet != null) {
        if (bet < MIN_BET) return interaction.editReply(`❌ Minimum bet is $${MIN_BET.toLocaleString()}.`);

        const session = new BlackjackSession({
          channel: interaction.channel,
          hostId: interaction.user.id,
          guildId,
          maxPlayers: 10,
          defaultBet: bet,
        });

        await ensureHostSecurity(session, guildId, interaction.user.id);

        const charge = await chargeWithCasinoFee({
          guildId,
          userId: interaction.user.id,
          amountStake: bet,
          type: "blackjack_buyin",
          meta: {
            channelId,
            preStart: true,
            username: interaction.user.username,
            displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
          },
          session,
          channel: interaction.channel,
          hostId: interaction.user.id,
        });

        if (!charge.ok) return interaction.editReply("❌ You don’t have enough balance for that bet + fee.");

        activeGames.set(channelId, session);
        session.addPlayer(interaction.user);

        session.setBet(interaction.user.id, bet);
        const pl = session.players.get(interaction.user.id);
        if (pl) pl.paid = true;

        await addServerBank(guildId, bet, "blackjack_bank_buyin", {
          channelId, gameId: session.gameId, userId: interaction.user.id,
        });

        if (charge.feeAmount > 0) {
          await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_buyin", {
            channelId, gameId: session.gameId, userId: interaction.user.id,
            feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
          });
        }

        await bjOnBetPaid(interaction, guildId, interaction.user.id, bet);

        await session.postOrEditPanel();

        const collector = session.message.createMessageComponentCollector({ time: 30 * 60_000 });
        wireCollectorHandlers({ collector, session, interaction, guildId, channelId });

        return interaction.editReply(
          `✅ Blackjack lobby created.\nHost stake: **$${bet.toLocaleString()}** (buy-in paid).\n` +
          `🛡️ Fee paid: **$${charge.feeAmount.toLocaleString()}**\n` +
          `Players can click **Join** to auto-buy-in, or run **/blackjack bet:<amount>** to pick their own.`
        );
      }

      const session = new BlackjackSession({
        channel: interaction.channel,
        hostId: interaction.user.id,
        guildId,
        maxPlayers: 10,
        defaultBet: null,
      });

      await ensureHostSecurity(session, guildId, interaction.user.id);

      activeGames.set(channelId, session);
      session.addPlayer(interaction.user);

      await session.postOrEditPanel();

      const collector = session.message.createMessageComponentCollector({ time: 30 * 60_000 });
      wireCollectorHandlers({ collector, session, interaction, guildId, channelId });

      return interaction.editReply("✅ Blackjack lobby created.\nSet your bet with **/blackjack bet:<amount>** (min $500).");
    } catch (err) {
      console.error("Blackjack error:", err);
      activeGames.delete(channelId);
      return interaction.editReply("❌ Blackjack hit an error — check bot logs.");
    }
  },
};

function wireCollectorHandlers({ collector, session, interaction, guildId, channelId }) {
  async function handleGameEnd() {
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

      await bjOnFinalOutcome(interaction, guildId, p);

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

    session.resultsMessage = await interaction.channel.send({
      embeds: [{ title: "🃏 Blackjack Results", description: desc }],
    });

    collector.stop("game_finished");
  }

  collector.on("collect", async (i) => {
    if (await guardNotJailedComponent(i)) return;

    await i.deferUpdate().catch(() => {});
    const [prefix, gameId, action] = i.customId.split(":");
    if (prefix !== "bj" || gameId !== session.gameId) return;

    const isHost = session.isHost(i.user.id);

    // LOBBY
    if (action === "join") {
      const res = session.addPlayer(i.user);
      if (!res.ok) {
        await sendEphemeralToast(i, `❌ ${res.msg}`);
        return;
      }

      await ensureHostSecurity(session, guildId, session.hostId);

      if (session.defaultBet != null) {
        const autoBet = Number(session.defaultBet);
        const p = session.players.get(i.user.id);

        session.setBet(i.user.id, autoBet);

        const charge = await chargeWithCasinoFee({
          guildId,
          userId: i.user.id,
          amountStake: autoBet,
          type: "blackjack_buyin_auto_join",
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
          session.removePlayer(i.user.id);
          await session.updatePanel();
          await sendEphemeralToast(i, `❌ Not enough balance to join at **$${autoBet.toLocaleString()}** + fee.`);
          return;
        }

        await addServerBank(guildId, autoBet, "blackjack_bank_buyin", {
          channelId, gameId: session.gameId, userId: i.user.id,
        });

        if (charge.feeAmount > 0) {
          await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_buyin", {
            channelId, gameId: session.gameId, userId: i.user.id,
            feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
          });
        }

        if (p) p.paid = true;
        await bjOnBetPaid(i, guildId, i.user.id, autoBet);

        await session.updatePanel();
        await sendEphemeralToast(
          i,
          `✅ Joined with buy-in **$${autoBet.toLocaleString()}**\n🛡️ Fee: **$${charge.feeAmount.toLocaleString()}**`
        );
        return;
      }

      await session.updatePanel();
      await sendEphemeralToast(i, "✅ Joined. Set your bet with **/blackjack bet:<amount>**.");
      return;
    }

    if (action === "leave") {
      if (session.state !== "lobby") return;

      const p = session.players.get(i.user.id);
      const wasPaid = Boolean(p?.paid && p?.bet);

      const rem = session.removePlayer(i.user.id);
      if (!rem.ok) {
        await sendEphemeralToast(i, `❌ ${rem.msg}`);
        return;
      }

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

    if (action === "start") {
      if (!isHost) {
        await sendTempNotice(i.channel, "❌ Only the host can start.", 4000);
        return;
      }
      if (!session.allPlayersPaid()) {
        await sendTempNotice(i.channel, "❌ Everyone must set + pay a bet before starting.", 5000);
        return;
      }

      await session.start();
      if (session.state === "ended") await handleGameEnd();
      return;
    }

    if (action === "end") {
      if (!isHost) {
        await sendTempNotice(i.channel, "❌ Only the host can end.", 4000);
        return;
      }
      collector.stop("ended_by_host");
      return;
    }

    // PLAY
    if (session.state !== "playing") return;

    if (action === "hit") {
      const res = await session.hit(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      if (session.state === "ended") await handleGameEnd();
      return;
    }

    if (action === "stand") {
      const res = await session.stand(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      if (session.state === "ended") await handleGameEnd();
      return;
    }

    // ✅ DOUBLE DOWN: charge extra bet+fee, bank it, then apply session.doubleDown
    if (action === "double") {
      if (!session.canDoubleDown?.(i.user.id)) {
        await sendTempNotice(i.channel, "❌ Double Down not allowed right now.", 4500);
        return;
      }

      const extraStake = Number(session.getCurrentHandBet(i.user.id) || 0);
      if (!extraStake) {
        await sendEphemeralToast(i, "❌ Couldn’t find your current bet to double.");
        return;
      }

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

      if (!charge.ok) {
        await sendEphemeralToast(i, "❌ Not enough balance to double down (including table fee).");
        return;
      }

      await addServerBank(guildId, extraStake, "blackjack_bank_double_down", {
        channelId, gameId: session.gameId, userId: i.user.id, extraStake,
      });

      if (charge.feeAmount > 0) {
        await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_double_down", {
          channelId, gameId: session.gameId, userId: i.user.id,
          feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
        });
      }

      await sendEphemeralToast(
        i,
        `✅ Double Down paid.\nExtra stake: **$${extraStake.toLocaleString()}**\nFee: **$${charge.feeAmount.toLocaleString()}**`
      );

      const res = await session.doubleDown(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      if (session.state === "ended") await handleGameEnd();
      return;
    }

    // ✅ SPLIT: charge extra bet+fee for the second hand, bank it, then apply session.split
    if (action === "split") {
      if (!session.canSplit?.(i.user.id)) {
        await sendTempNotice(i.channel, "❌ Split not allowed right now.", 4500);
        return;
      }

      const extraStake = Number(session.getCurrentHandBet(i.user.id) || 0);
      if (!extraStake) {
        await sendEphemeralToast(i, "❌ Couldn’t find your current bet to split.");
        return;
      }

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

      if (!charge.ok) {
        await sendEphemeralToast(i, "❌ Not enough balance to split (including table fee).");
        return;
      }

      await addServerBank(guildId, extraStake, "blackjack_bank_split", {
        channelId, gameId: session.gameId, userId: i.user.id, extraStake,
      });

      if (charge.feeAmount > 0) {
        await addServerBank(guildId, charge.feeAmount, "blackjack_fee_bank_split", {
          channelId, gameId: session.gameId, userId: i.user.id,
          feeAmount: charge.feeAmount, effectiveFeePct: charge.effectiveFeePct,
        });
      }

      await sendEphemeralToast(
        i,
        `✅ Split paid.\nExtra stake: **$${extraStake.toLocaleString()}**\nFee: **$${charge.feeAmount.toLocaleString()}**`
      );

      const res = await session.split(i.user.id);
      if (!res.ok) await sendTempNotice(i.channel, `❌ ${res.msg}`, 4500);
      return;
    }
  });

  collector.on("end", async () => {
    activeGames.delete(channelId);
    if (session.timeout) clearTimeout(session.timeout);

    setTimeout(() => {
      session.message?.delete().catch(() => {});
      session.resultsMessage?.delete().catch(() => {});
    }, 15_000);
  });
}
