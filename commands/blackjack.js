// commands/blackjack.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { activeGames } = require("../utils/gameManager");
const { BlackjackSession, handValue, cardStr } = require("../utils/blackjackSession");
const {
  tryDebitUser,
  addServerBank,
  bankToUserIfEnough,
  getServerBank,
} = require("../utils/economy");

const MIN_BET = 500;

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

    const channelId = interaction.channelId;
    const guildId = interaction.guildId;

    try {
      // If an ended game is somehow still tracked, clear it.
      const stale = activeGames.get(channelId);
      if (stale && stale.state === "ended") activeGames.delete(channelId);

      const bet = interaction.options.getInteger("bet", false);

      // If a lobby exists, /blackjack acts as join + (optional) set bet
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

        // optional bet setting
        if (bet != null) {
          if (bet < MIN_BET) {
            return interaction.editReply(`❌ Minimum bet is $${MIN_BET.toLocaleString()}.`);
          }

          const p = session.players.get(interaction.user.id);
          if (p.paid) {
            return interaction.editReply("❌ You’ve already set/paid your bet for this game.");
          }

          const setRes = session.setBet(interaction.user.id, bet);
          if (!setRes.ok) return interaction.editReply(`❌ ${setRes.msg}`);

          // debit user
          const debit = await tryDebitUser(guildId, interaction.user.id, bet, "blackjack_buyin", {
            channelId,
            gameId: session.gameId,
          });

          if (!debit.ok) {
            // undo local bet
            const pl = session.players.get(interaction.user.id);
            if (pl) { pl.bet = null; pl.paid = false; }
            await session.updatePanel();
            return interaction.editReply("❌ You don’t have enough balance for that bet.");
          }

          // credit server bank with buy-in
          await addServerBank(guildId, bet, "blackjack_bank_buyin", {
            channelId,
            gameId: session.gameId,
            userId: interaction.user.id,
          });

          // mark paid
          const pl = session.players.get(interaction.user.id);
          if (pl) pl.paid = true;

          await session.updatePanel();
          const bankNow = await getServerBank(guildId);

          return interaction.editReply(
            `✅ Bet set: **$${bet.toLocaleString()}** (buy-in paid).\n🏦 Server bank: **$${bankNow.toLocaleString()}**`
          );
        }

        await session.updatePanel();
        return interaction.editReply("✅ You’re in. Set your bet with: **/blackjack bet:<amount>** (min $500).");
      }

      // Create new session
      const session = new BlackjackSession({
        channel: interaction.channel,
        hostId: interaction.user.id,
        guildId,
        maxPlayers: 10,
      });

      activeGames.set(channelId, session);
      session.addPlayer(interaction.user);

      await session.postOrEditPanel();

      // If host provided a bet, apply it immediately
      if (bet != null) {
        const setRes = session.setBet(interaction.user.id, bet);
        if (!setRes.ok) return interaction.editReply(`❌ ${setRes.msg}`);

        const debit = await tryDebitUser(guildId, interaction.user.id, bet, "blackjack_buyin", {
          channelId,
          gameId: session.gameId,
        });

        if (!debit.ok) {
          const pl = session.players.get(interaction.user.id);
          if (pl) { pl.bet = null; pl.paid = false; }
          await session.updatePanel();
          activeGames.delete(channelId);
          return interaction.editReply("❌ You don’t have enough balance for that bet.");
        }

        await addServerBank(guildId, bet, "blackjack_bank_buyin", {
          channelId,
          gameId: session.gameId,
          userId: interaction.user.id,
        });

        const pl = session.players.get(interaction.user.id);
        if (pl) pl.paid = true;

        await session.updatePanel();
      }

      const collector = session.message.createMessageComponentCollector({ time: 30 * 60_000 });

      async function handleGameEnd() {
        if (session.endHandled) return;
        session.endHandled = true;

        const meta = { channelId, gameId: session.gameId };

        const { dealerHand, dealerValue, outcomes } = session.buildOutcomeData();

        const payoutNotes = [];
        const resultsLines = [];

        // Build payout plan:
        // - Standard win pays 2x bet
        // - Natural blackjack pays 2.5x bet
        // - Push refunds bet
        // - Lose pays 0
        const payoutPlan = outcomes.map((o) => {
          const B = Number(o.bet || 0);
          let payoutWanted = 0;

          if (o.result === "push") payoutWanted = B;
          else if (o.result === "win") payoutWanted = B * 2;
          else if (o.result === "blackjack_win") payoutWanted = Math.floor(B * 2.5);
          else payoutWanted = 0;

          return { ...o, payoutWanted };
        });

        // Safety ordering:
        // refund pushes first, then wins, then losers
        const pushes = payoutPlan.filter(p => p.result === "push" && p.payoutWanted > 0);
        const wins = payoutPlan.filter(p => (p.result === "win" || p.result === "blackjack_win") && p.payoutWanted > 0);
        const loses = payoutPlan.filter(p => p.payoutWanted === 0);

        const ordered = [...pushes, ...wins, ...loses];

        for (const p of ordered) {
          const B = Number(p.bet || 0);
          const pv = p.playerValue;

          let label = "❌ Lose";
          if (p.result === "push") label = "🤝 Push";
          if (p.result === "win") label = "✅ Win";
          if (p.result === "blackjack_win") label = "🟣 Blackjack";

          let paid = 0;

          if (p.payoutWanted > 0) {
            // Try full payout
            const full = await bankToUserIfEnough(
              guildId,
              p.userId,
              p.payoutWanted,
              "blackjack_payout",
              { ...meta, userId: p.userId, wanted: p.payoutWanted }
            );

            if (full.ok) {
              paid = p.payoutWanted;
            } else {
              // If payout is greater than base bet, fallback to refund base bet.
              // (This is your "bank can't cover payout -> return base bet + apology" rule.)
              if (p.payoutWanted > B && B > 0) {
                const refund = await bankToUserIfEnough(
                  guildId,
                  p.userId,
                  B,
                  "blackjack_refund",
                  { ...meta, userId: p.userId, wanted: p.payoutWanted, fallback: "refund_bet" }
                );

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
                // Push refund failed or exact payout failed
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
        await i.deferUpdate().catch(() => {});
        const [prefix, gameId, action] = i.customId.split(":");
        if (prefix !== "bj" || gameId !== session.gameId) return;

        const isHost = session.isHost(i.user.id);

        // Lobby buttons
        if (action === "join") {
          const res = session.addPlayer(i.user);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          await session.updatePanel();
          return i.followUp({
            content: "✅ Joined. Set bet with **/blackjack bet:<amount>** (min $500).",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        if (action === "leave") {
          if (session.state !== "lobby") return;

          const p = session.players.get(i.user.id);
          const wasPaid = Boolean(p?.paid && p?.bet);

          const res = session.removePlayer(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          // If they already paid, try refund from bank (non-negative enforced)
          if (wasPaid) {
            const refund = await bankToUserIfEnough(
              guildId,
              i.user.id,
              Number(p.bet),
              "blackjack_leave_refund",
              { channelId, gameId: session.gameId, userId: i.user.id }
            );

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
              content: "❌ Everyone must set + pay a bet first using **/blackjack bet:<amount>** (min $500).",
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

        // Gameplay buttons
        if (session.state !== "playing") return;

        if (action === "hand") {
          const p = session.players.get(i.user.id);
          if (!p) {
            return i.followUp({ content: "❌ You’re not in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          return i.followUp({
            content: `🃏 Your hand: ${p.hand.map(cardStr).join(" ")}\nTotal: **${handValue(p.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        if (action === "hit") {
          const res = await session.hit(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          await i.followUp({
            content: `🃏 You hit.\nYour hand: ${res.player.hand.map(cardStr).join(" ")}\nTotal: **${handValue(res.player.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});

          if (session.state === "ended") await handleGameEnd();
          return;
        }

        if (action === "stand") {
          const res = await session.stand(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }

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

      // Initial response to creator
      if (bet != null) {
        return interaction.editReply(
          `✅ Blackjack lobby created.\nYour bet: **$${bet.toLocaleString()}** (buy-in paid).\nOthers must use **/blackjack bet:<amount>** (min $500).`
        );
      }
      return interaction.editReply(
        "✅ Blackjack lobby created.\nSet your bet with **/blackjack bet:<amount>** (min $500)."
      );
    } catch (err) {
      console.error("Blackjack error:", err);
      activeGames.delete(channelId);
      return interaction.editReply("❌ Blackjack hit an error — check bot logs.");
    }
  },
};
