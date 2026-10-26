// ============================================================
// Zen Lossless (Qobuz) Extension
// Bridges the ZenMusic qobuz-api endpoint
//   GET {endpoint}?id=<youtubeVideoId>
//   -> { status:"success", streams:{ mp3_320|flac_cd|flac_hires_96|flac_hires_192 : {url,...} } }
// (Same backend that powers lossless streaming in ZenMusic)
// ============================================================

var EXT_ID = "zen-lossless";
var DEFAULT_ENDPOINT = "https://justfreefun.antideploy.app/";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- settings / logging ------------------------------------
var LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
var currentLogLevel = "warn";

function L(level, msg) {
    try {
        if ((LOG_LEVELS[level] || 1) <= (LOG_LEVELS[currentLogLevel] || 1)) {
            var fn = log[level] || log.debug;
            fn("[zen-lossless] " + msg);
        }
    } catch (e) { /* logging must never throw */ }
}

function getSetting(key, fallback) {
    try {
        var v = storage.get(key);
        return (v === undefined || v === null || v === "") ? fallback : v;
    } catch (e) { return fallback; }
}

function getEndpoint() {
    var ep = String(getSetting("endpoint", DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT).trim();
    if (!/^https?:\/\//i.test(ep)) ep = "https://" + ep;
    while (ep.charAt(ep.length - 1) === "/") ep = ep.slice(0, -1);
    return ep;
}

function enc(s) {
    if (typeof encodeURIComponent === "function") return encodeURIComponent(s);
    return String(s).replace(/[^A-Za-z0-9_.~-]/g, function (c) {
        var h = c.charCodeAt(0).toString(16).toUpperCase();
        while (h.length < 2) h = "0" + h;
        return "%" + h;
    });
}

// ---- caches -------------------------------------------------
var MEM = { streams: {}, tracks: {} };
var STREAM_TTL = 30 * 60 * 1000;   // resolved streams: 30 min
var NEG_TTL = 10 * 60 * 1000;      // "not in catalog": 10 min
var MAX_CACHE = 200;

function memEvict(map) {
    var keys = Object.keys(map);
    while (keys.length > MAX_CACHE) { delete map[keys[0]]; keys.shift(); }
}

function getCache(map, key) {
    var hit = map[key];
    if (hit && hit.expiry && Date.now() < hit.expiry) return hit.value;
    if (hit) delete map[key];
    return null;
}

function putCache(map, key, value, ttl) {
    map[key] = { value: value, expiry: Date.now() + ttl };
    memEvict(map);
}

function storageGetJson(key) {
    try {
        var raw = storage.get("zl_" + key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function storageSetJson(key, value) {
    try { storage.set("zl_" + key, JSON.stringify(value)); } catch (e) { }
}

// ---- HTTP helpers -------------------------------------------
// The Mornye runtime exposes a synchronous fetch(); some builds only
// expose http.get — both are supported here.
function httpGetJson(url) {
    try {
        var res = fetch(url, {
            method: "GET",
            headers: { "Accept": "application/json", "User-Agent": UA }
        });
        if (res && res.ok) {
            try { return res.json(); } catch (e) { }
            try { return JSON.parse(res.text()); } catch (e2) { }
            return null;
        }
    } catch (e) { L("debug", "fetch GET failed: " + e); }
    try {
        var r = http.get(url, { "Accept": "application/json", "User-Agent": UA });
        if (r && r.ok) return JSON.parse(r.body);
    } catch (e2) { L("debug", "http.get failed: " + e2); }
    return null;
}

function httpPostJson(url, body, headers) {
    var h = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA };
    if (headers) for (var k in headers) h[k] = headers[k];
    try {
        var res = fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
        if (res && res.ok) {
            try { return res.json(); } catch (e) { }
            try { return JSON.parse(res.text()); } catch (e2) { }
        }
    } catch (e) { L("debug", "fetch POST failed: " + e); }
    return null;
}

// ---- YouTube Music InnerTube (metadata + matching only) -----
var IT_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
var IT_SEARCH = "https://music.youtube.com/youtubei/v1/search?key=" + IT_KEY + "&prettyPrint=false";
var IT_PLAYER = "https://music.youtube.com/youtubei/v1/player?key=" + IT_KEY + "&prettyPrint=false";
var IT_CONTEXT = {
    client: {
        clientName: "WEB_REMIX",
        clientVersion: "1.20240403.01.00",
        hl: "en",
        gl: "US"
    }
};
var FILTER_SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
var FILTER_VIDEOS = "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D";

function itSearch(query, params) {
    var body = { context: IT_CONTEXT, query: query, params: params };
    return httpPostJson(IT_SEARCH, body, { "Origin": "https://music.youtube.com", "Referer": "https://music.youtube.com/" });
}

function itPlayer(videoId) {
    var body = { context: IT_CONTEXT, videoId: videoId };
    return httpPostJson(IT_PLAYER, body, { "Origin": "https://music.youtube.com", "Referer": "https://music.youtube.com/" });
}

function col(r, i) {
    try { return r.flexColumns[i].musicResponsiveListItemFlexColumnRenderer; } catch (e) { return null; }
}

function colText(c) {
    try {
        var runs = c.text.runs, s = "";
        for (var i = 0; i < runs.length; i++) s += runs[i].text;
        return s;
    } catch (e) { return ""; }
}

function colFirst(c) {
    try { return c.text.runs[0].text || ""; } catch (e) { return ""; }
}

function parseDurationMs(text) {
    var m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(text || ""));
    if (!m) return 0;
    if (m[3] !== undefined) return (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000;
    return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
}

function parseItem(r) {
    try {
        var videoId = null;
        if (r.playlistItemData && r.playlistItemData.videoId) videoId = r.playlistItemData.videoId;
        if (!videoId) {
            try { videoId = r.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint.watchEndpoint.videoId; } catch (e) { }
        }
        if (!videoId) {
            try { videoId = r.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId; } catch (e) { }
        }
        if (!videoId || videoId.length !== 11) return null;

        var c0 = col(r, 0), c1 = col(r, 1), c2 = col(r, 2), c3 = col(r, 3);
        var title = colFirst(c0) || "";
        var artist = colText(c1) || "";
        var album = "";
        var durationText = colText(c3);
        // shelf layouts differ: album may be col2, duration col3; when only 3
        // columns the last one carries "artist - album - duration"
        var subtitle = colText(c1) + " " + colText(c2) + " " + colText(c3);
        var dm = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(subtitle);
        var durationMs = dm ? parseDurationMs(dm[1]) : 0;
        if (colText(c2) && !/^\s*\d{1,2}:\d{2}/.test(colText(c2))) album = colText(c2).split(" • ")[0];

        var thumb = "";
        try {
            var thumbs = r.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
            for (var i = thumbs.length - 1; i >= 0; i--) {
                if (thumbs[i] && thumbs[i].url) { thumb = thumbs[i].url; break; }
            }
            if (thumb && thumb.indexOf("//") === 0) thumb = "https:" + thumb;
        } catch (e) { }

        artist = artist.split(" • ")[0].replace(/\s*(?:song|video)\s*$/i, "").trim();

        return {
            id: videoId,
            name: title,
            artists: artist,
            album_name: album,
            album_id: "",
            album_url: "",
            album_artist: artist,
            artist_id: "",
            artist_url: "",
            duration_ms: durationMs,
            cover_url: thumb,
            external_urls: "https://music.youtube.com/watch?v=" + videoId,
            preview_url: "",
            release_date: "",
            track_number: 0,
            total_tracks: 0,
            disc_number: 1,
            total_discs: 0,
            composer: "",
            isrc: "",
            audio_quality: "LOSSLESS",
            item_type: "track",
            provider_id: EXT_ID,
            genre: "",
            label: "",
            copyright: "",
            explicit: false
        };
    } catch (e) { return null; }
}

function parseSearchResults(data) {
    var out = [];
    try {
        var tabs = data.contents.tabbedSearchResultsRenderer.tabs;
        var sections = tabs[0].tabRenderer.content.sectionListRenderer.contents;
        for (var i = 0; i < sections.length; i++) {
            var shelf = sections[i].musicShelfRenderer;
            if (!shelf || !shelf.contents) continue;
            for (var j = 0; j < shelf.contents.length; j++) {
                var r = shelf.contents[j].musicResponsiveListItemRenderer;
                if (!r) continue;
                var t = parseItem(r);
                if (t) out.push(t);
            }
        }
    } catch (e) { L("debug", "parseSearchResults failed: " + e); }
    return out;
}

function searchTracksService(query, limit) {
    query = String(query || "").trim();
    if (!query) return [];
    limit = limit || 20;

    var cached = getCache(MEM.tracks, "q:" + query + ":" + limit);
    if (cached) return cached;

    var tracks = [];
    var data = itSearch(query, FILTER_SONGS);
    if (data) tracks = parseSearchResults(data);
    if (!tracks.length) {
        data = itSearch(query, FILTER_VIDEOS);
        if (data) tracks = parseSearchResults(data);
    }
    tracks = tracks.slice(0, limit);
    if (tracks.length) putCache(MEM.tracks, "q:" + query + ":" + limit, tracks, 10 * 60 * 1000);
    L("info", "search '" + query + "' -> " + tracks.length + " tracks");
    return tracks;
}

function getTrackService(token) {
    token = String(token || "").trim();
    if (!token) return null;

    var cached = getCache(MEM.tracks, "t:" + token);
    if (cached) return cached;
    cached = storageGetJson("track_" + token);
    if (cached) { putCache(MEM.tracks, "t:" + token, cached, STREAM_TTL); return cached; }

    var track = null;
    var durationSec = 0;
    var data = itPlayer(token);
    if (data && data.videoDetails && data.videoDetails.videoId) {
        var vd = data.videoDetails;
        try {
            durationSec = parseInt(data.microformat.playerMicroformatRenderer.lengthSeconds || vd.lengthSeconds || "0", 10) || 0;
        } catch (e) { durationSec = parseInt(vd.lengthSeconds || "0", 10) || 0; }
        var thumb = "";
        try {
            var th = vd.thumbnail.thumbnails;
            for (var i = th.length - 1; i >= 0; i--) { if (th[i] && th[i].url) { thumb = th[i].url; break; } }
        } catch (e) { }
        track = {
            id: vd.videoId,
            name: vd.title || "",
            artists: vd.author || "",
            album_name: "",
            album_id: "",
            album_url: "",
            album_artist: vd.author || "",
            artist_id: "",
            artist_url: "",
            duration_ms: durationSec * 1000,
            cover_url: thumb,
            external_urls: "https://music.youtube.com/watch?v=" + vd.videoId,
            preview_url: "",
            release_date: "",
            track_number: 0,
            total_tracks: 0,
            disc_number: 1,
            total_discs: 0,
            composer: "",
            isrc: "",
            audio_quality: "LOSSLESS",
            item_type: "track",
            provider_id: EXT_ID,
            genre: "",
            label: "",
            copyright: "",
            explicit: false
        };
    }
    if (!track) {
        // oEmbed fallback (title / author / art, no duration)
        var oe = httpGetJson("https://www.youtube.com/oembed?format=json&url=" + enc("https://music.youtube.com/watch?v=" + token));
        if (oe && oe.title) {
            track = {
                id: token,
                name: oe.title,
                artists: oe.author_name || "",
                album_name: "",
                album_artist: oe.author_name || "",
                duration_ms: 0,
                cover_url: oe.thumbnail_url || "",
                external_urls: "https://music.youtube.com/watch?v=" + token,
                preview_url: "",
                audio_quality: "LOSSLESS",
                item_type: "track",
                provider_id: EXT_ID,
                explicit: false
            };
        }
    }
    if (track && !track.duration_ms) {
        // duration fallback: take it from a matching search result
        try {
            var cands = searchTracksService(track.name + " " + track.artists, 10);
            for (var ci = 0; ci < cands.length; ci++) {
                if (cands[ci].id === token && cands[ci].duration_ms) {
                    track.duration_ms = cands[ci].duration_ms;
                    break;
                }
            }
        } catch (e) { }
    }
    if (track) {
        putCache(MEM.tracks, "t:" + token, track, STREAM_TTL);
        storageSetJson("track_" + token, track);
    }
    return track;
}

// ---- ZenMusic Qobuz API ------------------------------------
// GET {endpoint}?id=<videoId> ->
// { status:"success",
//   ytmusic: {videoId, title, artist, duration},
//   matched_track: {id, title, artist, album, duration, hires, maximum_bit_depth, maximum_sampling_rate},
//   streams: { tier: {label, format_id, mime_type, bit_depth, sampling_rate, url} } }
var TIER_LADDERS = {
    HI_RES_MAX: ["flac_hires_192", "flac_hires_96", "flac_cd", "mp3_320"],
    HI_RES: ["flac_hires_96", "flac_hires_192", "flac_cd", "mp3_320"],
    LOSSLESS: ["flac_cd", "flac_hires_96", "mp3_320"],
    MP3_320: ["mp3_320", "flac_cd"]
};
var TIER_ORDER = ["flac_hires_192", "flac_hires_96", "flac_cd", "mp3_320"];

function resolveStreams(videoId) {
    videoId = String(videoId || "").trim();
    if (!videoId || videoId.length !== 11) return null;

    var cached = getCache(MEM.streams, videoId);
    if (cached !== null) return cached; // may be false (negative cache)

    var ep = getEndpoint();
    var url = ep + "?id=" + enc(videoId);
    var data = httpGetJson(url);
    if (!data || data.status !== "success" || !data.streams) {
        L("info", "no Qobuz match for " + videoId);
        putCache(MEM.streams, videoId, false, NEG_TTL);
        return null;
    }

    var streams = {};
    for (var tier in data.streams) {
        var s = data.streams[tier];
        if (s && s.url) {
            streams[tier] = {
                url: s.url,
                label: s.label || tier,
                mime_type: s.mime_type || "",
                format_id: s.format_id || 0,
                bit_depth: s.bit_depth || 0,
                sampling_rate: s.sampling_rate || 44.1
            };
        }
    }
    if (!Object.keys(streams).length) {
        putCache(MEM.streams, videoId, false, NEG_TTL);
        return null;
    }
    putCache(MEM.streams, videoId, streams, STREAM_TTL);
    L("info", "resolved " + videoId + " (" + Object.keys(streams).length + " tiers)");
    return streams;
}

function pickTier(streams, quality) {
    var ladder = TIER_LADDERS[String(quality || "LOSSLESS").toUpperCase()] || TIER_LADDERS.LOSSLESS;
    for (var i = 0; i < ladder.length; i++) {
        if (streams[ladder[i]] && streams[ladder[i]].url) return ladder[i];
    }
    // last resort: best available in fixed order
    for (var j = 0; j < TIER_ORDER.length; j++) {
        if (streams[TIER_ORDER[j]] && streams[TIER_ORDER[j]].url) return TIER_ORDER[j];
    }
    return null;
}

function tierExtension(tier) {
    return (tier === "mp3_320") ? "mp3" : "flac";
}

function ensureExt(path, ext) {
    if (!/\.[A-Za-z0-9]{2,5}$/.test(path)) return path + "." + ext;
    return path.replace(/\.[A-Za-z0-9]{2,5}$/, "." + ext);
}

// ---- matching (used by checkAvailability) --------------------
function normalizeName(v) {
    return String(v || "")
        .replace(/&amp;/g, "&")
        .toLowerCase()
        .replace(/\((?:official\s*)?(?:music\s*)?(?:video|audio|lyric[s]?|visualizer)\)/gi, "")
        .replace(/\[(?:official\s*)?(?:music\s*)?(?:video|audio|lyric[s]?|visualizer)\]/gi, "")
        .replace(/\bofficial\s+(video|audio)\b/gi, "")
        .replace(/[^a-z0-9\u0080-\uffff]+/g, " ")
        .trim();
}

function artistList(v) {
    return String(v || "").split(/[,;&\/]|(?:\s+|\s)feat\.?\s+|(?:\s+)ft\.?\s+/i)
        .map(normalizeName).filter(Boolean);
}

function matchScore(wantedTitle, wantedArtists, track) {
    var a = normalizeName(wantedTitle);
    var b = normalizeName(track.name);
    if (!a || !b) return 0;
    if (a !== b && a.indexOf(b) === -1 && b.indexOf(a) === -1) return 0;
    var want = artistList(wantedArtists);
    var got = artistList(track.artists);
    var hit = 0;
    for (var i = 0; i < want.length; i++) {
        for (var j = 0; j < got.length; j++) {
            if (want[i] && want[i] === got[j]) { hit++; break; }
        }
    }
    return hit > 0 ? (a === b ? 2 : 1) : 0;
}

// ============================================================
// Hooks
// ============================================================

function initialize(config) {
    try {
        var lvl = getSetting("logLevel", "warn");
        if (LOG_LEVELS[lvl] !== undefined) currentLogLevel = lvl;
        L("info", "initialize endpoint=" + getEndpoint());
    } catch (e) { }
}

function cleanup(force) {
    MEM.streams = {};
    MEM.tracks = {};
    L("info", "cleanup");
}

function forceCleanup() {
    MEM.streams = {};
    MEM.tracks = {};
    try {
        var keys = storage.keys ? storage.keys() : [];
        for (var i = 0; i < keys.length; i++) {
            if (String(keys[i]).indexOf("zl_") === 0) {
                try { storage.set(keys[i], null); } catch (e) { }
            }
        }
    } catch (e) { }
    L("info", "forceCleanup done");
}

function customSearch(query, options) {
    options = typeof options === "string" ? { filter: options } : options || {};
    var filter = String(options.filter || "tracks").toLowerCase();
    var limit = options.limit || 20;
    if (filter === "tracks" || filter === "songs" || filter === "song") {
        return searchTracksService(query, limit);
    }
    return searchTracksService(query, limit);
}

function enrichTrack(track) {
    if (!track || !track.id) return track;
    if (track.provider_id && track.provider_id !== EXT_ID) return track;
    var streams = resolveStreams(track.id);
    if (streams) {
        var best = null;
        for (var i = 0; i < TIER_ORDER.length; i++) {
            if (streams[TIER_ORDER[i]]) { best = streams[TIER_ORDER[i]]; break; }
        }
        if (best) {
            track.audio_quality = (best.bit_depth > 16) ? "HI_RES_LOSSLESS" : "LOSSLESS";
            track.bit_depth = best.bit_depth;
            track.sample_rate = best.sampling_rate;
        }
    }
    return track;
}

function checkAvailability(isrc, trackName, artistName, options) {
    options = options || {};
    var track = options.track || {};

    // Own provider track (a search result of this extension)
    if (track.provider_id === EXT_ID && track.id) {
        var own = resolveStreams(track.id);
        if (own) {
            return { available: true, track_id: track.id, prepared_context: { track: track } };
        }
    }

    if (!trackName || !artistName) return { available: false, reason: "No recording metadata to match" };

    var candidates = searchTracksService(trackName + " " + artistName, 20);
    if (!candidates.length) candidates = searchTracksService(trackName, 20);

    var requestedDuration = options.duration_ms || track.duration_ms || 0;
    var best = null, bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        var score = matchScore(trackName, artistName, c);
        if (!score) continue;
        if (requestedDuration && c.duration_ms &&
            Math.abs(requestedDuration - c.duration_ms) > 5000) continue;
        if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best) return { available: false, reason: "No matching lossless recording" };

    var streams = resolveStreams(best.id);
    if (!streams) return { available: false, reason: "Track not in the Qobuz catalog" };

    return {
        available: true,
        track_id: best.id,
        prepared_context: { track: best, streams: streams }
    };
}

function getDownloadUrl(token, quality, options) {
    L("info", "getDownloadUrl " + token + " @ " + quality);
    token = String(token || "").replace(/^yt:/, "").trim();
    if (!token) return { success: false, error_message: "Invalid track id", error_type: "not_found" };

    var streams = null;
    var track = null;
    try {
        if (options && options.preparedContext) {
            streams = options.preparedContext.streams || null;
            track = options.preparedContext.track || null;
        }
    } catch (e) { }
    if (!streams) streams = resolveStreams(token);
    if (!streams) return { success: false, error_message: "Track is not available in the Qobuz catalog", error_type: "not_found" };
    if (!track) track = getTrackService(token) || { id: token, name: "", artists: "", album_name: "" };

    var tier = pickTier(streams, quality);
    if (!tier) return { success: false, error_message: "No stream tier available", error_type: "stream_error" };

    var s = streams[tier];
    var ext = tierExtension(tier);
    return {
        success: true,
        url: s.url,
        format: ext,
        actual_extension: ext,
        audio_codec: ext === "mp3" ? "mp3" : "flac",
        quality: s.label || tier,
        bit_depth: s.bit_depth || undefined,
        sample_rate: s.sampling_rate || undefined,
        track: track
    };
}

function download(token, quality, outputPath, onProgress, options) {
    L("info", "download " + token + " @ " + quality);
    var info = getDownloadUrl(token, quality, options);
    if (!info || !info.success) {
        return { success: false, error_message: (info && info.error_message) || "Stream resolution failed", error_type: (info && info.error_type) || "download_error" };
    }

    var ext = info.actual_extension || "flac";
    var outPath = ensureExt(outputPath, ext);

    var dl = file.download(info.url, outPath, {
        headers: { "User-Agent": UA },
        onProgress: onProgress ? function (r, t) { onProgress(t > 0 ? r / t : 0); } : undefined
    });
    if (!dl || !dl.success) {
        return {
            success: false,
            error_message: (dl && (dl.error_message || dl.error)) || "Download failed",
            error_type: (dl && dl.error_type) || "download_error"
        };
    }
    if (onProgress) onProgress(1);

    var track = info.track || {};
    return {
        success: true,
        file_path: dl.path || outPath,
        format: ext,
        actual_extension: ext,
        audio_codec: info.audio_codec,
        title: track.name || "",
        artist: track.artists || "",
        album: track.album_name || "",
        album_artist: track.album_artist || "",
        track_number: track.track_number || 0,
        total_tracks: track.total_tracks || 0,
        disc_number: track.disc_number || 1,
        total_discs: track.total_discs || 0,
        release_date: track.release_date || "",
        cover_url: track.cover_url || "",
        isrc: track.isrc || "",
        genre: track.genre || "",
        label: track.label || "",
        copyright: track.copyright || "",
        composer: track.composer || "",
        explicit: track.explicit === true,
        bit_depth: info.bit_depth,
        sample_rate: info.sample_rate
    };
}

function extractVideoId(url) {
    url = String(url || "");
    var m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url) ||
        /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url) ||
        /\/(?:watch|shorts|embed|v)\/([A-Za-z0-9_-]{11})/.exec(url);
    return m ? m[1] : null;
}

function handleUrl(url) {
    var videoId = extractVideoId(url);
    if (!videoId) return null;
    var track = getTrackService(videoId);
    if (!track) return null;
    return { type: "track", track: track };
}

// ============================================================
// Register with the host app
// ============================================================

registerExtension({
    initialize: initialize,
    cleanup: cleanup,
    forceCleanup: forceCleanup,
    searchTracks: searchTracksService,
    customSearch: customSearch,
    getTrack: getTrackService,
    enrichTrack: enrichTrack,
    checkAvailability: checkAvailability,
    getDownloadUrl: getDownloadUrl,
    download: download,
    handleUrl: handleUrl
});

L("info", "Zen Lossless extension loaded");
