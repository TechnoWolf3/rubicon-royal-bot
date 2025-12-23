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

/**
 * Spotify token setup (metadata resolving)
 * Requires Railway env vars:
 * SPOTIFY_CLIENT_ID
 * SPOTIFY_CLIENT_SECRET
 */
try {
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    playdl.setToken({
      spotify: {
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      },
    });
  }
} catch (e) {
  console.error("[music] Spotify token init failed:", e);
}

function prettyUser(u) {
  if (!u) return "Unknown";
  return u.username ? u.username : (u.tag || "User");
}

function isSpotifyLinkOrUri(q) {
  if (!q || typeof q !== "string") return false;
  return (
    /open\.spotify\.com\/(track|album|playlist)\//i.test(q) ||
    /^spotify:(track|album|playlist):/i.test(q)
  );
}

function cleanSpotifyUrl(q) {
  if (!q || typeof q !== "string") return q;
  if (q.includes("open.spotify.com/")) return q.split("?")[0];
  return q;
}

async function tryStartNext(state) {
  if (state.isStarting) return;
  if (state.player.state.status !== AudioPlayerStatus.Idle) return;
  if (!state.queue.length) return;

  state.isStarting = true;
  try {
    const next = state.queue.shift();
    state.now = next;

    // ✅ unified streaming for both YouTube + SoundCloud via play-dl info objects
    const source = await playdl.stream_from_info(next.info);

    const resource = createAudioResource(source.stream, {
      inputType: source.type,
      inlineVolume: true,
    });

    if (resource.volume) resource.volume.setVolume(0.5);
    state.player.play(resource);
  } catch (e) {
    console.error("[music] failed to start next:", e);

    // If this track failed, clear it and try the next immediately
    state.now = null;
    setImmediate(() => tryStartNext(state));
  } finally {
    state.isStarting = false;
  }
}

async function resolveOneFromTextPreferSoundCloud(text) {
  // 1) SoundCloud first
  const sc = await playdl
    .search(text, { limit: 1, source: { soundcloud: "tracks" } })
    .then((r) => r?.[0])
    .catch(() => null);

  if (sc?.url) {
    const info = await playdl.soundcloud(sc.url);
    return {
      title: sc.name || text,
      platform: "soundcloud",
      info,
    };
  }

  // 2) YouTube fallback
  const yt = await playdl
    .search(text, { limit: 1, source: { youtube: "video" } })
    .then((r) => r?.[0])
    .catch(() => null);

  if (yt?.url) {
    const info = await playdl.video_info(yt.url);
    return {
      title: yt.title || text,
      platform: "youtube",
      info,
    };
  }

  return null;
}

/**
 * Resolve query into queue items.
 * Queue items are always:
 * { title, platform, info, requestedBy }
 */
async function resolveToTracks(query, user) {
  const tracks = [];
  let cleaned = String(query ?? "").trim();

  // Make Spotify links/URIs super reliable
  if (isSpotifyLinkOrUri(cleaned)) cleaned = cleanSpotifyUrl(cleaned);

  const type = await playdl.validate(cleaned).catch(() => false);

  // ---- SPOTIFY (metadata) -> prefer SoundCloud, fallback YouTube ----
  if (
    type === "sp_track" ||
    type === "sp_album" ||
    type === "sp_playlist" ||
    isSpotifyLinkOrUri(cleaned)
  ) {
    const sp = await playdl.spotify(cleaned);
    const list = type === "sp_track" ? [sp] : await sp.all_tracks();

    for (const t of list) {
      const q = `${t.name} ${t.artists?.map((a) => a.name).join(" ") || ""}`.trim();
      const picked = await resolveOneFromTextPreferSoundCloud(q);
      if (!picked) continue;

      tracks.push({
        title: picked.title,
        platform: picked.platform,
        info: picked.info,
        requestedBy: user,
        source: "spotify",
      });
    }

    return tracks;
  }

  // ---- SOUNDCLOUD DIRECT ----
  if (type === "so_track") {
    const info = await playdl.soundcloud(cleaned);
    tracks.push({
      title: info?.name || "SoundCloud Track",
      platform: "soundcloud",
      info,
      requestedBy: user,
      source: "soundcloud",
    });
    return tracks;
  }

  if (type === "so_playlist") {
    const pl = await playdl.soundcloud(cleaned); // playlist info
    const items = await pl.all_tracks();
    for (const it of items) {
      tracks.push({
        title: it?.name || "SoundCloud Track",
        platform: "soundcloud",
        info: it, // already track-like info
        requestedBy: user,
        source: "soundcloud",
      });
    }
    return tracks;
  }

  // ---- YOUTUBE DIRECT ----
  if (type === "yt_video") {
    const info = await playdl.video_info(cleaned);
    tracks.push({
      title: info?.video_details?.title || "YouTube Track",
      platform: "youtube",
      info,
      requestedBy: user,
      source: "youtube",
    });
    return tracks;
  }

  if (type === "yt_playlist") {
    const pl = await playdl.playlist_info(cleaned);
    const vids = await pl.all_videos();

    // NOTE: This can be heavy on large playlists.
    for (const v of vids) {
      const info = await playdl.video_info(v.url);
      tracks.push({
        title: v?.title || "YouTube Track",
        platform: "youtube",
        info,
        requestedBy: user,
        source: "youtube",
      });
    }
    return tracks;
  }

  // ---- ANY OTHER URL TYPE -> treat as search text (stable UX) ----
  if (type) {
    const picked = await resolveOneFromTextPreferSoundCloud(cleaned);
    if (picked) {
      tracks.push({
        title: picked.title,
        platform: picked.platform,
        info: picked.info,
        requestedBy: user,
        source: "search",
      });
    }
    return tracks;
  }

  // ---- TEXT SEARCH: prefer SoundCloud, fallback YouTube ----
  const picked = await resolveOneFromTextPreferSoundCloud(cleaned);
  if (picked) {
    tracks.push({
      title: picked.title,
      platform: picked.platform,
      info: picked.info,
      requestedBy: user,
      source: "search",
    });
  }

  return tracks;
}

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
      // Reuse existing connection if already in guild
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

      if (!items.length) {
        throw new Error("No tracks found for that query.");
      }

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
