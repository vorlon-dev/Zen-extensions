// ============================================================
// Zen YouTube Music Extension
// Full YouTube Music provider: search (songs/videos/albums/
// artists/playlists), track & collection metadata, home feed and
// direct audio stream resolution. Uses the same innertube client
// identity as the ZenMusic app (WEB_REMIX + anonymous visitor
// data, with ANDROID_VR / IOS player fallbacks).
// ============================================================

var EXT_ID = "zen-ytmusic";

var YTM_ORIGIN = "https://music.youtube.com";
var YTM_API = YTM_ORIGIN + "/youtubei/v1/";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
var WEB_REMIX_VERSION = "1.20260213.01.00";

var POSITIVE_TTL_MS = 30 * 60 * 1000;
var SEARCH_TTL_MS = 15 * 60 * 1000;
var VISITOR_TTL_MS = 6 * 60 * 60 * 1000;
var STREAM_TTL_MS = 4 * 60 * 60 * 1000; // googlevideo URLs are long-lived
var MAX_CACHE = 200;

// ------------------------------------------------------------
// TTL cache on host storage
// ------------------------------------------------------------
function cacheGet(key) {
    try {
        var raw = storage.get("c_" + key);
        if (!raw) return null;
        var entry = JSON.parse(raw);
        if (!entry || !entry.e || Date.now() > entry.e) { storage.remove("c_" + key); return null; }
        return entry.v;
    } catch (e) { return null; }
}

function cacheSet(key, value, ttlMs) {
    try {
        storage.set("c_" + key, JSON.stringify({ v: value, e: Date.now() + (ttlMs || POSITIVE_TTL_MS) }));
    } catch (e) {}
}

function cacheClear() {
    try {
        var raw = storage.get("c_keys");
        if (raw) {
            var keys = JSON.parse(raw);
            for (var i = 0; i < keys.length; i++) storage.remove("c_" + keys[i]);
        }
        storage.remove("c_keys");
    } catch (e) {}
}

function cacheRemember(key) {
    try {
        var raw = storage.get("c_keys");
        var keys = raw ? JSON.parse(raw) : [];
        if (keys.indexOf(key) === -1) { keys.push(key); storage.set("c_keys", JSON.stringify(keys)); }
    } catch (e) {}
}

// ------------------------------------------------------------
// Innertube plumbing
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

var CLIENT_UA = {
    "WEB_REMIX": USER_AGENT,
    "ANDROID_VR": "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    "IOS": "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)"
};
var CLIENT_ID = { "WEB_REMIX": "67", "ANDROID_VR": "28", "IOS": "5" };

function getVisitorData() {
    var cached = cacheGet("visitor");
    if (cached) return cached;
    var response;
    try { response = http.get(YTM_ORIGIN + "/sw.js_data", { "User-Agent": USER_AGENT }); } catch (e) { return ""; }
    if (!response || !response.ok || !response.body) return "";
    var body = response.body.replace(/^\)\]\}'\s*/, "");
    try {
        var data = JSON.parse(body);
        var visitor = "";
        try { visitor = data[0][2][6] || ""; } catch (e) {}
        if (!visitor) { try { visitor = data[0][2][0][0][13] || ""; } catch (e) {} }
        if (visitor && typeof visitor === "string" && visitor.length > 40) {
            cacheSet("visitor", visitor, VISITOR_TTL_MS);
            cacheRemember("visitor");
            return visitor;
        }
    } catch (e) {}
    return "";
}

function ytmPost(endpoint, body, client) {
    client = client || "WEB_REMIX";
    var h = {
        "Content-Type": "application/json",
        "User-Agent": CLIENT_UA[client] || USER_AGENT,
        "X-Goog-Api-Format-Version": "2"
    };
    if (client === "WEB_REMIX") {
        h["Origin"] = YTM_ORIGIN;
        h["Referer"] = YTM_ORIGIN + "/";
        h["X-YouTube-Client-Name"] = CLIENT_ID[client];
        h["X-YouTube-Client-Version"] = WEB_REMIX_VERSION;
    }
    var visitor = getVisitorData();
    if (visitor) h["X-Goog-Visitor-Id"] = visitor;
    var response;
    try { response = http.post(YTM_API + endpoint + "?prettyPrint=false", JSON.stringify(body), h); } catch (e) {
        log.debug("[ZenYTM] post threw: " + (e && e.message));
        return null;
    }
    if (!response || !response.ok) {
        log.debug("[ZenYTM] " + endpoint + " HTTP " + (response ? response.statusCode : "none"));
        return null;
    }
    try { return JSON.parse(response.body); } catch (e) { return null; }
}

