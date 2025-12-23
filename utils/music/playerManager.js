const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const playdl = require("play-dl");
const { buildPanelMessagePayload } = require("./panelView");

const guildPlayers = new Map();

// -----------------------------
// Spotify Bearer Token (Client Credentials)
// -----------------------------
let spotifyBearer = null;
let spotifyBearerExpiresAt = 0;

async function getSpotifyBearerToken() {
  const now = Date.now();
  if (spotifyBearer && now < spotifyBearerExpiresAt - 60_000) return spotifyBearer;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Spotify token request failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  spotifyBearer = data.access_token;
  spotifyBearerExpiresAt = now + (Number(data.expires_in || 3600) * 1000);
  return spotifyBearer;
}

function cleanSpotifyUrl(q) {
  if (!q || typeof q !== "string") return q;
  if (q.includes("open.spotify.com/")) return q.split("?")[0];
  return q;
}

function getSpotifyTypeAndId(q) {
  if (!q || typeof q !== "string") return null;

  const uri = q.match(/^spotify:(track|album|playlist):([a-zA-Z0-9]+)$/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };

  const url = q.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/i);
  if (url) return { type: url[1].toLowerCase(), id: url[2] };

  return null;
}

async function spotifyFetchJson(path) {
  const token = await getSpotifyBearerToken();
  if (!token) throw new Error("Spotify bearer token missing (SPOTIFY_CLIENT_ID/SECRET not set).");

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Spotify API error: ${res.status} ${txt}`);
  }

  return res.json();
}

// -----------------------------
// URL helpers
// -----------------------------
function normalizeYouTubeUrl(url) {
  if (!url || typeof url !== "string") return url;

  // youtu.be/<id> -> youtube.com/watch?v=<id>
  const short = url.match(/^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  if (short?.[1]) return `https://www.youtube.com/watch?v=${short[1]}`;

  // music.youtube.com -> www.youtube.com
  if (url.includes("music.youtube.com/watch")) {
    return url.replace("music.youtube.com", "www.youtube.com");
  }

  return url;
}

function pickUrl(obj) {
  if (!obj) return null;
  return (
    obj.url ||
    obj.permalink_url ||
    obj.permalink ||
    obj.link ||
    obj.webpage_url ||
    null
  );
}

// -----------------------------
// Playback
// -----------------------------
async function tryStartNext(state) {
  if (state.isStarting) return;
  if (state.player.state.status !== AudioPlayerStatus.Idle) return;
  if (!state.queue.length) return;

  state.isStarting = true;
  try {
    const next = state.queue.shift();
    state.now = next;

    if (!next?.url) throw new Error("Queue item missing url (cannot stream).");

    const streamUrl =
      next.platform === "youtube" ? normalizeYouTubeUrl(next.url) : next.url;

    const source = await playdl.stream(streamUrl, { quality: 2 });

    const resource = createAudioResource(source.stream, {
      inputType: source.type,
      inlineVolume: true,
    });

    if (resource.volume) resource.volume.setVolume(0.5);
    state.player.play(resource);
  } catch (e) {
    console.error("[music] failed to start next:", e);
    state.now = null;
    setImmediate(() => tryStartNext(state));
  } finally {
    state.isStarting = false;
  }
}

// -----------------------------
// Resolver (SC first, YT fallback)
// Queue items: { title, platform, url, requestedBy, source }
// -----------------------------
async function resolveOneFromTextPreferSoundCloud(text) {
  // 1) SoundCloud first
  const sc = await playdl
    .search(text, { limit: 1, source: { soundcloud: "tracks" } })
    .then((r) => r?.[0])
    .catch(() => null);

  const scUrl = pickUrl(sc);
  if (scUrl) {
    return {
      title: sc.name || sc.title || text,
      platform: "soundcloud",
      url: scUrl,
    };
  }

  // 2) YouTube fallback
  const yt = await playdl
    .search(text, { limit: 1, source: { youtube: "video" } })
    .then((r) => r?.[0])
    .catch(() => null);

  const ytUrl = pickUrl(yt);
  if (ytUrl) {
    return {
      title: yt.title || yt.name || text,
      platform: "youtube",
      url: normalizeYouTubeUrl(ytUrl),
    };
  }

  return null;
}

