// ============================================================
// Zen Spotify Extension
// Spotify metadata & search provider.
//
// Two independent data paths (used in this order, per request):
//   1. Anonymous embed token -> api.spotify.com/v1 (full search +
//      deep metadata). This is the same anonymous token Spotify's
//      own web embed player uses; it works on normal networks.
//   2. Public /embed/<type>/<id> pages (__NEXT_DATA__) — no token
//      at all, works everywhere, used for URL imports and as a
//      metadata fallback when the token endpoint is unreachable.
//
// Spotify does not expose direct stream URLs, so this extension is
// metadata-only: the app's download chain uses the ISRC/duration/
// artist fields here to match tracks against lossless providers.
// ============================================================

var EXT_ID = "zen-spotify";

var SP_ORIGIN = "https://open.spotify.com";
var SP_API = "https://api.spotify.com/v1";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

var TOKEN_TTL_MS = 45 * 60 * 1000;
var META_TTL_MS = 30 * 60 * 1000;
var SEARCH_TTL_MS = 15 * 60 * 1000;
var MAX_CACHE = 200;

var config = { market: "IN" };

// ------------------------------------------------------------
// Cache
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
        storage.set("c_" + key, JSON.stringify({ v: value, e: Date.now() + (ttlMs || META_TTL_MS) }));
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
// Token (anonymous embed credential)
// ------------------------------------------------------------
function getToken() {
    var cached = cacheGet("token");
    if (cached) return cached;
    var response;
    try {
        response = http.get(SP_ORIGIN + "/get_access_token?reason=transport&productType=embed",
            { "User-Agent": UA, "Accept": "application/json" });
    } catch (e) { return ""; }
    if (!response || !response.ok) {
        log.debug("[ZenSpotify] token endpoint HTTP " + (response ? response.statusCode : "none"));
        return "";
    }
    try {
        var data = JSON.parse(response.body);
        var token = data.accessToken || "";
        if (token) {
            cacheSet("token", token, TOKEN_TTL_MS);
            cacheRemember("token");
        }
        return token;
    } catch (e) { return ""; }
}

function apiGet(path) {
    var token = getToken();
    if (!token) return { unauthenticated: true };
    var response;
    try {
        response = http.get(SP_API + path, {
            "Authorization": "Bearer " + token,
            "User-Agent": UA,
            "Accept": "application/json"
        });
    } catch (e) { return {}; }
    if (!response || !response.ok) {
        log.debug("[ZenSpotify] api HTTP " + (response ? response.statusCode : "none") + " for " + path);
        return { status: response ? response.statusCode : 0 };
    }
    try { return JSON.parse(response.body); } catch (e) { return {}; }
}

// ------------------------------------------------------------
// Embed pages (no token, always available)
// ------------------------------------------------------------
function embedData(type, id) {
    var cached = cacheGet("embed_" + type + "_" + id);
    if (cached) return cached;
    var response;
    try {
        response = http.get(SP_ORIGIN + "/embed/" + type + "/" + encodeURIComponent(id), {
            "User-Agent": UA, "Accept": "text/html"
        });
    } catch (e) { return null; }
    if (!response || !response.ok || !response.body) return null;
    var match = response.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) return null;
    try {
        var next = JSON.parse(match[1]);
        var entity = (((next.props || {}).pageProps || {}).state || {}).data || {};
        entity = entity.entity || entity;
        if (!entity || !entity.id) return null;
        cacheSet("embed_" + type + "_" + id, entity, META_TTL_MS);
        cacheRemember("embed_" + type + "_" + id);
        return entity;
    } catch (e) { return null; }
}

function coverFromEmbed(entity) {
    try {
        var sources = (entity.coverArt || entity.visuals || {}).sources || (entity.coverArt || {}).sources || [];
        if (sources.length) return sources[sources.length - 1].url || "";
    } catch (e) {}
    return "";
}

function artistString(list) {
    var names = [];
    try {
        for (var i = 0; i < list.length; i++) {
            var n = list[i].name || list[i].profile && list[i].profile.name || "";
            if (n) names.push(n);
        }
    } catch (e) {}
    return names.join(", ");
}

function trackFromEmbed(entity) {
    if (!entity) return null;
    var albumName = "";
    try { albumName = entity.albumOfTrack ? entity.albumOfTrack.name : (entity.album || {}).name || ""; } catch (e) {}
    return {
        id: entity.id,
        uri: entity.uri || ("spotify:track:" + entity.id),
        name: entity.name || entity.title || "",
        artists: artistString(entity.artists || []),
        album_name: albumName,
        duration_ms: entity.duration ? entity.duration.totalMilliseconds : (entity.duration || 0),
        cover_url: coverFromEmbed(entity.albumOfTrack || entity),
        item_type: "track",
        provider_id: EXT_ID,
        explicit: entity.isExplicit === true,
        isrc: "",
        external_urls: "https://open.spotify.com/track/" + entity.id,
        preview_url: entity.audioPreview ? entity.audioPreview.url : ""
    };
}