// ------------------------------------------------------------
// Shared response parsing helpers
// ------------------------------------------------------------
function runText(runs) {
    if (!runs) return "";
    var out = "";
    for (var i = 0; i < runs.length; i++) out += runs[i].text || "";
    return out;
}

function flexColumn(renderer, index) {
    try { return renderer.flexColumns[index].musicResponsiveListItemFlexColumnRenderer || {}; } catch (e) { return {}; }
}

function flexText(renderer, index) {
    try { return runText(flexColumn(renderer, index).text.runs); } catch (e) { return ""; }
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

function videoTypeOf(renderer) {
    try {
        return renderer.overlay.musicItemThumbnailOverlayRenderer.content
            .musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint
            .watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType || "";
    } catch (e) { return ""; }
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

function browseIdOf(renderer) {
    try {
        var runs = flexColumn(renderer, 0).text.runs || [];
        for (var i = 0; i < runs.length; i++) {
            var ep = runs[i].navigationEndpoint;
            var b = ep && ep.browseEndpoint && ep.browseEndpoint.browseId;
            if (b) return b;
        }
    } catch (e) {}
    try {
        var nav = renderer.navigationEndpoint || {};
        return (nav.browseEndpoint && nav.browseEndpoint.browseId) || "";
    } catch (e) {}
    return "";
}

function pageTypeOf(renderer) {
    try {
        var runs = flexColumn(renderer, 0).text.runs || [];
        for (var i = 0; i < runs.length; i++) {
            var ep = runs[i].navigationEndpoint;
            var s = ep && ep.browseEndpoint && ep.browseEndpoint.browseEndpointContextSupportedConfigs;
            if (s && s.browseEndpointContextMusicConfig && s.browseEndpointContextMusicConfig.pageType) {
                return s.browseEndpointContextMusicConfig.pageType;
            }
        }
    } catch (e) {}
    return "";
}

function parseTrackRenderer(renderer) {
    var videoId = videoIdOf(renderer);
    if (!videoId || videoId.length !== 11) return null;
    var title = flexText(renderer, 0);
    if (!title) return null;
    var artist = "";
    var album = "";
    var durationMs = 0;
    var colCount = renderer.flexColumns ? renderer.flexColumns.length : 0;
    for (var i = 1; i < colCount; i++) {
        var text = flexText(renderer, i);
        if (!text) continue;
        if (i === 1) {
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
        is_video: videoTypeOf(renderer) === "MUSIC_VIDEO_TYPE_UGC" || videoTypeOf(renderer) === "MUSIC_VIDEO_TYPE_OMV",
        external_urls: "https://music.youtube.com/watch?v=" + videoId
    };
}

function parseCardShelf(card) {
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
        is_video: false,
        external_urls: "https://music.youtube.com/watch?v=" + videoId
    };
}

function parseCollectionRenderer(renderer, itemType) {
    var browseId = browseIdOf(renderer);
    if (!browseId) return null;
    var title = flexText(renderer, 0);
    if (!title) return null;
    var subtext = "";
    var count = "";
    var colCount = renderer.flexColumns ? renderer.flexColumns.length : 0;
    for (var i = 1; i < colCount; i++) {
        var text = flexText(renderer, i);
        if (!text) continue;
        if (!subtext) subtext = text;
        else count = text;
    }
    return {
        id: browseId,
        name: title,
        subtext: subtext.replace(/^(?:Album|Single|EP|Playlist|Artist|Video)\s*•\s*/i, ""),
        item_type: itemType,
        provider_id: EXT_ID,
        track_count: count,
        cover_url: largestThumb(renderer.thumbnail)
    };
}

function parseArtistRenderer(renderer) {
    var browseId = browseIdOf(renderer);
    if (!browseId) return null;
    var title = flexText(renderer, 0);
    if (!title) return null;
    return {
        id: browseId,
        name: title,
        subtext: flexText(renderer, 1) || "",
        item_type: "artist",
        provider_id: EXT_ID,
        cover_url: largestThumb(renderer.thumbnail)
    };
}

// ------------------------------------------------------------
// Search
// ------------------------------------------------------------
function collectSearchItems(root) {
    var items = [];
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
        if (section.musicCardShelfRenderer) { items.push({ card: section.musicCardShelfRenderer }); continue; }
        if (section.musicShelfRenderer) {
            var contents = section.musicShelfRenderer.contents || [];
            for (var c = 0; c < contents.length; c++) {
                var r = contents[c].musicResponsiveListItemRenderer;
                if (r) items.push({ renderer: r, shelfTitle: runText(section.musicShelfRenderer.title.runs) });
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

function ytmSearch(query, params, limit) {
    var body = { context: ytmContext("WEB_REMIX"), query: query };
    if (params && params.filters) body.filters = params.filters;
    var data = ytmPost("search", body);
    if (!data) return [];
    var raw = collectSearchItems(data);
    var out = [];
    for (var i = 0; i < raw.length && (!limit || out.length < limit); i++) {
        var entry = raw[i];
        if (entry.card) {
            var card = parseCardShelf(entry.card);
            if (card) out.push(card);
            continue;
        }
        var renderer = entry.renderer;
        var pageType = pageTypeOf(renderer);
        var wants = (params && params.pageType) || "";
        if (wants && pageType && pageType.indexOf(wants) === -1 && entry.shelfTitle) {
            // fall through — shelf titles also encode the group on old layouts
        }
        if (wants === "MUSIC_PAGE_TYPE_ALBUM") {
            var album = parseCollectionRenderer(renderer, "album");
            if (album) out.push(album);
        } else if (wants === "MUSIC_PAGE_TYPE_PLAYLIST") {
            var pl = parseCollectionRenderer(renderer, "playlist");
            if (pl) out.push(pl);
        } else if (wants === "MUSIC_PAGE_TYPE_ARTIST") {
            var ar = parseArtistRenderer(renderer);
            if (ar) out.push(ar);
        } else {
            var track = parseTrackRenderer(renderer);
            if (track) {
                if (params && params.videosOnly !== true && videoTypeOf(renderer) === "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") continue;
                out.push(track);
            }
        }
    }
    return out;
}

function searchTracks(query, limit) {
    limit = limit || 20;
    var cacheKey = "s_tracks_" + query + "_" + limit;
    var cached = cacheGet(cacheKey);
    if (cached) return cached;
    var tracks = ytmSearch(query, { pageType: "" }, limit);
    cacheSet(cacheKey, tracks, SEARCH_TTL_MS);
    cacheRemember(cacheKey);
    return tracks;
}

function customSearch(query, filter, limit, page) {
    limit = limit || 20;
    if (filter === "albums") return ytmSearch(query, { pageType: "MUSIC_PAGE_TYPE_ALBUM" }, limit);
    if (filter === "playlists") return ytmSearch(query, { pageType: "MUSIC_PAGE_TYPE_PLAYLIST" }, limit);
    if (filter === "artists") return ytmSearch(query, { pageType: "MUSIC_PAGE_TYPE_ARTIST" }, limit);
    if (filter === "videos") return ytmSearch(query, { videosOnly: true }, limit);
    return searchTracks(query, limit);
}

// ------------------------------------------------------------
// Track metadata
// ------------------------------------------------------------
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
    var data = ytmPost("search", { context: ytmContext("WEB_REMIX"), query: videoId });
    if (!data) return null;
    var raw = collectSearchItems(data);
    for (var i = 0; i < raw.length; i++) {
        var entry = raw[i];
        var track = entry.card ? parseCardShelf(entry.card) : parseTrackRenderer(entry.renderer);
        if (track && track.id === videoId) return track;
    }
    for (var j = 0; j < raw.length; j++) {
        var t = raw[j].card ? parseCardShelf(raw[j].card) : parseTrackRenderer(raw[j].renderer);
        if (t) return t;
    }
    return null;
}

function getTrack(token) {
    if (!token) return null;
    token = String(token);
    var cached = cacheGet("track_" + token);
    if (cached) return cached;
    var track = null;
    var clients = ["WEB_REMIX", "ANDROID_VR", "IOS"];
    for (var i = 0; i < clients.length; i++) {
        var data = ytmPost("player", {
            context: ytmContext(clients[i]), videoId: token, contentCheckOk: true, racyCheckOk: true
        }, clients[i]);
        if (data && data.videoDetails && data.playabilityStatus && data.playabilityStatus.status === "OK") {
            track = detailsFromVideoDetails(data.videoDetails);
            break;
        }
    }
    if (!track && /^[A-Za-z0-9_-]{11}$/.test(token)) track = trackFromSearch(token);
    if (track) { cacheSet("track_" + token, track, POSITIVE_TTL_MS); cacheRemember("track_" + token); }
    return track;
}

// ------------------------------------------------------------
// Collections (album / playlist / artist) via browse
// ------------------------------------------------------------
function parsePlaylistShelfContents(shelf, albumTitle) {
    var tracks = [];
    var contents = shelf.musicPlaylistShelfRenderer.contents || [];
    for (var i = 0; i < contents.length; i++) {
        var r = contents[i].musicResponsiveListItemRenderer;
        if (!r) continue;
        var t = parseTrackRenderer(r);
        if (t) {
            t.track_number = tracks.length + 1;
            if (albumTitle && !t.album_name) t.album_name = albumTitle;
            tracks.push(t);
        }
    }
    return tracks;
}

function walkForPlaylistShelf(node, found) {
    if (!node || typeof node !== "object" || found.shelf) return;
    if (node.musicPlaylistShelfRenderer) { found.shelf = node.musicPlaylistShelfRenderer; return; }
    if (Array.isArray(node)) {
        for (var i = 0; i < node.length && !found.shelf; i++) walkForPlaylistShelf(node[i], found);
        return;
    }
    for (var key in node) {
        if (node.hasOwnProperty(key) && !found.shelf) walkForPlaylistShelf(node[key], found);
    }
}

function getCollection(browseId, kind) {
    var cached = cacheGet(kind + "_" + browseId);
    if (cached) return cached;
    var data = ytmPost("browse", { context: ytmContext("WEB_REMIX"), browseId: browseId });
    if (!data) return { success: false, error: "Could not fetch the " + kind };

    var name = "";
    var subtext = "";
    var cover = "";
    try {
        var two = data.contents.twoColumnBrowseResultsRenderer;
        var header = (two && two.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].musicResponsiveHeaderRenderer) ||
            data.header.musicImmersiveHeaderRenderer || data.header.musicResponsiveHeaderRenderer;
        if (header) {
            name = runText((header.title || {}).runs);
            var parts = [];
            var subs = (header.subtitle || {}).runs || [];
            for (var s = 0; s < subs.length; s++) parts.push(subs[s].text || "");
            subtext = parts.join("").replace(/\s*•\s*/g, " • ").trim();
            cover = largestThumb(header.thumbnail);
        }
    } catch (e) {}
    if (!name) {
        try { name = runText(data.header.musicDetailHeaderRenderer.title.runs); } catch (e) {}
        try { cover = cover || largestThumb(data.header.musicDetailHeaderRenderer.thumbnail); } catch (e) {}
    }

    var found = { shelf: null };
    walkForPlaylistShelf(data, found);
    if (!found.shelf) return { success: false, error: "No track list found for this " + kind };
    var tracks = parsePlaylistShelfContents(found.shelf, name);

    var collection = {
        id: browseId,
        name: name,
        subtext: subtext,
        item_type: kind,
        provider_id: EXT_ID,
        cover_url: cover,
        track_count: tracks.length,
        tracks: tracks
    };
    var result = { success: true, type: kind };
    result[kind] = collection;
    if (kind === "playlist") result.playlist = collection;
    if (kind === "album") result.album = collection;
    cacheSet(kind + "_" + browseId, result, POSITIVE_TTL_MS);
    cacheRemember(kind + "_" + browseId);
    return result;
}

function getAlbum(token) { return getCollection(String(token), "album"); }
function getPlaylist(token) {
    var id = String(token || "");
    if (id.indexOf("VL") !== 0 && id.indexOf("PL") !== 0 && id.indexOf("RD") !== 0 && id.indexOf("OL") !== 0) id = "VL" + id;
    return getCollection(id, "playlist");
}

function getArtist(token) {
    var browseId = String(token || "");
    var cached = cacheGet("artist_" + browseId);
    if (cached) return cached;
    var data = ytmPost("browse", { context: ytmContext("WEB_REMIX"), browseId: browseId });
    if (!data) return { success: false, error: "Could not fetch the artist" };
    var name = "";
    var cover = "";
    var description = "";
    try {
        var two = data.contents.twoColumnBrowseResultsRenderer;
        var header = (two && two.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].musicResponsiveHeaderRenderer) ||
            data.header.musicImmersiveHeaderRenderer || data.header.musicResponsiveHeaderRenderer;
        if (header) {
            name = runText((header.title || {}).runs);
            cover = largestThumb(header.thumbnail);
            var runs = (header.description || {}).runs || [];
            description = runText(runs).slice(0, 600);
        }
    } catch (e) {}

    // Songs shelf: first musicShelfRenderer whose title mentions songs.
    var top = [];
    try {
        var two2 = data.contents.twoColumnBrowseResultsRenderer;
        var contents = two2.tabs[0].tabRenderer.content.sectionListRenderer.contents;
        for (var i = 0; i < contents.length && top.length === 0; i++) {
            var shelf = contents[i].musicShelfRenderer;
            if (!shelf) continue;
            var title = runText(shelf.title.runs).toLowerCase();
            if (title.indexOf("song") !== -1 || title.indexOf("top") !== -1 || i === 0) {
                var items = shelf.contents || [];
                for (var k = 0; k < items.length; k++) {
                    var r = items[k].musicResponsiveListItemRenderer;
                    var t = r ? parseTrackRenderer(r) : null;
                    if (t) top.push(t);
                    if (top.length >= 10) break;
                }
            }
        }
    } catch (e) {}

    var artist = {
        id: browseId,
        name: name,
        item_type: "artist",
        provider_id: EXT_ID,
        cover_url: cover,
        image_url: cover,
        description: description,
        top_tracks: top,
        albums: []
    };
    var result = { success: true, type: "artist", artist: artist, image_url: cover };
    cacheSet("artist_" + browseId, result, POSITIVE_TTL_MS);
    cacheRemember("artist_" + browseId);
    return result;
}

// ------------------------------------------------------------
// Home feed — curated charts via the charts endpoint
// ------------------------------------------------------------
function getHomeFeed() {
    var sections = [];
    var data = ytmPost("browse", { context: ytmContext("WEB_REMIX"), browseId: "FEmusic_charts" });
    if (data) {
        try {
            var two = data.contents.twoColumnBrowseResultsRenderer;
            var contents = two.tabs[0].tabRenderer.content.sectionListRenderer.contents;
            for (var i = 0; i < contents.length && sections.length < 1; i++) {
                var shelf = contents[i].musicCarouselShelfRenderer;
                if (!shelf) continue;
                var items = [];
                var headers = shelf.header && shelf.header.musicCarouselShelfBasicHeaderRenderer;
                var shelfTitle = headers ? runText(headers.title.runs) : "";
                var contentItems = (shelf.contents || []);
                for (var k = 0; k < contentItems.length && items.length < 12; k++) {
                    var pl = contentItems[k].musicTwoRowItemRenderer;
                    if (!pl) continue;
                    var browseId = "";
                    try { browseId = pl.navigationEndpoint.watchPlaylistEndpoint.playlistId || pl.navigationEndpoint.browseEndpoint.browseId; } catch (e) {}
                    if (!browseId) continue;
                    items.push({
                        id: browseId,
                        name: runText(pl.title.runs),
                        subtext: runText((pl.subtitle || {}).runs),
                        item_type: "playlist",
                        provider_id: EXT_ID,
                        cover_url: largestThumb(pl.thumbnailRenderer)
                    });
                }
                if (items.length >= 2) sections.push({ title: shelfTitle || "Charts", items: items });
            }
        } catch (e) {}
    }
    if (!sections.length) {
        // Fallback: mood & genres carousel is always available.
        sections.push({
            title: "Explore",
            items: [{
                id: "FEmusic_charts",
                name: "Charts",
                subtext: "Browse YouTube Music charts",
                item_type: "playlist",
                provider_id: EXT_ID,
                cover_url: ""
            }]
        });
    }
    return { sections: sections };
}

function enrichTrack(track) {
    if (!track || !track.id) return track;
    if (!track.duration_ms) {
        var full = getTrack(track.id);
        if (full) return full;
    }
    return track;
}

// ------------------------------------------------------------
// Streams / download
// ------------------------------------------------------------
function pickAudioStream(formats, qualityId) {
    // Adaptive audio-only formats, direct URLs only.
    var audio = [];
    for (var i = 0; i < formats.length; i++) {
        var f = formats[i];
        if (!f || !f.url) continue;
        var mime = f.mimeType || "";
        if (mime.indexOf("audio") !== 0) continue;
        audio.push(f);
    }
    if (!audio.length) return null;
    audio.sort(function (a, b) { return (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0); });
    var bestBitrate = parseInt(audio[0].bitrate, 10) || 0;
    var wanted = qualityId === "AUDIO_MED" ? Math.min(128, Math.max(96, bestBitrate / 2))
        : qualityId === "AUDIO_LOW" ? 70
        : bestBitrate;
    // Closest match at or below the wanted ceiling.
    var best = audio[0];
    var bestDelta = Math.abs((parseInt(audio[0].bitrate, 10) || 0) - wanted);
    for (var j = 0; j < audio.length; j++) {
        var delta = Math.abs((parseInt(audio[j].bitrate, 10) || 0) - wanted);
        if (delta < bestDelta) { bestDelta = delta; best = audio[j]; }
    }
    return best;
}

function resolveStream(videoId, qualityId) {
    var cacheKey = "stream_" + videoId + "_" + (qualityId || "high");
    var cached = cacheGet(cacheKey);
    if (cached) return { success: true, stream: cached };
    var clients = ["WEB_REMIX", "ANDROID_VR", "IOS"];
    for (var i = 0; i < clients.length; i++) {
        var data = ytmPost("player", {
            context: ytmContext(clients[i]), videoId: videoId, contentCheckOk: true, racyCheckOk: true
        }, clients[i]);
        if (!data || !data.playabilityStatus || data.playabilityStatus.status !== "OK") continue;
        var formats = (data.streamingData && data.streamingData.adaptiveFormats) || [];
        var picked = pickAudioStream(formats, qualityId || "AUDIO_HIGH");
        if (picked) {
            cacheSet(cacheKey, picked, STREAM_TTL_MS);
            cacheRemember(cacheKey);
            return { success: true, stream: picked };
        }
    }
    return { success: false, error: "No playable audio stream (YouTube may require a signed-in network for this track)", error_type: "stream_error" };
}

function extForMime(mime) {
    if (!mime) return { ext: "m4a", codec: "aac" };
    if (mime.indexOf("webm") !== -1) return { ext: "weba", codec: mime.indexOf("opus") !== -1 ? "opus" : "vorbis" };
    if (mime.indexOf("mp4") !== -1 || mime.indexOf("aac") !== -1) return { ext: "m4a", codec: "aac" };
    return { ext: "m4a", codec: "aac" };
}

function getDownloadUrl(token, quality, options) {
    var videoId = String(token || "");
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        var track = getTrack(String(token));
        if (!track) return { success: false, error_message: "Unknown track id", error_type: "not_found" };
        videoId = track.id;
    }
    var result = resolveStream(videoId, quality);
    if (!result.success) return { success: false, error_message: result.error, error_type: result.error_type || "stream_error" };
    var stream = result.stream;
    var ext = extForMime(stream.mimeType);
    return {
        success: true,
        url: stream.url,
        format: ext.ext,
        actual_extension: ext.ext,
        audio_codec: ext.codec,
        quality: Math.round((parseInt(stream.bitrate, 10) || 0) / 1000) + "kbps",
        itag: stream.itag,
        track: getTrack(videoId) || undefined
    };
}

function download(token, quality, outputPath, onProgress, options) {
    var streamInfo = getDownloadUrl(token, quality, options);
    if (!streamInfo.success) return streamInfo;
    if (!outputPath) return { success: false, error_message: "Output path not provided", error_type: "invalid_path" };
    outputPath = String(outputPath);
    if (!new RegExp("\\." + streamInfo.actual_extension + "$", "i").test(outputPath)) {
        outputPath = outputPath.replace(/\.[^./\\]+$/, "") + "." + streamInfo.actual_extension;
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
        cover_url: track.cover_url || ""
    };
}

function checkAvailability(isrc, trackName, artistName, options) {
    options = options || {};
    var track = options.track || {};
    var videoId = track.provider_id === EXT_ID ? String(track.id || "") : "";
    if (!videoId && track.id && /^[A-Za-z0-9_-]{11}$/.test(String(track.id))) videoId = String(track.id);
    if (!videoId && trackName) {
        var results = searchTracks(trackName + " " + (artistName || ""), 5);
        if (results.length) videoId = results[0].id;
    }
    if (!videoId) return { available: false, reason: "No YouTube id to match" };
    var probe = resolveStream(videoId, "AUDIO_HIGH");
    if (!probe.success) return { available: false, reason: probe.error };
    return {
        available: true,
        track_id: videoId,
        quality: Math.round((parseInt(probe.stream.bitrate, 10) || 0) / 1000) + "kbps",
        prepared_context: { videoId: videoId, stream: probe.stream }
    };
}

// ------------------------------------------------------------
// URL handling
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

function extractChannelId(url) {
    var m = String(url).match(/channel\/(UC[A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
}

function handleUrl(url) {
    if (!url) return { success: false, error: "Empty URL" };
    var videoId = extractVideoId(url);
    if (videoId) {
        var track = getTrack(videoId);
        if (!track) return { success: false, error: "Could not resolve track metadata" };
        return { success: true, type: "track", track: track, image_url: track.cover_url };
    }
    var listId = extractListId(url);
    if (listId) {
        var playlist = getPlaylist(listId);
        if (!playlist.success) return { success: false, error: playlist.error };
        return { success: true, type: "playlist", playlist: playlist.playlist, image_url: playlist.playlist.cover_url };
    }
    var channelId = extractChannelId(url);
    if (channelId) {
        var artist = getArtist(channelId);
        if (!artist.success) return { success: false, error: artist.error };
        return { success: true, type: "artist", artist: artist.artist, image_url: artist.image_url };
    }
    return { success: false, error: "Not a YouTube or YouTube Music link" };
}

// ============================================================
// Register with the host application
// ============================================================
registerExtension({
    initialize: function () {},
    cleanup: function () {},
    forceCleanup: function () { cacheClear(); },
    searchTracks: searchTracks,
    customSearch: customSearch,
    getTrack: getTrack,
    getAlbum: getAlbum,
    getPlaylist: getPlaylist,
    getArtist: getArtist,
    getHomeFeed: getHomeFeed,
    enrichTrack: enrichTrack,
    checkAvailability: checkAvailability,
    getDownloadUrl: getDownloadUrl,
    download: download,
    handleUrl: handleUrl
});

log.info("[ZenYTM] Zen YouTube Music extension loaded");
