# Zen Addon Server (for ZenMusic itself)

This folder turns the **same four sources** (YouTube Music, JioSaavn, Qobuz lossless)
into a **ZenMusic addon** — the HTTP protocol ZenMusic speaks natively
(`manifest.json` / `search` / `stream`, the LastWave addon protocol).

The `registry.json` in the repository root targets extension-based apps
(SpotiFLAC / Mornye family). This server targets **ZenMusic** itself.
Zero npm dependencies — pure Node.js (>= 16) plus the vendored MIT-licensed
`crypto-js` used to decrypt JioSaavn media URLs.

## Quick start

```bash
cd zen-addon
PORT=8787 node server.js
# then add this URL as an addon in ZenMusic:
#   http://<your-host>:8787
```

The Qobuz lossless endpoint defaults to the ZenMusic one
(`https://justfreefun.antideploy.app/`). Override it:

```bash
QOBUZ_ENDPOINT=https://your-qobuz-api.example.com/ PORT=8787 node server.js
```

## Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /manifest.json` | Addon manifest (`id`, `name`, `version`, `resources`) |
| `GET /search?q=<q>&quality=<low\|high\|lossless\|hi_res\|atmos>&atmos=<auto\|none>` | Merged YouTube Music + JioSaavn results |
| `GET /stream/yt<videoId>?quality=...` | Qobuz FLAC stream (tier ladder, walks down) |
| `GET /stream/js<saavnId>?quality=...` | Direct JioSaavn AAC 320 stream |

## Deploying (public URL)

Any of these works — the server is stateless:

**Option 1 — Docker / any VPS**
```bash
docker build -t zen-addon .
docker run -p 8787:8787 zen-addon
```

**Option 2 — Render / Railway / Fly.io**
Create a Node service from this folder; start command `node server.js`.
Set `QOBUZ_ENDPOINT` if your Qobuz API lives elsewhere.

**Option 3 — Cloudflare Worker**
Not supported out of the box (the server needs Node's `crypto` module for
JioSaavn URL decryption).

## Optional environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `QOBUZ_ENDPOINT` | ZenMusic endpoint | Your qobuz-api base URL |
| `ADDON_TOKEN` | *(empty)* | Also serve under `/a/<token>/…` (the path style ZenMusic signs) |
| `ENFORCE_SIGN` | off | `1` = reject requests with invalid `X-LW-Sign` HMAC |
| `ADDON_SECRET` | protocol default | HMAC secret used when verifying signatures |

## How ZenMusic connects

1. Open **Settings → Addons** in ZenMusic.
2. Paste your deployed base URL (with or without `http(s)://`,
   with or without `/manifest.json` — both are accepted).
3. The app probes `manifest.json`, then search/stream just work:
   YouTube Music results upgrade to Qobuz lossless automatically,
   JioSaavn results stream at AAC 320.
