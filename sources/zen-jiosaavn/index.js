// ============================================================
// Zen JioSaavn Extension
// Search + download provider for JioSaavn (www.jiosaavn.com web API).
// Encrypted media URLs are decrypted with DES-ECB using the
// web player's well-known key, exactly like the official apps do.
// ============================================================

var EXT_ID = "zen-jiosaavn";

var API_HOST = "https://www.jiosaavn.com";
var API_BASE = API_HOST + "/api.php";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
var COOKIE_BASE = "DL=english; geo=IN;";

var DES_KEY = "38346591";

// ------------------------------------------------------------
// DES-ECB (FIPS 46-3) — needed to decrypt JioSaavn media URLs.
// Pure ES5, no dependencies. Key = 8 ASCII chars, data = hex
// ciphertext, PKCS5-padded plaintext (UTF-8).
// ------------------------------------------------------------
var DES = (function () {
    // Permuted choice 1 (64 -> 56 bits)
    var PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2,
        59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39,
        31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37,
        29, 21, 13, 5, 28, 20, 12, 4];
    // Permuted choice 2 (56 -> 48 bits)
    var PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4,
        26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40,
        51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
    var SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
    // Initial permutation
    var IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
        62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
        57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
        61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
    // Final (inverse) permutation
    var IP_INV = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
        38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
        36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
        34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
    // Expansion (32 -> 48 bits)
    var E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11,
        12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
        22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
    // P permutation (32 -> 32 bits)
    var P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
        2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
    // S-boxes, 8 x 4 rows x 16 cols, flattened row-major per box
    var S = [
        [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
            0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
            4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
            15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
        [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
            3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
            0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
            13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
        [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
            13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
            13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
            1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
        [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
            13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
            10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
            3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
        [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
            14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
            4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
            11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
        [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
            10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
            9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
            4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
        [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
            13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
            1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
            6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
        [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
            1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
            7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
            2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
    ];

    function bytesToBits(bytes) {
        var bits = [];
        for (var i = 0; i < bytes.length; i++) {
            for (var j = 7; j >= 0; j--) bits.push((bytes[i] >> j) & 1);
        }
        return bits;
    }

    function bitsToBytes(bits) {
        var out = [];
        for (var i = 0; i < bits.length; i += 8) {
            var b = 0;
            for (var j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ? 1 : 0);
            out.push(b & 0xFF);
        }
        return out;
    }

    function permute(input, table) {
        var out = [];
        for (var i = 0; i < table.length; i++) out.push(input[table[i] - 1]);
        return out;
    }

    function rotateLeft(bits, n) {
        return bits.slice(n).concat(bits.slice(0, n));
    }

    // 16 x 48-bit subkeys, encrypt order
    function buildSubkeys(keyStr) {
        var keyBytes = [];
        for (var i = 0; i < 8; i++) keyBytes.push(keyStr.charCodeAt(i) & 0xFF);
        var keyBits = bytesToBits(keyBytes);
        var pc1 = permute(keyBits, PC1); // 56 bits
        var c = pc1.slice(0, 28);
        var d = pc1.slice(28, 56);
        var subkeys = [];
        for (var r = 0; r < 16; r++) {
            c = rotateLeft(c, SHIFTS[r]);
            d = rotateLeft(d, SHIFTS[r]);
            subkeys.push(permute(c.concat(d), PC2)); // 48 bits
        }
        return subkeys;
    }

    function xor(a, b) {
        var out = [];
        for (var i = 0; i < a.length; i++) out.push(a[i] ^ b[i]);
        return out;
    }

    function feistel(rBits, subkey) {
        var expanded = permute(rBits, E); // 48 bits
        var mixed = xor(expanded, subkey);
        var sOut = [];
        for (var box = 0; box < 8; box++) {
            var chunk = mixed.slice(box * 6, box * 6 + 6);
            var row = (chunk[0] << 1) | chunk[5];
            var col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
            var val = S[box][row * 16 + col];
            var bits = [];
            for (var b = 3; b >= 0; b--) bits.push((val >> b) & 1);
            sOut = sOut.concat(bits);
        }
        return permute(sOut, P);
    }

    function cryptBlock(blockBits, subkeys) {
        var permuted = permute(blockBits, IP);
        var left = permuted.slice(0, 32);
        var right = permuted.slice(32, 64);
        for (var r = 0; r < 16; r++) {
            var nextRight = xor(left, feistel(right, subkeys[r]));
            left = right;
            right = nextRight;
        }
        // Final swap: R16 L16
        var pre = right.concat(left);
        return permute(pre, IP_INV);
    }

    function hexToBytes(hex) {
        var out = [];
        for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
        return out;
    }

    function decryptBytes(bytes, keyStr) {
        var subkeys = buildSubkeys(keyStr).reverse(); // decrypt = reversed order
        if (bytes.length === 0 || bytes.length % 8 !== 0) return null;
        var plainBytes = [];
        for (var i = 0; i < bytes.length; i += 8) {
            var block = cryptBlock(bytesToBits(bytes.slice(i, i + 8)), subkeys);
            plainBytes = plainBytes.concat(bitsToBytes(block));
        }
        // PKCS5 unpad
        if (plainBytes.length === 0) return null;
        var pad = plainBytes[plainBytes.length - 1];
        if (pad < 1 || pad > 8) return null;
        for (var k = plainBytes.length - pad; k < plainBytes.length; k++) {
            if (plainBytes[k] !== pad) return null;
        }
        var trimmed = plainBytes.slice(0, plainBytes.length - pad);
        var text = "";
        for (var t = 0; t < trimmed.length; t++) text += String.fromCharCode(trimmed[t]);
        return text;
    }

    function decryptECB(hexCiphertext, keyStr) {
        var bytes = [];
        for (var i = 0; i < hexCiphertext.length; i += 2) {
            bytes.push(parseInt(hexCiphertext.substr(i, 2), 16));
        }
        return decryptBytes(bytes, keyStr);
    }

    return { decrypt: decryptECB, decryptBytes: decryptBytes };
})();

// Base64 -> byte array (ES5, no host deps). Handles missing padding.
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(b64) {
    var input = String(b64).replace(/-/g, "+").replace(/_/g, "/");
    input = input.replace(/[^A-Za-z0-9+/]/g, "");
    while (input.length % 4 !== 0) input += "=";
    var out = [];
    var buffer = 0, bits = 0;
    for (var i = 0; i < input.length; i++) {
        var ch = input.charAt(i);
        if (ch === "=") break;
        var value = B64_CHARS.indexOf(ch);
        if (value === -1) continue;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xFF);
        }
    }
    return out;
}

function isHexString(value) {
    if (!value || typeof value !== "string" || value.length % 2 !== 0) return false;
    return /^[0-9a-fA-F]+$/.test(value);
}

function bytesToText(bytes) {
    var text = "";
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return text;
}

function desDecryptUrl(encrypted) {
    if (!encrypted) return "";
    try {
        var cipherText = String(encrypted);
        var bytes;
        if (isHexString(cipherText)) {
            // Legacy API responses ship hex-encoded ciphertext.
            bytes = [];
            for (var i = 0; i < cipherText.length; i += 2) {
                bytes.push(parseInt(cipherText.substr(i, 2), 16));
            }
        } else {
            // api_version=4 responses ship base64-encoded ciphertext.
            bytes = base64ToBytes(cipherText);
        }
        if (bytes.length === 0 || bytes.length % 8 !== 0) return "";
        var plain = DES.decryptBytes(bytes, DES_KEY);
        if (plain && plain.indexOf("http") === 0) return plain;
        return "";
    } catch (e) {
        log.debug("[ZenSaavn] DES decrypt failed: " + (e && e.message));
        return "";
    }
}

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
        storage.set("c_" + key, JSON.stringify({ v: value, e: Date.now() + (ttlMs || 30 * 60 * 1000) }));
    } catch (e) {}
}

function cacheRemove(key) { try { storage.remove("c_" + key); } catch (e) {} }

function clearCache() {
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
// API helpers
// ------------------------------------------------------------
function apiParams(extra) {
    var params = {
        _format: "json",
        _marker: "0",
        api_version: "4",
        ctx: "web6dot0"
    };
    if (extra) for (var k in extra) params[k] = extra[k];
    var parts = [];
    for (var key in params) parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
    return parts.join("&");
}

function apiCall(call, extra) {
    var url = API_BASE + "?__call=" + call + "&" + apiParams(extra);
    var headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": UA,
        "Referer": API_HOST + "/",
        "Cookie": COOKIE_BASE
    };
    var response;
    try { response = http.get(url, headers); } catch (e) {
        log.debug("[ZenSaavn] api get threw: " + (e && e.message));
        return null;
    }
    if (!response || !response.ok) {
        log.debug("[ZenSaavn] " + call + " HTTP " + (response ? response.statusCode : "none"));
        return null;
    }
    try { return JSON.parse(response.body); } catch (e) {
        log.debug("[ZenSaavn] " + call + " JSON error: " + e.message);
        return null;
    }
}

function decodeEntities(s) {
    if (!s) return "";
    var text = String(s);
    text = text.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
    return text;
}

function upscaleImage(url) {
    var u = decodeEntities(url || "");
    if (!u) return "";
    u = u.replace("150x150", "500x500").replace("50x50", "500x500");
    if (u.indexOf("http") !== 0) u = "https://" + u.replace(/^\/\//, "");
    return u;
}

function durationToMs(seconds) {
    return (parseInt(seconds, 10) || 0) * 1000;
}

function artistNames(song) {
    var names = [];
    try {
        var map = song.more_info.artistMap;
        var groups = ["primary_artists", "featured_artists", "artists"];
        for (var g = 0; g < groups.length; g++) {
            var list = map && map[groups[g]];
            if (!list || !list.length) continue;
            for (var i = 0; i < list.length; i++) {
                var n = decodeEntities(list[i].name || "").trim();
                if (n && names.indexOf(n) === -1) names.push(n);
            }
            if (names.length) break;
        }
    } catch (e) {}
    return names.join(", ");
}

function formatSong(raw, albumFallback, index) {
    if (!raw) return null;
    var more = raw.more_info || {};
    var id = raw.id || more.id || "";
    if (!id) return null;
    var mediaUrl = desDecryptUrl(more.encrypted_media_url);
    // Some v4 responses ship plain urls; accept those too.
    if (!mediaUrl && more.media_url && String(more.media_url).indexOf("http") === 0) {
        mediaUrl = String(more.media_url);
    }
    var track = {
        id: String(id),
        name: decodeEntities(raw.title || more.title || ""),
        artists: artistNames(raw),
        album_name: decodeEntities(more.album || albumFallback || ""),
        album_id: String(more.album_id || ""),
        duration_ms: durationToMs(more.duration),
        cover_url: upscaleImage(raw.image || more.image || ""),
        item_type: "track",
        provider_id: EXT_ID,
        explicit: more.is_explicit === true || more.explicit_content === "1",
        language: more.language || "",
        perma_url: decodeEntities(more.perma_url || raw.perma_url || ""),
        media_url: mediaUrl,
        external_urls: decodeEntities(more.perma_url || raw.perma_url || "") || ("https://www.jiosaavn.com/song/" + id)
    };
    if (albumFallback) {
        track.track_number = index || 0;
        track.release_date = "";
    }
    return track;
}

function formatCollection(raw, type) {
    if (!raw) return null;
    var id = raw.id || (raw.more_info && raw.more_info.id) || "";
    if (!id) return null;
    var name = decodeEntities(raw.title || raw.name || raw.listname || "");
    return {
        id: String(id),
        name: name,
        subtext: type === "album"
            ? artistNames({ more_info: raw.more_info || {} }) || decodeEntities((raw.more_info && raw.more_info.music) || "")
            : decodeEntities((raw.more_info && raw.more_info.subtitle) || raw.subtitle || (raw.more_info && raw.more_info.firstname) || ""),
        item_type: type === "album" ? "album" : "playlist",
        provider_id: EXT_ID,
        cover_url: upscaleImage(raw.image || (raw.more_info && raw.more_info.image) || ""),
        external_urls: decodeEntities(raw.perma_url || (raw.more_info && raw.more_info.perma_url) || "")
    };
}

function formatArtist(raw, detailed) {
    if (!raw) return null;
    var id = raw.id || raw.artistId || "";
    if (!id) return null;
    var artist = {
        id: String(id),
        name: decodeEntities(raw.title || raw.name || ""),
        item_type: "artist",
        provider_id: EXT_ID,
        cover_url: upscaleImage(raw.image || "")
    };
    if (detailed) {
        artist.image_url = artist.cover_url;
        artist.top_tracks = [];
        artist.albums = [];
        try {
            var songs = (raw.topSongs && raw.topSongs.songs) || [];
            for (var i = 0; i < songs.length && i < 10; i++) {
                var t = formatSong(songs[i]);
                if (t) artist.top_tracks.push(t);
            }
            var albums = (raw.topAlbums && raw.topAlbums.albums) || [];
            for (var a = 0; a < albums.length && a < 12; a++) {
                var al = formatCollection(albums[a], "album");
                if (al) artist.albums.push(al);
            }
        } catch (e) {}
    }
    return artist;
}

function firstSongList(payload) {
    if (!payload) return [];
    if (payload.results && payload.results.length) return payload.results;
    if (payload.songs && payload.songs.length) return payload.songs;
    return [];
}

// ------------------------------------------------------------
// Services
// ------------------------------------------------------------
function initialize(settings) { settings = settings || {}; }
function cleanup() {}
function forceCleanup() { clearCache(); }

function searchTracks(query, limit) {
    limit = limit || 20;
    var cached = cacheGet("search_" + query + "_" + limit);
    if (cached) return cached;
    var data = apiCall("search.getResults", { q: query, p: "1", n: String(limit) });
    var out = [];
    var items = firstSongList(data);
    for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type !== "song") continue;
        var t = formatSong(items[i]);
        if (t && t.id) out.push(t);
    }
    cacheSet("search_" + query + "_" + limit, out, 15 * 60 * 1000);
    cacheRemember("search_" + query + "_" + limit);
    return out;
}

function customSearch(query, filter, limit, page) {
    limit = limit || 20;
    page = page || 1;
    var callMap = {
        tracks: "search.getResults",
        albums: "search.getAlbumResults",
        playlists: "search.getPlaylistResults",
        artists: "search.getArtistResults"
    };
    var call = callMap[filter] || callMap.tracks;
    var data = apiCall(call, { q: query, p: String(page), n: String(limit) });
    var out = [];
    var items = firstSongList(data);
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (filter === "albums" || (item.type === "album")) {
            var al = formatCollection(item, "album");
            if (al) out.push(al);
        } else if (filter === "playlists" || item.type === "playlist") {
            var pl = formatCollection(item, "playlist");
            if (pl) out.push(pl);
        } else if (filter === "artists" || item.type === "artist") {
            var ar = formatArtist(item, false);
            if (ar) out.push(ar);
        } else if (!filter || filter === "tracks" || item.type === "song") {
            var t = formatSong(item);
            if (t) out.push(t);
        }
    }
    return out;
}

function getTrack(token) {
    if (!token) return null;
    var cached = cacheGet("track_" + token);
    if (cached) return cached;
    var data = apiCall("song.getDetails", { pids: String(token) });
    var song = null;
    if (data && data[String(token)]) song = data[String(token)];
    else if (data && data.songs && data.songs.length) song = data.songs[0];
    var track = song ? formatSong(song) : null;
    if (track) {
        cacheSet("track_" + token, track, 30 * 60 * 1000);
        cacheRemember("track_" + token);
    }
    return track;
}

function getAlbum(token) {
    var data = apiCall("content.getAlbumDetails", { albumid: String(token) });
    if (!data || !data.id) return { success: false, error: "Album not found" };
    var songsRaw = firstSongList(data);
    var tracks = [];
    for (var i = 0; i < songsRaw.length; i++) {
        var t = formatSong(songsRaw[i], decodeEntities(data.title || ""), i + 1);
        if (t) tracks.push(t);
    }
    return {
        success: true,
        type: "album",
        album: {
            id: String(data.id),
            name: decodeEntities(data.title || ""),
            artists: artistNames({ more_info: data.more_info || data }),
            cover_url: upscaleImage(data.image || ""),
            item_type: "album",
            provider_id: EXT_ID,
            track_count: tracks.length,
            tracks: tracks
        }
    };
}

function getPlaylist(token) {
    var data = apiCall("playlist.getPlaylistDetails", { playlistid: String(token) });
    if (!data || !data.id) return { success: false, error: "Playlist not found" };
    var songsRaw = firstSongList(data);
    var tracks = [];
    for (var i = 0; i < songsRaw.length; i++) {
        var t = formatSong(songsRaw[i]);
        if (t) tracks.push(t);
    }
    return {
        success: true,
        type: "playlist",
        playlist: {
            id: String(data.id),
            name: decodeEntities(data.title || data.listname || ""),
            subtext: decodeEntities((data.more_info && data.more_info.firstname) || ""),
            cover_url: upscaleImage(data.image || data.images || ""),
            item_type: "playlist",
            provider_id: EXT_ID,
            track_count: tracks.length,
            tracks: tracks
        }
    };
}

function getArtist(token) {
    var data = apiCall("artist.getArtistPageDetails", { artistId: String(token) });
    if (!data || !(data.id || data.artistId)) return { success: false, error: "Artist not found" };
    var artist = formatArtist(data, true);
    if (!artist) return { success: false, error: "Artist not found" };
    return { success: true, type: "artist", artist: artist, image_url: artist.cover_url };
}

function getHomeFeed() {
    var lang = "english";
    try { lang = storage.get("lang") || "english"; } catch (e) {}
    var data = apiCall("content.getHomepageData", { language: lang });
    if (!data) return { sections: [] };
    var sections = [];

    function feedItems(raw) {
        var items = [];
        for (var i = 0; i < raw.length && items.length < 12; i++) {
            var v = raw[i];
            if (!v || !v.id) continue;
            var type = v.type || "";
            if (type === "song") {
                // Feed items ship flat (no more_info) — light format only;
                // playback resolves lazily via getTrack(id).
                var more = v.more_info || {};
                items.push({
                    id: String(v.id),
                    name: decodeEntities(v.title || ""),
                    artists: decodeEntities(v.subtitle || more.artistMap || ""),
                    album_name: "",
                    duration_ms: 0,
                    cover_url: upscaleImage(v.image || more.image || ""),
                    item_type: "track",
                    provider_id: EXT_ID,
                    external_urls: decodeEntities(v.perma_url || v.url || "")
                });
            } else if (type === "album") {
                var al = formatCollection({
                    id: v.id, title: v.title, image: v.image,
                    perma_url: v.perma_url || v.url,
                    more_info: v.more_info || {}
                }, "album");
                if (al) { al.subtext = decodeEntities(v.subtitle || ""); items.push(al); }
            } else if (type === "playlist") {
                var pl = formatCollection({
                    id: v.id, title: v.title, image: v.image,
                    perma_url: v.perma_url || v.url,
                    more_info: v.more_info || {}
                }, "playlist");
                if (pl) { pl.subtext = decodeEntities(v.subtitle || ""); items.push(pl); }
            }
        }
        return items;
    }

    var newAlbums = Array.isArray(data.new_albums) ? data.new_albums : [];
    var featured = Array.isArray(data.featured_playlists) ? data.featured_playlists : [];
    var charts = Array.isArray(data.charts) ? data.charts : [];

    if (newAlbums.length) {
        var items = feedItems(newAlbums);
        if (items.length >= 2) sections.push({ title: "New & Trending", items: items });
    }
    if (featured.length) {
        var items2 = feedItems(featured);
        if (items2.length >= 2) sections.push({ title: "Featured Playlists", items: items2 });
    }
    if (charts.length) {
        var items3 = feedItems(charts);
        if (items3.length >= 2) sections.push({ title: "Charts", items: items3 });
    }
    return { sections: sections };
}

function enrichTrack(track) {
    if (!track || !track.id) return track;
    var full = getTrack(track.id);
    return full || track;
}

// ------------------------------------------------------------
// Download
// ------------------------------------------------------------
function bitrateForQuality(qualityId) {
    var map = { AAC_320: "320", AAC_160: "160", AAC_96: "96", AAC_48: "48", AAC_12: "12" };
    return map[String(qualityId || "AAC_320").toUpperCase()] || "320";
}

function upgradeMediaUrl(url, bitrate) {
    if (!url) return url;
    // https://aac.saavncdn.com/.../track_96.mp4 -> _320
    var upgraded = url.replace(/_(\d{2,3})(\.mp4)/, "_" + bitrate + "$2");
    return upgraded;
}

function cacheDownloadTrack(track, reference) {
    if (!track || !track.media_url) return;
    var ids = [reference, track.id];
    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (!id || ids.indexOf(id) !== i) continue;
        cacheSet("url_" + id, track.media_url, 60 * 60 * 1000);
        cacheSet("trackobj_" + id, track, 60 * 60 * 1000);
    }
}