// ------------------------------------------------------------
// Unified track/collection formatting (API shapes)
// ------------------------------------------------------------
function apiArtists(list) {
    var names = [];
    try { for (var i = 0; i < list.length; i++) if (list[i].name) names.push(list[i].name); } catch (e) {}
    return names.join(", ");
}

function apiCover(images) {
    try {
        var best = "";
        var bestW = 0;
        for (var i = 0; i < images.length; i++) {
            if ((images[i].width || 0) >= bestW) { bestW = images[i].width || 0; best = images[i].url || ""; }
        }
        return best;
    } catch (e) { return ""; }
}

function formatApiTrack(t) {
    return {
        id: t.id,
        uri: t.uri || ("spotify:track:" + t.id),
        name: t.name || "",
        artists: apiArtists(t.artists || []),
        album_name: (t.album && t.album.name) || "",
        album_id: (t.album && t.album.id) || "",
        duration_ms: t.duration_ms || 0,
        cover_url: apiCover((t.album && t.album.images) || []),
        item_type: "track",
        provider_id: EXT_ID,
        explicit: t.explicit === true,
        isrc: (t.external_ids && t.external_ids.isrc) || "",
        track_number: t.track_number || 0,
        disc_number: t.disc_number || 0,
        release_date: (t.album && t.album.release_date) || "",
        external_urls: (t.external_urls && t.external_urls.spotify) || ("https://open.spotify.com/track/" + t.id),
        popularity: t.popularity
    };
}

function formatApiAlbum(a) {
    return {
        id: a.id,
        name: a.name || "",
        artists: apiArtists(a.artists || []),
        subtext: apiArtists(a.artists || []),
        item_type: "album",
        provider_id: EXT_ID,
        cover_url: apiCover(a.images || []),
        track_count: (a.total_tracks !== undefined) ? String(a.total_tracks) : "",
        release_date: a.release_date || "",
        external_urls: (a.external_urls && a.external_urls.spotify) || ("https://open.spotify.com/album/" + a.id)
    };
}

function formatApiPlaylist(p) {
    return {
        id: p.id,
        name: p.name || "",
        subtext: (p.owner && p.owner.display_name) || "",
        item_type: "playlist",
        provider_id: EXT_ID,
        cover_url: apiCover(p.images || []),
        track_count: (p.tracks && p.tracks.total !== undefined) ? String(p.tracks.total) : "",
        external_urls: (p.external_urls && p.external_urls.spotify) || ("https://open.spotify.com/playlist/" + p.id)
    };
}

function formatApiArtist(a) {
    return {
        id: a.id,
        name: a.name || "",
        subtext: (a.genres && a.genres.join(", ")) || "",
        item_type: "artist",
        provider_id: EXT_ID,
        cover_url: apiCover((a.images || [])),
        external_urls: (a.external_urls && a.external_urls.spotify) || ("https://open.spotify.com/artist/" + a.id)
    };
}

function entityAlbumFromEmbed(entity) {
    return {
        id: entity.id,
        name: entity.name || "",
        artists: artistString(entity.artists || entity.creators || []),
        subtext: artistString(entity.artists || entity.creators || []),
        item_type: "album",
        provider_id: EXT_ID,
        cover_url: coverFromEmbed(entity),
        track_count: "",
        releaseDate: entity.releaseDate || "",
        external_urls: "https://open.spotify.com/album/" + entity.id
    };
}

// ------------------------------------------------------------
// Services
// ------------------------------------------------------------
function initialize(settings) {
    settings = settings || {};
    if (settings.market) config.market = String(settings.market).toUpperCase().slice(0, 2);
}

function cleanup() {}
function forceCleanup() { cacheClear(); }

function market() { return config.market || "IN"; }

function searchTracks(query, limit) {
    limit = limit || 20;
    var cacheKey = "s_" + query + "_" + limit;
    var cached = cacheGet(cacheKey);
    if (cached) return cached;
    var data = apiGet("/search?q=" + encodeURIComponent(query) + "&type=track&limit=" + limit + "&market=" + market());
    var tracks = [];
    if (data && data.tracks && data.tracks.items) {
        for (var i = 0; i < data.tracks.items.length; i++) {
            var t = formatApiTrack(data.tracks.items[i]);
            if (t.id) tracks.push(t);
        }
    }
    cacheSet(cacheKey, tracks, SEARCH_TTL_MS);
    cacheRemember(cacheKey);
    return tracks;
}

