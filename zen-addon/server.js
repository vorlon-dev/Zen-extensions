#!/usr/bin/env node
/**
 * Zen Extensions — Addon Server for ZenMusic
 * ==========================================
 * Implements the ZenMusic / LastWave Addon HTTP protocol:
 *
 *   GET /manifest.json
 *   GET /search?q=<query>&quality=<low|high|lossless|hi_res|atmos>&atmos=<auto|none>
 *   GET /stream/<id>?quality=<...>&atmos=<auto|none>
 *
 * Sources (matching the ZenMusic extension repository):
 *   - YouTube Music  (InnerTube WEB_REMIX)          ids: yt<videoId>
 *   - JioSaavn       (www.jiosaavn.com API)         ids: js<saavnId>
 *   - Qobuz lossless (your ZenMusic qobuz-api URL)  applied to yt* tracks at stream time
 *
 * Run:   PORT=8787 QOBUZ_ENDPOINT=https://justfreefun.antideploy.app/ node server.js
 * Test:  curl 'http://localhost:8787/search?q=blinding%20lights&quality=lossless&atmos=none'
 *
 * Optional env:
 *   ADDON_TOKEN    serve under /a/<token>/... as well (ZenMusic signs requests for such paths)
 *   ENFORCE_SIGN=1 reject requests whose X-LW-Sign HMAC is invalid
 *   ADDON_SECRET   HMAC secret (defaults to the protocol's known default)
 */

const http = require("http");
const crypto = require("crypto");
const CryptoJS = require("./vendor/crypto-js.js");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "8787", 10);
const QOBUZ_ENDPOINT = (process.env.QOBUZ_ENDPOINT || "https://justfreefun.antideploy.app/").replace(/\/+$/, "");
const ADDON_TOKEN = process.env.ADDON_TOKEN || "";
const ENFORCE_SIGN = process.env.ENFORCE_SIGN === "1";
const ADDON_SECRET = process.env.ADDON_SECRET ||
  "36d96a751b12ee481c281a8a8e64c482d0c1634a22061ab72f40175017818b85";
const VERSION = "1.0.0";

// ---------------------------------------------------------------- utilities
const caches = new Map();
function cacheGet(key) {
  const hit = caches.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  if (hit) caches.delete(key);
  return undefined;
}
function cachePut(key, value, ttlMs) {
  if (caches.size > 400) {
    const first = caches.keys().next().value;
    caches.delete(first);
  }
  caches.set(key, { value, expiry: Date.now() + ttlMs });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function hmacValid(req, pathname) {
  const ts = req.headers["x-lw-ts"];
  const sign = req.headers["x-lw-sign"];
  if (!ts || !sign) return !ENFORCE_SIGN;
  const m = /\/a\/([^/]+)/.exec(pathname);
  const token = m ? m[1] : "";
  const message = `${ts}\nGET\n${pathname}\n${token}`;
  const expect = crypto.createHmac("sha256", ADDON_SECRET).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expect));
  } catch {
    return false;
  }
}

async function getJson(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ...(opts.headers || {}) },
      method: opts.method || "GET",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------ YouTube Music
const IT_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const IT_CONTEXT = { client: { clientName: "WEB_REMIX", clientVersion: "1.20240403.01.00", hl: "en", gl: "US" } };
const FILTER_SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
const FILTER_VIDEOS = "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D";

function colRuns(item, i) {
  try { return item.flexColumns[i].musicResponsiveListItemFlexColumnRenderer.text.runs; } catch { return null; }
}
function runsText(runs) { return runs ? runs.map((r) => r.text || "").join("") : ""; }
function firstText(runs) { return runs && runs[0] ? runs[0].text || "" : ""; }

function parseYtItem(item) {
  try {
    let videoId = null;
    if (item.playlistItemData && item.playlistItemData.videoId) videoId = item.playlistItemData.videoId;
    if (!videoId) { try { videoId = colRuns(item, 0)[0].navigationEndpoint.watchEndpoint.videoId; } catch { } }
    if (!videoId) {
      try {
        videoId = item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
          .playNavigationEndpoint.watchEndpoint.videoId;
      } catch { }
    }
    if (!videoId || videoId.length !== 11) return null;
    const subtitle = runsText(colRuns(item, 1)) + " " + runsText(colRuns(item, 2));
    const dm = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(subtitle);
    let secs = 0;
    if (dm) {
      const p = dm[1].split(":").map((x) => parseInt(x, 10));
      secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    }
    let artist = firstText(colRuns(item, 1)).split(" • ")[0].trim();
    let thumb = "";
    try {
      const th = item.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
      thumb = th[th.length - 1].url;
      if (thumb.startsWith("//")) thumb = "https:" + thumb;
    } catch { }
    return {
      id: "yt" + videoId,
      title: firstText(colRuns(item, 0)),
      artist: artist,
      album: "",
      duration: secs,
      format: "flac",
      audioQuality: "LOSSLESS",
      quality: "LOSSLESS",
      atmos: false,
      artworkURL: thumb,
    };
  } catch {
    return null;
  }
}

