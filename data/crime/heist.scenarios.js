// data/crime/heist.scenarios.js
// Rebalanced for long-form, high-stakes but winnable heists

module.exports = {
  // ----------------
  // SCOUT — low heat, planning phase
  // ----------------
  scout: [
    {
      id: "sc_shift_change",
      text: "You notice a brief staff overlap during shift change. Confusing, but busy.",
      choices: [
        { label: "Wait it out and observe", heat: -4 },
        { label: "Blend in nearby", heat: 1, maskless: true, camerasSeenYou: true },
        { label: "Move during the overlap", heat: 3, timeOverrun: true },
      ],
    },
    {
      id: "sc_camera_blindspot",
      text: "A side entrance might be in a camera blind spot — hard to tell from here.",
      choices: [
        { label: "Take note and proceed carefully", heat: 1 },
        { label: "Back off and rescope", heat: -5 },
        { label: "Assume the camera saw you", heat: 0, camerasSeenYou: true },
      ],
    },
    {
      id: "sc_police_patrols",
      text: "A patrol rolls by. Normal presence, nothing aggressive yet.",
      choices: [
        { label: "Pause and let them pass", heat: -6 },
        { label: "Proceed slowly", heat: 2 },
        { label: "Rush before they loop back", heat: 4, timeOverrun: true },
      ],
    },
  ],

  // ----------------
  // ENTRY — controlled risk
  // ----------------
  entry: [
    {
      id: "en_side_door",
      text: "The side door sticks slightly.",
      choices: [
        { label: "Work it patiently", heat: 2, timeOverrun: true },
        { label: "Force it quickly", heat: 6, alarmTriggered: true },
        { label: "Abort and reroute", heat: 3, routeSwapped: true },
      ],
    },
    {
      id: "en_lobby_presence",
      text: "A couple of late customers linger in the lobby.",
      choices: [
        { label: "Wait for a clear moment", heat: -5 },
        { label: "Mask up and move through", heat: 4 },
        { label: "Go maskless and blend", heat: 1, maskless: true, witnesses: true },
      ],
    },
  ],

  // ----------------
  // INSIDE — pressure begins
  // ----------------
  inside: [
    {
      id: "in_security_room",
      text: "You locate the security room controlling internal cameras.",
      choices: [
        { label: "Ignore it for now", heat: 0, camerasSeenYou: true },
        { label: "Jam cameras quickly", heat: 4, jammedCameras: true },
        { label: "Scrub footage (takes time)", heat: 5, timeOverrun: true, scrubbedFootage: true },
      ],
    },
    {
      id: "in_guard_pass",
      text: "Footsteps echo nearby — a guard doing rounds.",
      choices: [
        { label: "Hide and wait", heat: 2 },
        { label: "Talk your way past", heat: 1, maskless: true, witnesses: true },
        { label: "Neutralize quietly", heat: 8, leftEvidence: true },
      ],
    },
  ],

  // ----------------
  // VAULT — major risk / reward
  // ----------------
  vault: [
    {
      id: "va_time_lock",
      text: "The vault is on a time lock.",
      choices: [
        { label: "Wait it out", heat: 6, timeOverrun: true, lootAdd: 4000, lootAddMajor: 12000 },
        { label: "Force it", heat: 14, heatMajor: 20, alarmTriggered: true, lootAdd: 3000 },
        { label: "Abort vault for side storage", heat: 4, lootAdd: 1500 },
      ],
    },
    {
      id: "va_laser_grid",
      text: "A laser grid hums faintly.",
      choices: [
        { label: "Carefully thread through", heat: 5, lootAdd: 2500 },
        { label: "Disable system", heat: 8, timeOverrun: true, lootAdd: 3500 },
        { label: "Trip it and rush", heat: 18, heatMajor: 26, alarmTriggered: true },
      ],
    },
  ],

  // ----------------
  // LOOT — greed decisions
  // ----------------
  loot: [
    {
      id: "lo_second_pass",
      text: "You could grab more before leaving.",
      choices: [
        { label: "Leave now", heat: -2 },
        { label: "Quick extra grab", heat: 6, lootAdd: 3000 },
        { label: "Go all in", heat: 12, heatMajor: 18, timeOverrun: true, lootAdd: 6000 },
      ],
    },
    {
      id: "lo_heavy_bag",
      text: "One bag is heavy and awkward.",
      choices: [
        { label: "Dump some weight", heat: -4, lootAdd: -2000 },
        { label: "Carry it carefully", heat: 4 },
        { label: "Sprint with it", heat: 10, witnesses: true },
      ],
    },
  ],

  // ----------------
  // ESCAPE — most dangerous phase
  // ----------------
  escape: [
    {
      id: "es_exit_choice",
      text: "You reach the exit routes.",
      choices: [
        { label: "Back exit, slow and steady", heat: 4 },
        { label: "Front exit, fast", heat: 10, witnesses: true },
        { label: "Detour through alleys", heat: 8, routeSwapped: true },
      ],
    },
    {
      id: "es_siren_close",
      text: "A siren sounds nearby.",
      choices: [
        { label: "Blend in and walk", heat: 3, maskless: true },
        { label: "Cut through side streets", heat: 8, routeSwapped: true },
        { label: "Run hard", heat: 14, heatMajor: 20, witnesses: true },
      ],
    },
  ],

  // ----------------
  // CLEANUP — recovery phase
  // ----------------
  cleanUp: [
    {
      id: "cu_change_clothes",
      text: "You duck into cover and have a moment.",
      choices: [
        { label: "Change clothes", heat: -8, changedClothes: true },
        { label: "Keep moving", heat: 0 },
        { label: "Change and ditch tools", heat: -6, ditchedTools: true },
      ],
    },
    {
      id: "cu_dump_evidence",
      text: "You still have minor evidence on you.",
      choices: [
        { label: "Dump everything", heat: -10, ditchedTools: true },
        { label: "Dump some of it", heat: -4 },
        { label: "Keep it", heat: 2, leftEvidence: true },
      ],
    },
  ],
};
