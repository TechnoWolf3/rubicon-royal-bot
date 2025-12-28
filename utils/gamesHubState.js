// utils/gamesHubState.js
// Keeps track of the /games hub message and active game per channel so games can reuse/edit it.

const hubByChannel = new Map();       // channelId -> { messageId }
const activeByChannel = new Map();    // channelId -> { key, state, tableId }

function setHubMessage(channelId, messageId) {
  hubByChannel.set(channelId, { messageId });
}

function getHubMessageId(channelId) {
  return hubByChannel.get(channelId)?.messageId || null;
}

async function fetchHubMessage(channel) {
  const messageId = getHubMessageId(channel.id);
  if (!messageId) return null;
  try {
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

// --- active game helpers (used by commands/games.js for the board status) ---
function setActiveGame(channelId, info) {
  // info: { key: 'blackjack'|'roulette', state: 'lobby'|'running', tableId?: string }
  activeByChannel.set(channelId, { ...info });
}

function clearActiveGame(channelId) {
  activeByChannel.delete(channelId);
}

function getActiveGame(channelId) {
  return activeByChannel.get(channelId) || null;
}

module.exports = {
  setHubMessage,
  getHubMessageId,
  fetchHubMessage,
  setActiveGame,
  clearActiveGame,
  getActiveGame,
};