async function ytmSearch(query, limit) {
  const key = `ytm:${query}:${limit}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  let tracks = [];
  for (const params of [FILTER_SONGS, FILTER_VIDEOS]) {
    const data = await getJson(
      `https://music.youtube.com/youtubei/v1/search?key=${IT_KEY}&prettyPrint=false`,
      { method: "POST", headers: { Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/" }, body: { context: IT_CONTEXT, query, params } }
    );
    if (data) {
      try {
        const sections = data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents;
        for (const s of sections) {
          const shelf = s.musicShelfRenderer;
          if (!shelf || !shelf.contents) continue;
          for (const c of shelf.contents) {
            const t = c.musicResponsiveListItemRenderer && parseYtItem(c.musicResponsiveListItemRenderer);
            if (t && t.title) tracks.push(t);
          }
        }
      } catch { }
    }
    if (tracks.length) break;
  }
  tracks = tracks.slice(0, limit);
  cachePut(key, tracks, 10 * 60 * 1000);
  return tracks;
}

// ------------------------------------------------------------------ JioSaavn
// media URLs are DES-ECB encrypted with the well-known public key "38346591".
// OpenSSL 3 removed DES from Node, so we use the vendored pure-JS MIT crypto-js.
const SAAVN_DES_KEY = CryptoJS.enc.Utf8.parse("38346591");
function decryptSaavnUrl(encUrl) {
  try {
    const dec = CryptoJS.DES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(encUrl) }),
      SAAVN_DES_KEY,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    ).toString(CryptoJS.enc.Utf8);
    return dec.startsWith("http") ? dec.replace(/_96\.mp4$/, "_320.mp4") : null;
  } catch {
    return null;
  }
}
const decodeEntities = (s) =>
  String(s || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function saavnSearch(query, limit) {
  const key = `saavn:${query}:${limit}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const url =
    `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0` +
    `&q=${encodeURIComponent(query)}&p=1&n=${limit}`;
  const data = await getJson(url, { headers: { "X-Requested-With": "XMLHttpRequest", Referer: "https://www.jiosaavn.com/" } });
  const out = [];
  if (data && Array.isArray(data.results)) {
    for (const r of data.results) {
      try {
        const mi = r.more_info || {};
        let stream = null;
        if (mi.encrypted_media_url) stream = decryptSaavnUrl(mi.encrypted_media_url);
        let artist = r.primary_artists || "";
        if (!artist && mi.artistMap && Array.isArray(mi.artistMap.primary_artists)) {
          artist = mi.artistMap.primary_artists.map((a) => a.name).join(", ");
        }
        if (!artist && r.subtitle) artist = String(r.subtitle).split(" - ")[0];
        if (!artist && mi.singers) artist = mi.singers;
        let art = r.image || mi.image || "";
        art = String(art).replace(/150x150/g, "500x500");
        out.push({
          id: "js" + r.id,
          title: decodeEntities(r.title || r.name || r.song),
          artist: decodeEntities(artist),
          album: decodeEntities(mi.album || r.album || ""),
          duration: parseInt(r.duration || mi.duration || "0", 10),
          format: "m4a",
          audioQuality: "AAC 320",
          quality: "AAC 320",
          atmos: false,
          artworkURL: art,
          streamURL: stream || undefined,
        });
      } catch { }
    }
  }
  cachePut(key, out, 10 * 60 * 1000);
  return out;
}

// ------------------------------------------------------- Qobuz lossless tier
const QOBUZ_TIERS = {
  atmos: ["flac_hires_192", "flac_hires_96", "flac_cd", "mp3_320"],
  hi_res: ["flac_hires_96", "flac_hires_192", "flac_cd", "mp3_320"],
  lossless: ["flac_cd", "flac_hires_96", "mp3_320"],
  high: ["mp3_320", "flac_cd"],
  low: ["mp3_320"],
};

async function ytStream(videoId, quality) {
  const key = `qb:${videoId}:${quality}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const data = await getJson(`${QOBUZ_ENDPOINT}?id=${encodeURIComponent(videoId)}`);
  if (!data || data.status !== "success" || !data.streams) {
    cachePut(`qb:${videoId}`, null, 10 * 60 * 1000);
    cachePut(key, null, 10 * 60 * 1000);
    return null;
  }
  cachePut(`qb:${videoId}`, data.streams, 30 * 60 * 1000);
  const ladder = QOBUZ_TIERS[quality] || QOBUZ_TIERS.lossless;
  let picked = null;
  for (const tier of ladder) {
    if (data.streams[tier] && data.streams[tier].url) { picked = data.streams[tier]; break; }
  }
  if (!picked) {
    for (const k of Object.keys(data.streams)) {
      if (data.streams[k] && data.streams[k].url) { picked = data.streams[k]; break; }
    }
  }
  if (!picked) { cachePut(key, null, 10 * 60 * 1000); return null; }
  const stream = {
    url: picked.url,
    format: /mp3/.test(picked.mime_type || "") ? "mp3" : "flac",
    codec: /mp3/.test(picked.mime_type || "") ? "mp3" : "flac",
    quality: picked.label || "LOSSLESS",
    audioQuality: picked.label || "LOSSLESS",
    bitDepth: picked.bit_depth || 16,
    sampleRate: (picked.sampling_rate || 44.1) * 1000,
    bitrate: null,
    manifest: "file",
    atmos: false,
  };
  cachePut(key, stream, 30 * 60 * 1000);
  return stream;
}

async function saavnStream(saavnId, quality) {
  const key = `jsv:${saavnId}`;
  let hit = cacheGet(key);
  if (hit === undefined) {
    const url =
      `https://www.jiosaavn.com/api.php?__call=song.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0` +
      `&pids=${encodeURIComponent(saavnId)}`;
    const data = await getJson(url, { headers: { "X-Requested-With": "XMLHttpRequest", Referer: "https://www.jiosaavn.com/" } });
    let streamUrl = null;
    const song = data && Array.isArray(data.songs) && data.songs.find((s) => String(s.id) === String(saavnId));
    if (song && song.more_info && song.more_info.encrypted_media_url) {
      streamUrl = decryptSaavnUrl(song.more_info.encrypted_media_url);
    }
    hit = streamUrl;
    cachePut(key, hit, 30 * 60 * 1000);
  }
  if (!hit) return null;
  return {
    url: hit,
    format: "m4a",
    codec: "aac",
    quality: "AAC 320",
    audioQuality: "AAC 320",
    bitDepth: 16,
    sampleRate: 44100,
    bitrate: 320,
    manifest: "file",
    atmos: false,
  };
}

// ------------------------------------------------------------------- server
const MANIFEST = {
  id: "zen-extensions",
  name: "Zen Extensions",
  version: VERSION,
  resources: ["search", "stream"],
  root: "",
};

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, `http://${req.headers.host || "localhost"}`); } catch {
    return sendJson(res, 400, { error: "bad request" });
  }
  let pathname = decodeURIComponent(u.pathname);

  // optional /a/<token> prefix (ZenMusic signs requests on such paths)
  if (ADDON_TOKEN) {
    const m = new RegExp(`^/a/${ADDON_TOKEN}(/.*)?$`).exec(pathname);
    if (m) pathname = m[1] || "/";
  } else {
    const m = /^\/a\/[^/]+(\/.*)?$/.exec(pathname);
    if (m) pathname = m[1] || "/";
  }

  if (!hmacValid(req, pathname)) {
    return sendJson(res, 401, { error: "invalid signature" });
  }

  try {
    if (pathname === "/" && req.method === "GET") {
      return sendJson(res, 200, {
        name: "Zen Extensions addon",
        version: VERSION,
        sources: ["youtube-music", "jiosaavn", "qobuz-lossless"],
        endpoints: ["/manifest.json", "/search?q=&quality=&atmos=", "/stream/{id}?quality=&atmos="],
      });
    }
    if (pathname === "/manifest.json") {
      return sendJson(res, 200, MANIFEST);
    }
    if (pathname === "/search") {
      const q = (u.searchParams.get("q") || "").trim();
      const quality = u.searchParams.get("quality") || "lossless";
      const limit = Math.min(parseInt(u.searchParams.get("n") || "20", 10) || 20, 40);
      if (!q) return sendJson(res, 200, { tracks: [] });
      const [ytm, saavn] = await Promise.all([
        ytmSearch(q, limit).catch(() => []),
        saavnSearch(q, limit).catch(() => []),
      ]);
      let tracks = [...ytm, ...saavn];
      if (quality === "lossless" || quality === "hi_res" || quality === "atmos") {
        tracks = tracks.sort((a, b) => (b.audioQuality > a.audioQuality ? 1 : -1));
      }
      return sendJson(res, 200, { tracks });
    }
    const streamMatch = /^\/stream\/(.+)$/.exec(pathname);
    if (streamMatch) {
      const rawId = streamMatch[1].trim();
      const quality = u.searchParams.get("quality") || "lossless";
      if (rawId.startsWith("yt") && rawId.length >= 12) {
        const stream = await ytStream(rawId.slice(2), quality);
        if (!stream) return sendJson(res, 404, { error: "no qobuz match for this track" });
        return sendJson(res, 200, stream);
      }
      if (rawId.startsWith("js")) {
        const stream = await saavnStream(rawId.slice(2), quality);
        if (!stream) return sendJson(res, 404, { error: "no jiosaavn stream" });
        return sendJson(res, 200, stream);
      }
      return sendJson(res, 400, { error: "unknown id namespace (expected yt* or js*)" });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => {
  console.log(`[zen-addon] listening on http://0.0.0.0:${PORT}`);
  console.log(`[zen-addon] qobuz endpoint: ${QOBUZ_ENDPOINT}`);
  console.log(`[zen-addon] manifest: http://localhost:${PORT}/manifest.json`);
  if (ADDON_TOKEN) console.log(`[zen-addon] token path: /a/${ADDON_TOKEN}/`);
});
