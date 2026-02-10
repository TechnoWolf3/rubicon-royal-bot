// commands/games.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const { getActiveGame } = require("../utils/gamesHubState");
const { loadCategories, getCategory, getGame } = require("../data/games");
const gamesConfig = require("../data/games/config");

const CAT_SELECT_ID = "games:cat";
const GAME_SELECT_ID = "games:game";
const BTN_HOME_ID = "games:home";
const BTN_BACK_ID = "games:back";
const BTN_REFRESH_ID = "games:refresh";
const BTN_CLOSE_ID = "games:close";

// per-channel single panel message tracking
const panels = new Map(); // channelId -> { messageId, collector, view, catId }

function statusLine(channelId) {
  const active = getActiveGame(channelId);
  return active
    ? `🟡 **Active:** ${active.type} — **${active.state || "active"}**`
    : "🟢 **No active game in this channel**";
}

function buildHomeEmbed(channelId, categories) {
  const embed = new EmbedBuilder()
    .setTitle(gamesConfig.title)
    .setDescription(`${gamesConfig.description}\n\n${statusLine(channelId)}`);

  for (const c of categories) {
    embed.addFields({
      name: `${c.emoji || "🎮"} ${c.name}`,
      value: `${c.description || "—"}\n**Games:** ${c.games?.length || 0}`,
      inline: true,
    });
  }

  return embed;
}

function buildCategoryEmbed(channelId, cat) {
  const list = (cat.games?.length || 0)
    ? cat.games
        .map((g) => `${g.emoji || "🎮"} **${g.name}** — ${g.description || "—"}`)
        .join("\n")
    : "_No games in this category yet._";

  return new EmbedBuilder()
    .setTitle(`${cat.emoji || "🎮"} ${cat.name}`)
    .setDescription(`${statusLine(channelId)}\n\n${cat.description || ""}\n\n**Available:**\n${list}`);
}

function buildCategorySelect(categories) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CAT_SELECT_ID)
      .setPlaceholder("Choose a category…")
      .addOptions(
        categories.map((c) => ({
          label: c.name,
          value: c.id,
          description: (c.description || "View games").slice(0, 100),
          emoji: c.emoji,
        }))
      )
  );
}

function buildGameSelect(cat) {
  const games = cat.games || [];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(GAME_SELECT_ID)
      .setPlaceholder(games.length ? "Choose a game…" : "No games available")
      .setDisabled(games.length === 0)
      .addOptions(
        games.map((g) => ({
          label: g.name,
          value: g.id,
          description: (g.description || "Launch").slice(0, 100),
          emoji: g.emoji,
        }))
      )
  );
}

function buildButtons({ showBack }) {
  const row = new ActionRowBuilder();

  if (showBack) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_BACK_ID)
        .setLabel("Back")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_HOME_ID)
      .setLabel("Home")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(BTN_REFRESH_ID)
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(BTN_CLOSE_ID)
      .setLabel("Close")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  return row;
}

