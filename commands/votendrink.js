const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const QUESTIONS = require("../data/voteQuestions_spicy");

const ALLOWED_CHANNEL = "1449217901306581074";

// In-memory session (simple + reliable)
let session = null;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("votendrink")
    .setDescription("Start a Vote & Drink game")
    .addSubcommand(sub =>
      sub.setName("start").setDescription("Start a Vote & Drink game")
    )
    .addSubcommand(sub =>
      sub.setName("next").setDescription("Next round")
    )
    .addSubcommand(sub =>
      sub.setName("stop").setDescription("Stop the game")
    ),

  async execute(interaction) {
    if (interaction.channelId !== ALLOWED_CHANNEL) {
      return interaction.reply({
        content: "❌ This game can only be played in the designated channel.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // START
    if (sub === "start") {
      if (session) {
        return interaction.reply({
          content: "⚠️ A Vote & Drink game is already running.",
          ephemeral: true,
        });
      }

      session = {
        players: interaction.channel.members
          .filter(m => !m.user.bot)
          .map(m => m.user),
        votes: {},
        messageId: null,
        question: null,
      };

      if (session.players.length < 2) {
        session = null;
        return interaction.reply({
          content: "❌ Not enough players (need at least 2).",
          ephemeral: true,
        });
      }

      await interaction.reply("🍻 **Vote & Drink has started!**");

      return startRound(interaction);
    }

    // NEXT
    if (sub === "next") {
      if (!session) {
        return interaction.reply({
          content: "❌ No game running.",
          ephemeral: true,
        });
      }
      return startRound(interaction);
    }

    // STOP
    if (sub === "stop") {
      session = null;
      return interaction.reply("🛑 **Vote & Drink has ended.**");
    }
  },
};

async function startRound(interaction) {
  session.votes = {};
  session.question =
    QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink")
    .setDescription(`**${session.question}**\n\nVote below 👇`)
    .setColor(0x8e44ad);

  const rows = [];
  let row = new ActionRowBuilder();

  session.players.forEach((user, i) => {
    if (i > 0 && i % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`vote_${user.id}`)
        .setLabel(user.username)
        .setStyle(ButtonStyle.Primary)
    );
  });

  rows.push(row);

  const msg = await interaction.channel.send({
    embeds: [embed],
    components: rows,
  });

  session.messageId = msg.id;

  const collector = msg.createMessageComponentCollector({
    time: 30000,
  });

  collector.on("collect", async i => {
    if (!session) return;

    session.votes[i.user.id] =
      session.votes[i.user.id] || i.customId.replace("vote_", "");

    await i.reply({ content: "✅ Vote counted!", ephemeral: true });
  });

  collector.on("end", async () => {
    if (!session) return;

    const tally = {};
    Object.values(session.votes).forEach(v => {
      tally[v] = (tally[v] || 0) + 1;
    });

    if (Object.keys(tally).length === 0) {
      await msg.edit({
        embeds: [
          embed.setDescription(`**${session.question}**\n\n❌ No votes cast.`),
        ],
        components: [],
      });
      return;
    }

    const maxVotes = Math.max(...Object.values(tally));
    const losers = Object.keys(tally).filter(id => tally[id] === maxVotes);

    const sips = Math.floor(Math.random() * 3) + 1;
    const mentions = losers.map(id => `<@${id}>`).join(", ");

    await msg.edit({
      embeds: [
        embed.setDescription(
          `**${session.question}**\n\n🍺 ${mentions} drink **${sips} sip(s)**!`
        ),
      ],
      components: [],
    });
  });
}
