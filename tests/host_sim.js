// ============================================================
// Zen-extensions host-simulation test harness (sync-curl edition)
// Loads each extension's index.js exactly like the host app does,
// exercising the public API against LIVE services.
// ============================================================
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = "/home/z/my-project/workspace/Zen-extensions/sources";

function curlSync(url, method, body, headers) {
    const args = ["-s", "-L", "--max-time", "25", "-X", method || "GET",
        "-w", "\n__ZSTATUS__%{http_code}"];
    for (const k of Object.keys(headers || {})) args.push("-H", k + ": " + headers[k]);
    if (body) args.push("--data-binary", body);
    args.push(url);
    const res = spawnSync("curl", args, { maxBuffer: 64 * 1024 * 1024, timeout: 35000 });
    const out = (res.stdout || "").toString();
    const idx = out.lastIndexOf("__ZSTATUS__");
    const status = idx >= 0 ? parseInt(out.slice(idx + 11).trim(), 10) || 0 : 0;
    const bodyText = idx >= 0 ? out.slice(0, idx) : out;
    return { statusCode: status, ok: status >= 200 && status < 300, body: bodyText };
}

function loadExtension(file, quiet) {
    const store = {};
    let registered = null;
    const log = quiet ? { debug() {}, info() {}, error() {} } : {
        debug: m => console.log("      [d]", String(m).slice(0, 140)),
        info: m => console.log("      [i]", String(m).slice(0, 140)),
        error: m => console.log("      [e]", String(m).slice(0, 140))
    };
    const host = {
        log,
        storage: {
            get: k => (k in store ? store[k] : null),
            set: (k, v) => { store[k] = String(v); },
            remove: k => { delete store[k]; }
        },
        http: {
            get: (url, headers) => curlSync(url, "GET", null, headers),
            post: (url, body, headers) => curlSync(url, "POST", body, headers)
        },
        file: { download: () => ({ success: false, error_message: "harness: file.download skipped" }) },
        registerExtension: f => { registered = f; }
    };
    const fn = new Function("http", "storage", "log", "file", "registerExtension",
        fs.readFileSync(file, "utf8"));
    fn(host.http, host.storage, host.log, host.file, host.registerExtension);
    if (!registered) throw new Error("registerExtension never called in " + file);
    return registered;
}

const PASS = "  PASS ";
const FAIL = "  FAIL ";
let failures = 0;

function test(label, condition, detail) {
    if (condition) { console.log(PASS + label); if (detail) console.log("        ", detail); }
    else { console.log(FAIL + label); if (detail) console.log("        ", detail); failures++; }
}

function run(fn, name, args) {
    try {
        const out = fn(...args);
        return { out, error: null };
    } catch (e) {
        return { out: null, error: e.message };
    }
}

// ============================================================
console.log("=== zen-jiosaavn (LIVE) ===");
{
    const ext = loadExtension(path.join(ROOT, "zen-jiosaavn/index.js"), true);
    const s = run(ext.searchTracks, "searchTracks", ["Arijit Singh", 8]);
    const tracks = (s.out && !s.error) ? s.out : [];
    test("searchTracks returns songs", tracks.length > 0, s.error || `${tracks.length} tracks`);
    const first = tracks.find(t => t && t.media_url) || tracks[0];
    if (first) {
        console.log("        first:", JSON.stringify({ id: first.id, name: first.name, artists: first.artists, album: first.album_name, media: (first.media_url || "").slice(0, 55) }));
        test("decrypted media_url (aac.saavncdn.com)", /^https:\/\/(aac|c)\.saavncdn\.com\/.+\.mp4$/.test(first.media_url || ""), (first.media_url || "").slice(0, 70));

        const gt = run(ext.getTrack, "getTrack", [first.id]);
        test("getTrack by id", gt.out && gt.out.id === first.id, gt.error || JSON.stringify(gt.out && gt.out.name));

        const dl = run(ext.getDownloadUrl, "getDownloadUrl", [first.id, "AAC_320", null]);
        test("getDownloadUrl -> _320 kbps", dl.out && dl.out.success === true && /_320\.mp4/.test(dl.out.url || ""), dl.error || JSON.stringify({ url: (dl.out && dl.out.url || "").slice(0, 70), q: dl.out && dl.out.quality, err: dl.out && dl.out.error_message }));

        const hu = run(ext.handleUrl, "handleUrl", [first.external_urls || ("https://www.jiosaavn.com/song/" + first.id)]);
        test("handleUrl perma link", hu.out && hu.out.success === true, hu.error || JSON.stringify(hu.out && hu.out.type));

        const hf = run(ext.getHomeFeed, "getHomeFeed", []);
        test("getHomeFeed sections", hf.out && hf.out.sections && hf.out.sections.length > 0, hf.error || `${(hf.out && hf.out.sections || []).length} sections`);

        const cs = run(ext.customSearch, "customSearch", ["Arijit", "albums", 5, 1]);
        test("customSearch albums", cs.out && cs.out.length > 0, cs.error || `${cs.out && cs.out.length} albums: ${(cs.out && cs.out[0] && cs.out[0].name) || ""}`);
    }
}

