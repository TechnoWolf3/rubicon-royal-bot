// data/nightwalker/lapDance.js
module.exports = {
  key: "lapDance",
  title: "💃 Lap Dance",
  rounds: 5,

  // recoverable mistakes
  penalties: {
    failAt: 3,          // fail when penalty tokens reach this
    awkwardAdds: 1,
    smoothRemoves: 1,   // if smooth chosen, remove 1 token (min 0)
  },

  payout: { min: 1200, max: 3200 },
  xp: { success: 16, fail: 5 },

  // Each round: choose a move — tags are hidden
  scenarios: [
    {
      prompt: "The music hits. What do you do next?",
      choices: [
        { label: "Slow and confident", tag: "smooth", feedback: "Great control. The crowd approves." },
        { label: "Big dramatic move", tag: "okay", feedback: "Bold. A little chaotic, but fine." },
        { label: "Rush the tempo", tag: "awkward", feedback: "Too fast. The vibe slips." },
        { label: "Read the room first", tag: "smooth", feedback: "Smart. Timing is everything." },
      ],
    },
    {
      prompt: "They’re watching closely. Next move?",
      choices: [
        { label: "Hold eye contact", tag: "smooth", feedback: "Strong. Confident energy." },
        { label: "Overcommit to a bit", tag: "awkward", feedback: "It’s… a choice. Not the best one." },
        { label: "Keep it playful", tag: "okay", feedback: "Fun. Not perfect, but works." },
        { label: "Change rhythm smoothly", tag: "smooth", feedback: "Clean transition. Nice." },
      ],
    },
    {
      prompt: "You feel the room shift. What now?",
      choices: [
        { label: "Reset with a pause", tag: "smooth", feedback: "Professional. Regains control." },
        { label: "Go louder and harder", tag: "awkward", feedback: "Too much. Too soon." },
        { label: "Lean into the beat", tag: "okay", feedback: "Solid. Gets the job done." },
        { label: "Go subtle and sharp", tag: "smooth", feedback: "Tasteful. Strong." },
      ],
    },
  ],
};
