module.exports = [
  {
    id: "example_10",
    name: "Example",
    description: "Do the thing 10 times.",
    category: "General",
    hidden: false,
    reward_coins: 0,
    reward_role_id: null,

    // Progress-driven achievement:
    progress: {
      key: "example_counter", // counter key stored in DB
      target: 10,
      mode: "count", // "count" or "max"
    },

    sort_order: 0,
  },
];