function getDownloadUrl(token, quality, options) {
    token = String(token || "");
    if (!token) return { success: false, error_message: "Invalid JioSaavn track ID", error_type: "not_found" };
    var mediaUrl = "";
    var track = null;
    var prepared = options && options.preparedContext && options.preparedContext.track;
    if (prepared && String(prepared.id) === token && prepared.media_url) {
        mediaUrl = prepared.media_url;
        track = prepared;
    }
    if (!mediaUrl) {
        mediaUrl = cacheGet("url_" + token);
        var cachedTrack = cacheGet("trackobj_" + token);
        if (cachedTrack) track = cachedTrack;
    }
    if (!mediaUrl) {
        track = getTrack(token);
        if (track && track.media_url) {
            mediaUrl = track.media_url;
            cacheDownloadTrack(track, token);
        }
    }
    if (!mediaUrl) {
        return { success: false, error_message: "JioSaavn has no playable stream for this track", error_type: "stream_error" };
    }
    var bitrate = bitrateForQuality(quality);
    var finalUrl = upgradeMediaUrl(mediaUrl, bitrate);
    return {
        success: true,
        url: finalUrl,
        format: "m4a",
        actual_extension: "m4a",
        audio_codec: "aac",
        quality: bitrate + "kbps",
        track: track || undefined
    };
}

