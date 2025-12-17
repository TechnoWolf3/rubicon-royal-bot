// data/nineToFive/index.js
module.exports = {
  category: {
    id: "nineToFive",
    title: "📦 Work a 9–5",
    description: "Classic work. Steady pay.",
    footer: "Cooldown blocks payouts, not browsing.",
  },

  // What appears on the Work a 9–5 board (order matters)
  jobs: [
    {
      key: "transportContract",
      title: "🚚 Transport Contract",
      desc: "3-step choices (risk/reward).",
      button: { id: "job_95:contract", label: "🚚 Transport" },
    },
    {
      key: "skillCheck",
      title: "🧩 Skill Check",
      desc: "Quick test — win or lose.",
      button: { id: "job_95:skill", label: "🧩 Skill Check" },
    },
    {
      key: "shift",
      title: "🕒 Shift",
      desc: "Wait it out, then Collect Pay.",
      button: { id: "job_95:shift", label: "🕒 Shift" },
    },
  ],

  // Optional: if you want Legendary to appear as part of this category
  legendary: {
    enabled: true,
    button: { id: "job_95:legendary", label: "🌟 Legendary" },
    // (future) you could add unlock rules here if you want
  },
};
