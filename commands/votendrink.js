const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const QUESTIONS = require("../data/voteQuestions_spicy");
const ALLOWED_CHANNEL = "1449217901306581074";

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
  },
};

function createSession(interaction) {
  return {
    hostId: interaction.user.id,
    channelId: interaction.channelId,

    players: new Map(),
    usedQuestions: [],

    lobbyMessageId: null,
    lobbyCollector: null,

    roundActive: false,
    roundMessageId: null,
    roundVotesByVoterId: {},
    roundQuestion: null,

    // 🔥 Session-only stats
    sessionVoteTotals: {}, // { userId: totalVotes }
    roundsPlayed: 0,
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
    .setFooter({ text: "Session-only stats • Party responsibly" });

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
    time: 2 * 60 * 60 * 1000,
  });

  session.lobbyCollector = collector;

  collector.on("collect", async (btn) => {
    await btn.deferUpdate().catch(() => {});
    if (!session || btn.channelId !== session.channelId) return;

    if (btn.customId === "vnd_join") {
      session.players.set(btn.user.id, btn.user);
      return lobbyMsg.edit(buildLobbyMessage());
    }

    if (btn.customId === "vnd_leave") {
      session.players.delete(btn.user.id);
      return lobbyMsg.edit(buildLobbyMessage());
    }

    if (btn.customId === "vnd_begin") {
      if (btn.user.id !== session.hostId) return;
      if (session.roundActive || session.players.size < 2) return;

      session.roundActive = true;
      await lobbyMsg.edit(buildLobbyMessage());
      await startRound(btn.channel);
      session.roundActive = false;
      return lobbyMsg.edit(buildLobbyMessage());
    }

    if (btn.customId === "vnd_end") {
      if (btn.user.id !== session.hostId) return;
      collector.stop("ended");
      return endGame(btn.channel);
    }
  });

  collector.on("end", async () => {
    if (session) await endGame(lobbyMsg.channel);
  });
}

function pickNextQuestion() {
  const available = QUESTIONS.filter((q) => !session.usedQuestions.includes(q));
  const pool = available.length ? available : QUESTIONS;

  if (!available.length) session.usedQuestions = [];

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  session.usedQuestions.push(chosen);
  return chosen;
}

function buildVoteComponents(playersArr) {
  const rows = [];
  let row = new ActionRowBuilder();

  playersArr.forEach((user, idx) => {
    if (idx && idx % 5 === 0) {
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

  const roundMsg = await channel.send({
    embeds: [embed],
    components: buildVoteComponents(playersArr),
  });

  session.roundMessageId = roundMsg.id;

  const collector = roundMsg.createMessageComponentCollector({ time: 30_000 });

  collector.on("collect", async (btn) => {
    await btn.deferUpdate().catch(() => {});
    if (!session || !session.players.has(btn.user.id)) return;

    const votedId = btn.customId.replace("vnd_vote_", "");
    session.roundVotesByVoterId[btn.user.id] = votedId;

    if (Object.keys(session.roundVotesByVoterId).length >= session.players.size) {
      collector.stop("all_voted");
    }
  });

  collector.on("end", async () => {
    const tally = {};
    Object.values(session.roundVotesByVoterId).forEach((id) => {
      tally[id] = (tally[id] || 0) + 1;
    });

    for (const [id, count] of Object.entries(tally)) {
      session.sessionVoteTotals[id] =
        (session.sessionVoteTotals[id] || 0) + count;
    }

    session.roundsPlayed += 1;

    const postRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vnd_next")
        .setLabel("Next Round")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("vnd_end")
        .setLabel("End Game")
        .setStyle(ButtonStyle.Danger)
    );

    let resultText = `**${session.roundQuestion}**\n\n`;

    if (!Object.keys(tally).length) {
      resultText += "❌ No votes were cast.";
    } else {
      const maxVotes = Math.max(...Object.values(tally));
      const losers = Object.keys(tally).filter((id) => tally[id] === maxVotes);
      const sips = Math.random() < 0.15 ? 4 : Math.floor(Math.random() * 3) + 1;

      resultText +=
        Object.entries(tally)
          .map(([id, c]) => `• <@${id}> — **${c}** vote(s)`)
          .join("\n") +
        `\n\n🍺 ${losers.map((id) => `<@${id}>`).join(", ")} drink **${sips} sip(s)**!` +
        (losers.length > 1 ? " (Tie rule)" : "");
    }

    await roundMsg.edit({
      embeds: [EmbedBuilder.from(embed).setDescription(resultText)],
      components: [postRow],
    });

    const postCollector = roundMsg.createMessageComponentCollector({
      filter: (i) => ["vnd_next", "vnd_end"].includes(i.customId),
      time: 2 * 60 * 60 * 1000,
    });

    postCollector.on("collect", async (i) => {
      await i.deferUpdate().catch(() => {});
      if (!session || i.user.id !== session.hostId) return;

      if (i.customId === "vnd_end") {
        session.lobbyCollector?.stop();
        return endGame(channel);
      }

      if (i.customId === "vnd_next" && !session.roundActive) {
        session.roundActive = true;
        await startRound(channel);
        session.roundActive = false;
        postCollector.stop();
      }
    });
  });
}

async function endGame(channel) {
  try {
    if (session?.lobbyMessageId) {
      const lobby = await channel.messages.fetch(session.lobbyMessageId);
      await lobby.edit({ ...buildLobbyMessage(), components: [] });
    }
  } catch {}

  const totals = Object.entries(session.sessionVoteTotals).sort((a, b) => b[1] - a[1]);

  if (totals.length) {
    const lines = totals.slice(0, 10).map(
      ([id, v], i) =>
        `${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"} <@${id}> — **${v}** vote(s)`
    );

    const embed = new EmbedBuilder()
      .setTitle("🏆 Vote & Drink — Session Leaderboard")
      .setColor(0x8e44ad)
      .setDescription(
        `**Rounds played:** ${session.roundsPlayed}\n\n${lines.join("\n")}`
      )
      .setFooter({ text: "Session-only leaderboard" });

    await channel.send({ embeds: [embed] });
  }

  session = null;
  await channel.send("🛑 **Vote & Drink has ended.**");
}
