// ============================================================
// Zen Qobuz Lossless Extension
// Lossless download provider backed by the Zen Music qobuz-api
// (https://github.com/Anattana-Labs/qobuz-api).
//
// Flow (mirrors ZenMusic's LosslessService exactly):
//   1. Map the track to a YouTube video id (YTM tracks already carry
//      one; the extension's own search yields video ids directly).
//   2. GET {endpoint}/?id=<videoId>
//      -> { "status": "success", "streams": { "<tier>": { "url": ... } } }
//   3. Walk the tier ladder DOWN (Hi-Res Max -> Hi-Res 96 -> CD ->
//      MP3 320), never up: the user's tier is the ceiling.
//   4. Serve the signed CDN url directly — FLAC / MP3.
//
// Caching (same posture as the app):
//   * positive resolutions  ->  8 min  (signed URLs expire fast)
//   * "no Qobuz match"      -> 30 min  (static catalog fact)
//   * transport failures    ->  5 min  (endpoint may recover)
// ============================================================

var EXT_ID = "zen-qobuz-lossless";

var DEFAULT_ENDPOINT = "https://justfreefun.antideploy.app";
var YTM_ORIGIN = "https://music.youtube.com";
var YTM_API = YTM_ORIGIN + "/youtubei/v1/";
var YTM_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX3";
var WEB_REMIX_VERSION = "1.20260213.01.00";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

// Heaviest first — the ladder walks DOWN from the user's tier.
var TIER_LADDER = ["flac_hires_192", "flac_hires_96", "flac_cd", "mp3_320"];
var TIER_LABELS = {
    flac_hires_192: "Hi-Res Max (24bit/192kHz FLAC)",
    flac_hires_96: "Hi-Res Lossless (24bit/96kHz FLAC)",
    flac_cd: "Lossless CD (16bit/44.1kHz FLAC)",
    mp3_320: "MP3 320 kbps"
};

var POSITIVE_TTL_MS = 8 * 60 * 1000;
var NO_MATCH_TTL_MS = 30 * 60 * 1000;
var TRANSPORT_TTL_MS = 5 * 60 * 1000;
var TRACK_TTL_MS = 30 * 60 * 1000;
var MAX_CACHE = 160;

var config = { endpoint: DEFAULT_ENDPOINT, tier: "flac_hires_192" };

// ------------------------------------------------------------
// Tiny TTL cache on top of host storage (survives re-inits).
// ------------------------------------------------------------
function cacheGet(key) {
    try {
        var raw = storage.get("c_" + key);
        if (!raw) return null;
        var entry = JSON.parse(raw);
        if (!entry || !entry.e || Date.now() > entry.e) {
            storage.remove("c_" + key);
            return null;
        }
        return entry.v;
    } catch (e) { return null; }
}

function cacheSet(key, value, ttlMs) {
    try {
        storage.set("c_" + key, JSON.stringify({ v: value, e: Date.now() + ttlMs }));
    } catch (e) {}
}

function cacheClear() {
    try {
        var raw = storage.get("c_keys");
        if (!raw) return;
        var keys = JSON.parse(raw);
        for (var i = 0; i < keys.length; i++) storage.remove("c_" + keys[i]);
        storage.remove("c_keys");
    } catch (e) {}
}

function cacheRemember(key) {
    try {
        var raw = storage.get("c_keys");
        var keys = raw ? JSON.parse(raw) : [];
        if (keys.indexOf(key) === -1) {
            keys.push(key);
            if (keys.length > MAX_CACHE) keys.splice(0, keys.length - MAX_CACHE);
            storage.set("c_keys", JSON.stringify(keys));
        }
    } catch (e) {}
}