function customSearch(query, filter, limit, page) {
    limit = limit || 20;
    var typeMap = { albums: "album", playlists: "playlist", artists: "artist" };
    var type = typeMap[filter] || "track";
    var data = apiGet("/search?q=" + encodeURIComponent(query) + "&type=" + type + "&limit=" + limit + (page && page > 1 ? "&offset=" + ((page - 1) * limit) : "") + "&market=" + market());
    var out = [];
    var bucket = data && data[type + "s"];
    if (bucket && bucket.items) {
        for (var i = 0; i < bucket.items.length; i++) {
            var item = bucket.items[i];
            if (!item || !item.id) continue;
            if (type === "album") out.push(formatApiAlbum(item));
            else if (type === "playlist") out.push(formatApiPlaylist(item));
            else if (type === "artist") out.push(formatApiArtist(item));
            else out.push(formatApiTrack(item));
        }
    }
    return out;
}

function getTrack(token) {
    if (!token) return null;
    var id = String(token).replace(/^spotify:track:/, "").split("?")[0];
    var cached = cacheGet("track_" + id);
    if (cached) return cached;
    var track = null;
    var data = apiGet("/tracks/" + id + "?market=" + market());
    if (data && data.id) track = formatApiTrack(data);
    if (!track) track = trackFromEmbed(embedData("track", id));
    if (track) { cacheSet("track_" + id, track, META_TTL_MS); cacheRemember("track_" + id); }
    return track;
}

function getAlbum(token) {
    var id = String(token || "").replace(/^spotify:album:/, "").split("?")[0];
    var data = apiGet("/albums/" + id + "?market=" + market());
    if (data && data.id) {
        var tracks = [];
        var items = (data.tracks && data.tracks.items) || [];
        for (var i = 0; i < items.length; i++) {
            var t = formatApiTrack(items[i]);
            t.album_name = data.name;
            t.cover_url = t.cover_url || apiCover(data.images || []);
            t.track_number = items[i].track_number || (i + 1);
            tracks.push(t);
        }
        var album = formatApiAlbum(data);
        album.tracks = tracks;
        return { success: true, type: "album", album: album, image_url: album.cover_url };
    }
    // Embed fallback (works without a token)
    var entity = embedData("album", id);
    if (entity) {
        var albumEmbed = entityAlbumFromEmbed(entity);
        var embedTracks = [];
        var trackList = ((entity.trackList || []));
        for (var k = 0; k < trackList.length; k++) {
            var te = trackList[k];
            var tid = String(te.uri || "").replace("spotify:track:", "");
            embedTracks.push({
                id: tid,
                name: te.title || "",
                artists: artistString(entity.artists || []),
                album_name: entity.name || "",
                duration_ms: te.duration ? te.duration.totalMilliseconds : 0,
                cover_url: coverFromEmbed(entity),
                item_type: "track",
                provider_id: EXT_ID,
                track_number: k + 1,
                external_urls: "https://open.spotify.com/track/" + tid
            });
        }
        albumEmbed.tracks = embedTracks;
        return { success: true, type: "album", album: albumEmbed, image_url: albumEmbed.cover_url };
    }
    return { success: false, error: "Album not found (Spotify token unreachable and embed unavailable)" };
}

function getPlaylist(token) {
    var id = String(token || "").replace(/^spotify:playlist:/, "").split("?")[0];
    var data = apiGet("/playlists/" + id + "?market=" + market());
    if (data && data.id) {
        var tracks = [];
        var items = ((data.tracks && data.tracks.items) || []);
        for (var i = 0; i < items.length; i++) {
            var raw = items[i] && items[i].track;
            if (!raw || !raw.id || raw.is_local) continue;
            tracks.push(formatApiTrack(raw));
        }
        var playlist = formatApiPlaylist(data);
        playlist.tracks = tracks;
        playlist.track_count = String(tracks.length);
        return { success: true, type: "playlist", playlist: playlist, image_url: playlist.cover_url };
    }
    var entity = embedData("playlist", id);
    if (entity) {
        var plEmbed = {
            id: entity.id,
            name: entity.title || entity.name || "",
            subtext: entity.subtitle || "",
            item_type: "playlist",
            provider_id: EXT_ID,
            cover_url: coverFromEmbed(entity),
            track_count: String((entity.trackList || []).length),
            tracks: []
        };
        var list = entity.trackList || [];
        for (var j = 0; j < list.length; j++) {
            var entry = list[j];
            var eid = String(entry.uri || "").replace("spotify:track:", "");
            plEmbed.tracks.push({
                id: eid,
                name: entry.title || "",
                artists: entry.subtitle || "",
                album_name: "",
                duration_ms: entry.duration ? entry.duration.totalMilliseconds : 0,
                cover_url: "",
                item_type: "track",
                provider_id: EXT_ID,
                external_urls: "https://open.spotify.com/track/" + eid
            });
        }
        return { success: true, type: "playlist", playlist: plEmbed, image_url: plEmbed.cover_url };
    }
    return { success: false, error: "Playlist not found" };
}

