// data/help/categories/general.js
module.exports = {
  id: "general",
  order: 1,
  name: "General",
  emoji: "🧭",
  blurb: "Basics and utility commands.",

  commands: [
    {
      id: "ping",
      name: "/ping",
      short: "Check bot responsiveness.",
      detail:
        "**/ping**\n" +
        "Use this to check if the bot is alive and responding.\n\n" +
        "**Tip:** If commands feel like they're not working, try /ping and see if the bot responds!.",
    },
    {
      id: "inventory",
      name: "/inventory",
      short: "See what you’ve got in your pockets.",
      detail:
        "**/inventory**\n" +
        "Shows your inventory contents.\n\n" +
        "**Common use:** checking items before using the shop or jobs.",
    },
    {
      id: "achievements",
      name: "/achievements",
      short: "View your achievements.",
      detail:
        "**/achievements**\n" +
        "Shows your unlocked achievements and the ones you are missing.\n\n" +
        "**Note:** Achievements unlock automatically from gameplay and chatting.",
    },
  ],
};
