// utils/blackjackSession.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardStr(c) {
  if (!c) return "?";
  return `${c.r}${c.s}`;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === "A") { aces++; total += 11; }
    else if (["K","Q","J"].includes(c.r)) total += 10;
    else total += parseInt(c.r, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

class BlackjackSession {
  constructor({ channel, hostId }) {
    this.channel = channel;
    this.hostId = hostId;

    this.state = "lobby"; // lobby | playing | ended
    this.players = new Map(); // userId -> { user, hand, status }
    this.turnOrder = [];
    this.turnIndex = 0;

    this.dealerHand = [];
    this.deck = makeDeck();

    this.message = null;
    this.gameId = `${Date.now()}`;
    this.timeout = null;

    this.maxPlayers = 10;
  }

  isHost(userId) { return userId === this.hostId; }
  currentPlayerId() { return this.turnOrder[this.turnIndex] ?? null; }

  addPlayer(user) {
    if (this.state !== "lobby") return { ok:false, msg:"Game already started." };
    if (this.players.has(user.id)) return { ok:false, msg:"You’re already in." };
    if (this.players.size >= this.maxPlayers) return { ok:false, msg:"Game is full (6 players)." };
    this.players.set(user.id, { user, hand: [], status: "Waiting" });
    return { ok:true };
  }

  removePlayer(userId) {
    if (!this.players.has(userId)) return { ok:false, msg:"You’re not in the game." };
    if (this.state !== "lobby") return { ok:false, msg:"Can’t leave after start (host can end)." };
    this.players.delete(userId);
    return { ok:true };
  }

  draw() {
    if (this.deck.length === 0) this.deck = makeDeck();
    return this.deck.pop();
  }

  dealInitial() {
    this.dealerHand = [this.draw(), this.draw()];

    for (const [id, p] of this.players.entries()) {
      p.hand = [this.draw(), this.draw()];
      const v = handValue(p.hand);
      p.status = (v === 21) ? "Blackjack" : "Playing";
    }

    this.turnOrder = [...this.players.keys()].filter(id => this.players.get(id).status === "Playing");
    this.turnIndex = 0;
  }

  async start() {
    if (this.state !== "lobby") return;
    if (this.players.size < 1) return;

    this.state = "playing";
    this.dealInitial();

    if (this.turnOrder.length === 0) {
      await this.resolveDealerAndFinish();
      return;
    }

    await this.updatePanel();
    this.armTurnTimeout();
  }

  armTurnTimeout() {
    if (this.timeout) clearTimeout(this.timeout);

    this.timeout = setTimeout(async () => {
      const pid = this.currentPlayerId();
      if (!pid) return;

      const p = this.players.get(pid);
      if (p && p.status === "Playing") p.status = "Stood";

      await this.advanceTurn();
    }, 60_000);
  }

  async hit(userId) {
    if (this.state !== "playing") return { ok:false, msg:"Game not active." };
    if (userId !== this.currentPlayerId()) return { ok:false, msg:"Not your turn." };

    const p = this.players.get(userId);
    if (!p || p.status !== "Playing") return { ok:false, msg:"You can’t hit right now." };

    p.hand.push(this.draw());
    const v = handValue(p.hand);

    if (v > 21) p.status = "Busted";
    else if (v === 21) p.status = "Stood";

    await this.advanceTurn();
    return { ok:true, player:p };
  }

  async stand(userId) {
    if (this.state !== "playing") return { ok:false, msg:"Game not active." };
    if (userId !== this.currentPlayerId()) return { ok:false, msg:"Not your turn." };

    const p = this.players.get(userId);
    if (!p || p.status !== "Playing") return { ok:false, msg:"You can’t stand right now." };

    p.status = "Stood";
    await this.advanceTurn();
    return { ok:true, player:p };
  }

  async advanceTurn() {
    if (this.timeout) clearTimeout(this.timeout);

    while (this.turnIndex < this.turnOrder.length) {
      const pid = this.turnOrder[this.turnIndex];
      const p = this.players.get(pid);
      if (!p || p.status !== "Playing") this.turnIndex++;
      else break;
    }

    if (this.turnIndex >= this.turnOrder.length) {
      await this.resolveDealerAndFinish();
      return;
    }

    await this.updatePanel();
    this.armTurnTimeout();
  }

  async resolveDealerAndFinish() {
    let dv = handValue(this.dealerHand);
    while (dv < 17) {
      this.dealerHand.push(this.draw());
      dv = handValue(this.dealerHand);
    }

    this.state = "ended";
    await this.updatePanel(true);

    await this.channel.send({ embeds: [this.resultsEmbed()] });

    setTimeout(() => {
      this.message?.delete().catch(() => {});
    }, 60_000);
  }

  resultsEmbed() {
    const dv = handValue(this.dealerHand);
    const dealerLine = `${this.dealerHand.map(cardStr).join(" ")} (**${dv}**)`;

    const lines = [];
    for (const p of this.players.values()) {
      const pv = handValue(p.hand);
      const name = p.user.toString();

      let outcome = "";
      if (p.status === "Busted") outcome = "❌ Bust";
      else if (pv === 21 && p.hand.length === 2) outcome = "🟣 Blackjack";
      else if (dv > 21) outcome = "✅ Win (dealer bust)";
      else if (pv > dv) outcome = "✅ Win";
      else if (pv < dv) outcome = "❌ Lose";
      else outcome = "🤝 Push";

      lines.push(`${name}: **${pv}** — ${outcome}`);
    }

    return new EmbedBuilder()
      .setTitle("🃏 Blackjack Results")
      .setDescription(`**Dealer:** ${dealerLine}\n\n${lines.join("\n")}`);
  }

  lobbyComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:join`).setLabel("Join").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:leave`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:start`).setLabel("Start").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger),
      )
    ];
  }

  playComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:hit`).setLabel("Hit").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:stand`).setLabel("Stand").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger),
      )
    ];
  }

  panelEmbed(revealDealer = false) {
    let dealerShown;

if (this.dealerHand.length === 0) {
  // Lobby (not dealt yet)
  dealerShown = "_Not dealt yet_";
} else if (revealDealer) {
  dealerShown = `${this.dealerHand.map(cardStr).join(" ")} (**${handValue(this.dealerHand)}**)`;
} else {
  dealerShown = `${cardStr(this.dealerHand[0])}  ?`;
};

    const playerLines = [...this.players.values()].map(p => {
      const pv = handValue(p.hand);
      const publicTotal = (this.state === "ended") ? `**${pv}**` : "??";
      return `${p.user.toString()} — **${p.status}** — ${publicTotal}`;
    });

    const turnId = this.currentPlayerId();
    const turnLine =
      this.state === "playing" && turnId ? `👉 Turn: <@${turnId}>`
      : this.state === "lobby" ? "Waiting to start…"
      : "Game finished.";

    return new EmbedBuilder()
      .setTitle("🃏 Blackjack")
      .setDescription(
        `**Dealer:** ${dealerShown}\n\n` +
        `**Players (${this.players.size}/${this.maxPlayers}):**\n${playerLines.join("\n") || "_None yet_"}\n\n` +
        `${turnLine}`
      );
  }

  async postOrEditPanel() {
    const embed = this.panelEmbed(false);
    const components = this.lobbyComponents();

    if (!this.message) {
      this.message = await this.channel.send({ embeds: [embed], components });
    } else {
      await this.message.edit({ embeds: [embed], components });
    }
  }

  async updatePanel(revealDealer = false) {
    if (!this.message) return;

    let embeds;
    let components;

    if (this.state === "lobby") {
      embeds = [this.panelEmbed(false)];
      components = this.lobbyComponents();
    } else if (this.state === "playing") {
      embeds = [this.panelEmbed(false)];
      components = this.playComponents();
    } else {
      embeds = [this.panelEmbed(true)];
      components = [];
    }

    await this.message.edit({ embeds, components });
  }
}

module.exports = { BlackjackSession, handValue, cardStr };