function getArtist(token) {
    var id = String(token || "").replace(/^spotify:artist:/, "").split("?")[0];
    var data = apiGet("/artists/" + id);
    if (data && data.id) {
        var artist = formatApiArtist(data);
        var top = apiGet("/artists/" + id + "/top-tracks?market=" + market());
        artist.top_tracks = [];
        if (top && top.tracks) {
            for (var i = 0; i < top.tracks.length && i < 10; i++) {
                artist.top_tracks.push(formatApiTrack(top.tracks[i]));
            }
        }
        var albums = apiGet("/artists/" + id + "/albums?include_groups=album,single&limit=12&market=" + market());
        artist.albums = [];
        if (albums && albums.items) {
            for (var k = 0; k < albums.items.length; k++) {
                artist.albums.push(formatApiAlbum(albums.items[k]));
            }
        }
        return { success: true, type: "artist", artist: artist, image_url: artist.cover_url };
    }
    var entity = embedData("artist", id);
    if (entity) {
        var aEmbed = {
            id: entity.id,
            name: entity.name || "",
            subtext: entity.biography || "",
            item_type: "artist",
            provider_id: EXT_ID,
            cover_url: coverFromEmbed(entity),
            image_url: coverFromEmbed(entity),
            top_tracks: [],
            albums: []
        };
        var stats = ((entity.stats || {}).topCities) ? entity.stats : {};
        return { success: true, type: "artist", artist: aEmbed, image_url: aEmbed.cover_url };
    }
    return { success: false, error: "Artist not found" };
}

function getHomeFeed() {
    var sections = [];
    var newReleases = apiGet("/browse/new-releases?limit=12&market=" + market());
    if (newReleases && newReleases.albums && newReleases.albums.items) {
        var items = [];
        for (var i = 0; i < newReleases.albums.items.length; i++) {
            var al = formatApiAlbum(newReleases.albums.items[i]);
            if (al.id) items.push(al);
        }
        if (items.length >= 2) sections.push({ title: "New Releases", items: items });
    }
    if (!sections.length) {
        // Token unreachable — embed-based "Today's Top Hits" fallback.
        var top = getPlaylist("37i9dQZF1DXcBWIGoYBM5M");
        if (top.success && top.playlist.tracks.length >= 2) {
            var feedTracks = [];
            for (var t = 0; t < top.playlist.tracks.length && t < 12; t++) feedTracks.push(top.playlist.tracks[t]);
            sections.push({ title: top.playlist.name || "Today's Top Hits", items: feedTracks });
        }
    }
    return { sections: sections };
}

function enrichTrack(track) {
    if (!track || !track.id) return track;
    var full = getTrack(track.id);
    return full || track;
}

// Spotify never ships direct stream URLs — matching data for the app's
// download providers is the whole point of this provider.
function checkAvailability(isrc, trackName, artistName, options) {
    return { available: false, reason: "Spotify is a metadata provider here — audio matching is handled by lossless download providers using this track's ISRC and duration" };
}

// ------------------------------------------------------------
// URL handling (https links + spotify: URIs)
// ------------------------------------------------------------
function handleUrl(url) {
    if (!url) return { success: false, error: "Empty URL" };
    var input = String(url).trim();

    var m = input.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)/);
    var kind = m ? m[1] : "";
    var id = m ? m[2] : "";
    if (!m) {
        m = input.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
        if (!m) return { success: false, error: "Not a Spotify link" };
        kind = m[1];
        id = m[2];
    }

    if (kind === "track") {
        var track = getTrack(id);
        if (!track) return { success: false, error: "Could not resolve the track" };
        return { success: true, type: "track", track: track, image_url: track.cover_url };
    }
    if (kind === "album") {
        var album = getAlbum(id);
        if (!album.success) return { success: false, error: album.error };
        return { success: true, type: "album", album: album.album, image_url: album.image_url };
    }
    if (kind === "playlist") {
        var playlist = getPlaylist(id);
        if (!playlist.success) return { success: false, error: playlist.error };
        return { success: true, type: "playlist", playlist: playlist.playlist, image_url: playlist.image_url };
    }
    var artist = getArtist(id);
    if (!artist.success) return { success: false, error: artist.error };
    return { success: true, type: "artist", artist: artist.artist, image_url: artist.image_url };
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
    getHomeFeed: getHomeFeed,
    enrichTrack: enrichTrack,
    checkAvailability: checkAvailability,
    handleUrl: handleUrl
});

log.info("[ZenSpotify] Zen Spotify extension loaded");
