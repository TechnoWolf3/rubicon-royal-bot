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

  payout: { min: 1000, max: 3000 },
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
    {
  prompt: "The music starts slow and heavy. They’re watching closely.",
  choices: [
    { label: "Ease into the rhythm", tag: "smooth", feedback: "Controlled and confident." },
    { label: "Lock eyes immediately", tag: "smooth", feedback: "That grabs attention." },
    { label: "Start stiff, then loosen up", tag: "neutral", feedback: "A little awkward, but recoverable." },
    { label: "Rush the movement", tag: "awkward", feedback: "Too fast. Feels off." },
  ],
},
{
  prompt: "They lean forward as you move closer.",
  choices: [
    { label: "Slow it down deliberately", tag: "smooth", feedback: "Perfect tension." },
    { label: "Match their energy", tag: "smooth", feedback: "Nice read." },
    { label: "Pause briefly", tag: "neutral", feedback: "Momentary hesitation." },
    { label: "Freeze up", tag: "awkward", feedback: "That breaks the flow." },
  ],
},
{
  prompt: "The beat shifts unexpectedly.",
  choices: [
    { label: "Adapt smoothly", tag: "smooth", feedback: "Natural and seamless." },
    { label: "Play with the change", tag: "smooth", feedback: "Creative move." },
    { label: "Stick to your pace", tag: "neutral", feedback: "Doesn’t fully land." },
    { label: "Lose timing", tag: "awkward", feedback: "They notice the slip." },
  ],
},
{
  prompt: "They smile, clearly enjoying the view.",
  choices: [
    { label: "Acknowledge it subtly", tag: "smooth", feedback: "Connection deepens." },
    { label: "Lean into confidence", tag: "smooth", feedback: "That works." },
    { label: "Ignore it", tag: "neutral", feedback: "Missed opportunity." },
    { label: "React nervously", tag: "awkward", feedback: "Energy dips." },
  ],
},
{
  prompt: "You feel the room’s attention shift toward you.",
  choices: [
    { label: "Own the spotlight", tag: "smooth", feedback: "Strong presence." },
    { label: "Refocus on your client", tag: "smooth", feedback: "Keeps it intimate." },
    { label: "Pull back slightly", tag: "neutral", feedback: "Safe, but dull." },
    { label: "Get visibly tense", tag: "awkward", feedback: "That shows." },
  ],
},
{
  prompt: "The chair creaks as you adjust.",
  choices: [
    { label: "Turn it into a pause", tag: "smooth", feedback: "Plays it off nicely." },
    { label: "Laugh it off", tag: "neutral", feedback: "Awkward but human." },
    { label: "Ignore it completely", tag: "neutral", feedback: "Could’ve been smoother." },
    { label: "Overcorrect quickly", tag: "awkward", feedback: "Jarring movement." },
  ],
},
{
  prompt: "They shift their posture to get a better look.",
  choices: [
    { label: "Angle yourself confidently", tag: "smooth", feedback: "Good awareness." },
    { label: "Slow the motion", tag: "smooth", feedback: "Builds anticipation." },
    { label: "Continue unchanged", tag: "neutral", feedback: "Misses the cue." },
    { label: "Break eye contact", tag: "awkward", feedback: "Energy falters." },
  ],
},
{
  prompt: "The lighting changes mid-song.",
  choices: [
    { label: "Use it to your advantage", tag: "smooth", feedback: "Looks intentional." },
    { label: "Hold a pose briefly", tag: "smooth", feedback: "Striking moment." },
    { label: "Keep moving normally", tag: "neutral", feedback: "Okay, but flat." },
    { label: "Get distracted", tag: "awkward", feedback: "Focus slips." },
  ],
},
{
  prompt: "They lean back, clearly relaxed.",
  choices: [
    { label: "Slow everything down", tag: "smooth", feedback: "Perfect control." },
    { label: "Maintain steady rhythm", tag: "smooth", feedback: "Consistent and clean." },
    { label: "Try something new", tag: "neutral", feedback: "Risky shift." },
    { label: "Speed up nervously", tag: "awkward", feedback: "Doesn’t match the vibe." },
  ],
},
{
  prompt: "You feel a moment of uncertainty.",
  choices: [
    { label: "Trust your instincts", tag: "smooth", feedback: "Confidence returns." },
    { label: "Simplify your movement", tag: "smooth", feedback: "Less is more." },
    { label: "Hesitate briefly", tag: "neutral", feedback: "Noticeable pause." },
    { label: "Second-guess yourself", tag: "awkward", feedback: "That shows." },
  ],
},
{
  prompt: "They give a small nod of approval.",
  choices: [
    { label: "Lean into the rhythm", tag: "smooth", feedback: "Great response." },
    { label: "Mirror their calm", tag: "smooth", feedback: "Nice sync." },
    { label: "Overdo it", tag: "awkward", feedback: "Too much, too fast." },
    { label: "Stay overly cautious", tag: "neutral", feedback: "Plays it safe." },
  ],
},
{
  prompt: "The music builds toward a peak.",
  choices: [
    { label: "Build tension slowly", tag: "smooth", feedback: "Excellent pacing." },
    { label: "Hold a confident pose", tag: "smooth", feedback: "Strong visual." },
    { label: "Rush the moment", tag: "awkward", feedback: "Timing feels off." },
    { label: "Pull back early", tag: "neutral", feedback: "Missed payoff." },
  ],
},
{
  prompt: "They glance away briefly.",
  choices: [
    { label: "Draw them back in", tag: "smooth", feedback: "Attention reclaimed." },
    { label: "Stay steady", tag: "neutral", feedback: "Keeps flow." },
    { label: "Pause uncertainly", tag: "awkward", feedback: "Momentum drops." },
    { label: "Get distracted too", tag: "awkward", feedback: "Connection breaks." },
  ],
},
{
  prompt: "You adjust your balance mid-move.",
  choices: [
    { label: "Turn it into a slow transition", tag: "smooth", feedback: "Nicely saved." },
    { label: "Reset confidently", tag: "smooth", feedback: "Professional recovery." },
    { label: "Laugh nervously", tag: "neutral", feedback: "A bit awkward." },
    { label: "Stumble visibly", tag: "awkward", feedback: "Hard to ignore." },
  ],
},
{
  prompt: "They seem fully engaged now.",
  choices: [
    { label: "Maintain control", tag: "smooth", feedback: "Exactly right." },
    { label: "Dial it up slightly", tag: "smooth", feedback: "Nice escalation." },
    { label: "Change style abruptly", tag: "awkward", feedback: "Disruptive shift." },
    { label: "Lose focus", tag: "awkward", feedback: "That costs you." },
  ],
},
{
  prompt: "The tempo drops unexpectedly.",
  choices: [
    { label: "Slow everything down", tag: "smooth", feedback: "Perfect adjustment." },
    { label: "Hold still briefly", tag: "smooth", feedback: "Creates tension." },
    { label: "Keep prior speed", tag: "awkward", feedback: "Feels mismatched." },
    { label: "Freeze awkwardly", tag: "awkward", feedback: "Kills the vibe." },
  ],
},
{
  prompt: "They lean in closer.",
  choices: [
    { label: "Stay composed", tag: "smooth", feedback: "Strong presence." },
    { label: "Match proximity calmly", tag: "smooth", feedback: "Nicely handled." },
    { label: "Pull away too fast", tag: "awkward", feedback: "Feels abrupt." },
    { label: "Overreact", tag: "awkward", feedback: "That breaks rhythm." },
  ],
},
{
  prompt: "The chair shifts under you again.",
  choices: [
    { label: "Use it as a transition", tag: "smooth", feedback: "Well played." },
    { label: "Reset posture smoothly", tag: "smooth", feedback: "Professional." },
    { label: "Get flustered", tag: "awkward", feedback: "Confidence drops." },
    { label: "Rush the movement", tag: "awkward", feedback: "Looks sloppy." },
  ],
},
{
  prompt: "They seem impressed but reserved.",
  choices: [
    { label: "Maintain subtlety", tag: "smooth", feedback: "Keeps them hooked." },
    { label: "Lean into confidence", tag: "smooth", feedback: "Strong finish." },
    { label: "Push too hard", tag: "awkward", feedback: "Oversteps the moment." },
    { label: "Pull back too much", tag: "neutral", feedback: "Loses momentum." },
  ],
},
{
  prompt: "The music nears its end.",
  choices: [
    { label: "Finish strong and controlled", tag: "smooth", feedback: "Excellent closer." },
    { label: "Hold a final pose", tag: "smooth", feedback: "Memorable." },
    { label: "Fade out early", tag: "neutral", feedback: "Safe ending." },
    { label: "Rush the finish", tag: "awkward", feedback: "Weak close." },
  ],
},
{
  prompt: "They watch you closely, expression unreadable.",
  choices: [
    { label: "Stay confident", tag: "smooth", feedback: "Confidence carries." },
    { label: "Slow things deliberately", tag: "smooth", feedback: "Keeps control." },
    { label: "Second-guess yourself", tag: "awkward", feedback: "Energy dips." },
    { label: "Overcorrect movements", tag: "awkward", feedback: "Looks forced." },
  ],
},
{
  prompt: "You feel the pressure to impress.",
  choices: [
    { label: "Focus on control", tag: "smooth", feedback: "That pays off." },
    { label: "Simplify your style", tag: "smooth", feedback: "Clean execution." },
    { label: "Try something flashy", tag: "awkward", feedback: "Doesn’t land." },
    { label: "Get inside your head", tag: "awkward", feedback: "Confidence fades." },
  ],
},
{
  prompt: "They relax completely into the chair.",
  choices: [
    { label: "Match their calm", tag: "smooth", feedback: "Perfect sync." },
    { label: "Slow, deliberate moves", tag: "smooth", feedback: "Nicely done." },
    { label: "Change pace suddenly", tag: "awkward", feedback: "Jarring shift." },
    { label: "Lose rhythm", tag: "awkward", feedback: "Noticeable slip." },
  ],
},
{
  prompt: "You sense the moment could go either way.",
  choices: [
    { label: "Trust your flow", tag: "smooth", feedback: "Confidence seals it." },
    { label: "Hold steady", tag: "neutral", feedback: "Safe choice." },
    { label: "Push too far", tag: "awkward", feedback: "That backfires." },
    { label: "Freeze up", tag: "awkward", feedback: "Moment lost." },
  ],
},
  ],
};
