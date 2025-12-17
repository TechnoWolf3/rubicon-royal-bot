// data/nightwalker/index.js
const flirt = require("./flirt");
const lapDance = require("./lapDance");
const prostitute = require("./prostitute");

module.exports = {
  category: {
    id: "nightwalker",
    title: "🧠 Night Walker",
    description: "Work to please the night. Choose your hustle.",
    footer: "Choices matter. Keep it cheeky.",
  },

  jobs: {
    flirt,
    lapDance,
    prostitute,
  },

  // Order of buttons on the Night Walker board
  list: ["flirt", "lapDance", "prostitute"],
};