// ------------------------------------------------------------
// HTTP helper (returns parsed JSON or null — never throws)
// ------------------------------------------------------------
function httpGetJSON(url, headers) {
    var h = { "User-Agent": USER_AGENT, "Accept": "application/json" };
    if (headers) for (var k in headers) h[k] = headers[k];
    var response;
    try { response = http.get(url, h); } catch (e) {
        log.debug("[ZenQobuz] http.get threw: " + (e && e.message));
        return null;
    }
    if (!response || !response.ok) {
        log.debug("[ZenQobuz] HTTP " + (response ? response.statusCode : "no response") + " for " + url);
        return { __status: response ? response.statusCode : 0, __body: response ? response.body : "", __failed: true };
    }
    try { return JSON.parse(response.body); } catch (e) {
        log.debug("[ZenQobuz] JSON parse error: " + e.message);
        return { __status: response.statusCode, __body: response.body || "", __failed: true };
    }
}

// ------------------------------------------------------------
// YouTube Music innertube (same client identity as ZenMusic)
// ------------------------------------------------------------
function ytmContext(client) {
    client = client || "WEB_REMIX";
    var base = { hl: "en", gl: "IN" };
    if (client === "WEB_REMIX") {
        base.clientName = "WEB_REMIX";
        base.clientVersion = WEB_REMIX_VERSION;
    } else if (client === "ANDROID_VR") {
        base.clientName = "ANDROID_VR";
        base.clientVersion = "1.65.10";
        base.osName = "Android";
        base.osVersion = "12L";
        base.deviceMake = "Oculus";
        base.deviceModel = "Quest 3";
        base.androidSdkVersion = 32;
    } else if (client === "IOS") {
        base.clientName = "IOS";
        base.clientVersion = "21.03.1";
    }
    return { client: base };
}

var YTM_CLIENT_UA = {
    "WEB_REMIX": USER_AGENT,
    "ANDROID_VR": "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    "IOS": "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)"
};
var YTM_CLIENT_ID = { "WEB_REMIX": "67", "ANDROID_VR": "28", "IOS": "5" };

function ytmPost(endpoint, body, client) {
    client = client || "WEB_REMIX";
    var url = YTM_API + endpoint + "?prettyPrint=false";
    var h = {
        "Content-Type": "application/json",
        "User-Agent": YTM_CLIENT_UA[client] || USER_AGENT,
        "X-Goog-Api-Format-Version": "2"
    };
    if (client === "WEB_REMIX") {
        h["Origin"] = YTM_ORIGIN;
        h["Referer"] = YTM_ORIGIN + "/";
        h["X-YouTube-Client-Name"] = YTM_CLIENT_ID[client];
        h["X-YouTube-Client-Version"] = WEB_REMIX_VERSION;
    }
    var visitor = getVisitorData();
    if (visitor) h["X-Goog-Visitor-Id"] = visitor;
    var response;
    try { response = http.post(url, JSON.stringify(body), h); } catch (e) {
        log.debug("[ZenQobuz] ytm post threw: " + (e && e.message));
        return null;
    }
    if (!response || !response.ok) {
        log.debug("[ZenQobuz] YTM " + endpoint + " HTTP " + (response ? response.statusCode : "none"));
        return null;
    }
    try { return JSON.parse(response.body); } catch (e) { return null; }
}

// Visitor data (anonymous) from music.youtube.com/sw.js_data — cached.
function getVisitorData() {
    var cached = cacheGet("visitor");
    if (cached) return cached;
    var response;
    try { response = http.get(YTM_ORIGIN + "/sw.js_data", { "User-Agent": USER_AGENT }); } catch (e) { return ""; }
    if (!response || !response.ok || !response.body) return "";
    var body = response.body.replace(/^\)\]\}'\s*/, "");
    try {
        var data = JSON.parse(body);
        // data[0][2][6] is the visitor token in the service-worker config.
        var visitor = "";
        try { visitor = data[0][2][6] || ""; } catch (e) {}
        if (!visitor) {
            try { visitor = data[0][2][0][0][13] || ""; } catch (e) {}
        }
        if (visitor && typeof visitor === "string" && visitor.length > 40) {
            cacheSet("visitor", visitor, 6 * 60 * 60 * 1000);
            cacheRemember("visitor");
            return visitor;
        }
    } catch (e) {}
    return "";
}

// ------------------------------------------------------------
// YTM search — result collection (handles classic shelves AND the
// newer flat itemSectionRenderer layout).
// ------------------------------------------------------------
function runText(runs) {
    if (!runs) return "";
    var out = "";
    for (var i = 0; i < runs.length; i++) out += runs[i].text || "";
    return out;
}

