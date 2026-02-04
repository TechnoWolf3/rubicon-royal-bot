// data/help/categories/gameBoss.js
module.exports = {
  id: "gameboss",
  order: 99,
  name: "Game Boss",
  emoji: "👑",
  blurb: "Admin / control panel commands (restricted).",

  commands: [
    { id: "addbalance", name: "/addbalance", short: "Add balance to a user.", detail: "**/addbalance**\nMint money for players." },
    { id: "addserverbal", name: "/addserverbal", short: "Adjust server bank balance.", detail: "**/addserverbal**\nMint money for the server." },
    { id: "board", name: "/board", short: "Manage Role boards.", detail: "**/board**\nCreate a Role board for players to accept and recieve roles." },
    { id: "cooldown", name: "/cooldown", short: "Manage cooldowns.", detail: "**/cooldown**\nChange player cooldown time for some/ all crimes." },
    { id: "invadmin", name: "/invadmin", short: "Inventory admin tools.", detail: "**/invadmin**\nChange inventory items of players." },
    { id: "patchboard", name: "/patchboard", short: "Manage patch notes board.", detail: "**/patchboard**\nAdd, append or delete patchboard notes in channels." },
    { id: "purge", name: "/purge", short: "Purge messages.", detail: "**/purge**\nClean up channels using /purge (# of messages)." },
    { id: "resetachievements", name: "/resetachievements", short: "Reset achievements.", detail: "**/resetachievements**\nReset the achievements of players to earn again." },
    { id: "serverbal", name: "/serverbal", short: "View server bank balance.", detail: "**/serverbal**\nCheck on the server economy." },
    { id: "setheat", name: "/setheat", short: "Set crime heat.", detail: "**/setheat**\nChange the heat level of players." },
    { id: "setjail", name: "/setjail", short: "Set jail status (admin).", detail: "**/setjail**\nChange the jail time of players." },
    { id: "shopadmin", name: "/shopadmin", short: "Shop admin tools.", detail: "**/shopadmin**\nAdd/ remove items from the shop." },
  ],
};
