// data/games/registry.js
// Category-based registry for /games hub.
// Add new categories/games here without touching the hub logic.

module.exports = {
  categories: [
    {
      id: "casino",
      name: "Casino",
      emoji: "🎰",
      blurb: "House games, table fees, and big swings.",
      games: [
        {
          key: "blackjack",
          label: "Blackjack",
          emoji: "🃏",
          hint: "1–10 players • splits/double • table fees",
          // relative to commands/games.js
          modulePath: "../data/games/blackjack",
          startExport: "startFromHub",
        },
        {
          key: "roulette",
          label: "Roulette",
          emoji: "🎡",
          hint: "Red/Black/Numbers • table fees",
          modulePath: "../data/games/roulette",
          startExport: "startFromHub",
        },
      ],
    },

    {
      id: "drinking",
      name: "Drinking Games",
      emoji: "🍻",
      blurb: "Party games and chaos (responsibly… allegedly).",
      games: [
        {
          key: "votendrink",
          label: "Vote & Drink",
          emoji: "🗳️",
          hint: "Lobby + rounds • votes decide who drinks",
          modulePath: "../commands/votendrink",
          startExport: "startFromHub",
        },
      ],
    },

    {
      id: "fun",
      name: "Just for Fun",
      emoji: "🎉",
      blurb: "Low-stakes mini-games. (More coming soon.)",
      games: [],
    },
  ],
};
