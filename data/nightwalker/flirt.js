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
    {
  prompt: "They hold eye contact a little longer than necessary.",
  choices: [
    { label: "Hold it back, slow smile", tag: "good", feedback: "Confident. That lands well." },
    { label: "Look away, then back", tag: "neutral", feedback: "Keeps it subtle." },
    { label: "Break it with a joke", tag: "neutral", feedback: "Safe, but less tension." },
    { label: "Stare them down", tag: "wrong", feedback: "Too intense. You feel it slip." },
  ],
},
{
  prompt: "They compliment your appearance openly.",
  choices: [
    { label: "Thank them softly", tag: "good", feedback: "Simple. Effective." },
    { label: "Return the compliment", tag: "good", feedback: "Mutual interest sparks." },
    { label: "Deflect playfully", tag: "neutral", feedback: "Keeps it light." },
    { label: "Brush it off coldly", tag: "wrong", feedback: "That cools the vibe." },
  ],
},
{
  prompt: "They step closer, lowering their voice.",
  choices: [
    { label: "Match their tone", tag: "good", feedback: "Intimate energy builds." },
    { label: "Lean in slightly", tag: "good", feedback: "Nice balance." },
    { label: "Keep your distance", tag: "neutral", feedback: "Safe, but cautious." },
    { label: "Pull away noticeably", tag: "wrong", feedback: "They notice the hesitation." },
  ],
},
{
  prompt: "They tease you lightly.",
  choices: [
    { label: "Tease back", tag: "good", feedback: "Chemistry clicks." },
    { label: "Laugh it off", tag: "neutral", feedback: "Comfortable, not electric." },
    { label: "Play dumb", tag: "neutral", feedback: "Misses the moment." },
    { label: "Take it personally", tag: "wrong", feedback: "Mood shifts fast." },
  ],
},
{
  prompt: "They ask what you're doing later.",
  choices: [
    { label: "Answer vaguely", tag: "good", feedback: "Mystery works." },
    { label: "Hint at flexibility", tag: "good", feedback: "Inviting without pressure." },
    { label: "Be completely honest", tag: "neutral", feedback: "Straightforward." },
    { label: "Overshare immediately", tag: "wrong", feedback: "Too much, too fast." },
  ],
},
{
  prompt: "They smile when you talk.",
  choices: [
    { label: "Slow your speech", tag: "good", feedback: "Draws them in." },
    { label: "Smile back casually", tag: "neutral", feedback: "Comfortable rhythm." },
    { label: "Look away shyly", tag: "neutral", feedback: "Cute, but unsure." },
    { label: "Ignore it", tag: "wrong", feedback: "Missed connection." },
  ],
},
{
  prompt: "They brush past you deliberately.",
  choices: [
    { label: "Acknowledge it subtly", tag: "good", feedback: "Nicely handled." },
    { label: "Play it cool", tag: "neutral", feedback: "Keeps control." },
    { label: "Comment on it", tag: "neutral", feedback: "Risky but okay." },
    { label: "Call it out loudly", tag: "wrong", feedback: "That breaks the spell." },
  ],
},
{
  prompt: "They laugh at something only mildly funny.",
  choices: [
    { label: "Lean into the humor", tag: "good", feedback: "Connection deepens." },
    { label: "Smirk knowingly", tag: "good", feedback: "You read the room." },
    { label: "Downplay it", tag: "neutral", feedback: "Safe response." },
    { label: "Question why", tag: "wrong", feedback: "That kills the moment." },
  ],
},
{
  prompt: "They ask you a personal question.",
  choices: [
    { label: "Answer, but lightly", tag: "good", feedback: "Openness builds trust." },
    { label: "Turn it back on them", tag: "good", feedback: "Smooth deflection." },
    { label: "Keep it surface-level", tag: "neutral", feedback: "Guarded but fine." },
    { label: "Refuse outright", tag: "wrong", feedback: "Feels closed off." },
  ],
},
{
  prompt: "They compliment your voice.",
  choices: [
    { label: "Lower it slightly", tag: "good", feedback: "Nice instinct." },
    { label: "Thank them casually", tag: "neutral", feedback: "Polite." },
    { label: "Laugh it off", tag: "neutral", feedback: "Deflects the tension." },
    { label: "Mock the comment", tag: "wrong", feedback: "That stings." },
  ],
},
{
  prompt: "They pause, clearly waiting for you to say something.",
  choices: [
    { label: "Hold the silence", tag: "good", feedback: "Confident move." },
    { label: "Say something playful", tag: "good", feedback: "Breaks the tension nicely." },
    { label: "Change the topic", tag: "neutral", feedback: "Keeps things moving." },
    { label: "Get visibly awkward", tag: "wrong", feedback: "They feel it." },
  ],
},
{
  prompt: "They mention being bored tonight.",
  choices: [
    { label: "Suggest excitement", tag: "good", feedback: "Intriguing." },
    { label: "Agree sympathetically", tag: "neutral", feedback: "Relatable." },
    { label: "Offer casual company", tag: "neutral", feedback: "Safe play." },
    { label: "Dismiss it", tag: "wrong", feedback: "Opportunity lost." },
  ],
},
{
  prompt: "They tilt their head, studying you.",
  choices: [
    { label: "Hold their gaze", tag: "good", feedback: "Strong energy." },
    { label: "Smile knowingly", tag: "good", feedback: "They like that." },
    { label: "Look confused", tag: "neutral", feedback: "Breaks momentum." },
    { label: "Ask what's wrong", tag: "wrong", feedback: "Misread the moment." },
  ],
},
{
  prompt: "They comment on your confidence.",
  choices: [
    { label: "Own it", tag: "good", feedback: "Attractive." },
    { label: "Downplay it slightly", tag: "neutral", feedback: "Humble." },
    { label: "Turn it into humor", tag: "neutral", feedback: "Safe charm." },
    { label: "Get defensive", tag: "wrong", feedback: "That sours things." },
  ],
},
{
  prompt: "They step into your personal space.",
  choices: [
    { label: "Stay relaxed", tag: "good", feedback: "You handle it well." },
    { label: "Mirror their position", tag: "good", feedback: "Mutual signal." },
    { label: "Shift uncomfortably", tag: "neutral", feedback: "Mixed message." },
    { label: "Pull away sharply", tag: "wrong", feedback: "Clear rejection." },
  ],
},
{
  prompt: "They give you a look that lingers.",
  choices: [
    { label: "Return it briefly", tag: "good", feedback: "Perfect timing." },
    { label: "Smile softly", tag: "good", feedback: "Warm and inviting." },
    { label: "Pretend not to notice", tag: "neutral", feedback: "Missed spark." },
    { label: "Stare too long", tag: "wrong", feedback: "Overdoes it." },
  ],
},
{
  prompt: "They ask if you're flirting.",
  choices: [
    { label: "Smile, don’t answer", tag: "good", feedback: "That says enough." },
    { label: "Admit it confidently", tag: "good", feedback: "Bold and honest." },
    { label: "Play it off", tag: "neutral", feedback: "Safe exit." },
    { label: "Deny it harshly", tag: "wrong", feedback: "Mood drops." },
  ],
},
{
  prompt: "They compliment your energy.",
  choices: [
    { label: "Match theirs", tag: "good", feedback: "Nice sync." },
    { label: "Thank them warmly", tag: "neutral", feedback: "Friendly." },
    { label: "Deflect modestly", tag: "neutral", feedback: "Low risk." },
    { label: "Question it", tag: "wrong", feedback: "Unnecessary doubt." },
  ],
},
{
  prompt: "They mention they like confidence.",
  choices: [
    { label: "Show it calmly", tag: "good", feedback: "Exactly right." },
    { label: "Lean into it", tag: "good", feedback: "They notice." },
    { label: "Stay reserved", tag: "neutral", feedback: "Plays it safe." },
    { label: "Overdo it", tag: "wrong", feedback: "Comes off forced." },
  ],
},
{
  prompt: "They pause mid-sentence, smiling.",
  choices: [
    { label: "Let them finish", tag: "good", feedback: "Respectful tension." },
    { label: "Finish their thought", tag: "neutral", feedback: "Risky guess." },
    { label: "Change topic", tag: "neutral", feedback: "Momentum lost." },
    { label: "Interrupt awkwardly", tag: "wrong", feedback: "That breaks flow." },
  ],
},
{
  prompt: "They joke about being trouble.",
  choices: [
    { label: "Say you like trouble", tag: "good", feedback: "Playful spark." },
    { label: "Laugh and agree", tag: "neutral", feedback: "Easy energy." },
    { label: "Deflect lightly", tag: "neutral", feedback: "Safe move." },
    { label: "Warn them off", tag: "wrong", feedback: "Buzzkill." },
  ],
},
{
  prompt: "They lean on something near you.",
  choices: [
    { label: "Mirror the posture", tag: "good", feedback: "Subtle connection." },
    { label: "Stay relaxed", tag: "neutral", feedback: "Comfortable vibe." },
    { label: "Comment on it", tag: "neutral", feedback: "Could work." },
    { label: "Step away", tag: "wrong", feedback: "Creates distance." },
  ],
},
{
  prompt: "They ask what caught your attention.",
  choices: [
    { label: "Say them", tag: "good", feedback: "Direct and effective." },
    { label: "Keep it vague", tag: "neutral", feedback: "Mystery remains." },
    { label: "Deflect humorously", tag: "neutral", feedback: "Safe play." },
    { label: "Say ‘nothing’", tag: "wrong", feedback: "Ouch." },
  ],
},
{
  prompt: "They smile as if expecting a move.",
  choices: [
    { label: "Make one", tag: "good", feedback: "Perfect timing." },
    { label: "Hold the moment", tag: "good", feedback: "Confidence shows." },
    { label: "Stay neutral", tag: "neutral", feedback: "Moment fades." },
    { label: "Freeze up", tag: "wrong", feedback: "Opportunity slips." },
  ],
},
  ],
};
