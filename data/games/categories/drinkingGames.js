// data/games/categories/drinkingGames.js
// Games Hub category: Drinking Games

module.exports = {
  id: "drinking",
  name: "Drinking Games",
  emoji: "🍻",
  description: "Party games and questionable decisions.",
  order: 2,

  games: [
    {
      id: "votendrink",
      name: "Vote & Drink",
      emoji: "🗳️",
      description: "Vote-based party game. Loser drinks.",
      run: async (interaction, ctx = {}) => {
        const game = require("../votendrink");
        return game.startFromHub(interaction, ctx);
      },
    },
  ],
};
