// deploy-commands.js
// Robust guild-level slash command deployer.
// Works regardless of whether this file sits in project root or inside /commands.

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes } = require("discord.js");

// ---- CONFIG ----
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// Retired commands: do not deploy these
const RETIRED = new Set(["blackjack.js", "roulette.js"]);

// Find the commands directory reliably.
// Prefer "<projectRoot>/commands" using process.cwd().
// If that doesn't exist, try relative to this file.
function resolveCommandsDir() {
  const fromCwd = path.join(process.cwd(), "commands");
  if (fs.existsSync(fromCwd) && fs.statSync(fromCwd).isDirectory()) return fromCwd;

  const fromHere = path.join(__dirname, "commands");
  if (fs.existsSync(fromHere) && fs.statSync(fromHere).isDirectory()) return fromHere;

  // If this file is in /commands, then __dirname itself is the commands dir.
  if (fs.existsSync(__dirname) && fs.statSync(__dirname).isDirectory()) {
    const maybeHasCommands = fs
      .readdirSync(__dirname)
      .some((f) => f.endsWith(".js") && f !== path.basename(__filename));
    if (maybeHasCommands) return __dirname;
  }

  throw new Error(
    `Could not locate commands directory. Tried: ${fromCwd}, ${fromHere}, and __dirname.`
  );
}

if (!token) console.warn("⚠️ DISCORD_TOKEN is not set.");
if (!clientId) console.warn("⚠️ CLIENT_ID is not set.");
if (!guildId) console.warn("⚠️ GUILD_ID is not set.");

const commands = [];
const commandsDir = resolveCommandsDir();

for (const file of fs.readdirSync(commandsDir)) {
  if (!file.endsWith(".js")) continue;
  if (RETIRED.has(file)) continue;

  const filePath = path.join(commandsDir, file);
  const command = require(filePath);

  if (!command?.data?.toJSON) {
    console.warn(`⚠️ Skipping ${file} — missing "data" (SlashCommandBuilder).`);
    continue;
  }

  commands.push(command.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log(`Deploying ${commands.length} command(s) to guild...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log("✅ Guild commands deployed.");
  } catch (error) {
    console.error("❌ Deploy failed:", error);
    process.exitCode = 1;
  }
})();
