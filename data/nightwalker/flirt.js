// data/nightwalker/flirt.js
module.exports = {
  key: "flirt",
  title: "💬 Flirt",
  rounds: 5,
  failOnWrongs: 2,

  payout: { min: 900, max: 2200 },
  xp: { success: 14, fail: 4 },

  // payout modifiers applied at end
  modifiers: {
    goodBonusPct: 8,      // per good pick
    neutralBonusPct: 0,
    wrongPenaltyPct: 12,  // per wrong pick
  },

  // Scenario pool — non-repeating within a single session
  scenarios: [
    {
      prompt: "They smirk and ask, “So… what’s your vibe tonight?”",
      choices: [
        { label: "Play it mysterious", tag: "good", feedback: "Smooth. Mystery sells." },
        { label: "Crack a quick joke", tag: "neutral", feedback: "It lands… enough." },
        { label: "Overshare instantly", tag: "wrong", feedback: "Woah. Too much, too fast." },
        { label: "Turn it back on them", tag: "good", feedback: "Nice. Keeps them engaged." },
      ],
    },
    {
      prompt: "They pause and look you up and down.",
      choices: [
        { label: "Hold eye contact", tag: "good", feedback: "Confident. They like that." },
        { label: "Look away quickly", tag: "wrong", feedback: "Awkward. The moment slips." },
        { label: "Compliment their style", tag: "good", feedback: "Good taste. Good timing." },
        { label: "Act unimpressed", tag: "neutral", feedback: "Risky, but not fatal." },
      ],
    },
    {
      prompt: "They lean closer. “Say something interesting.”",
      choices: [
        { label: "Tell a short story", tag: "good", feedback: "Hooked. They’re listening." },
        { label: "One-word answer", tag: "wrong", feedback: "Dry. The vibe drops." },
        { label: "Tease them lightly", tag: "good", feedback: "Playful. Strong move." },
        { label: "Ask them a question", tag: "neutral", feedback: "Safe. Keeps it moving." },
      ],
    },
    {
      prompt: "They mention they hate drama.",
      choices: [
        { label: "Agree and keep it light", tag: "good", feedback: "Perfect. Low stress energy." },
        { label: "Start gossiping", tag: "wrong", feedback: "Oof. That’s exactly drama." },
        { label: "Change topic smoothly", tag: "neutral", feedback: "Fair pivot." },
        { label: "Make it about them", tag: "good", feedback: "They feel seen. Nice." },
      ],
    },
    {
      prompt: "They ask what you do for fun.",
      choices: [
        { label: "Keep it confident", tag: "good", feedback: "That’s attractive. Simple." },
        { label: "Try too hard", tag: "wrong", feedback: "It feels… forced." },
        { label: "Be a little cheeky", tag: "good", feedback: "Bold. Works well." },
        { label: "Stay neutral", tag: "neutral", feedback: "Not exciting, not bad." },
      ],
    },
    {
      prompt: "They challenge you: “Impress me.”",
      choices: [
        { label: "Compliment + tease", tag: "good", feedback: "Nice combo. They laugh." },
        { label: "Go overly intense", tag: "wrong", feedback: "Too heavy. Too soon." },
        { label: "Make it playful", tag: "good", feedback: "Clean, fun energy." },
        { label: "Act casual", tag: "neutral", feedback: "Safe option." },
      ],
    },
    {
      prompt: "They glance at their phone mid-convo.",
      choices: [
        { label: "Keep talking anyway", tag: "wrong", feedback: "That’s… not the move." },
        { label: "Pause and smile", tag: "good", feedback: "Confident silence. Powerful." },
        { label: "Light joke about it", tag: "neutral", feedback: "Could’ve been worse." },
        { label: "Ask if they’re needed", tag: "good", feedback: "Respectful. Good read." },
      ],
    },
    {
      prompt: "They say: “You’re trouble.”",
      choices: [
        { label: "Smile and agree", tag: "good", feedback: "That’s the spirit." },
        { label: "Get defensive", tag: "wrong", feedback: "Kills the playful tone." },
        { label: "Flip it back at them", tag: "good", feedback: "They like the confidence." },
        { label: "Brush it off", tag: "neutral", feedback: "Okay. Not exciting." },
      ],
    },
  ],
};
