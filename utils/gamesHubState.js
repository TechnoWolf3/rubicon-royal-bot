// utils/gamesHubState.js
// Simple channel-scoped “what game is active here?” state for /games hub.
// Keeps blackjack/roulette from stepping on each other without touching their internal maps.

const activeByChannel = new Map(); // channelId -> { type, state, ... }

function setActiveGame(channelId, info) {
  if (!channelId) return;
  activeByChannel.set(String(channelId), { ...(info || {}), updatedAt: Date.now() });
}

function updateActiveGame(channelId, patch) {
  if (!channelId) return;
  const key = String(channelId);
  const prev = activeByChannel.get(key) || {};
  activeByChannel.set(key, { ...prev, ...(patch || {}), updatedAt: Date.now() });
}

function clearActiveGame(channelId) {
  if (!channelId) return;
  activeByChannel.delete(String(channelId));
}

function getActiveGame(channelId) {
  if (!channelId) return null;
  return activeByChannel.get(String(channelId)) || null;
}

module.exports = {
  setActiveGame,
  updateActiveGame,
  clearActiveGame,
  getActiveGame,
};