async function resolveToTracks(query, user) {
  const tracks = [];
  let cleaned = String(query ?? "").trim();

  // Spotify by pattern
  if (cleaned.includes("open.spotify.com/")) cleaned = cleanSpotifyUrl(cleaned);

  const spRef = getSpotifyTypeAndId(cleaned);
  if (spRef) {
    if (spRef.type === "track") {
      const t = await spotifyFetchJson(`/tracks/${spRef.id}`);
      const q = `${t.name} ${t.artists?.map((a) => a.name).join(" ") || ""}`.trim();
      const picked = await resolveOneFromTextPreferSoundCloud(q);
      if (picked) {
        tracks.push({
          title: picked.title,
          platform: picked.platform,
          url: picked.url,
          requestedBy: user,
          source: "spotify",
        });
      }
      return tracks;
    }

    if (spRef.type === "album") {
      const a = await spotifyFetchJson(`/albums/${spRef.id}`);
      const items = a.tracks?.items || [];
      for (const t of items) {
        const q = `${t.name} ${t.artists?.map((ar) => ar.name).join(" ") || ""}`.trim();
        const picked = await resolveOneFromTextPreferSoundCloud(q);
        if (!picked) continue;
        tracks.push({
          title: picked.title,
          platform: picked.platform,
          url: picked.url,
          requestedBy: user,
          source: "spotify",
        });
      }
      return tracks;
    }

    if (spRef.type === "playlist") {
      const p = await spotifyFetchJson(`/playlists/${spRef.id}`);
      const items = p.tracks?.items || [];
      for (const it of items) {
        const t = it?.track;
        if (!t?.name) continue;
        const q = `${t.name} ${t.artists?.map((ar) => ar.name).join(" ") || ""}`.trim();
        const picked = await resolveOneFromTextPreferSoundCloud(q);
        if (!picked) continue;
        tracks.push({
          title: picked.title,
          platform: picked.platform,
          url: picked.url,
          requestedBy: user,
          source: "spotify",
        });
      }
      return tracks;
    }
  }

  // Not Spotify — validate URL types
  const type = await playdl.validate(cleaned).catch(() => false);

  // SoundCloud direct
  if (type === "so_track") {
    tracks.push({
      title: "SoundCloud Track",
      platform: "soundcloud",
      url: cleaned,
      requestedBy: user,
      source: "soundcloud",
    });
    return tracks;
  }

  if (type === "so_playlist") {
    const pl = await playdl.soundcloud(cleaned);
    const items = await pl.all_tracks();

    for (const it of items) {
      const url = pickUrl(it);
      if (!url) continue;

      tracks.push({
        title: it?.name || it?.title || "SoundCloud Track",
        platform: "soundcloud",
        url,
        requestedBy: user,
        source: "soundcloud",
      });
    }
    return tracks;
  }

  // YouTube direct
  if (type === "yt_video") {
    tracks.push({
      title: "YouTube Track",
      platform: "youtube",
      url: normalizeYouTubeUrl(cleaned),
      requestedBy: user,
      source: "youtube",
    });
    return tracks;
  }

  if (type === "yt_playlist") {
    const pl = await playdl.playlist_info(cleaned);
    const vids = await pl.all_videos();

    for (const v of vids) {
      const url = pickUrl(v) || v?.url;
      if (!url) continue;

      tracks.push({
        title: v?.title || "YouTube Track",
        platform: "youtube",
        url: normalizeYouTubeUrl(url),
        requestedBy: user,
        source: "youtube",
      });
    }
    return tracks;
  }

  // Any other URL type → treat as text (stable UX)
  if (type) {
    const picked = await resolveOneFromTextPreferSoundCloud(cleaned);
    if (picked) {
      tracks.push({
        title: picked.title,
        platform: picked.platform,
        url: picked.url,
        requestedBy: user,
        source: "search",
      });
    }
    return tracks;
  }

  // Text search
  const picked = await resolveOneFromTextPreferSoundCloud(cleaned);
  if (picked) {
    tracks.push({
      title: picked.title,
      platform: picked.platform,
      url: picked.url,
      requestedBy: user,
      source: "search",
    });
  }

  return tracks;
}

