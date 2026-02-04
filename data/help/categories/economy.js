// data/help/categories/economy.js
module.exports = {
  id: "economy",
  order: 2,
  name: "Economy",
  emoji: "💰",
  blurb: "Balance, payouts, shop, and money movement.",

  commands: [
    {
      id: "bal",
      name: "/bal",
      short: "Shows your current balance.",
      detail:
        "**/bal**\n" +
        "Displays your current money balance.",
    },
    {
      id: "balance",
      name: "/balance",
      short: "Alias for /bal.",
      detail:
        "**/balance**\n" +
        "Same as **/bal** — just another name for it.",
    },
    {
      id: "leaderboard",
      name: "/leaderboard",
      short: "Top balances leaderboard.",
      detail:
        "**/leaderboard**\n" +
        "Shows the richest players.",
    },
    {
      id: "daily",
      name: "/daily",
      short: "Claim your daily payout.",
      detail:
        "**/daily**\n" +
        "Claim your daily reward.\n\n" +
        "**Note:** Can be claimed once daily.",
    },
    {
      id: "weekly",
      name: "/weekly",
      short: "Claim your weekly payout.",
      detail:
        "**/weekly**\n" +
        "Claim your weekly reward.\n\n" +
        "**Note:** Can be claimed once weekly.",
    },
    {
      id: "pay",
      name: "/pay",
      short: "Pay another player.",
      detail:
        "**/pay**\n" +
        "Send money to another user.\n\n" +
        "**Tip:** Double-check the amount before confirming.",
    },
    {
      id: "sendmoney",
      name: "/sendmoney",
      short: "Alias for /pay",
      detail:
        "**/sendmoney**\n" +
        "Sends money to another user, same as /pay.",
    },
    {
      id: "shop",
      name: "/shop",
      short: "Browse and buy items.",
      detail:
        "**/shop**\n" +
        "Opens the shop so you can browse and purchase items.\n\n" +
        "**Note:** Some items may have limited stock.",
    },

    // These are “hubs” but you listed them inside economy too — we’ll keep them.
    {
      id: "gamesHub",
      name: "/games",
      short: "Open the casino / games hub.",
      detail:
        "**/games**\n" +
        "Opens the casino hub (games like blackjack/roulette, etc).\n\n" +
        "**Heads up:** Winnings/losses affect your balance.",
    },
    {
      id: "jobHub",
      name: "/job",
      short: "Open the work hub.",
      detail:
        "**/job**\n" +
        "Opens the work hub where you can pick a job type.",
    },
  ],
};