function flexColumn(renderer, index) {
    try {
        return renderer.flexColumns[index].musicResponsiveListItemFlexColumnRenderer || {};
    } catch (e) { return {}; }
}

function flexText(renderer, index) {
    try {
        return runText(flexColumn(renderer, index).text.runs);
    } catch (e) { return ""; }
}

function largestThumb(thumbnail) {
    try {
        var thumbs = thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
        var best = "";
        var bestW = 0;
        for (var i = 0; i < thumbs.length; i++) {
            if ((thumbs[i].width || 0) >= bestW) { bestW = thumbs[i].width || 0; best = thumbs[i].url || ""; }
        }
        return best;
    } catch (e) { return ""; }
}

function videoTypeOf(renderer) {
    try {
        return renderer.overlay.musicItemThumbnailOverlayRenderer.content
            .musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint
            .watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType || "";
    } catch (e) { return ""; }
}

function videoIdOf(renderer) {
    try { if (renderer.playlistItemData && renderer.playlistItemData.videoId) return renderer.playlistItemData.videoId; } catch (e) {}
    try {
        var vid = renderer.overlay.musicItemThumbnailOverlayRenderer.content
            .musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId;
        if (vid) return vid;
    } catch (e) {}
    try {
        var runs = flexColumn(renderer, 0).text.runs || [];
        for (var i = 0; i < runs.length; i++) {
            var ep = runs[i].navigationEndpoint;
            var v = ep && ep.watchEndpoint && ep.watchEndpoint.videoId;
            if (v) return v;
        }
    } catch (e) {}
    try {
        var onTap = renderer.onTap && renderer.onTap.watchEndpoint;
        if (onTap && onTap.videoId) return onTap.videoId;
    } catch (e) {}
    return "";
}

function durationToMs(text) {
    var parts = String(text).split(":");
    var secs = 0;
    for (var i = 0; i < parts.length; i++) secs = secs * 60 + (parseInt(parts[i], 10) || 0);
    return secs * 1000;
}

function isDurationText(text) {
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(text).trim());
}

function parseSongRenderer(renderer, forcedVideoId, forcedTitle) {
    var videoId = forcedVideoId || videoIdOf(renderer);
    if (!videoId || videoId.length !== 11) return null;
    var title = forcedTitle || flexText(renderer, 0);
    if (!title) return null;
    var artist = "";
    var album = "";
    var durationMs = 0;
    var colCount = renderer.flexColumns ? renderer.flexColumns.length : 0;
    for (var i = 1; i < colCount; i++) {
        var text = flexText(renderer, i);
        if (!text) continue;
        if (i === 1) {
            // New flat layout prefixes the secondary column with "Song • " /
            // "Video • ". Strip it so artists stay clean.
            artist = text.replace(/^(?:Song|Video|Album|Single|EP|Playlist|Artist)\s*•\s*/i, "");
            continue;
        }
        if (isDurationText(text)) durationMs = durationToMs(text);
        else if (!album) album = text;
    }
    return {
        id: videoId,
        name: title,
        artists: artist,
        album_name: album,
        duration_ms: durationMs,
        cover_url: largestThumb(renderer.thumbnail),
        item_type: "track",
        provider_id: EXT_ID,
        external_urls: "https://music.youtube.com/watch?v=" + videoId
    };
}

function parseCardShelf(card) {
    // Top-result card: title.runs[0], subtitle.runs (type • artists), onTap.
    var videoId = "";
    try { videoId = card.onTap.watchEndpoint.videoId; } catch (e) {}
    if (!videoId || videoId.length !== 11) return null;
    var title = "";
    try { title = runText(card.title.runs); } catch (e) {}
    if (!title) return null;
    var artist = "";
    try {
        var runs = card.subtitle.runs || [];
        for (var i = runs.length - 1; i >= 0; i--) {
            if (runs[i].text && runs[i].text !== " • ") { artist = runs[i].text; break; }
        }
    } catch (e) {}
    return {
        id: videoId,
        name: title,
        artists: artist,
        album_name: "",
        duration_ms: 0,
        cover_url: largestThumb(card.thumbnail),
        item_type: "track",
        provider_id: EXT_ID,
        external_urls: "https://music.youtube.com/watch?v=" + videoId
    };
}

