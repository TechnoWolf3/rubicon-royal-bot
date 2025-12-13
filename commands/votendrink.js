const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const QUESTIONS = require("../data/voteQuestions_spicy");
const ALLOWED_CHANNEL = "1449217901306581074";

// One in-memory session (one game at a time)
let session = null;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("votendrink")
    .setDescription("Vote & Drink party game")
    .addSubcommand((sub) =>
      sub.setName("start").setDescription("Start a Vote & Drink lobby")
    ),

  async execute(interaction) {
    if (interaction.channelId !== ALLOWED_CHANNEL) {
      return interaction.reply({
        content: "❌ This game can only be played in the designated channel.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "start") {
      if (session) {
        return interaction.reply({
          content: "⚠️ A Vote & Drink game is already running.",
          ephemeral: true,
        });
      }

      session = createSession(interaction);

      await interaction.reply({
        content: "🍻 **Vote & Drink lobby created!**",
        ephemeral: true,
      });

      const lobbyMsg = await interaction.channel.send(buildLobbyMessage());
      session.lobbyMessageId = lobbyMsg.id;

      attachLobbyCollector(lobbyMsg);
      return;
    }
  },
};

function createSession(interaction) {
  return {
    hostId: interaction.user.id,
    channelId: interaction.channelId,

    // Players who clicked Join
    players: new Map(), // userId -> User

    // Deck behavior (avoid repeats until exhausted)
    usedQuestions: [],

    // Lobby + round state
    lobbyMessageId: null,
    roundActive: false,
    roundMessageId: null,
    roundVotesByVoterId: {}, // { voterId: votedUserId }
    roundQuestion: null,
  };
}

function buildLobbyMessage() {
  const playerList = session.players.size
    ? [...session.players.values()].map((u) => `• ${u}`).join("\n")
    : "_No players yet. Click **Join** to play._";

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink — Lobby")
    .setColor(0x8e44ad)
    .setDescription(
      `Click **Join** if you're playing.\n` +
        `Host can click **Begin Round** once you have at least 2 players.\n\n` +
        `**Players (${session.players.size}):**\n${playerList}`
    )
    .setFooter({ text: "Keep it chaotic. Keep it friendly." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("vnd_join")
      .setLabel("Join")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("vnd_leave")
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vnd_begin")
      .setLabel("Begin Round")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(session.roundActive),
    new ButtonBuilder()
      .setCustomId("vnd_end")
      .setLabel("End Game")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function attachLobbyCollector(lobbyMsg) {
  const collector = lobbyMsg.createMessageComponentCollector({
    // Long-running lobby (2 hours)
    time: 2 * 60 * 60 * 1000,
  });

  collector.on("collect", async (btn) => {
    if (!session) return btn.reply({ content: "Game ended.", ephemeral: true });
    if (btn.channelId !== session.channelId) return;

    // JOIN
    if (btn.customId === "vnd_join") {
      session.players.set(btn.user.id, btn.user);
      await btn.reply({ content: "✅ You joined the game.", ephemeral: true });
      return lobbyMsg.edit(buildLobbyMessage());
    }

    // LEAVE
    if (btn.customId === "vnd_leave") {
      session.players.delete(btn.user.id);
      await btn.reply({ content: "👋 You left the game.", ephemeral: true });
      return lobbyMsg.edit(buildLobbyMessage());
    }

    // BEGIN ROUND (host-only)
    if (btn.customId === "vnd_begin") {
      if (btn.user.id !== session.hostId) {
        return btn.reply({
          content: "❌ Only the host can begin rounds.",
          ephemeral: true,
        });
      }
      if (session.roundActive) {
        return btn.reply({
          content: "⚠️ A round is already running.",
          ephemeral: true,
        });
      }
      if (session.players.size < 2) {
        return btn.reply({
          content: "❌ Need at least 2 joined players.",
          ephemeral: true,
        });
      }

      session.roundActive = true;
      await btn.reply({ content: "▶️ Round started!", ephemeral: true });

      // Disable Begin while round runs
      await lobbyMsg.edit(buildLobbyMessage());

      // Start the round
      await startRound(btn.channel);

      // Re-enable Begin after round ends
      session.roundActive = false;
      await lobbyMsg.edit(buildLobbyMessage());
      return;
    }

    // NEXT ROUND (host-only) — comes from the result message buttons
    if (btn.customId === "vnd_next") {
      if (btn.user.id !== session.hostId) {
        return btn.reply({
          content: "❌ Only the host can start the next round.",
          ephemeral: true,
        });
      }
      if (session.roundActive) {
        return btn.reply({
          content: "⚠️ A round is already running.",
          ephemeral: true,
        });
      }
      if (session.players.size < 2) {
        return btn.reply({
          content: "❌ Need at least 2 joined players.",
          ephemeral: true,
        });
      }

      session.roundActive = true;
      await btn.reply({ content: "▶️ Next round started!", ephemeral: true });

      await lobbyMsg.edit(buildLobbyMessage());

      await startRound(btn.channel);

      session.roundActive = false;
      await lobbyMsg.edit(buildLobbyMessage());
      return;
    }

    // END GAME (host-only)
    if (btn.customId === "vnd_end") {
      if (btn.user.id !== session.hostId) {
        return btn.reply({
          content: "❌ Only the host can end the game.",
          ephemeral: true,
        });
      }
      await btn.reply({ content: "🛑 Ending game…", ephemeral: true });
      collector.stop("ended");
      return endGame(btn.channel, "🛑 **Vote & Drink has ended.**");
    }
  });

  collector.on("end", async () => {
    if (session) {
      await endGame(lobbyMsg.channel, "⌛ Lobby timed out — game ended.");
    }
  });
}

function pickNextQuestion() {
  const available = QUESTIONS.filter((q) => !session.usedQuestions.includes(q));
  const pool = available.length ? available : QUESTIONS;

  const chosen = pool[Math.floor(Math.random() * pool.length)];

  // If exhausted, reset and start again
  if (!available.length) session.usedQuestions = [];

  session.usedQuestions.push(chosen);
  return chosen;
}

function buildVoteComponents(playersArr) {
  const rows = [];
  let row = new ActionRowBuilder();

  playersArr.forEach((user, idx) => {
    if (idx > 0 && idx % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`vnd_vote_${user.id}`)
        .setLabel(user.username)
        .setStyle(ButtonStyle.Primary)
    );
  });

  rows.push(row);
  return rows;
}

async function startRound(channel) {
  session.roundVotesByVoterId = {};
  session.roundQuestion = pickNextQuestion();

  const playersArr = [...session.players.values()];

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink")
    .setColor(0x8e44ad)
    .setDescription(`**${session.roundQuestion}**\n\nVote below 👇`)
    .setFooter({ text: "Ends in 30 seconds (or sooner if everyone votes)" });

  const components = buildVoteComponents(playersArr);

  const roundMsg = await channel.send({ embeds: [embed], components });
  session.roundMessageId = roundMsg.id;

  const collector = roundMsg.createMessageComponentCollector({ time: 30_000 });

  const maybeEndEarly = () => {
    if (Object.keys(session.roundVotesByVoterId).length >= session.players.size) {
      collector.stop("all_voted");
    }
  };

  collector.on("collect", async (btn) => {
    if (!session) return btn.reply({ content: "Game ended.", ephemeral: true });
    if (btn.message.id !== session.roundMessageId) {
      return btn.reply({ content: "That round is no longer active.", ephemeral: true });
    }

    // Only joined players can vote
    if (!session.players.has(btn.user.id)) {
      return btn.reply({
        content: "❌ You’re not in the game. Click **Join** in the lobby.",
        ephemeral: true,
      });
    }

    const votedUserId = btn.customId.replace("vnd_vote_", "");
    session.roundVotesByVoterId[btn.user.id] = votedUserId;

    await btn.reply({ content: "✅ Vote counted!", ephemeral: true });
    maybeEndEarly();
  });

  collector.on("end", async () => {
    if (!session) return;

    const tally = {};
    Object.values(session.roundVotesByVoterId).forEach((votedId) => {
      tally[votedId] = (tally[votedId] || 0) + 1;
    });

    const postRoundRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vnd_next")
        .setLabel("Next Round")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("vnd_end")
        .setLabel("End Game")
        .setStyle(ButtonStyle.Danger)
    );

    // No votes
    if (Object.keys(tally).length === 0) {
      const noVoteEmbed = EmbedBuilder.from(embed).setDescription(
        `**${session.roundQuestion}**\n\n❌ No votes were cast.`
      );
      await roundMsg.edit({ embeds: [noVoteEmbed], components: [postRoundRow] });
      return;
    }

    const maxVotes = Math.max(...Object.values(tally));
    const losers = Object.keys(tally).filter((id) => tally[id] === maxVotes);

    // Random but reasonable sips: usually 1–3, sometimes 4
    const sips = Math.random() < 0.15 ? 4 : Math.floor(Math.random() * 3) + 1;

    const resultsLines = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => `• <@${id}> — **${count}** vote(s)`)
      .join("\n");

    const mentions = losers.map((id) => `<@${id}>`).join(", ");

    const resultEmbed = EmbedBuilder.from(embed).setDescription(
      `**${session.roundQuestion}**\n\n` +
        `📊 **Results:**\n${resultsLines}\n\n` +
        `🍺 ${mentions} drink **${sips} sip(s)**!` +
        (losers.length > 1 ? " (Tie rule)" : "")
    );

    await roundMsg.edit({ embeds: [resultEmbed], components: [postRoundRow] });
  });
}

async function endGame(channel, finalMessage) {
  // Disable lobby components if we can find the lobby message
  try {
    if (session?.lobbyMessageId) {
      const lobbyMsg = await channel.messages.fetch(session.lobbyMessageId);
      if (lobbyMsg) {
        await lobbyMsg.edit({
          ...buildLobbyMessage(),
          components: [],
        });
      }
    }
  } catch (_) {
    // ignore
  }

  session = null;
  await channel.send(finalMessage);
}
