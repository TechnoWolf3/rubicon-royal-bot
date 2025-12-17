// data/nineToFive/transportContract.js
module.exports = {
  // UI
  titlePrefix: "📦", // used in step titles if you want
  footer: "Finish all 3 steps to get paid.",

  // Rewards / XP (matches what you had)
  xp: {
    success: 15,
    fail: 4, // consolation XP (does NOT count as a completed job)
  },

  // Base pay before bonuses from choices
  basePay: {
    min: 750,
    max: 1250,
  },

  // When a contract fails, you still pay a small consolation amount (does NOT count as a job)
  consolationPay: {
    min: 60,
    max: 260,
  },

  // Unlock rules
  unlocks: {
    vipLevel: 10,
    dangerLevel: 20,
  },

  // Contract steps (non-repeating labels; pick what feels fun)
  steps: [
    {
      title: "📦 Step 1/3 — Pick your route",
      desc: "How are you getting there?",
      baseChoices: [
        { id: "highway", label: "Highway", modMin: 0, modMax: 160, risk: 0.02 },
        { id: "backstreets", label: "Backstreets", modMin: 80, modMax: 280, risk: 0.06 },
        { id: "scenic", label: "Scenic", modMin: -40, modMax: 180, risk: 0.01 },
      ],
      vipChoices: [
        { id: "viplane", label: "VIP Lane", modMin: 160, modMax: 420, risk: 0.08 },
      ],
      dangerChoices: [
        { id: "hotroute", label: "Hot Route", modMin: 300, modMax: 700, risk: 0.14 },
      ],
    },
    {
      title: "📦 Step 2/3 — Handling",
      desc: "Package handling style?",
      baseChoices: [
        { id: "careful", label: "Careful", modMin: 40, modMax: 180, risk: 0.01 },
        { id: "fast", label: "Fast", modMin: 120, modMax: 340, risk: 0.08 },
        { id: "standard", label: "Standard", modMin: 0, modMax: 160, risk: 0.03 },
      ],
      vipChoices: [
        { id: "insured", label: "Insured Handling", modMin: 120, modMax: 320, risk: 0.04 },
      ],
      dangerChoices: [
        { id: "fragile", label: "Ultra Fragile", modMin: 260, modMax: 620, risk: 0.16 },
      ],
    },
    {
      title: "📦 Step 3/3 — Delivery",
      desc: "How do you finish it?",
      baseChoices: [
        { id: "signature", label: "Signature", modMin: 70, modMax: 220, risk: 0.03 },
        { id: "doorstep", label: "Doorstep", modMin: 0, modMax: 170, risk: 0.05 },
        { id: "priority", label: "Priority", modMin: 140, modMax: 380, risk: 0.10 },
      ],
      vipChoices: [
        { id: "vipdrop", label: "VIP Priority", modMin: 240, modMax: 600, risk: 0.12 },
      ],
      dangerChoices: [
        { id: "blackops", label: "Black Ops Drop", modMin: 400, modMax: 900, risk: 0.20 },
      ],
    },
  ],
};
