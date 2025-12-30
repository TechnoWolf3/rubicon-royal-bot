// utils/gamesHubState.js
// Tracks the /games hub message per channel so game UIs can edit/replace it (no extra embeds).
// Also tracks which game is currently active in a channel for the hub status line.

const hubByChannel = new Map();      // channelId -> { messageId }
const activeByChannel = new Map();   // channelId -> { key, state, tableId }

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

function setActiveGame(channelId, info) {
  activeByChannel.set(channelId, { ...info });
}

function updateActiveGame(channelId, patch) {
  const prev = activeByChannel.get(channelId) || {};
  activeByChannel.set(channelId, { ...prev, ...patch });
  return activeByChannel.get(channelId);
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
  updateActiveGame,
};
