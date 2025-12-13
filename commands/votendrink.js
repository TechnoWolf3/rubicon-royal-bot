const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const QUESTIONS = require("../data/voteQuestions_spicy");

const ALLOWED_CHANNEL = "1449217901306581074";

// One in-memory session (simple + reliable)
let session = null;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("votendrink")
    .setDescription("Vote & Drink party game")
    .addSubcommand((sub) =>
      sub.setName("start").setDescription("Start a Vote & Drink game")
    )
    .addSubcommand((sub) =>
      sub.setName("next").setDescription("Start the next round")
    )
    .addSubcommand((sub) =>
      sub.setName("stop").setDescription("Stop the current game")
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

      // Snapshot current non-bot members in the channel at start time
      const players = interaction.channel.members
        .filter((m) => !m.user.bot)
        .map((m) => m.user);

      if (players.length < 2) {
        return interaction.reply({
          content: "❌ Not enough players (need at least 2).",
          ephemeral: true,
        });
      }

      session = {
        players,
        votesByVoterId: {},      // { voterUserId: votedUserId }
        usedQuestions: [],       // deck behaviour (no repeats)
        activeMessageId: null,
        activeQuestion: null,
      };

      await interaction.reply("🍻 **Vote & Drink has started!**");
      return startRound(interaction);
    }

    if (sub === "next") {
      if (!session) {
        return interaction.reply({
          content: "❌ No game running. Use `/votendrink start` first.",
          ephemeral: true,
        });
      }
      await interaction.reply({ content: "▶️ **Starting next round...**", ephemeral: true });
      return startRound(interaction);
    }

    if (sub === "stop") {
      if (!session) {
        return interaction.reply({
          content: "❌ No game running.",
          ephemeral: true,
        });
      }

      session = null;
      return interaction.reply("🛑 **Vote & Drink has ended.**");
    }
  },
};

function pickNextQuestion() {
  // Avoid repeats until the whole pack is exhausted
  const available = QUESTIONS.filter((q) => !session.usedQuestions.includes(q));
  const pool = available.length ? available : QUESTIONS;

  const chosen = pool[Math.floor(Math.random() * pool.length)];

  // If we exhausted the deck, reset usedQuestions and start again
  if (!available.length) session.usedQuestions = [];

  session.usedQuestions.push(chosen);
  return chosen;
}

function buildVoteComponents(players) {
  // Discord buttons: max 5 rows, 5 buttons per row (25 max)
  // You said 2–10 players, so this is safely within limits.
  const rows = [];
  let row = new ActionRowBuilder();

  players.forEach((user, idx) => {
    if (idx > 0 && idx % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`votendrink_vote_${user.id}`)
        .setLabel(user.username)
        .setStyle(ButtonStyle.Primary)
    );
  });

  rows.push(row);
  return rows;
}

async function startRound(interaction) {
  // Reset votes
  session.votesByVoterId = {};
  session.activeQuestion = pickNextQuestion();

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink")
    .setDescription(`**${session.activeQuestion}**\n\nVote below 👇`)
    .setColor(0x8e44ad)
    .setFooter({ text: "Voting ends in 30 seconds" });

  const components = buildVoteComponents(session.players);

  const msg = await interaction.channel.send({
    embeds: [embed],
    components,
  });

  session.activeMessageId = msg.id;

  const collector = msg.createMessageComponentCollector({ time: 30_000 });

  collector.on("collect", async (btn) => {
    if (!session) return btn.reply({ content: "Game ended.", ephemeral: true });
    if (btn.message.id !== session.activeMessageId) {
      return btn.reply({ content: "That round is no longer active.", ephemeral: true });
    }

    const votedUserId = btn.customId.replace("votendrink_vote_", "");

    // (Optional) prevent voting for yourself — if you want this, uncomment below:
    // if (btn.user.id === votedUserId) {
    //   return btn.reply({ content: "❌ You can't vote for yourself.", ephemeral: true });
    // }

    session.votesByVoterId[btn.user.id] = votedUserId;
    return btn.reply({ content: "✅ Vote counted!", ephemeral: true });
  });

  collector.on("end", async () => {
    if (!session) return;

    // Tally votes
    const tally = {}; // { votedUserId: count }
    for (const votedUserId of Object.values(session.votesByVoterId)) {
      tally[votedUserId] = (tally[votedUserId] || 0) + 1;
    }

    // No votes cast
    if (Object.keys(tally).length === 0) {
      const noVoteEmbed = EmbedBuilder.from(embed).setDescription(
        `**${session.activeQuestion}**\n\n❌ No votes were cast.`
      );

      await msg.edit({ embeds: [noVoteEmbed], components: [] });
      return;
    }

    const maxVotes = Math.max(...Object.values(tally));
    const losers = Object.keys(tally).filter((id) => tally[id] === maxVotes);

    // Random but reasonable: 1–3 sips, with a small chance of 4
    const sips = Math.random() < 0.15 ? 4 : Math.floor(Math.random() * 3) + 1;

    const mentions = losers.map((id) => `<@${id}>`).join(", ");
    const resultsLines = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // keep it tidy
      .map(([id, count]) => `• <@${id}> — **${count}** vote(s)`)
      .join("\n");

    const resultEmbed = EmbedBuilder.from(embed).setDescription(
      `**${session.activeQuestion}**\n\n` +
      `📊 **Results:**\n${resultsLines}\n\n` +
      `🍺 ${mentions} drink **${sips} sip(s)**!` +
      (losers.length > 1 ? " (Tie rule)" : "")
    );

    await msg.edit({ embeds: [resultEmbed], components: [] });
  });
}
