// data/help/categories/games.js
module.exports = {
  id: "games",
  order: 3,
  name: "Games",
  emoji: "🎮",
  blurb: "Mini-games and fun commands.",

  commands: [
    {
      id: "votendrink",
      name: "/votendrink",
      short: "Vote + drink game.",
      detail:
        "**/votendrink**\n" +
        "Runs the Vote & Drink game.\n\n" +
        "A game where players are asked questions such as **Whos the most likely to ___.\n" +
        "The person with the most votes is to take a sip of their drink.",
    },
  ],
};