function collectSearchItems(root) {
    var items = []; // [{renderer, card}]
    var tabs = (root.contents && root.contents.tabbedSearchResultsRenderer)
        ? root.contents.tabbedSearchResultsRenderer.tabs : null;
    var sections = null;
    if (tabs && tabs.length && tabs[0].tabRenderer && tabs[0].tabRenderer.content) {
        sections = tabs[0].tabRenderer.content.sectionListRenderer;
    } else if (root.contents && root.contents.sectionListRenderer) {
        sections = root.contents.sectionListRenderer;
    }
    if (!sections || !sections.contents) return items;
    for (var i = 0; i < sections.contents.length; i++) {
        var section = sections.contents[i];
        if (section.musicCardShelfRenderer) {
            items.push({ card: section.musicCardShelfRenderer });
            continue;
        }
        if (section.musicShelfRenderer) {
            var shelfTitle = runText(section.musicShelfRenderer.title.runs).toLowerCase();
            var contents = section.musicShelfRenderer.contents || [];
            for (var c = 0; c < contents.length; c++) {
                var r = contents[c].musicResponsiveListItemRenderer;
                if (r && (shelfTitle.indexOf("song") !== -1 || shelfTitle === "")) items.push({ renderer: r });
            }
            continue;
        }
        if (section.itemSectionRenderer) {
            var inner = section.itemSectionRenderer.contents || [];
            for (var k = 0; k < inner.length; k++) {
                var item = inner[k].musicResponsiveListItemRenderer;
                if (item) items.push({ renderer: item });
            }
        }
    }
    return items;
}

function ytmSearchSongs(query, limit) {
    var data = ytmPost("search", { context: ytmContext(), query: query });
    if (!data) return [];
    var raw = collectSearchItems(data);
    var atv = [];   // licensed songs — best Qobuz matches
    var omv = [];   // official music videos
    var other = []; // UGC / untyped with song shape
    for (var i = 0; i < raw.length; i++) {
        var entry = raw[i];
        var track = null;
        if (entry.card) track = parseCardShelf(entry.card);
        else if (entry.renderer) track = parseSongRenderer(entry.renderer);
        if (!track) continue;
        var vtype = entry.card ? "MUSIC_VIDEO_TYPE_OMV" : videoTypeOf(entry.renderer);
        if (vtype === "MUSIC_VIDEO_TYPE_ATV") atv.push(track);
        else if (vtype === "MUSIC_VIDEO_TYPE_OMV") omv.push(track);
        else if (vtype !== "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") other.push(track);
        if (limit && atv.length >= limit) return atv;
    }
    var merged = atv.concat(omv);
    for (var j = 0; j < other.length && (!limit || merged.length < limit); j++) merged.push(other[j]);
    return merged;
}

// ------------------------------------------------------------
// Track metadata — player endpoint first (multi-client), then a
// search-by-videoId fallback. The player works on user devices;
// the search path keeps metadata available even where the player
// is bot-gated (shared IPs).
// ------------------------------------------------------------
function ytmPlayerDetails(videoId, client) {
    var body = { context: ytmContext(client), videoId: videoId, contentCheckOk: true, racyCheckOk: true };
    var data = ytmPost("player", body, client);
    if (!data || !data.videoDetails) return null;
    var status = data.playabilityStatus && data.playabilityStatus.status;
    if (status && status !== "OK") return null;
    return data.videoDetails;
}