function download(token, quality, outputPath, onProgress, options) {
    var streamInfo = getDownloadUrl(token, quality, options);
    if (!streamInfo.success) return streamInfo;
    if (!outputPath) {
        return { success: false, error_message: "Output path not provided", error_type: "invalid_path" };
    }
    outputPath = String(outputPath);
    if (!/\.m4a$/i.test(outputPath)) {
        outputPath = outputPath.replace(/\.[^./\\]+$/, "") + ".m4a";
    }
    var dl;
    try {
        dl = file.download(streamInfo.url, outputPath, {
            headers: { "User-Agent": UA, "Referer": API_HOST + "/" },
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
        format: "m4a",
        actual_extension: "m4a",
        audio_codec: "aac",
        title: track.name || "",
        artist: track.artists || "",
        album: track.album_name || "",
        album_artist: "",
        track_number: track.track_number || 0,
        total_tracks: 0,
        disc_number: 0,
        total_discs: 0,
        release_date: track.release_date || "",
        cover_url: track.cover_url || "",
        genre: "",
        label: "",
        copyright: "",
        composer: "",
        explicit: track.explicit === true
    };
}

function checkAvailability(isrc, trackName, artistName, options) {
    options = options || {};
    var track = options.track || {};
    if (track.provider_id === EXT_ID && track.id) {
        var song = getTrack(track.id);
        if (song && song.media_url) {
            cacheDownloadTrack(song, track.id);
            return { available: true, track_id: song.id, prepared_context: { track: song } };
        }
    }
    if (!trackName) return { available: false, reason: "No recording metadata to match" };
    var candidates = searchTracks(trackName + " " + (artistName || ""), 10);
    var requestedDuration = (options.duration_ms || track.duration_ms || 0);
    for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (!candidate.media_url) continue;
        if (!artistName) continue;
        if (matchingName(trackName) !== matchingName(candidate.name) ||
            !matchingArtists(artistName, candidate.artists)) continue;
        if (requestedDuration && candidate.duration_ms &&
            Math.abs(requestedDuration - candidate.duration_ms) > 8000) continue;
        cacheDownloadTrack(candidate, candidate.id);
        return { available: true, track_id: candidate.id, prepared_context: { track: candidate } };
    }
    return { available: false, reason: "No matching JioSaavn recording" };
}

function matchingName(value) {
    return decodeEntities(value).toLowerCase().replace(/[^a-z0-9\u0080-\uffff]+/g, " ").trim();
}

function matchingArtists(expected, actual) {
    function names(value) {
        return String(value || "").split(/[,;&]|\s+(?:feat\.?|ft\.?)\s+/i).map(matchingName).filter(Boolean);
    }
    var requested = names(expected);
    var provided = names(actual);
    for (var i = 0; i < requested.length; i++) {
        if (provided.indexOf(requested[i]) !== -1) return true;
    }
    return false;
}

// ------------------------------------------------------------
// URL handling
// ------------------------------------------------------------
function extractToken(permaUrl) {
    // JioSaavn share links carry the base62 id as the LAST path segment,
    // e.g. https://www.jiosaavn.com/song/gehra-hua/QQ8jRRlhBEs
    var segments = String(permaUrl || "/").split("?")[0].split("/")
        .filter(function (s) { return s.length > 0; });
    if (!segments.length) return "";
    var last = segments[segments.length - 1];
    if (last === "featured" || last === "playlist" || last === "song" ||
        last === "album" || last === "artist" || last === "s") return "";
    return decodeURIComponent(last);
}

function resolveToken(token, type) {
    // webapi.get understands base62 tokens for songs, albums, playlists
    // and artists alike and returns a keyed envelope.
    var data = apiCall("webapi.get", { token: token, type: type });
    if (!data) return null;
    var plural = type + "s";
    if (data[plural] && data[plural].length) return data[plural][0];
    return null;
}

function urlKind(url) {
    var u = String(url || "");
    if (/jiosaavn\.com\/song\//.test(u)) return "song";
    if (/jiosaavn\.com\/album\//.test(u)) return "album";
    if (/jiosaavn\.com\/(playlist|s\/playlist|featured)\//.test(u)) return "playlist";
    if (/jiosaavn\.com\/artist\//.test(u)) return "artist";
    return "";
}

function handleUrl(url) {
    if (!url) return { success: false, error: "Empty URL" };
    var kind = urlKind(url);
    if (!kind) return { success: false, error: "Not a JioSaavn song, album, playlist, or artist link" };
    var token = extractToken(url);
    if (!token) return { success: false, error: "Invalid URL — could not extract token" };

    if (kind === "song") {
        var raw = resolveToken(token, "song");
        var track = raw ? formatSong(raw) : (getTrack(token) || null);
        if (!track) return { success: false, error: "Could not resolve the song" };
        return { success: true, type: "track", track: track, image_url: track.cover_url };
    }
    if (kind === "album") {
        var rawAlbum = resolveToken(token, "album");
        if (rawAlbum && rawAlbum.id) return getAlbum(rawAlbum.id);
        var directAlbum = getAlbum(token);
        if (directAlbum.success) return directAlbum;
        return { success: false, error: "Could not resolve the album" };
    }
    if (kind === "playlist") {
        var rawPlaylist = resolveToken(token, "playlist");
        if (rawPlaylist && rawPlaylist.id) return getPlaylist(rawPlaylist.id);
        var directPlaylist = getPlaylist(token);
        if (directPlaylist.success) return directPlaylist;
        return { success: false, error: "Could not resolve the playlist" };
    }
    var rawArtist = resolveToken(token, "artist");
    if (rawArtist && (rawArtist.id || rawArtist.artistId)) {
        return getArtist(rawArtist.id || rawArtist.artistId);
    }
    var directArtist = getArtist(token);
    if (directArtist.success) return directArtist;
    return { success: false, error: "Could not resolve the artist" };
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
    getDownloadUrl: getDownloadUrl,
    download: download,
    handleUrl: handleUrl
});

log.info("[ZenSaavn] Zen JioSaavn extension loaded");