console.log("\n=== zen-qobuz-lossless (LIVE — user's endpoint) ===");
{
    const ext = loadExtension(path.join(ROOT, "zen-qobuz-lossless/index.js"), true);
    const s = run(ext.searchTracks, "searchTracks", ["Believer Imagine Dragons", 5]);
    const tracks = (s.out && !s.error) ? s.out : [];
    test("searchTracks returns YTM songs", tracks.length > 0, s.error || `${tracks.length} tracks`);
    const first = tracks[0];
    if (first) {
        console.log("        first:", JSON.stringify({ id: first.id, name: first.name, artists: first.artists }));
        test("11-char videoId", /^[A-Za-z0-9_-]{11}$/.test(first.id || ""), first.id);

        const gt = run(ext.getTrack, "getTrack", [first.id]);
        test("getTrack (player videoDetails)", gt.out && gt.out.name, gt.error || JSON.stringify(gt.out && gt.out.name));

        const dl = run(ext.getDownloadUrl, "getDownloadUrl", [first.id, "flac_hires_192", null]);
        const dlOk = dl.out && dl.out.success === true && /^https?:\/\//.test(dl.out.url || "");
        test("getDownloadUrl via Qobuz endpoint (tier ladder)", dlOk, dl.error || JSON.stringify({ quality: dl.out && dl.out.quality, lossless: dl.out && dl.out.lossless, url: (dl.out && dl.out.url || "").slice(0, 75), err: dl.out && dl.out.error_message }));

        const ca = run(ext.checkAvailability, "checkAvailability", ["", first.name, first.artists, { track: first }]);
        test("checkAvailability endpoint probe", ca.out && ca.out.available !== undefined, ca.error || JSON.stringify({ available: ca.out && ca.out.available, q: ca.out && ca.out.quality, reason: ca.out && ca.out.reason }));
    }
}

console.log("\n=== zen-ytmusic ===");
{
    const file = path.join(ROOT, "zen-ytmusic/index.js");
    if (fs.existsSync(file)) {
        const ext = loadExtension(file, true);
        const s = run(ext.searchTracks, "searchTracks", ["Tum Hi Ho", 5]);
        const tracks = (s.out && !s.error) ? s.out : [];
        test("searchTracks returns YTM songs", tracks.length > 0, s.error || `${tracks.length} tracks`);
        const first = tracks[0];
        if (first) {
            console.log("        first:", JSON.stringify({ id: first.id, name: first.name, artists: first.artists }));
            const dl = run(ext.getDownloadUrl, "getDownloadUrl", [first.id, "high", null]);
            const dlOk = dl.out && dl.out.success === true && /^https?:\/\//.test(dl.out.url || "");
            test("getDownloadUrl direct stream", dlOk, dl.error || JSON.stringify({ itag: dl.out && dl.out.itag, bitrate: dl.out && dl.out.bitrate, url: (dl.out && dl.out.url || "").slice(0, 70), err: dl.out && dl.out.error_message }));
        }
    } else {
        console.log("  SKIP (not written yet)");
    }
}

console.log("\n=== zen-spotify ===");
{
    const file = path.join(ROOT, "zen-spotify/index.js");
    if (fs.existsSync(file)) {
        const ext = loadExtension(file, true);
        const s = run(ext.searchTracks, "searchTracks", ["Blinding Lights", 5]);
        const tracks = (s.out && !s.error) ? s.out : [];
        test("searchTracks returns Spotify tracks", tracks.length > 0, s.error || `${tracks.length} tracks`);
        const first = tracks[0];
        if (first) {
            console.log("        first:", JSON.stringify({ id: first.id, name: first.name, artists: first.artists }));
            const gt = run(ext.getTrack, "getTrack", [first.id]);
            test("getTrack by Spotify id", gt.out && gt.out.id === first.id, gt.error || JSON.stringify(gt.out && gt.out.name));
            const hu = run(ext.handleUrl, "handleUrl", [first.external_urls || "https://open.spotify.com/track/" + first.id]);
            test("handleUrl spotify link", hu.out && hu.out.success === true, hu.error || JSON.stringify(hu.out && hu.out.type));
        }
    } else {
        console.log("  SKIP (not written yet)");
    }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL LIVE TESTS PASSED");
process.exit(failures ? 1 : 0);
