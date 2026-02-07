// utils/roleBoards.js
const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const BOARDS_DIR = path.join(process.cwd(), "data", "roleboards");

function listBoardIds() {
  if (!fs.existsSync(BOARDS_DIR)) return [];
  return fs
    .readdirSync(BOARDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

function loadBoard(boardId) {
  const file = path.join(BOARDS_DIR, `${boardId}.json`);
  if (!fs.existsSync(file)) {
    const err = new Error(`Board file not found: ${file}`);
    err.code = "BOARD_NOT_FOUND";
    throw err;
  }

  const raw = fs.readFileSync(file, "utf8");
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    const err = new Error(`Invalid JSON in ${file}: ${e.message}`);
    err.code = "BOARD_BAD_JSON";
    throw err;
  }

  // Basic validation
  if (!json.boardId || json.boardId !== boardId) {
    throw new Error(`boardId mismatch in ${file} (expected "${boardId}")`);
  }
  if (!json.title || !json.description) {
    throw new Error(`Missing title/description in ${file}`);
  }
  if (!Array.isArray(json.roles) || json.roles.length === 0) {
    throw new Error(`roles[] must be a non-empty array in ${file}`);
  }
  if (json.roles.length > 25) {
    throw new Error(`roles[] too large in ${file}. Max 25 buttons per message.`);
  }

  // Clean role items
  json.roles = json.roles.map((r, idx) => {
    if (!r.roleId || !r.buttonName) {
      throw new Error(`roles[${idx}] missing roleId/buttonName in ${file}`);
    }
    return {
      roleId: String(r.roleId),
      buttonName: String(r.buttonName).slice(0, 80),
      emoji: r.emoji ? String(r.emoji) : undefined,
      style: r.style ? String(r.style).toUpperCase() : "SECONDARY",
    };
  });

  json.channelId = json.channelId ? String(json.channelId) : null;

  return json;
}

function styleFromString(s) {
  switch (String(s).toUpperCase()) {
    case "PRIMARY":
      return ButtonStyle.Primary;
    case "SUCCESS":
      return ButtonStyle.Success;
    case "DANGER":
      return ButtonStyle.Danger;
    case "SECONDARY":
    default:
      return ButtonStyle.Secondary;
  }
}

function buildBoardMessage(board) {
  const embed = new EmbedBuilder()
    .setTitle(board.title)
    .setDescription(board.description);

  // Build buttons into rows of 5
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < board.roles.length; i++) {
    const item = board.roles[i];

    const btn = new ButtonBuilder()
      .setCustomId(`rr:${board.boardId}:${item.roleId}`)
      .setLabel(item.buttonName)
      .setStyle(styleFromString(item.style));

    if (item.emoji) btn.setEmoji(item.emoji);

    // 5 per row
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(btn);
  }
  if (currentRow.components.length) rows.push(currentRow);

  return { embeds: [embed], components: rows };
}

module.exports = {
  listBoardIds,
  loadBoard,
  buildBoardMessage,
};
