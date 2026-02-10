// data/games/votendrink.js
// Vote & Drink game module used by /games hub (NOT a slash command).
// Launch via: startFromHub(interaction)

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

// NOTE: file moved from /commands -> /data/games
// voteQuestions_spicy lives in /data, so relative path is ../voteQuestions_spicy
const QUESTIONS = require("../voteQuestions_spicy");

// Keep your channel lock if you still want it:
const ALLOWED_CHANNEL = "1449217901306581074";

let session = null;

/**
 * Safely send an ephemeral message regardless of whether the interaction
 * has been deferred/replied already (e.g., from a select menu).
 */
async function replyEphemeral(interaction, payload) {
  const msg = typeof payload === "string" ? { content: payload } : payload;

  // For discord.js v14, prefer flags where you already use MessageFlags elsewhere
  msg.flags = MessageFlags.Ephemeral;

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(msg).catch(() => {});
  }
  return interaction.reply(msg).catch(() => {});
}

function createSession(hostUser, channelId) {
  return {
    hostId: hostUser.id,
    channelId,

    players: new Map(), // userId -> User

    usedQuestions: [],
    panelMessageId: null,

    state: "lobby", // "lobby" | "voting" | "results"
    roundActive: false,
    roundVotesByVoterId: {}, // voterId -> votedUserId
    roundQuestion: null,

    sessionVoteTotals: {}, // userId -> total votes received
    roundsPlayed: 0,
  };
}

function buildLobbyPanelPayload() {
  const playerList = session.players.size
    ? [...session.players.values()].map((u) => `• ${u}`).join("\n")
    : "_No players yet. Click **Join** to play._";

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink — Lobby")
    .setDescription(
      `Click **Join** if you're playing.\n` +
        `Host clicks **Begin Round** when ready (**need 2+ players**).\n\n` +
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
      .setDisabled(session.roundActive || session.players.size < 2),
    new ButtonBuilder()
      .setCustomId("vnd_end")
      .setLabel("End Game")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function buildVotingPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink")
    .setDescription(`**${session.roundQuestion}**\n\nVote below 👇`)
    .setFooter({ text: "Ends in 30 seconds (or sooner if everyone votes)" });

  const voteRows = buildVoteComponents([...session.players.values()]);
  return { embeds: [embed], components: voteRows };
}

function buildResultsPanelPayload(tally) {
  const baseEmbed = new EmbedBuilder().setTitle("🗳️ Vote & Drink");

  let desc = `**${session.roundQuestion}**\n\n`;

  if (!Object.keys(tally).length) {
    desc += "❌ No votes were cast.";
  } else {
    const maxVotes = Math.max(...Object.values(tally));
    const losers = Object.keys(tally).filter((id) => tally[id] === maxVotes);

    const sips = Math.random() < 0.05 ? 2 : 1; // your spicy 5% double sip

    const resultsLines = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `• <@${id}> — **${count}** vote(s)`)
      .join("\n");

    const mentions = losers.map((id) => `<@${id}>`).join(", ");

    desc +=
      `📊 **Results:**\n${resultsLines}\n\n🍺 ${mentions} drink **${sips} sip(s)**!` +
      (losers.length > 1 ? " (Tie rule)" : "");
  }

  const embed = EmbedBuilder.from(baseEmbed).setDescription(desc);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("vnd_next")
      .setLabel("Next Round")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("vnd_end")
      .setLabel("End Game")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function buildVoteComponents(playersArr) {
  // Voting buttons: vnd_vote_<userid>
  const rows = [];
  const chunkSize = 5;

  for (let i = 0; i < playersArr.length; i += chunkSize) {
    const chunk = playersArr.slice(i, i + chunkSize);

    rows.push(
      new ActionRowBuilder().addComponents(
        ...chunk.map((u) =>
          new ButtonBuilder()
            .setCustomId(`vnd_vote_${u.id}`)
            .setLabel(u.username)
            .setStyle(ButtonStyle.Secondary)
        )
      )
    );
  }

  return rows;
}

function drawQuestion() {
  const all = QUESTIONS;
  if (!Array.isArray(all) || all.length === 0) {
    return "Who would survive the apocalypse the longest?";
  }

  if (session.usedQuestions.length >= all.length) session.usedQuestions = [];

  let q;
  do {
    q = all[Math.floor(Math.random() * all.length)];
  } while (session.usedQuestions.includes(q) && session.usedQuestions.length < all.length);

  session.usedQuestions.push(q);
  return q;
}

async function beginRound(panelMsg) {
  session.roundActive = true;
  session.state = "voting";
  session.roundVotesByVoterId = {};
  session.roundQuestion = drawQuestion();

  await panelMsg.edit(buildVotingPanelPayload()).catch(() => {});

  // 30s timer
  setTimeout(async () => {
    if (!session || !session.roundActive) return;
    await finishRound(panelMsg);
  }, 30_000);
}

async function finishRound(panelMsg) {
  session.roundActive = false;
  session.state = "results";
  session.roundsPlayed += 1;

  const tally = {};
  for (const voterId of Object.keys(session.roundVotesByVoterId)) {
    const votedId = session.roundVotesByVoterId[voterId];
    tally[votedId] = (tally[votedId] || 0) + 1;
    session.sessionVoteTotals[votedId] = (session.sessionVoteTotals[votedId] || 0) + 1;
  }

  await panelMsg.edit(buildResultsPanelPayload(tally)).catch(() => {});
}

async function endGame(panelMsg) {
  try {
    await panelMsg.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗳️ Vote & Drink — Ended")
          .setDescription("Game ended by host. Thanks for the chaos. 🍻"),
      ],
      components: [],
    });
  } catch {}

  session = null;
}