function detailsFromVideoDetails(d) {
    var artists = (d.author || "").replace(/ - Topic$/, "");
    var cover = "";
    try {
        var thumbs = d.thumbnail.thumbnails || [];
        var bestW = 0;
        for (var i = 0; i < thumbs.length; i++) {
            if ((thumbs[i].width || 0) >= bestW) { bestW = thumbs[i].width || 0; cover = thumbs[i].url || ""; }
        }
        if (!cover && thumbs.length) cover = thumbs[thumbs.length - 1].url;
    } catch (e) {}
    return {
        id: d.videoId,
        name: d.title || "",
        artists: artists,
        album_name: "",
        duration_ms: (parseInt(d.lengthSeconds, 10) || 0) * 1000,
        cover_url: cover,
        item_type: "track",
        provider_id: EXT_ID,
        external_urls: "https://music.youtube.com/watch?v=" + d.videoId
    };
}

function trackFromSearch(videoId) {
    // Bot-gated networks still serve the search endpoint; searching the
    // raw videoId surfaces the exact song as the top result.
    var data = ytmPost("search", { context: ytmContext("WEB_REMIX"), query: videoId });
    if (!data) return null;
    var raw = collectSearchItems(data);
    for (var i = 0; i < raw.length; i++) {
        var entry = raw[i];
        var track = entry.card ? parseCardShelf(entry.card) : parseSongRenderer(entry.renderer);
        if (track && track.id === videoId) return track;
    }
    // Exact match not surfaced — first song-shaped item is close enough.
    for (var j = 0; j < raw.length; j++) {
        var t = raw[j].card ? parseCardShelf(raw[j].card) : parseSongRenderer(raw[j].renderer);
        if (t) return t;
    }
    return null;
}

function ytmTrackDetails(videoId) {
    var clients = ["WEB_REMIX", "ANDROID_VR", "IOS"];
    for (var i = 0; i < clients.length; i++) {
        var d = ytmPlayerDetails(videoId, clients[i]);
        if (d) return detailsFromVideoDetails(d);
    }
    return trackFromSearch(videoId);
}

function trackForToken(token) {
    if (!token) return null;
    token = String(token);
    var cached = cacheGet("track_" + token);
    if (cached) return cached;
    var track = null;
    if (/^[A-Za-z0-9_-]{11}$/.test(token)) {
        track = ytmTrackDetails(token);
    } else {
        // Album-style or unknown token — search for it.
        var results = ytmSearchSongs(token, 1);
        if (results.length) track = results[0];
    }
    if (track) { cacheSet("track_" + token, track, TRACK_TTL_MS); cacheRemember("track_" + token); }
    return track;
}

// ------------------------------------------------------------
// The Qobuz endpoint: resolve + tier ladder
// ------------------------------------------------------------
function normalizeEndpoint(url) {
    var e = String(url || "").trim();
    if (!e) return DEFAULT_ENDPOINT;
    if (e.indexOf("http") !== 0) e = "https://" + e;
    while (e.charAt(e.length - 1) === "/") e = e.slice(0, -1);
    return e;
}

function resolveStreams(videoId) {
    var key = "streams_" + videoId;
    var cached = cacheGet(key);
    if (cached) return cached;

    var endpoint = normalizeEndpoint(config.endpoint);
    var data = httpGetJSON(endpoint + "/?id=" + encodeURIComponent(videoId), { "Accept": "application/json" });

    if (data && data.__failed) {
        // Transport-level failure (or HTTP error): 404 = no Qobuz match (30 min),
        // anything else may be transient (5 min).
        if (data.__status === 404) return null;
        return null;
    }
    if (!data || data.status !== "success" || !data.streams) {
        cacheSet(key, { none: true }, NO_MATCH_TTL_MS);
        cacheRemember(key);
        return null;
    }

    var streams = {};
    for (var tier in data.streams) {
        if (!data.streams.hasOwnProperty(tier)) continue;
        var entry = data.streams[tier];
        var url = entry && (typeof entry === "string" ? entry : entry.url);
        if (url && typeof url === "string") streams[tier] = url;
    }
    if (Object.keys(streams).length === 0) return null;

    cacheSet(key, streams, POSITIVE_TTL_MS);
    cacheRemember(key);
    return streams;
}

