require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const commands = [];
const commandsPath = path.join(__dirname, "commands");
const RETIRED = new Set(["blackjack.js", "roulette.js"]);
// If you ever need to temporarily re-enable legacy commands, set:
//   INCLUDE_RETIRED_COMMANDS=true
const includeRetired = String(process.env.INCLUDE_RETIRED_COMMANDS || "").toLowerCase() === "true";

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => includeRetired || !RETIRED.has(f));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} command(s) to guild...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Guild commands deployed.");
  } catch (err) {
    console.error("❌ Deploy failed:", err);
  }
})();
