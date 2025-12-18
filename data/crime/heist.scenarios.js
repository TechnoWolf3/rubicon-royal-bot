// data/crime/heist.scenarios.js
// Heist (S4) + Major Heist (S5) scenario pools
//
// Engine idea (later):
// - For S4: use choice.heat / choice.lootAdd
// - For S5: use choice.heatMajor ?? choice.heat, choice.lootAddMajor ?? choice.lootAdd
//
// Supported choice fields (suggested):
// label, heat, heatMajor, lootAdd, lootAddMajor,
// maskless, camerasSeenYou, leftEvidence, witnesses, alarmTriggered, timeOverrun,
// usedGetawayCar, shotsFired, insideMan,
// scrubbedFootage, changedClothes, ditchedTools, routeSwapped, jammedCameras

module.exports = {
  // ----------------
  // SCOUT (intel & approach) — 2–3 steps
  // ----------------
  scout: [
    {
      id: "sc_shift_change",
      text: "You spot a shift change through the glass. Two staff overlap for a minute—more eyes, more confusion.",
      choices: [
        { label: "Exploit the overlap (move now)", heat: 8, heatMajor: 12, timeOverrun: true },
        { label: "Wait for the quiet minute", heat: -5, lootAdd: 0 },
        { label: "Walk in maskless to scout close", heat: 0, maskless: true, camerasSeenYou: true },
      ],
    },
    {
      id: "sc_camera_blindspot",
      text: "Your quick lap around the block shows a camera that *might* miss the side entrance—might.",
      choices: [
        { label: "Take the side entrance route", heat: 5, jammedCameras: true },
        { label: "Assume cameras saw you anyway", heat: 0, camerasSeenYou: true },
        { label: "Back off and re-scout from distance", heat: -8 },
      ],
    },
    {
      id: "sc_delivery_schedule",
      text: "A delivery schedule is taped inside the door. Predictable routines… predictable mistakes.",
      choices: [
        { label: "Hit near delivery time (chaos cover)", heat: 7, heatMajor: 10, witnesses: true, lootAdd: 1200, lootAddMajor: 2500 },
        { label: "Hit outside routine (cleaner, fewer people)", heat: -3, lootAdd: 600, lootAddMajor: 1200 },
        { label: "Steal the schedule photo (phone trail)", heat: 4, leftEvidence: true },
      ],
    },
    {
      id: "sc_inside_man_offer",
      text: "A jittery contact offers an inside tip: codes, patrol timing, a ‘door that sticks’. They want a cut.",
      choices: [
        { label: "Take the inside man (split loot)", heat: -5, insideMan: true, lootAdd: -1500, lootAddMajor: -4000 },
        { label: "Refuse—too many mouths", heat: 2 },
        { label: "Take tip but stiff them later", heat: 8, heatMajor: 12, insideMan: true, witnesses: true },
      ],
    },
    {
      id: "sc_police_patrols",
      text: "You hear a patrol cruise by twice in ten minutes. Either normal… or a bad week to be greedy.",
      choices: [
        { label: "Proceed anyway (you’ll be quick)", heat: 10, heatMajor: 15, timeOverrun: true },
        { label: "Delay and cool off", heat: -10 },
        { label: "Switch approach to reduce exposure", heat: 3, routeSwapped: true },
      ],
    },
    {
      id: "sc_loitering_bystanders",
      text: "A couple of late-night smokers linger near your intended entry point, chatting like they own the sidewalk.",
      choices: [
        { label: "Blend and wait them out", heat: -4 },
        { label: "Push through—act like you belong", heat: 4, maskless: true, witnesses: true },
        { label: "Force them to move (bad vibe)", heat: 12, heatMajor: 18, witnesses: true },
      ],
    },
  ],

  // ----------------
  // ENTRY (how you breach) — 2–3 steps
  // ----------------
  entry: [
    {
      id: "en_side_door_sticks",
      text: "The side door sticks. You can force it… but the noise will travel.",
      choices: [
        { label: "Force it fast", heat: 10, heatMajor: 16, alarmTriggered: true, timeOverrun: true },
        { label: "Work it patiently", heat: 5, timeOverrun: true },
        { label: "Abort and reroute to front (bold)", heat: 6, camerasSeenYou: true },
      ],
    },
    {
      id: "en_alarm_panel",
      text: "There’s an alarm panel right by entry. If you hit the wrong thing, it’s over.",
      choices: [
        { label: "Risk it (try to disarm)", heat: 8, heatMajor: 12, jammedCameras: true },
        { label: "Ignore and move fast", heat: 12, heatMajor: 18, alarmTriggered: true },
        { label: "Cover it and pass quietly", heat: 4 },
      ],
    },
    {
      id: "en_crowded_lobby",
      text: "The lobby has a couple customers. Not many—but enough to remember faces.",
      choices: [
        { label: "Mask up and commit", heat: 10, heatMajor: 14 },
        { label: "Go maskless to avoid suspicion", heat: 0, maskless: true, camerasSeenYou: true, witnesses: true },
        { label: "Wait for a clean moment", heat: -6 },
      ],
    },
    {
      id: "en_keypad_guess",
      text: "A keypad door blocks you. You can guess, brute it, or find another way.",
      choices: [
        { label: "Guess quickly (risky)", heat: 12, heatMajor: 18, timeOverrun: true, alarmTriggered: true },
        { label: "Brute entry (loud)", heat: 14, heatMajor: 22, alarmTriggered: true, witnesses: true },
        { label: "Find alternate entry route", heat: 6, routeSwapped: true },
      ],
    },
    {
      id: "en_uniforms",
      text: "You have uniforms in the bag. They’ll help you blend… until they don’t.",
      choices: [
        { label: "Use uniforms (blend in)", heat: 2, lootAdd: 800, lootAddMajor: 1800, camerasSeenYou: true },
        { label: "Skip uniforms, go direct", heat: 8, heatMajor: 12 },
        { label: "Use uniforms, but ditch later", heat: 4, changedClothes: true, leftEvidence: true },
      ],
    },
    {
      id: "en_getaway_ready",
      text: "Your ride is positioned. Plates are a question mark. The route is a question mark too.",
      choices: [
        { label: "Use a car (fast exit)", heat: 6, usedGetawayCar: true },
        { label: "Go on foot (cleaner)", heat: 3 },
        { label: "Use car + swap route twice", heat: 8, usedGetawayCar: true, routeSwapped: true },
      ],
    },
  ],

  // ----------------
  // INSIDE (control / stealth) — 2–3 steps
  // ----------------
  inside: [
    {
      id: "in_security_room",
      text: "You find the security room door. If you can kill cameras, everything gets easier.",
      choices: [
        { label: "Scrub footage (risky time)", heat: 8, heatMajor: 12, timeOverrun: true, scrubbedFootage: true },
        { label: "Jam cameras quickly", heat: 10, heatMajor: 14, jammedCameras: true },
        { label: "Ignore it—too risky", heat: 0, camerasSeenYou: true },
      ],
    },
    {
      id: "in_guard_rounds",
      text: "A guard’s footsteps drift closer. You have seconds to decide who you are.",
      choices: [
        { label: "Hide and let them pass", heat: 4, timeOverrun: true },
        { label: "Talk your way out (maskless)", heat: 0, maskless: true, witnesses: true, camerasSeenYou: true },
        { label: "Neutralize quietly (dark)", heat: 15, heatMajor: 22, leftEvidence: true },
      ],
    },
    {
      id: "in_radio_chatter",
      text: "Radio chatter crackles: ‘Check that door.’ They’re alert, but not panicked yet.",
      choices: [
        { label: "Move faster, accept the risk", heat: 10, heatMajor: 15, timeOverrun: true },
        { label: "Slow down and avoid mistakes", heat: 5 },
        { label: "Create a diversion deeper inside", heat: 12, heatMajor: 18, witnesses: true },
      ],
    },
    {
      id: "in_employee_spots_you",
      text: "An employee turns the corner and freezes. They recognize the situation instantly.",
      choices: [
        { label: "Let them run (hope)", heat: 12, heatMajor: 18, witnesses: true },
        { label: "Tie them up (time sink)", heat: 10, heatMajor: 16, timeOverrun: true, leftEvidence: true },
        { label: "Calm them—promise no harm", heat: 6, heatMajor: 10, witnesses: true },
      ],
    },
    {
      id: "in_gloves_torn",
      text: "Your glove tears on a rough edge. Tiny problem, huge consequences.",
      choices: [
        { label: "Ignore it and keep moving", heat: 8, leftEvidence: true },
        { label: "Stop and fix it (time)", heat: 6, timeOverrun: true, ditchedTools: true },
        { label: "Swap gloves, ditch the torn one", heat: 4, ditchedTools: true, leftEvidence: true },
      ],
    },
    {
      id: "in_lockdown_warning",
      text: "A screen flashes: LOCKDOWN SYSTEM ARMED. One mistake triggers sealed doors.",
      choices: [
        { label: "Proceed carefully (slow)", heat: 6, timeOverrun: true },
        { label: "Rush it (risk lockdown)", heat: 14, heatMajor: 20, alarmTriggered: true },
        { label: "Pull back and reroute", heat: 7, routeSwapped: true },
      ],
    },
  ],

  // ----------------
  // VAULT (the big moment) — 2–3 steps
  // ----------------
  vault: [
    {
      id: "va_time_lock",
      text: "The vault has a time lock. You can wait… or force… or improvise.",
      choices: [
        { label: "Wait it out (big reward, big risk)", heat: 16, heatMajor: 24, timeOverrun: true, lootAdd: 5000, lootAddMajor: 14000 },
        { label: "Force entry (loud)", heat: 18, heatMajor: 28, alarmTriggered: true, lootAdd: 3500, lootAddMajor: 9000 },
        { label: "Abort vault, hit secondary storage", heat: 8, lootAdd: 2000, lootAddMajor: 5000 },
      ],
    },
    {
      id: "va_laser_grid",
      text: "A laser grid hums faintly. It looks older than you expected, but that doesn’t mean forgiving.",
      choices: [
        { label: "Thread the lasers (skill check vibe)", heat: 10, heatMajor: 16, lootAdd: 3000, lootAddMajor: 8000 },
        { label: "Disable system (time)", heat: 12, heatMajor: 18, timeOverrun: true, jammedCameras: true, lootAdd: 4200, lootAddMajor: 12000 },
        { label: "Trip it and run (panic)", heat: 22, heatMajor: 32, alarmTriggered: true, witnesses: true },
      ],
    },
    {
      id: "va_inside_man_codes",
      text: "Your inside tip includes partial vault codes. Partial is the key word.",
      choices: [
        { label: "Use codes (best odds)", heat: 6, insideMan: true, lootAdd: 4500, lootAddMajor: 15000 },
        { label: "Doubt it—force entry instead", heat: 18, heatMajor: 26, alarmTriggered: true },
        { label: "Use codes but scrub cameras after", heat: 12, heatMajor: 18, insideMan: true, scrubbedFootage: true, timeOverrun: true },
      ],
    },
    {
      id: "va_guard_arrives",
      text: "A guard arrives mid-vault. They weren’t meant to be here yet.",
      choices: [
        { label: "Freeze and hide", heat: 10, heatMajor: 14, timeOverrun: true },
        { label: "Talk your way out (maskless)", heat: 0, maskless: true, camerasSeenYou: true, witnesses: true },
        { label: "Force them down (ugly)", heat: 20, heatMajor: 30, leftEvidence: true, witnesses: true },
      ],
    },
    {
      id: "va_drill_overheats",
      text: "The drill overheats. Smoke starts curling. This is where amateurs get caught.",
      choices: [
        { label: "Cool it down (time)", heat: 10, heatMajor: 14, timeOverrun: true, lootAdd: 2500, lootAddMajor: 7000 },
        { label: "Push it anyway", heat: 18, heatMajor: 26, alarmTriggered: true, lootAdd: 4000, lootAddMajor: 11000 },
        { label: "Switch tools, ditch drill", heat: 12, heatMajor: 18, ditchedTools: true, leftEvidence: true },
      ],
    },
    {
      id: "va_marked_bills",
      text: "You crack a bundle and realize some cash is marked. It’ll spend fine—until it doesn’t.",
      choices: [
        { label: "Take it anyway (more cash)", heat: 8, heatMajor: 12, lootAdd: 3500, lootAddMajor: 9000, leftEvidence: true },
        { label: "Leave it (stay clean)", heat: -3, lootAdd: 0 },
        { label: "Take it + plan cleanup later", heat: 12, heatMajor: 18, lootAdd: 3000, lootAddMajor: 8000, scrubbedFootage: true, timeOverrun: true },
      ],
    },
  ],

  // ----------------
  // LOOT (greed decisions) — 2–3 steps
  // ----------------
  loot: [
    {
      id: "lo_second_pass",
      text: "You could do a second pass for extra bags. It’s the difference between ‘good’ and ‘great’.",
      choices: [
        { label: "Second pass (greedy)", heat: 14, heatMajor: 20, timeOverrun: true, lootAdd: 6000, lootAddMajor: 16000 },
        { label: "Take what you have and move", heat: 5, lootAdd: 2000, lootAddMajor: 6000 },
        { label: "Split the difference (one quick grab)", heat: 10, heatMajor: 14, lootAdd: 4000, lootAddMajor: 11000 },
      ],
    },
    {
      id: "lo_heavy_bag",
      text: "The bag is heavy and loud. Coins, bars, something dumb. It’ll slow you down.",
      choices: [
        { label: "Carry it (risk stumble)", heat: 10, heatMajor: 14, timeOverrun: true, lootAdd: 3500, lootAddMajor: 9000 },
        { label: "Dump the heavy stuff", heat: -3, lootAdd: -1500, lootAddMajor: -4000, ditchedTools: true },
        { label: "Repack carefully (time)", heat: 8, heatMajor: 12, timeOverrun: true, changedClothes: true },
      ],
    },
    {
      id: "lo_crew_argument",
      text: "Someone in the crew wants more. Loud whispers. Ego. The fastest way to die is to debate mid-crime.",
      choices: [
        { label: "Shut it down (move now)", heat: 6, lootAdd: 0 },
        { label: "Take more to appease them", heat: 12, heatMajor: 18, timeOverrun: true, lootAdd: 4500, lootAddMajor: 12000 },
        { label: "Split up to loot faster (risky)", heat: 14, heatMajor: 22, witnesses: true, lootAdd: 6000, lootAddMajor: 15000 },
      ],
    },
    {
      id: "lo_alarm_countdown",
      text: "A silent countdown ticks on a panel. You don’t know if it’s real—only that it *feels* real.",
      choices: [
        { label: "Grab and run", heat: 10, heatMajor: 14, lootAdd: 3500, lootAddMajor: 9000 },
        { label: "Stop and disable (time)", heat: 12, heatMajor: 18, timeOverrun: true, jammedCameras: true },
        { label: "Panic grab (messy)", heat: 18, heatMajor: 26, leftEvidence: true, witnesses: true, lootAdd: 4500, lootAddMajor: 12000 },
      ],
    },
    {
      id: "lo_bag_tears",
      text: "Your bag strap threatens to tear. If it goes, it’s a trail of money and panic.",
      choices: [
        { label: "Reinforce it (time)", heat: 8, heatMajor: 12, timeOverrun: true },
        { label: "Dump some loot to save the run", heat: -2, lootAdd: -3000, lootAddMajor: -8000, ditchedTools: true },
        { label: "Risk it and sprint", heat: 14, heatMajor: 20, witnesses: true, leftEvidence: true },
      ],
    },
    {
      id: "lo_shots_option",
      text: "A shadow moves near the corridor. Someone might be blocking your exit route.",
      choices: [
        { label: "Avoid them (quiet reroute)", heat: 8, routeSwapped: true },
        { label: "Confront and bluff", heat: 12, heatMajor: 16, witnesses: true },
        { label: "Fire a warning shot (chaos)", heat: 26, heatMajor: 38, shotsFired: true, alarmTriggered: true, witnesses: true },
      ],
    },
  ],

  // ----------------
  // ESCAPE (route choices) — 2–3 steps
  // ----------------
  escape: [
    {
      id: "es_front_exit_cameras",
      text: "Front exit is fastest—but the camera angle there is perfect.",
      choices: [
        { label: "Take front anyway (fast)", heat: 12, heatMajor: 18, camerasSeenYou: true, witnesses: true },
        { label: "Back exit (slower, safer)", heat: 6, timeOverrun: true },
        { label: "Back exit + swap route twice", heat: 10, heatMajor: 14, routeSwapped: true },
      ],
    },
    {
      id: "es_getaway_car_spotlight",
      text: "Your car is where you left it—but it feels like it’s under a spotlight.",
      choices: [
        { label: "Use car immediately", heat: 10, heatMajor: 14, usedGetawayCar: true },
        { label: "Walk it out, meet car later", heat: 6, routeSwapped: true },
        { label: "Steal a random ride (chaos)", heat: 16, heatMajor: 22, usedGetawayCar: true, witnesses: true },
      ],
    },
    {
      id: "es_police_siren_close",
      text: "A siren is closer now. Not ‘distance’ close—*close* close.",
      choices: [
        { label: "Cut through alleys", heat: 10, heatMajor: 14, routeSwapped: true, timeOverrun: true },
        { label: "Blend in (walk normal)", heat: 4, maskless: true, camerasSeenYou: true },
        { label: "Sprint (looks guilty)", heat: 14, heatMajor: 20, witnesses: true },
      ],
    },
    {
      id: "es_crowd_bottleneck",
      text: "A small crowd forms ahead—someone yelling, someone recording, everyone watching everything.",
      choices: [
        { label: "Blend through crowd", heat: 6, camerasSeenYou: true, witnesses: true },
        { label: "Detour (lose time)", heat: 8, heatMajor: 12, timeOverrun: true, routeSwapped: true },
        { label: "Force your way through", heat: 18, heatMajor: 26, witnesses: true },
      ],
    },
    {
      id: "es_tool_drop",
      text: "Something metal clinks. A tool slips. If it’s left behind, it’s a signature.",
      choices: [
        { label: "Pick it up (time)", heat: 8, heatMajor: 12, timeOverrun: true },
        { label: "Leave it (clean exit priority)", heat: 10, leftEvidence: true },
        { label: "Kick it away into darkness", heat: 6, leftEvidence: true },
      ],
    },
    {
      id: "es_wrong_turn",
      text: "You take a turn and immediately regret it—dead end vibes, too quiet, too exposed.",
      choices: [
        { label: "Backtrack (time)", heat: 10, heatMajor: 14, timeOverrun: true },
        { label: "Climb / squeeze through a gap", heat: 12, heatMajor: 18, leftEvidence: true },
        { label: "Break into a building to cut through", heat: 16, heatMajor: 24, witnesses: true },
      ],
    },
  ],

  // ----------------
  // CLEANUP (post-heist mitigation) — 2–3 steps
  // ----------------
  cleanUp: [
    {
      id: "cu_change_clothes",
      text: "You find a dark corner and a bin. You can change layers fast… or keep moving.",
      choices: [
        { label: "Change clothes", heat: -8, changedClothes: true },
        { label: "Keep moving (no stops)", heat: 0 },
        { label: "Change + ditch tools", heat: -6, changedClothes: true, ditchedTools: true, leftEvidence: true },
      ],
    },
    {
      id: "cu_scrub_footage",
      text: "You have a window to mess with cameras remotely. It’s not clean, but it might save you.",
      choices: [
        { label: "Scrub footage (time + risk)", heat: 10, heatMajor: 14, timeOverrun: true, scrubbedFootage: true },
        { label: "Jam future access and bail", heat: 6, jammedCameras: true },
        { label: "Don’t touch it (less trace)", heat: -2 },
      ],
    },
    {
      id: "cu_dump_evidence",
      text: "You’ve got gloves, packaging, tape—small stuff that becomes big stuff later.",
      choices: [
        { label: "Dump evidence hard", heat: -10, ditchedTools: true, scrubbedFootage: true },
        { label: "Keep it (paranoia later)", heat: 0, leftEvidence: true },
        { label: "Dump only the obvious bits", heat: -6, ditchedTools: true },
      ],
    },
    {
      id: "cu_launder_route",
      text: "You can move the loot immediately… or sit on it until heat dies down.",
      choices: [
        { label: "Move it now (risk trail)", heat: 10, heatMajor: 14, leftEvidence: true, lootAdd: 1500, lootAddMajor: 3500 },
        { label: "Sit on it, lay low", heat: -6 },
        { label: "Move a small portion, stash the rest", heat: 4, lootAdd: 800, lootAddMajor: 2000 },
      ],
    },
    {
      id: "cu_route_swap",
      text: "You feel like you’re being watched. Might be nothing. Might be everything.",
      choices: [
        { label: "Swap routes twice", heat: -6, routeSwapped: true },
        { label: "Duck into a crowd and blend", heat: -3, camerasSeenYou: true },
        { label: "Sprint home (panic)", heat: 10, heatMajor: 14, witnesses: true },
      ],
    },
    {
      id: "cu_inside_man_payment",
      text: "Your inside man pings you for payment. Ignoring them could create a new problem.",
      choices: [
        { label: "Pay them (cleaner)", heat: -4, lootAdd: -2000, lootAddMajor: -6000, insideMan: true },
        { label: "Ignore them", heat: 6, heatMajor: 10, witnesses: true },
        { label: "Threaten them to stay quiet", heat: 14, heatMajor: 20, witnesses: true },
      ],
    },
  ],
};