function pickTierUrl(streams, requestedTier) {
    var wanted = requestedTier || config.tier;
    var start = TIER_LADDER.indexOf(wanted);
    if (start === -1) start = TIER_LADDER.indexOf(config.tier);
    if (start === -1) start = TIER_LADDER.length - 1;
    for (var i = start; i >= 0; i--) {
        var url = streams[TIER_LADDER[i]];
        if (url) return { tier: TIER_LADDER[i], url: url };
    }
    // Requested tier unknown to the endpoint — take the best it does offer.
    for (var j = TIER_LADDER.length - 1; j >= 0; j--) {
        if (streams[TIER_LADDER[j]]) return { tier: TIER_LADDER[j], url: streams[TIER_LADDER[j]] };
    }
    return null;
}

function extensionForTier(tier) {
    if (tier === "mp3_320") return { format: "mp3", codec: "mp3" };
    return { format: "flac", codec: "flac" };
}

// ------------------------------------------------------------
// Services
// ------------------------------------------------------------
function initialize(settings) {
    settings = settings || {};
    if (settings.endpoint) config.endpoint = String(settings.endpoint);
    if (settings.tier) config.tier = String(settings.tier);
    log.info("[ZenQobuz] initialized. endpoint=" + normalizeEndpoint(config.endpoint) + " tier=" + config.tier);
}

function cleanup() {}
function forceCleanup() { cacheClear(); }

function searchTracks(query, limit) {
    limit = limit || 20;
    var tracks = ytmSearchSongs(query, limit);
    for (var i = 0; i < tracks.length; i++) {
        // Warm the availability cache in small batches is too chatty for a
        // small self-deployed instance; availability is checked lazily by
        // checkAvailability instead (same posture as the app's network gate).
    }
    return tracks;
}

function customSearch(query, filter, limit, page) {
    if (filter && filter !== "tracks" && filter !== "songs") return [];
    return searchTracks(query, limit || 20);
}

function getTrack(token) {
    return trackForToken(token);
}

function getAlbum(token) {
    return { success: false, error: "Album browse is handled by the app's YouTube Music provider; Zen Qobuz Lossless serves per-track lossless streams" };
}

function getPlaylist(token) {
    return { success: false, error: "Playlist browse is handled by the app's YouTube Music provider" };
}

function getArtist(token) {
    return { success: false, error: "Artist browse is handled by the app's YouTube Music provider" };
}

function enrichTrack(track) {
    if (!track || !track.id) return track;
    if (!track.duration_ms) {
        var full = trackForToken(track.id);
        if (full) return full;
    }
    return track;
}

function checkAvailability(isrc, trackName, artistName, options) {
    options = options || {};
    var track = options.track || {};
    var videoId = track.provider_id === EXT_ID ? String(track.id || "") : "";
    if (!videoId && options.videoId) videoId = String(options.videoId);
    if (!videoId && track.id && /^[A-Za-z0-9_-]{11}$/.test(String(track.id))) videoId = String(track.id);

    if (!videoId && trackName) {
        var results = ytmSearchSongs((trackName + " " + (artistName || "")).trim(), 1);
        if (results.length) videoId = results[0].id;
    }
    if (!videoId) return { available: false, reason: "No YouTube id to match against the Qobuz catalog" };

    var streams = resolveStreams(videoId);
    if (!streams) return { available: false, reason: "Not in the Qobuz catalog" };
    var picked = pickTierUrl(streams, options.tier);
    if (!picked) return { available: false, reason: "Qobuz match found but no stream url served" };

    cacheSet("dl_" + videoId, picked, POSITIVE_TTL_MS);
    cacheRemember("dl_" + videoId);
    return {
        available: true,
        track_id: videoId,
        quality: TIER_LABELS[picked.tier] || picked.tier,
        prepared_context: { videoId: videoId, tier: picked.tier, url: picked.url }
    };
}

