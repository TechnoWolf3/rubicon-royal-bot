// data/nightwalker/prostitute.js
module.exports = {
  key: "prostitute",
  title: "🎲 Prostitute",
  rounds: 4,

  risk: {
    start: 0,
    failAt: 100,
  },

  payout: { min: 1000, max: 5000 },
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
    {
      prompt: "This the final move what do you do?",
      choices: [
        { label: "Slip away like nothing happened", riskDelta: 6, payoutDeltaPct: 4, feedback: "Safe. No one noticed a thing." },
        { label: "Finish and chill with them for a while", riskDelta: 18, payoutDeltaPct: 14, feedback: "Jobs done, still risky." },
        { label: "Ask to go back to their place", riskDelta: 14, payoutDeltaPct: 10, feedback: "Risky move, I like it." },
        { label: "Steal their wallet and run", riskDelta: 34, payoutDeltaPct: 54, feedback: "Bold. Will likely backfire." },
      ],
    },
    {
  prompt: "A client flashes cash like they’re trying to impress you. What’s your play?",
  choices: [
    { label: "Keep it professional", riskDelta: 8, payoutDeltaPct: 6, feedback: "Clean energy. You stay in control." },
    { label: "Raise the price calmly", riskDelta: 14, payoutDeltaPct: 12, feedback: "Nice. Premium without drama." },
    { label: "Lean into the flex", riskDelta: 28, payoutDeltaPct: 22, feedback: "Big money vibes… big attention too." },
    { label: "Take it somewhere quieter", riskDelta: 12, payoutDeltaPct: 10, feedback: "Smart move. Less eyes, same cash." },
  ],
    },
    {
  prompt: "They start acting a little too familiar, a little too fast.",
  choices: [
    { label: "Set a boundary, politely", riskDelta: 6, payoutDeltaPct: 4, feedback: "Respect earned. Risk lowered." },
    { label: "Redirect with charm", riskDelta: 12, payoutDeltaPct: 10, feedback: "Smooth. Keeps the vibe without losing control." },
    { label: "Let it slide for extra", riskDelta: 26, payoutDeltaPct: 20, feedback: "Profit up… safety down." },
    { label: "End it early and bounce", riskDelta: 10, payoutDeltaPct: 6, feedback: "Not maximum cash, but you stay safe." },
  ],
    },
    {
  prompt: "A familiar face in the area makes you nervous.",
  choices: [
    { label: "Lay low and wait", riskDelta: 5, payoutDeltaPct: 3, feedback: "Patience saves you sometimes." },
    { label: "Change your look a bit", riskDelta: 12, payoutDeltaPct: 8, feedback: "Good call. Less recognition." },
    { label: "Switch location immediately", riskDelta: 10, payoutDeltaPct: 7, feedback: "Clean escape. Minimal heat." },
    { label: "Ignore it—keep going", riskDelta: 30, payoutDeltaPct: 22, feedback: "Bold. Might be a mistake." },
  ],
},
{
  prompt: "They ask for discretion and offer a ‘bonus’ for it.",
  choices: [
    { label: "Agree—strict rules", riskDelta: 10, payoutDeltaPct: 12, feedback: "Discreet, controlled, profitable." },
    { label: "Agree—no questions asked", riskDelta: 32, payoutDeltaPct: 26, feedback: "That’s premium money… and premium risk." },
    { label: "Decline, keep it simple", riskDelta: 6, payoutDeltaPct: 5, feedback: "Safe and steady." },
    { label: "Move to a quieter spot", riskDelta: 14, payoutDeltaPct: 14, feedback: "Nice. Risk reduced with cash intact." },
  ],
},
{
  prompt: "Your phone buzzes—someone’s asking where you are.",
  choices: [
    { label: "Ignore it for now", riskDelta: 18, payoutDeltaPct: 14, feedback: "Money first… but distractions cost you." },
    { label: "Reply with a vague check-in", riskDelta: 10, payoutDeltaPct: 8, feedback: "Smart. Keeps you covered." },
    { label: "Pause and reassess", riskDelta: 6, payoutDeltaPct: 4, feedback: "Good instinct. Safety matters." },
    { label: "Finish fast and leave", riskDelta: 14, payoutDeltaPct: 10, feedback: "Efficient. Less time, less heat." },
  ],
},
{
  prompt: "A client wants ‘VIP treatment’ but their vibe feels off.",
  choices: [
    { label: "Stick to standard service", riskDelta: 8, payoutDeltaPct: 6, feedback: "Smart. No need to gamble." },
    { label: "Charge VIP, keep distance", riskDelta: 18, payoutDeltaPct: 16, feedback: "Good middle ground. Still a risk." },
    { label: "Accept fully for big cash", riskDelta: 38, payoutDeltaPct: 30, feedback: "High reward… high danger." },
    { label: "Decline and move on", riskDelta: 5, payoutDeltaPct: 2, feedback: "Not glamorous, but safe." },
  ],
},
{
  prompt: "They mention they’re ‘new in town’ and want something exciting.",
  choices: [
    { label: "Keep it classy and calm", riskDelta: 8, payoutDeltaPct: 7, feedback: "You steer the night, not them." },
    { label: "Make it playful (safe)", riskDelta: 14, payoutDeltaPct: 12, feedback: "Fun without being reckless." },
    { label: "Push the thrill angle", riskDelta: 28, payoutDeltaPct: 22, feedback: "That thrill comes with heat." },
    { label: "Switch to a premium pitch", riskDelta: 16, payoutDeltaPct: 14, feedback: "Easy upsell. Solid." },
  ],
},
{
  prompt: "Someone nearby is lingering too long. Eyes on you.",
  choices: [
    { label: "Act normal, keep cool", riskDelta: 14, payoutDeltaPct: 10, feedback: "Confidence helps. Sometimes." },
    { label: "Relocate smoothly", riskDelta: 10, payoutDeltaPct: 8, feedback: "Clean. Quiet. Smart." },
    { label: "Wrap up immediately", riskDelta: 12, payoutDeltaPct: 9, feedback: "Short and safe—good instincts." },
    { label: "Ignore it and commit", riskDelta: 34, payoutDeltaPct: 24, feedback: "Big risk. Big consequences." },
  ],
},
{
  prompt: "They want a discount. You can feel the negotiation coming.",
  choices: [
    { label: "Hold your price", riskDelta: 8, payoutDeltaPct: 10, feedback: "Respect. You don’t fold." },
    { label: "Offer a tiny discount", riskDelta: 10, payoutDeltaPct: 8, feedback: "Keeps the deal without looking desperate." },
    { label: "Offer premium instead", riskDelta: 18, payoutDeltaPct: 16, feedback: "Nice flip. Higher value." },
    { label: "Give in too much", riskDelta: 14, payoutDeltaPct: 4, feedback: "You get the job… but lose the profit." },
  ],
},
{
  prompt: "A client says they’ve been ‘burned before’ and doesn’t trust easily.",
  choices: [
    { label: "Reassure + set rules", riskDelta: 8, payoutDeltaPct: 8, feedback: "Trust builds. Risk drops." },
    { label: "Overpromise to secure it", riskDelta: 24, payoutDeltaPct: 16, feedback: "Careful—big promises backfire." },
    { label: "Keep it short and simple", riskDelta: 10, payoutDeltaPct: 6, feedback: "Not exciting, but reliable." },
    { label: "Offer discreet premium", riskDelta: 16, payoutDeltaPct: 14, feedback: "Good pitch. Solid payout." },
  ],
},
{
  prompt: "They’re clearly intoxicated. This could get messy.",
  choices: [
    { label: "Decline politely", riskDelta: 5, payoutDeltaPct: 2, feedback: "Smart. That’s how you stay safe." },
    { label: "Proceed with strict limits", riskDelta: 18, payoutDeltaPct: 12, feedback: "Risky. You’ll need control." },
    { label: "Proceed for big bonus", riskDelta: 40, payoutDeltaPct: 28, feedback: "Huge gamble. Heat magnet." },
    { label: "Delay and move locations", riskDelta: 12, payoutDeltaPct: 8, feedback: "Better environment, better outcome." },
  ],
},
{
  prompt: "They ask for ‘something exclusive’ and glance around nervously.",
  choices: [
    { label: "Keep it discreet", riskDelta: 12, payoutDeltaPct: 12, feedback: "Handled well. Quiet profit." },
    { label: "Push for VIP upsell", riskDelta: 22, payoutDeltaPct: 18, feedback: "Good money, rising risk." },
    { label: "Take a risky shortcut", riskDelta: 36, payoutDeltaPct: 28, feedback: "High reward… high exposure." },
    { label: "End it—too sketchy", riskDelta: 8, payoutDeltaPct: 4, feedback: "You trust your gut. Good." },
  ],
},
{
  prompt: "A client looks you up and down slowly, clearly interested. How do you play it?",
  choices: [
    { label: "Keep it cool and confident", riskDelta: 8, payoutDeltaPct: 6, feedback: "Controlled energy. You set the tone." },
    { label: "Lean into the attention", riskDelta: 18, payoutDeltaPct: 14, feedback: "They’re hooked — but eyes linger." },
    { label: "Turn it playful", riskDelta: 14, payoutDeltaPct: 12, feedback: "Flirty, light, effective." },
    { label: "Push it fast for extra", riskDelta: 30, payoutDeltaPct: 24, feedback: "Money spikes… so does the heat." },
  ],
},
{
  prompt: "They compliment you openly, not caring who hears.",
  choices: [
    { label: "Smile and redirect quietly", riskDelta: 10, payoutDeltaPct: 8, feedback: "Smart move. Keeps things discreet." },
    { label: "Accept it confidently", riskDelta: 16, payoutDeltaPct: 12, feedback: "Confidence sells — attention rises." },
    { label: "Shut it down firmly", riskDelta: 6, payoutDeltaPct: 4, feedback: "Safe, but less exciting." },
    { label: "Encourage it for leverage", riskDelta: 28, payoutDeltaPct: 22, feedback: "High reward, risky spotlight." },
  ],
},
{
  prompt: "They suggest somewhere more private.",
  choices: [
    { label: "Agree, set boundaries", riskDelta: 12, payoutDeltaPct: 12, feedback: "Privacy with control. Nice." },
    { label: "Suggest your own spot", riskDelta: 14, payoutDeltaPct: 14, feedback: "You stay in charge." },
    { label: "Go along without questions", riskDelta: 32, payoutDeltaPct: 26, feedback: "Big money, big gamble." },
    { label: "Decline and stay public", riskDelta: 6, payoutDeltaPct: 4, feedback: "Safe, but limits the payout." },
  ],
},
{
  prompt: "A lingering touch tests your reaction.",
  choices: [
    { label: "Guide it away smoothly", riskDelta: 10, payoutDeltaPct: 8, feedback: "Subtle and professional." },
    { label: "Let it linger briefly", riskDelta: 18, payoutDeltaPct: 14, feedback: "Risk rises, interest spikes." },
    { label: "Pull back immediately", riskDelta: 6, payoutDeltaPct: 4, feedback: "Clear boundaries keep you safe." },
    { label: "Use it to upsell", riskDelta: 26, payoutDeltaPct: 20, feedback: "Dangerous… but profitable." },
  ],
},
{
  prompt: "They mention wanting something ‘memorable’.",
  choices: [
    { label: "Offer premium vibes", riskDelta: 16, payoutDeltaPct: 14, feedback: "Great pitch. Clean execution." },
    { label: "Promise excitement", riskDelta: 22, payoutDeltaPct: 18, feedback: "Big words, bigger risk." },
    { label: "Keep expectations realistic", riskDelta: 8, payoutDeltaPct: 6, feedback: "Safe and steady." },
    { label: "Go all-in on the fantasy", riskDelta: 34, payoutDeltaPct: 28, feedback: "Huge payoff… if it doesn’t blow back." },
  ],
},
{
  prompt: "They’re clearly enjoying the tension between you.",
  choices: [
    { label: "Stretch it out slowly", riskDelta: 12, payoutDeltaPct: 10, feedback: "Anticipation pays." },
    { label: "Close the deal quickly", riskDelta: 14, payoutDeltaPct: 12, feedback: "Efficient and clean." },
    { label: "Play hard to get", riskDelta: 18, payoutDeltaPct: 14, feedback: "Dangerous tease." },
    { label: "Capitalize aggressively", riskDelta: 30, payoutDeltaPct: 24, feedback: "Fast money, fast consequences." },
  ],
},
{
  prompt: "They ask how far you’re willing to go.",
  choices: [
    { label: "Clearly state limits", riskDelta: 8, payoutDeltaPct: 6, feedback: "Respect earns trust." },
    { label: "Leave it vague", riskDelta: 14, payoutDeltaPct: 12, feedback: "Mystery sells." },
    { label: "Imply flexibility", riskDelta: 22, payoutDeltaPct: 18, feedback: "Risk climbs with expectations." },
    { label: "Overpromise", riskDelta: 36, payoutDeltaPct: 28, feedback: "That could come back hard." },
  ],
},
{
  prompt: "They want exclusivity for the night.",
  choices: [
    { label: "Charge a premium", riskDelta: 18, payoutDeltaPct: 18, feedback: "Right price for the ask." },
    { label: "Agree cautiously", riskDelta: 14, payoutDeltaPct: 12, feedback: "Balanced approach." },
    { label: "Decline politely", riskDelta: 6, payoutDeltaPct: 4, feedback: "Safe, but lower profit." },
    { label: "Exploit the desire", riskDelta: 32, payoutDeltaPct: 26, feedback: "Huge leverage, huge risk." },
  ],
},
{
  prompt: "Their confidence borders on arrogance.",
  choices: [
    { label: "Humble them gently", riskDelta: 12, payoutDeltaPct: 10, feedback: "Power shift achieved." },
    { label: "Play into it", riskDelta: 18, payoutDeltaPct: 14, feedback: "Ego stroking pays." },
    { label: "Keep it strictly business", riskDelta: 8, payoutDeltaPct: 6, feedback: "No drama." },
    { label: "Challenge them openly", riskDelta: 28, payoutDeltaPct: 22, feedback: "High tension. High reward." },
  ],
},
{
  prompt: "They’re watching you closely, waiting for a cue.",
  choices: [
    { label: "Take the lead", riskDelta: 14, payoutDeltaPct: 12, feedback: "Confidence sells hard." },
    { label: "Let them chase", riskDelta: 18, payoutDeltaPct: 14, feedback: "Risky tease." },
    { label: "Reset the energy", riskDelta: 8, payoutDeltaPct: 6, feedback: "Keeps things grounded." },
    { label: "Exploit the moment", riskDelta: 30, payoutDeltaPct: 24, feedback: "Bold — maybe too bold." },
  ],
},
{
  prompt: "They hint at wanting discretion above all else.",
  choices: [
    { label: "Reassure professionally", riskDelta: 10, payoutDeltaPct: 10, feedback: "Trust builds value." },
    { label: "Upsell secrecy", riskDelta: 20, payoutDeltaPct: 18, feedback: "Premium discretion." },
    { label: "Avoid the complication", riskDelta: 6, payoutDeltaPct: 4, feedback: "Safe exit." },
    { label: "Promise too much", riskDelta: 34, payoutDeltaPct: 26, feedback: "That promise carries weight." },
  ],
},
{
  prompt: "The chemistry is obvious, but eyes are everywhere.",
  choices: [
    { label: "Relocate smoothly", riskDelta: 12, payoutDeltaPct: 12, feedback: "Clean and quiet." },
    { label: "Dial it back", riskDelta: 8, payoutDeltaPct: 6, feedback: "Safety first." },
    { label: "Ignore the crowd", riskDelta: 28, payoutDeltaPct: 22, feedback: "Thrilling… and dangerous." },
    { label: "Turn it into leverage", riskDelta: 20, payoutDeltaPct: 18, feedback: "Attention becomes currency." },
  ],
},
{
  prompt: "They ask if you’re ‘worth the price’.",
  choices: [
    { label: "Answer confidently", riskDelta: 12, payoutDeltaPct: 12, feedback: "Self-assurance pays." },
    { label: "Prove it with attitude", riskDelta: 18, payoutDeltaPct: 14, feedback: "Bold move." },
    { label: "Lower expectations", riskDelta: 8, payoutDeltaPct: 6, feedback: "Safe but dull." },
    { label: "Jack the price up", riskDelta: 30, payoutDeltaPct: 24, feedback: "High risk, high return." },
  ],
},
{
  prompt: "They seem torn between desire and hesitation.",
  choices: [
    { label: "Ease them in slowly", riskDelta: 10, payoutDeltaPct: 8, feedback: "Patience works." },
    { label: "Push the moment", riskDelta: 22, payoutDeltaPct: 18, feedback: "Pressure can pay… or break it." },
    { label: "Let them decide", riskDelta: 8, payoutDeltaPct: 6, feedback: "Low risk, low reward." },
    { label: "Capitalize immediately", riskDelta: 32, payoutDeltaPct: 26, feedback: "All-in energy." },
  ],
},
{
  prompt: "They step closer, lowering their voice.",
  choices: [
    { label: "Match the tone", riskDelta: 14, payoutDeltaPct: 12, feedback: "Intimate, controlled." },
    { label: "Keep distance", riskDelta: 8, payoutDeltaPct: 6, feedback: "Safe and composed." },
    { label: "Lean into the moment", riskDelta: 24, payoutDeltaPct: 20, feedback: "Electric — and risky." },
    { label: "Turn it transactional", riskDelta: 16, payoutDeltaPct: 14, feedback: "Clear terms, clear money." },
  ],
},
  ],
};

if (process.env.NODE_ENV !== "production") {
  console.log("[NW] prostitute scenarios loaded");
}