async function upsertPanel(interaction) {
  const channelId = interaction.channelId;
  const categories = loadCategories();

  const embed = buildHomeEmbed(channelId, categories);
  const components = [buildCategorySelect(categories), buildButtons({ showBack: false })];

  const existing = panels.get(channelId);
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
    panels.set(channelId, { messageId: msg.id, collector: null, view: "home", catId: null });
  }

  // Attach collector once
  const rec = panels.get(channelId);
  if (!rec.collector) {
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.MessageComponent,
      idle: (gamesConfig.idleMinutes || 30) * 60 * 1000,
    });
    rec.collector = collector;

    collector.on("collect", async (i) => {
      if (i.message.id !== msg.id) return;

      const categoriesNow = loadCategories();
      const canClose =
        i.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels) ||
        i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);

      try {
        // close
        if (i.customId === BTN_CLOSE_ID) {
          if (!canClose) {
            return i.reply({
              content: "❌ You need **Manage Channels** (or Admin) to close the hub panel.",
              flags: MessageFlags.Ephemeral,
            });
          }

          collector.stop("closed");
          panels.delete(channelId);

          await msg.delete().catch(async () => {
            await msg.edit({ components: [] }).catch(() => {});
          });

          return i.reply({ content: "🗑️ Games hub closed.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // refresh
        if (i.customId === BTN_REFRESH_ID) {
          await i.deferUpdate().catch(() => {});
          const state = panels.get(channelId);

          if (!state || state.view === "home") {
            return msg.edit({
              embeds: [buildHomeEmbed(channelId, categoriesNow)],
              components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
            });
          }

          const cat = getCategory(categoriesNow, state.catId);
          if (!cat) {
            state.view = "home";
            state.catId = null;
            return msg.edit({
              embeds: [buildHomeEmbed(channelId, categoriesNow)],
              components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
            });
          }

          return msg.edit({
            embeds: [buildCategoryEmbed(channelId, cat)],
            components: [buildGameSelect(cat), buildButtons({ showBack: true })],
          });
        }

        // home/back
        if (i.customId === BTN_HOME_ID || i.customId === BTN_BACK_ID) {
          await i.deferUpdate().catch(() => {});
          const state = panels.get(channelId);
          if (state) {
            state.view = "home";
            state.catId = null;
          }

          return msg.edit({
            embeds: [buildHomeEmbed(channelId, categoriesNow)],
            components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
          });
        }

        // category select
        if (i.customId === CAT_SELECT_ID) {
          await i.deferUpdate().catch(() => {});
          const catId = i.values?.[0];
          const cat = getCategory(categoriesNow, catId);
          if (!cat) return;

          const state = panels.get(channelId);
          if (state) {
            state.view = "cat";
            state.catId = cat.id;
          }

          return msg.edit({
            embeds: [buildCategoryEmbed(channelId, cat)],
            components: [buildGameSelect(cat), buildButtons({ showBack: true })],
          });
        }

        // game select
        if (i.customId === GAME_SELECT_ID) {
          await i.deferUpdate().catch(() => {});
          const state = panels.get(channelId);
          if (!state?.catId) return;

          const cat = getCategory(categoriesNow, state.catId);
          if (!cat) return;

          const gameId = i.values?.[0];
          const game = getGame(cat, gameId);
          if (!game) return;

          const active = getActiveGame(channelId);
          if (active) {
            return i.followUp({
              content: `❌ There’s already an active game in this channel: **${active.type}** (${active.state}).`,
              flags: MessageFlags.Ephemeral,
            });
          }

          if (typeof game.run !== "function") {
            return i.followUp({
              content: `❌ **${game.name}** isn’t hub-enabled yet.`,
              flags: MessageFlags.Ephemeral,
            });
          }

          await i.followUp({
            content: `${game.emoji || "🎮"} Launching **${game.name}**…`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});

          await game.run(i, { reuseMessage: msg }).catch((e) => {
            console.error("[games] launch error:", e);
          });

          // refresh view after launch
          const fresh = panels.get(channelId);
          if (!fresh || fresh.view === "home") {
            return msg.edit({
              embeds: [buildHomeEmbed(channelId, categoriesNow)],
              components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
            }).catch(() => {});
          }

          const freshCat = getCategory(categoriesNow, fresh.catId);
          if (!freshCat) return;

          return msg.edit({
            embeds: [buildCategoryEmbed(channelId, freshCat)],
            components: [buildGameSelect(freshCat), buildButtons({ showBack: true })],
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[games] panel error:", e);
        try {
          if (!i.deferred && !i.replied) {
            await i.reply({ content: "❌ Something went wrong.", flags: MessageFlags.Ephemeral });
          }
        } catch {}
      }
    });

    collector.on("end", async () => {
      try {
        await msg.edit({ components: [] });
      } catch {}
      const cur = panels.get(channelId);
      if (cur?.collector === collector) panels.delete(channelId);
    });
  }

  return msg;
}

// Internal helper for rerouting (like your old pattern)
async function ensureHub(interaction) {
  try {
    return await upsertPanel(interaction);
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    await upsertPanel(interaction);

    return interaction.editReply("✅ Games hub posted/updated in this channel.");
  },
};

module.exports.ensureHub = ensureHub;