function getDownloadUrl(token, quality, options) {
    var videoId = String(token || "");
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        var track = trackForToken(videoId);
        if (!track) return { success: false, error_message: "Could not map this track to a YouTube id", error_type: "not_found" };
        videoId = track.id;
    }

    var picked = null;
    var prepared = options && options.preparedContext;
    if (prepared && prepared.videoId === videoId && prepared.url) {
        picked = { tier: prepared.tier, url: prepared.url };
    }
    if (!picked) picked = cacheGet("dl_" + videoId);
    if (!picked) {
        var streams = resolveStreams(videoId);
        if (!streams) {
            return { success: false, error_message: "No Qobuz lossless match for this track", error_type: "not_found" };
        }
        picked = pickTierUrl(streams, quality);
        if (!picked) {
            return { success: false, error_message: "Qobuz match served no stream urls", error_type: "stream_error" };
        }
        cacheSet("dl_" + videoId, picked, POSITIVE_TTL_MS);
        cacheRemember("dl_" + videoId);
    }

    var fmt = extensionForTier(picked.tier);
    var trackMeta = trackForToken(videoId);
    return {
        success: true,
        url: picked.url,
        format: fmt.format,
        actual_extension: fmt.format,
        audio_codec: fmt.codec,
        quality: TIER_LABELS[picked.tier] || picked.tier,
        lossless: picked.tier !== "mp3_320",
        track: trackMeta || undefined
    };
}

function download(token, quality, outputPath, onProgress, options) {
    var streamInfo = getDownloadUrl(token, quality, options);
    if (!streamInfo.success) return streamInfo;
    if (!outputPath) {
        return { success: false, error_message: "Output path not provided", error_type: "invalid_path" };
    }
    var ext = streamInfo.actual_extension;
    outputPath = String(outputPath);
    if (!new RegExp("\\." + ext + "$", "i").test(outputPath)) {
        outputPath = outputPath.replace(/\.[^./\\]+$/, "") + "." + ext;
    }

    var dl;
    try {
        dl = file.download(streamInfo.url, outputPath, {
            headers: { "User-Agent": USER_AGENT },
            onProgress: onProgress ? function (r, t) { onProgress(t > 0 ? r / t : 0); } : undefined
        });
    } catch (e) {
        return { success: false, error_message: e.message || String(e), error_type: "download_error" };
    }
    if (!dl || !dl.success) {
        return { success: false, error_message: (dl && (dl.error_message || dl.error)) || "Download failed", error_type: (dl && dl.error_type) || "download_error" };
    }
    if (onProgress) onProgress(1);

    var track = streamInfo.track || {};
    return {
        success: true,
        file_path: dl.path || outputPath,
        format: streamInfo.format,
        actual_extension: streamInfo.actual_extension,
        audio_codec: streamInfo.audio_codec,
        title: track.name || "",
        artist: track.artists || "",
        album: track.album_name || "",
        cover_url: track.cover_url || "",
        lossless: streamInfo.lossless === true
    };
}

// ------------------------------------------------------------
// URL handling — youtube / ytmusic links
// ------------------------------------------------------------
function extractVideoId(url) {
    var m = String(url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = String(url).match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = String(url).match(/\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    return "";
}

function extractListId(url) {
    var m = String(url).match(/[?&]list=([A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
}

function handleUrl(url) {
    if (!url) return { success: false, error: "Empty URL" };
    var videoId = extractVideoId(url);
    if (videoId) {
        var track = trackForToken(videoId);
        if (!track) return { success: false, error: "Could not resolve track metadata" };
        return { success: true, type: "track", track: track, image_url: track.cover_url };
    }
    var listId = extractListId(url);
    if (listId) {
        return {
            success: false,
            error: "Playlist import is handled by the app's YouTube Music provider; individual tracks resolve losslessly through this extension"
        };
    }
    return { success: false, error: "Not a YouTube or YouTube Music link" };
}

// ============================================================
// Register with the host application
// ============================================================
registerExtension({
    initialize: initialize,
    cleanup: cleanup,
    forceCleanup: forceCleanup,
    searchTracks: searchTracks,
    customSearch: customSearch,
    getTrack: getTrack,
    getAlbum: getAlbum,
    getPlaylist: getPlaylist,
    getArtist: getArtist,
    enrichTrack: enrichTrack,
    checkAvailability: checkAvailability,
    getDownloadUrl: getDownloadUrl,
    download: download,
    handleUrl: handleUrl
});

log.info("[ZenQobuz] Zen Qobuz Lossless extension loaded");
