// data/nightwalker/prostitute.js
module.exports = {
  key: "prostitute",
  title: "🎲 Prostitute",
  rounds: 4,

  risk: {
    start: 0,
    failAt: 100,
  },

  payout: { min: 2000, max: 7000 },
  xp: { success: 18, fail: 6 },

  // Each choice affects risk + payout multiplier
  // payoutDeltaPct is applied cumulatively
  scenarios: [
    {
      prompt: "A client approaches with a confident grin. What’s your move?",
      choices: [
        { label: "Stick to your rules", riskDelta: 10, payoutDeltaPct: 8, feedback: "Safe, clean, professional." },
        { label: "Offer something premium", riskDelta: 22, payoutDeltaPct: 18, feedback: "Bigger money… bigger risk." },
        { label: "Change venue quickly", riskDelta: 15, payoutDeltaPct: 12, feedback: "Smart. Reduces eyes on you." },
        { label: "Take a risky shortcut", riskDelta: 35, payoutDeltaPct: 28, feedback: "Spicy move. Dangerous." },
      ],
    },
    {
      prompt: "They push for more than planned. You…",
      choices: [
        { label: "Redirect politely", riskDelta: 12, payoutDeltaPct: 10, feedback: "Controlled. You keep power." },
        { label: "Agree for extra cash", riskDelta: 30, payoutDeltaPct: 22, feedback: "Money talks… risk screams." },
        { label: "Set a firm boundary", riskDelta: 8, payoutDeltaPct: 6, feedback: "Safer choice. Lower growth." },
        { label: "Move to VIP request", riskDelta: 40, payoutDeltaPct: 30, feedback: "Jackpot territory — careful." },
      ],
    },
    {
      prompt: "You notice someone paying too much attention nearby.",
      choices: [
        { label: "Lay low briefly", riskDelta: 6, payoutDeltaPct: 4, feedback: "Smart. Let heat fade." },
        { label: "Finish fast and bounce", riskDelta: 18, payoutDeltaPct: 14, feedback: "Efficient, still risky." },
        { label: "Switch locations", riskDelta: 14, payoutDeltaPct: 10, feedback: "Good instinct." },
        { label: "Ignore it and commit", riskDelta: 34, payoutDeltaPct: 24, feedback: "Bold. Might backfire." },
      ],
    },
  ],
};
