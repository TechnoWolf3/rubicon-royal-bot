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

const MIN_BET = 500;

/* =========================================================
   🏆 ACHIEVEMENTS (BLACKJACK) — easy to edit section
   - IDs must match data/achievements.json
   - Only edit this block to change what triggers + announcements
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
  ENABLED: true, // set false if it gets too noisy
  // If true, sends in the same channel the game is in
  USE_GAME_CHANNEL: true,
};

// Helper: fetch full achievement info from DB for nicer embeds
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

// Helper: announce achievement publicly (only called on first unlock)
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

// Safe wrapper: unlock + optional public announce
async function bjUnlock(thing, guildId, userId, achievementId) {
  try {
    const db = thing?.client?.db;
    if (!db) return null;

    // ✅ Normalize userId in case it comes in like "<@123>" or "<@!123>"
    const cleanUserId = String(userId).replace(/[<@!>]/g, "");

    const res = await unlockAchievement({ db, guildId, userId: cleanUserId, achievementId });
    if (!res?.unlocked) return res;

    // Fetch info for a nicer announcement embed
    const info = await bjFetchAchievementInfo(db, achievementId);

    // Announce in the game channel (same channel)
    const channel = BJ_ANNOUNCE.USE_GAME_CHANNEL ? thing.channel : null;
    await bjAnnounceAchievement(channel, cleanUserId, info);

    // Helpful proof in logs
    console.log("[BJ ACH] unlocked", { guildId, userId: cleanUserId, achievementId });

    return res;
  } catch (e) {
    console.error("Achievement unlock failed:", e);
    return null;
  }
}

// Helper: increment blackjack win count and unlock at 10 wins
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

    // Unlock exactly when they hit 10 wins
    if (wins === 10) {
      await bjUnlock(thing, guildId, cleanUserId, BJ_ACH.TEN_WINS);
    }
  } catch (e) {
    console.error("bjIncrementWinsAndMaybeUnlock failed:", e);
  }
}

// Trigger: call this when a bet is successfully PAID (debit OK)
async function bjOnBetPaid(thing, guildId, userId, betAmount) {
  if (Number(betAmount) >= BJ_RULES.HIGH_ROLLER_BET) {
    await bjUnlock(thing, guildId, userId, BJ_ACH.HIGH_ROLLER);
  }
}

// Trigger: call at game end for each player outcome
async function bjOnFinalOutcome(thing, guildId, outcome) {
  const pv = Number(outcome.playerValue ?? 0);

  // Bust
  if (pv > 21) {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.BUST);
  }

  // Any win
  if (outcome.result === "win" || outcome.result === "blackjack_win") {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.FIRST_WIN);

    // ✅ NEW: count this win toward 10 wins
    await bjIncrementWinsAndMaybeUnlock(thing, guildId, outcome.userId);
  }

  // Blackjack win (your code labels this as blackjack_win with 2.5x payout)
  if (outcome.result === "blackjack_win") {
    await bjUnlock(thing, guildId, outcome.userId, BJ_ACH.BLACKJACK);
  }
}

/* ========================================================= */

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate: blocks /blackjack entirely while jailed
    if (await guardNotJailed(interaction)) return;

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

        // join if not already
        if (!session.players.has(interaction.user.id)) {
          const joinRes = session.addPlayer(interaction.user);
          if (!joinRes.ok) return interaction.editReply(`❌ ${joinRes.msg}`);
          await session.updatePanel();
        }

        // Optional bet set / adjust
        if (bet != null) {
          if (bet < MIN_BET) {
            return interaction.editReply(`❌ Minimum bet is $${MIN_BET.toLocaleString()}.`);
          }

          const p = session.players.get(interaction.user.id);
          if (!p) return interaction.editReply("❌ You’re not in the game.");

          // If already paid, allow changing by charging/refunding the DIFFERENCE
          if (p.paid && p.bet != null) {
            const oldBet = Number(p.bet);
            const newBet = Number(bet);
            if (newBet === oldBet) {
              return interaction.editReply("✅ Your bet is already set to that amount.");
            }

            const delta = newBet - oldBet;

            if (delta > 0) {
              // charge extra
              const debit = await tryDebitUser(guildId, interaction.user.id, delta, "blackjack_bet_increase", {
                channelId,
                gameId: session.gameId,
                from: oldBet,
                to: newBet,
              });

              if (!debit.ok) {
                return interaction.editReply("❌ You don’t have enough balance to increase your bet.");
              }

              await addServerBank(guildId, delta, "blackjack_bank_buyin_delta", {
                channelId,
                gameId: session.gameId,
                userId: interaction.user.id,
                delta,
              });

              p.bet = newBet;
              p.paid = true;

              // 🏆 Achievement trigger: bet paid (increase)
              await bjOnBetPaid(interaction, guildId, interaction.user.id, newBet);

              await session.updatePanel();
              return interaction.editReply(`✅ Bet increased to **$${newBet.toLocaleString()}**.`);
            } else {
              // refund difference (subject to bank protection)
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
          }

          // Not paid yet: normal set + debit full bet
          const setRes = session.setBet(interaction.user.id, bet);
          if (!setRes.ok) return interaction.editReply(`❌ ${setRes.msg}`);

          const debit = await tryDebitUser(guildId, interaction.user.id, bet, "blackjack_buyin", {
            channelId,
            gameId: session.gameId,
          });

          if (!debit.ok) {
            p.bet = null;
            p.paid = false;
            await session.updatePanel();
            return interaction.editReply("❌ You don’t have enough balance for that bet.");
          }

          await addServerBank(guildId, bet, "blackjack_bank_buyin", {
            channelId,
            gameId: session.gameId,
            userId: interaction.user.id,
          });

          p.paid = true;

          // 🏆 Achievement trigger: bet paid (initial)
          await bjOnBetPaid(interaction, guildId, interaction.user.id, bet);

          await session.updatePanel();
          const bankNow = await getServerBank(guildId);

          return interaction.editReply(
            `✅ Bet set: **$${bet.toLocaleString()}** (buy-in paid).\n🏦 Server bank: **$${bankNow.toLocaleString()}**`
          );
        }

        await session.updatePanel();
        return interaction.editReply(
          "✅ You’re in. Set or change your bet with: **/blackjack bet:<amount>** (min $500)."
        );
      }

      // Create new session
      if (bet != null) {
        if (bet < MIN_BET) return interaction.editReply(`❌ Minimum bet is $${MIN_BET.toLocaleString()}.`);

        // Pre-charge host BEFORE creating panel
        const debit = await tryDebitUser(guildId, interaction.user.id, bet, "blackjack_buyin", {
          channelId,
          preStart: true,
        });

        if (!debit.ok) {
          return interaction.editReply("❌ You don’t have enough balance for that bet.");
        }

        const session = new BlackjackSession({
          channel: interaction.channel,
          hostId: interaction.user.id,
          guildId,
          maxPlayers: 10,
          defaultBet: bet, // Join auto-buy-in at this bet
        });

        activeGames.set(channelId, session);
        session.addPlayer(interaction.user);

        session.setBet(interaction.user.id, bet);
        const pl = session.players.get(interaction.user.id);
        if (pl) pl.paid = true;

        await addServerBank(guildId, bet, "blackjack_bank_buyin", {
          channelId,
          gameId: session.gameId,
          userId: interaction.user.id,
        });

        // 🏆 Achievement trigger: host bet paid
        await bjOnBetPaid(interaction, guildId, interaction.user.id, bet);

        await session.postOrEditPanel();

        const collector = session.message.createMessageComponentCollector({ time: 30 * 60_000 });
        wireCollectorHandlers({ collector, session, interaction, guildId, channelId });

        return interaction.editReply(
          `✅ Blackjack lobby created.\nHost bet: **$${bet.toLocaleString()}** (your buy-in paid).\n` +
            `Players can click **Join** to auto-buy-in, or run **/blackjack bet:<amount>** to pick their own.`
        );
      }

      // No host bet: normal lobby, no auto-buy-in
      const session = new BlackjackSession({
        channel: interaction.channel,
        hostId: interaction.user.id,
        guildId,
        maxPlayers: 10,
        defaultBet: null,
      });

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

      // 🏆 Achievement triggers based on final outcomes
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
            });

            if (refund.ok) {
              paid = B;
              payoutNotes.push(
                `⚠️ <@${p.userId}>: The bank couldn’t cover full winnings, so we refunded your bet (**$${B.toLocaleString()}**) instead. Sorry!`
              );
            } else {
              payoutNotes.push(
                `⚠️ <@${p.userId}>: The bank couldn’t cover winnings or a refund right now. Please ping an admin — sorry!`
              );
            }
          } else {
            payoutNotes.push(
              `⚠️ <@${p.userId}>: The bank couldn’t cover a refund/payout right now. Please ping an admin — sorry!`
            );
          }
        }
      }

      const paidText = paid > 0 ? ` → Paid **$${paid.toLocaleString()}**` : "";
      resultsLines.push(`${p.user} — **${pv}** — ${label}${paidText}`);
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
    // 🚔 Jail gate for button actions too
    if (await guardNotJailedComponent(i)) return;

    await i.deferUpdate().catch(() => {});
    const [prefix, gameId, action] = i.customId.split(":");
    if (prefix !== "bj" || gameId !== session.gameId) return;

    const isHost = session.isHost(i.user.id);

    // LOBBY
    if (action === "join") {
      const res = session.addPlayer(i.user);
      if (!res.ok) {
        return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      // If host set a default bet, auto-buy-in on Join
      if (session.defaultBet != null) {
        const autoBet = Number(session.defaultBet);
        const p = session.players.get(i.user.id);

        session.setBet(i.user.id, autoBet);

        const debit = await tryDebitUser(guildId, i.user.id, autoBet, "blackjack_buyin_auto_join", {
          channelId,
          gameId: session.gameId,
        });

        if (!debit.ok) {
          // rollback join + bet
          session.removePlayer(i.user.id);
          await session.updatePanel();
          return i.followUp({
            content: `❌ You don’t have enough balance to join at **$${autoBet.toLocaleString()}**.`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        await addServerBank(guildId, autoBet, "blackjack_bank_buyin", {
          channelId,
          gameId: session.gameId,
          userId: i.user.id,
        });

        if (p) p.paid = true;

        // 🏆 Achievement trigger: auto-join bet paid
        await bjOnBetPaid(i, guildId, i.user.id, autoBet);

        await session.updatePanel();
        return i.followUp({
          content:
            `✅ Joined + buy-in paid: **$${autoBet.toLocaleString()}**.\n` +
            `You can change it with **/blackjack bet:<amount>** before the host starts.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      await session.updatePanel();
      return i.followUp({
        content: "✅ Joined. Set your bet with **/blackjack bet:<amount>** (min $500).",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (action === "leave") {
      if (session.state !== "lobby") return;

      const p = session.players.get(i.user.id);
      const wasPaid = Boolean(p?.paid && p?.bet);

      const rem = session.removePlayer(i.user.id);
      if (!rem.ok) {
        return i.followUp({ content: `❌ ${rem.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      // Refund paid bet if possible
      if (wasPaid) {
        const refund = await bankToUserIfEnough(guildId, i.user.id, Number(p.bet), "blackjack_leave_refund", {
          channelId,
          gameId: session.gameId,
          userId: i.user.id,
        });

        if (!refund.ok) {
          await i.followUp({
            content: "⚠️ I couldn’t refund your buy-in due to low server bank. Please ping an admin — sorry!",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }

      await session.updatePanel();
      return;
    }

    if (action === "start") {
      if (!isHost) {
        return i.followUp({ content: "❌ Only the host can start.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      if (!session.allPlayersPaid()) {
        return i.followUp({
          content: "❌ Everyone must set + pay a bet before starting.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      await session.start();
      if (session.state === "ended") await handleGameEnd();
      return;
    }

    if (action === "end") {
      if (!isHost) {
        return i.followUp({ content: "❌ Only the host can end.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      collector.stop("ended_by_host");
      return;
    }

    // PLAY
    if (session.state !== "playing") return;

    if (action === "hand") {
      const p = session.players.get(i.user.id);
      if (!p) return i.followUp({ content: "❌ You’re not in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return i.followUp({
        content: `🃏 Your hand: ${p.hand.map(cardStr).join(" ")}\nTotal: **${handValue(p.hand)}**`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (action === "hit") {
      const res = await session.hit(i.user.id);
      if (!res.ok) return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});

      await i.followUp({
        content: `🃏 You hit.\nYour hand: ${res.player.hand.map(cardStr).join(" ")}\nTotal: **${handValue(res.player.hand)}**`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      if (session.state === "ended") await handleGameEnd();
      return;
    }

    if (action === "stand") {
      const res = await session.stand(i.user.id);
      if (!res.ok) return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});

      await i.followUp({
        content: `✋ You stood.\nYour hand: ${res.player.hand.map(cardStr).join(" ")}\nTotal: **${handValue(res.player.hand)}**`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      if (session.state === "ended") await handleGameEnd();
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
