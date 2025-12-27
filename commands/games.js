// commands/games.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const { getActiveGame } = require("../utils/gamesHubState");
const registry = require("../data/games/registry");

// In-memory board tracking (per process)
const boards = new Map(); // channelId -> { messageId, collector }

function buildBoardEmbed(channelId) {
  const active = getActiveGame(channelId);

  const status = active
    ? `🟡 **Active:** ${active.type} — **${active.state || "active"}**`
    : "🟢 **No active game in this channel**";

  const lines = registry.games.map((g) => {
    const hint = g.hint ? ` — ${g.hint}` : "";
    return `${g.emoji || "🎮"} **${g.label}**${hint}`;
  });

  return new EmbedBuilder()
    .setTitle("🎰 Rubicon Royal — Games Hub")
    .setDescription(
      `${status}\n\n` +
      `**Available Games:**\n` +
      `${lines.join("\n")}\n\n` +
      `Use the buttons below to launch a game in this channel.`
    );
}

function buildBoardComponents(disabled = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("games:launch:blackjack")
      .setLabel("Blackjack")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("games:launch:roulette")
      .setLabel("Roulette")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("games:refresh")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("games:close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );

  return [row];
}

async function upsertBoardMessage(interaction) {
  const channelId = interaction.channelId;
  const embed = buildBoardEmbed(channelId);
  const components = buildBoardComponents(false);

  const existing = boards.get(channelId);
  let msg = null;

  if (existing?.messageId) {
    try {
      msg = await interaction.channel.messages.fetch(existing.messageId);
      await msg.edit({ embeds: [embed], components });
    } catch {
      msg = null;
    }
  }

  if (!msg) {
    msg = await interaction.channel.send({ embeds: [embed], components });
    boards.set(channelId, { messageId: msg.id, collector: null });
  }

  // Ensure collector is attached for this board message
  const rec = boards.get(channelId);
  if (!rec.collector) {
    const collector = msg.createMessageComponentCollector({ time: 12 * 60 * 60_000 }); // 12h
    rec.collector = collector;

    collector.on("collect", async (i) => {
      // Only handle buttons on THIS hub message
      if (i.message.id !== msg.id) return;

      await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

      const active = getActiveGame(channelId);

      // Permissions for close
      const canClose =
        i.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels) ||
        i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);

      const [prefix, action, gameKey] = String(i.customId || "").split(":");
      if (prefix !== "games") return;

      if (action === "refresh") {
        await msg.edit({ embeds: [buildBoardEmbed(channelId)], components: buildBoardComponents(false) }).catch(() => {});
        return i.editReply("🔄 Refreshed.");
      }

      if (action === "close") {
        if (!canClose) return i.editReply("❌ You need **Manage Channels** (or Admin) to close the hub panel.");
        try {
          collector.stop("closed");
        } catch {}
        boards.delete(channelId);
        await msg.delete().catch(() => {});
        return i.editReply("🗑️ Games hub closed.");
      }

      if (action === "launch") {
        if (active) {
          return i.editReply(`❌ There’s already an active game in this channel: **${active.type}** (${active.state}).`);
        }

        if (gameKey === "blackjack") {
          const bj = require('../data/games/blackjack');
          if (typeof bj.startFromHub !== "function") {
            return i.editReply("❌ Blackjack is not hub-enabled yet (missing startFromHub export).");
          }
          // startFromHub handles its own panel + collector
          await i.editReply("🃏 Launching Blackjack…");
          return bj.startFromHub(i);
        }

        if (gameKey === "roulette") {
          const rou = require('../data/games/roulette');
          if (typeof rou.startFromHub !== "function") {
            return i.editReply("❌ Roulette is not hub-enabled yet (missing startFromHub export).");
          }
          await i.editReply("🎡 Launching Roulette…");
          return rou.startFromHub(i);
        }

        return i.editReply("❌ Unknown game.");
      }
    });

    collector.on("end", async () => {
      // Best-effort: disable buttons rather than deleting
      try {
        await msg.edit({ components: buildBoardComponents(true) });
      } catch {}
      const cur = boards.get(channelId);
      if (cur?.collector === collector) boards.delete(channelId);
    });
  }

  return msg;
}

// Expose a safe internal helper so legacy commands can "reroute" users
// into the hub flow without duplicating hub logic.
async function ensureHub(interaction) {
  try {
    return await upsertBoardMessage(interaction);
  } catch {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("games")
    .setDescription("Open the Games Hub panel for this channel."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Slash feedback is ephemeral, board is a normal message
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    await upsertBoardMessage(interaction);

    return interaction.editReply("✅ Games hub posted/updated in this channel.");
  },
};

// Internal helper (not a slash command export) used by legacy wrappers.
module.exports.ensureHub = ensureHub;
