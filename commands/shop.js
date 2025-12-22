// commands/shop.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const {
  listStoreItems,
  getStoreItem,
  purchaseItem,
  listSellableItems,
  sellItem,
} = require("../utils/store");

const { guardNotJailed } = require("../utils/jail");

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function formatDuration(sec) {
  sec = Math.max(0, Number(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse, buy, and sell items from the server shop.")
    .addStringOption((opt) =>
      opt
        .setName("view")
        .setDescription("Choose Buy or Sell")
        .addChoices({ name: "Buy", value: "buy" }, { name: "Sell", value: "sell" })
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("item")
        .setDescription("Item ID (buy or sell)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("qty")
        .setDescription("Quantity to buy/sell")
        .setMinValue(1)
        .setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const view = interaction.options.getString("view", false) || "buy";
    const itemIdRaw = interaction.options.getString("item", false);
    const qty = interaction.options.getInteger("qty", false);

    // =========================
    // SELL VIEW
    // =========================
    if (view === "sell") {
      // Direct sell: /shop view:sell item:<id> qty:<n>
      if (itemIdRaw && qty) {
        const itemId = itemIdRaw.trim();
        const res = await sellItem(guildId, userId, itemId, qty, { via: "shop_command_direct" });

        if (!res.ok) {
          if (res.reason === "not_sellable") return interaction.editReply("❌ That item is not sellable.");
          if (res.reason === "not_owned") return interaction.editReply("❌ You don’t own that item.");
          if (res.reason === "insufficient_qty") {
            return interaction.editReply(`❌ You only have **${res.owned}** of that item.`);
          }
          return interaction.editReply("❌ Could not sell that item.");
        }

        return interaction.editReply(
          `✅ Sold **${res.qtySold}x** \`${itemId}\` for **${money(res.total)}**.`
        );
      }

      // Interactive sell menu
      let sellables = await listSellableItems(guildId, userId);

      if (!sellables.length) {
        const embed = new EmbedBuilder()
          .setTitle("💰 Sell Items")
          .setDescription("You have no sellable items right now.")
          .setFooter({ text: "Sellable items are usually loot (fish, gems, etc.)." });

        return interaction.editReply({ embeds: [embed] });
      }

      let idx = 0;

      const render = () => {
        sellables = sellables.filter((x) => Number(x.qty || 0) > 0);
        if (!sellables.length) {
          return {
            embeds: [
              new EmbedBuilder()
                .setTitle("💰 Sell Items")
                .setDescription("You have no sellable items right now.")
                .setFooter({ text: "Sellable items are usually loot (fish, gems, etc.)." }),
            ],
            components: [],
          };
        }

        idx = Math.max(0, Math.min(idx, sellables.length - 1));
        const it = sellables[idx];

        const embed = new EmbedBuilder()
          .setTitle("💰 Sell Items")
          .setDescription(
            [
              `**${it.name}**`,
              `ID: \`${it.item_id}\``,
              `Owned: **${Number(it.qty || 0).toLocaleString()}**`,
              `Sell price: **${money(it.sell_price)}** each`,
              ``,
              `Total (all): **${money(Number(it.sell_price) * Number(it.qty || 0))}**`,
            ].join("\n")
          )
          .setFooter({ text: `Item ${idx + 1} of ${sellables.length}` });

        const prev = new ButtonBuilder()
          .setCustomId("shop_sell:prev")
          .setLabel("◀")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(sellables.length <= 1);

        const next = new ButtonBuilder()
          .setCustomId("shop_sell:next")
          .setLabel("▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(sellables.length <= 1);

        const sell1 = new ButtonBuilder()
          .setCustomId("shop_sell:sell:1")
          .setLabel("Sell 1")
          .setStyle(ButtonStyle.Success);

        const sell5 = new ButtonBuilder()
          .setCustomId("shop_sell:sell:5")
          .setLabel("Sell 5")
          .setStyle(ButtonStyle.Success)
          .setDisabled(Number(it.qty || 0) < 5);

        const sellAll = new ButtonBuilder()
          .setCustomId("shop_sell:sell:all")
          .setLabel("Sell All")
          .setStyle(ButtonStyle.Success);

        const custom = new ButtonBuilder()
          .setCustomId("shop_sell:custom")
          .setLabel("Custom…")
          .setStyle(ButtonStyle.Primary);

        const close = new ButtonBuilder()
          .setCustomId("shop_sell:close")
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger);

        const row1 = new ActionRowBuilder().addComponents(prev, next, custom, close);
        const row2 = new ActionRowBuilder().addComponents(sell1, sell5, sellAll);

        return { embeds: [embed], components: [row1, row2] };
      };

      const msg = await interaction.editReply({ ...render(), fetchReply: true }).catch(() => null);
      if (!msg) return;

      const collector = msg.createMessageComponentCollector({ time: 5 * 60 * 1000 });

      const refreshSellables = async () => {
        sellables = await listSellableItems(guildId, userId);
        if (idx >= sellables.length) idx = Math.max(0, sellables.length - 1);
      };

      collector.on("collect", async (btn) => {
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This menu isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        await btn.deferUpdate().catch(() => {});

        if (btn.customId === "shop_sell:close") {
          collector.stop("closed");
          return;
        }

        if (btn.customId === "shop_sell:prev") idx = Math.max(0, idx - 1);
        if (btn.customId === "shop_sell:next") idx = Math.min(sellables.length - 1, idx + 1);

        if (btn.customId.startsWith("shop_sell:sell:")) {
          const cur = sellables[idx];
          if (!cur) {
            await refreshSellables();
            return interaction.editReply(render()).catch(() => {});
          }

          const arg = btn.customId.split(":")[2];
          const amount = arg === "all" ? Number(cur.qty || 0) : Number(arg || 1);

          const res = await sellItem(guildId, userId, cur.item_id, amount, { via: "shop_sell_menu" });

          if (!res.ok) {
            let msgTxt = "❌ Could not sell that item.";
            if (res.reason === "not_sellable") msgTxt = "❌ That item is not sellable.";
            if (res.reason === "not_owned") msgTxt = "❌ You don’t own that item.";
            if (res.reason === "insufficient_qty") msgTxt = `❌ You only have **${res.owned}**.`;
            await interaction.followUp({ content: msgTxt, flags: MessageFlags.Ephemeral }).catch(() => {});
          } else {
            await interaction.followUp({
              content: `✅ Sold **${res.qtySold}x** \`${cur.item_id}\` for **${money(res.total)}**.`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }

          await refreshSellables();
        }

        if (btn.customId === "shop_sell:custom") {
          const cur = sellables[idx];
          if (!cur) {
            await refreshSellables();
            return interaction.editReply(render()).catch(() => {});
          }

          const modal = new ModalBuilder()
            .setCustomId("shop_sell_modal")
            .setTitle("Sell Custom Amount");

          const input = new TextInputBuilder()
            .setCustomId("amount")
            .setLabel(`How many to sell? (Max ${Number(cur.qty || 0)})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("e.g. 12");

          modal.addComponents(new ActionRowBuilder().addComponents(input));

          await btn.showModal(modal).catch(() => {});

          const submitted = await btn.awaitModalSubmit({
            time: 30 * 1000,
            filter: (m) => m.user.id === userId && m.customId === "shop_sell_modal",
          }).catch(() => null);

          if (submitted) {
            await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const raw = submitted.fields.getTextInputValue("amount");
            const n = Math.floor(Number(raw));

            if (!Number.isFinite(n) || n <= 0) {
              await submitted.editReply("❌ Please enter a valid positive number.").catch(() => {});
            } else {
              const amt = Math.min(n, Number(cur.qty || 0));
              const res = await sellItem(guildId, userId, cur.item_id, amt, { via: "shop_sell_custom" });

              if (!res.ok) {
                let msgTxt = "❌ Could not sell that item.";
                if (res.reason === "not_sellable") msgTxt = "❌ That item is not sellable.";
                if (res.reason === "not_owned") msgTxt = "❌ You don’t own that item.";
                if (res.reason === "insufficient_qty") msgTxt = `❌ You only have **${res.owned}**.`;
                await submitted.editReply(msgTxt).catch(() => {});
              } else {
                await submitted.editReply(`✅ Sold **${res.qtySold}x** \`${cur.item_id}\` for **${money(res.total)}**.`).catch(() => {});
              }

              await refreshSellables();
            }
          }
        }

        await interaction.editReply(render()).catch(() => {});
      });

      collector.on("end", async () => {
        await interaction.editReply({ ...render(), components: [] }).catch(() => {});
      });

      return;
    }

    // =========================
    // BUY VIEW (your existing behavior)
    // =========================

    // /shop -> LIST
    if (!itemIdRaw) {
      const items = await listStoreItems(guildId, { enabledOnly: true });
      if (!items.length) return interaction.editReply("🛒 Shop is empty.");

      const lines = items.slice(0, 20).map((it) => {
        const daily = Number(it.daily_stock || 0);
        const stockLabel = daily > 0 ? `daily:${daily}` : `stock:∞`;
        return `• **${it.name}** — \`${it.item_id}\` — ${money(it.price)} — ${stockLabel}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🛒 Rubicon Royal Store")
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Use /shop item:<id> for details • /shop item:<id> qty:<n> to buy • /shop view:sell to sell" });

      return interaction.editReply({ embeds: [embed] });
    }

    const itemId = itemIdRaw.trim();

    // /shop item:<id>  -> INFO
    // /shop item:<id> qty:<n> -> BUY
    if (!qty) {
      const item = await getStoreItem(guildId, itemId);
      if (!item || !item.enabled) return interaction.editReply("❌ That item doesn’t exist (or is not for sale).");

      const maxOwned = Number(item.max_owned || 0);
      const maxUses = Number(item.max_uses || 0);
      const maxEver = Number(item.max_purchase_ever || 0);
      const cd = Number(item.cooldown_seconds || 0);
      const daily = Number(item.daily_stock || 0);

      const limits = [];
      if (maxOwned > 0) limits.push(`max_owned: ${maxOwned}`);
      if (maxUses > 0) limits.push(`uses: ${maxUses}`);
      if (maxEver > 0) limits.push(`ever: ${maxEver}`);
      if (cd > 0) limits.push(`cooldown: ${formatDuration(cd)}`);
      if (daily > 0) limits.push(`daily_stock: ${daily}`);

      const embed = new EmbedBuilder()
        .setTitle(`🛒 ${item.name}`)
        .setDescription(item.description || "_No description_")
        .addFields(
          { name: "Item ID", value: `\`${item.item_id}\``, inline: true },
          { name: "Price", value: money(item.price), inline: true },
          { name: "Kind", value: String(item.kind || "item"), inline: true },
          { name: "Limits", value: limits.length ? limits.join(" • ") : "none", inline: false }
        )
        .setFooter({ text: "Buy with /shop item:<id> qty:<n>" });

      return interaction.editReply({ embeds: [embed] });
    }

    // BUY
    const res = await purchaseItem(guildId, userId, itemId, qty, { via: "shop_command" });

    if (!res.ok) {
      if (res.reason === "not_found") return interaction.editReply("❌ That item doesn’t exist (or is not for sale).");
      if (res.reason === "insufficient_funds") {
        return interaction.editReply(`❌ Not enough balance. Your balance is **${money(res.balance)}**.`);
      }
      if (res.reason === "max_owned") {
        return interaction.editReply("❌ You already have the maximum allowed amount of that item.");
      }
      if (res.reason === "max_purchase_ever") {
        return interaction.editReply("❌ That item is a one-time purchase, and you’ve already bought it.");
      }
      if (res.reason === "cooldown") {
        return interaction.editReply(`⏳ You can buy that again in **${formatDuration(res.retryAfterSec)}**.`);
      }
      if (res.reason === "sold_out_daily") {
        return interaction.editReply("❌ Sold out for today.");
      }
      return interaction.editReply("❌ Purchase failed.");
    }

    return interaction.editReply(
      `✅ Bought **${res.qtyBought}x** \`${res.item.item_id}\` for **${money(res.totalPrice)}**. New balance: **${money(res.newBalance)}**.`
    );
  },
};
