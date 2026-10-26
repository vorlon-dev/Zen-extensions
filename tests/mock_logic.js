// ============================================================
// Mock-based logic tests for paths blocked from datacenter IPs:
//  1. zen-ytmusic pickAudioStream + getDownloadUrl shape
//  2. zen-spotify embed fallback (getTrack/handleUrl without token)
// ============================================================
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project/workspace/Zen-extensions/sources";
let failures = 0;
function test(label, cond, detail) {
    if (cond) console.log("  PASS", label, detail ? "— " + detail : "");
    else { console.log("  FAIL", label, detail ? "— " + detail : ""); failures++; }
}

function loadExt(file, hostOverrides) {
    let registered = null;
    const store = {};
    const host = Object.assign({
        log: { debug() {}, info() {}, error() {} },
        storage: {
            get: k => (k in store ? store[k] : null),
            set: (k, v) => { store[k] = String(v); },
            remove: k => { delete store[k]; }
        },
        http: { get: () => null, post: () => null },
        file: { download: () => ({ success: false }) },
        registerExtension: f => { registered = f; }
    }, hostOverrides || {});
    const fn = new Function("http", "storage", "log", "file", "registerExtension", fs.readFileSync(file, "utf8"));
    fn(host.http, host.storage, host.log, host.file, host.registerExtension);
    return { ext: registered, store };
}

// ---------- 1. zen-ytmusic stream picking ----------
console.log("=== zen-ytmusic mock tests ===");
{
    // Canned WEB_REMIX player response with adaptiveFormats
    const canned = {
        playabilityStatus: { status: "OK" },
        videoDetails: {
            videoId: "fsiPzT50ZiM", title: "Tum Hi Ho", author: "Arijit Singh - Topic",
            lengthSeconds: "262", thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/x.jpg", width: 544 }] }
        },
        streamingData: {
            adaptiveFormats: [
                { itag: 140, mimeType: "audio/mp4; codecs=\"mp4a.40.2\"", bitrate: "129573", url: "https://googlevideo.com/videoplayback?itag=140" },
                { itag: 141, mimeType: "audio/mp4; codecs=\"mp4a.40.2\"", bitrate: "255656", url: "https://googlevideo.com/videoplayback?itag=141" },
                { itag: 251, mimeType: "audio/webm; codecs=\"opus\"", bitrate: "142000", url: "https://googlevideo.com/videoplayback?itag=251" },
                { itag: 137, mimeType: "video/mp4; codecs=\"avc1\"", bitrate: "2000000", url: "https://googlevideo.com/videoplayback?itag=137" }
            ]
        }
    };
    let playerCalls = 0;
    const { ext } = loadExt(path.join(ROOT, "zen-ytmusic/index.js"), {
        http: {
            get: (url) => {
                if (url.includes("sw.js_data")) return { ok: true, statusCode: 200, body: ")]}'\n[[null,null,[null,null,null,null,null,null,\"CgtGYWtlVmlzaXRvcl9UaXNBYXJ0aWZpY2lhbFZpc2l0b3JEYXRhX1Rva2VuX1ZhbHVlX0hlcmUxMjM0NTY3OA\"]]" };
                return { ok: false, statusCode: 404, body: "" };
            },
            post: (url, body) => {
                playerCalls++;
                if (url.includes("/player")) {
                    const req = JSON.parse(body);
                    if (req.context.client.clientName === "WEB_REMIX") return { ok: true, statusCode: 200, body: JSON.stringify(canned) };
                }
                return { ok: false, statusCode: 404, body: "" };
            }
        }
    });
    const dl = ext.getDownloadUrl("fsiPzT50ZiM", "AUDIO_HIGH", null);
    test("getDownloadUrl picks best audio stream", dl && dl.success === true && dl.url.includes("itag=141"),
        dl && dl.success ? `${dl.quality} itag=${dl.itag} codec=${dl.audio_codec}` : JSON.stringify(dl));
    test("download shape complete", dl && dl.format === "m4a" && dl.actual_extension === "m4a" && dl.track && dl.track.name === "Tum Hi Ho");
    const dlMed = ext.getDownloadUrl("fsiPzT50ZiM", "AUDIO_MED", null);
    test("AUDIO_MED picks ~128kbps tier", dlMed && dlMed.success === true && (dlMed.itag === 140 || dlMed.itag === 251),
        dlMed && dlMed.success ? `itag=${dlMed.itag}` : JSON.stringify(dlMed));
    const track = ext.getTrack("fsiPzT50ZiM");
    test("getTrack from canned player", track && track.name === "Tum Hi Ho" && track.artists === "Arijit Singh",
        track ? JSON.stringify({ name: track.name, artists: track.artists, dur: track.duration_ms }) : "null");
}

// ---------- 2. zen-spotify embed fallback ----------
console.log("\n=== zen-spotify embed fallback (no token) ===");
{
    const embedHtml = fs.readFileSync("/tmp/sp_embed.html", "utf8");
    const { ext } = loadExt(path.join(ROOT, "zen-spotify/index.js"), {
        http: {
            get: (url) => {
                if (url.includes("/embed/track/")) return { ok: true, statusCode: 200, body: embedHtml };
                return { ok: false, statusCode: 403, body: "" }; // token endpoint blocked
            },
            post: () => ({ ok: false, statusCode: 404, body: "" })
        }
    });
    const track = ext.getTrack("0VjIjW4GlUZAMYd2vXMi3b");
    test("getTrack via embed (no token)", track && track.name === "Blinding Lights" && track.artists === "The Weeknd",
        track ? JSON.stringify({ name: track.name, artists: track.artists, dur: track.duration_ms }) : "null");
    const hu = ext.handleUrl("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc");
    test("handleUrl spotify link (embed path)", hu && hu.success === true && hu.type === "track", hu && hu.out ? "" : "");
    const ca = ext.checkAvailability("", "x", "y", {});
    test("checkAvailability honest metadata-only response", ca && ca.available === false && ca.reason.includes("metadata"));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL MOCK TESTS PASSED");
process.exit(failures ? 1 : 0);
