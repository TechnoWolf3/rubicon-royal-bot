// utils/gamesHubState.js
// Simple channel-scoped “what game is active here?” state for /games hub.
// Keeps blackjack/roulette from stepping on each other without touching their internal maps.

const activeByChannel = new Map(); // channelId -> { type, state, ... }

const hubMessageByChannel = new Map(); // channelId -> messageId

function setHubMessage(channelId, messageId) {
  if (!channelId || !messageId) return;
  hubMessageByChannel.set(String(channelId), String(messageId));
}

async function updateHubMessage(channel) {
  try {
    if (!channel) return false;
    const channelId = String(channel.id);
    const messageId = hubMessageByChannel.get(channelId);
    if (!messageId) return false;

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg || !msg.editable) return false;

    const active = getActiveGame(channelId);
    const embed = msg.embeds?.[0];
    if (!embed) return false;

    // Build a new description with updated status line, leaving the rest as-is.
    const lines = (embed.description || "").split(/\n/);
    const statusLine = active?.type
      ? `🟡 Active game in this channel: **${active.type[0].toUpperCase() + active.type.slice(1)}**`
      : `🟢 No active game in this channel`;

    if (lines.length === 0) lines.push(statusLine);
    else lines[0] = statusLine;

    await msg.edit({ embeds: [{ ...embed.toJSON(), description: lines.join("\n") }] }).catch(() => null);
    return true;
  } catch {
    return false;
  }
}

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
  setHubMessage,
  updateHubMessage,
};