/**
 * Public entry point used by Games Hub.
 * This is what your category file will call.
 */
async function startFromHub(interaction) {
  // Channel lock (keep/remove as you like)
  if (interaction.channelId !== ALLOWED_CHANNEL) {
    return replyEphemeral(interaction, "❌ This game can only be played in the designated channel.");
  }

  if (session) {
    return replyEphemeral(interaction, "⚠️ A Vote & Drink game is already running.");
  }

  session = createSession(interaction.user, interaction.channelId);

  await replyEphemeral(interaction, "🍻 **Vote & Drink started!** (Panel posted below)");

  const panelMsg = await interaction.channel.send(buildLobbyPanelPayload());
  session.panelMessageId = panelMsg.id;

  const collector = panelMsg.createMessageComponentCollector({
    time: 3 * 60 * 60 * 1000, // 3 hours
  });

  collector.on("collect", async (i) => {
    await i.deferUpdate().catch(() => {});
    if (!session) return;
    if (i.channelId !== session.channelId) return;
    if (i.message.id !== session.panelMessageId) return;

    const id = i.customId;

    // Lobby
    if (id === "vnd_join") {
      if (session.state === "voting") return;
      session.players.set(i.user.id, i.user);
      await panelMsg.edit(buildLobbyPanelPayload()).catch(() => {});
      return;
    }

    if (id === "vnd_leave") {
      if (session.state === "voting") return;
      session.players.delete(i.user.id);
      await panelMsg.edit(buildLobbyPanelPayload()).catch(() => {});
      return;
    }

    if (id === "vnd_begin") {
      if (i.user.id !== session.hostId) return;
      if (session.roundActive) return;
      if (session.players.size < 2) return;
      await beginRound(panelMsg);
      return;
    }

    if (id === "vnd_next") {
      if (i.user.id !== session.hostId) return;
      if (session.roundActive) return;
      if (session.players.size < 2) return;
      await beginRound(panelMsg);
      return;
    }

    if (id === "vnd_end") {
      if (i.user.id !== session.hostId) return;
      collector.stop("ended");
      await endGame(panelMsg);
      return;
    }

    // Voting buttons: vnd_vote_<userid>
    if (id.startsWith("vnd_vote_")) {
      if (session.state !== "voting") return;
      if (!session.players.has(i.user.id)) return; // must be joined

      const votedId = id.replace("vnd_vote_", "");
      session.roundVotesByVoterId[i.user.id] = votedId;

      // End early if everyone voted
      const voters = [...session.players.keys()];
      const votedCount = voters.filter((uid) => session.roundVotesByVoterId[uid]).length;

      if (votedCount >= voters.length) {
        await finishRound(panelMsg);
      }

      return;
    }
  });

  collector.on("end", async () => {
    // if ended naturally, just clear session
    if (session?.panelMessageId === panelMsg.id) {
      session = null;
      try {
        await panelMsg.edit({ components: [] });
      } catch {}
    }
  });
}

module.exports = {
  id: "votendrink",
  name: "Vote & Drink",
  startFromHub,
};
