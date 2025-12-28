// utils/gamesHubState.js
// Keeps track of the /games hub message per channel so games can reuse/edit it.
const hubByChannel = new Map(); // channelId -> { messageId }

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

module.exports = {
  setHubMessage,
  getHubMessageId,
  fetchHubMessage,
};