// -----------------------------
// Public Player API
// -----------------------------
function getOrCreateGuildPlayer(guildId) {
  if (guildPlayers.has(guildId)) return guildPlayers.get(guildId);

  const state = {
    guildId,
    connection: null,
    player: createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    }),
    queue: [],
    now: null,
    loopMode: "off", // off | track | queue
    panel: {
      channelId: null,
      messageId: null,
    },
    isStarting: false,
  };

  state.player.on(AudioPlayerStatus.Idle, async () => {
    if (state.loopMode === "track" && state.now) {
      state.queue.unshift(state.now);
    } else if (state.loopMode === "queue" && state.now) {
      state.queue.push(state.now);
    }

    state.now = null;
    await tryStartNext(state);
  });

  state.player.on("error", async (err) => {
    console.error("[music] audio player error:", err);
    state.now = null;
    await tryStartNext(state);
  });

  const api = {
    state,

    async connect(voiceChannel) {
      const existing = getVoiceConnection(voiceChannel.guild.id);
      if (existing) state.connection = existing;

      if (!state.connection) {
        state.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        state.connection.subscribe(state.player);

        try {
          await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
        } catch (e) {
          console.error("[music] voice connection not ready:", e);
        }

        state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
          state.connection = null;
        });
      }
    },

    async enqueue(query, user) {
      const items = await resolveToTracks(query, user);
      if (!items.length) throw new Error("No tracks found for that query.");

      for (const t of items) state.queue.push(t);

      await tryStartNext(state);

      return {
        count: items.length,
        title: items[0]?.title,
      };
    },

    async ensurePanel(textChannel) {
      const payload = buildPanelMessagePayload(state);
      state.panel.channelId = textChannel.id;

      if (state.panel.messageId) {
        try {
          const msg = await textChannel.messages.fetch(state.panel.messageId);
          await msg.edit(payload);
          return;
        } catch {
          state.panel.messageId = null;
        }
      }

      const msg = await textChannel.send(payload);
      state.panel.messageId = msg.id;
    },

    async refreshPanel(client) {
      if (!state.panel.channelId || !state.panel.messageId) return;
      const guild = client.guilds.cache.get(state.guildId);
      const channel = guild?.channels?.cache?.get(state.panel.channelId);
      if (!channel?.isTextBased?.()) return;

      try {
        const msg = await channel.messages.fetch(state.panel.messageId);
        await msg.edit(buildPanelMessagePayload(state));
      } catch {}
    },

    async pauseToggle(client) {
      if (state.player.state.status === AudioPlayerStatus.Playing) state.player.pause();
      else state.player.unpause();
      await api.refreshPanel(client);
    },

    async skip(client) {
      state.player.stop(true);
      await api.refreshPanel(client);
    },

    async stop(client) {
      state.queue = [];
      state.now = null;
      state.player.stop(true);
      const conn = getVoiceConnection(state.guildId);
      conn?.destroy?.();
      state.connection = null;
      await api.refreshPanel(client);
    },

    async shuffle(client) {
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      await api.refreshPanel(client);
    },

    async cycleLoop(client) {
      state.loopMode =
        state.loopMode === "off" ? "track" : state.loopMode === "track" ? "queue" : "off";
      await api.refreshPanel(client);
    },

    async jumpTo(index, client) {
      if (index < 0 || index >= state.queue.length) return;
      const [picked] = state.queue.splice(index, 1);
      state.queue.unshift(picked);
      state.player.stop(true);
      await api.refreshPanel(client);
    },
  };

  guildPlayers.set(guildId, api);
  return api;
}

module.exports = { getOrCreateGuildPlayer };
