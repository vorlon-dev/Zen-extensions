# App Support — where to paste the registry link

## SpotiFLAC / Mornye (and forks)

The registry schema (`version`, `updated_at`, `extensions[]` with
`download_url` + `sha256`) matches the official SpotiFLAC extension registry,
so the link works anywhere that format is accepted.

1. Open the app and go to **Settings → Extensions**.
2. Tap **Add registry / Import from URL** (wording varies by version).
3. Paste:
   ```
   https://raw.githubusercontent.com/<YOUR-USERNAME>/zen-extensions/main/registry.json
   ```
4. The five extensions appear with icons, descriptions and version numbers.
   Install what you need — the app verifies each `.sflx` against its SHA-256.

Notes per extension:

- **YouTube Music** — works out of the box. If direct downloads start returning
  403, open the extension settings and either switch **PO Token Mode** to `auto`
  or paste a BgUtils provider URL. The home feed country is also configurable.
- **Spotify Web** — metadata/search provider; playback uses the app's own
  Spotify engine (sign in with your account where the app asks).
- **JioSaavn** — may require an Indian region (VPN/proxy) outside supported areas.
- **Qobuz** — full catalog browsing; 24-Bit Max tier attempts the highest
  quality first and falls back down the ladder automatically.
- **Zen Lossless (Qobuz)** — matches any track in the app against YouTube Music,
  then upgrades playback/downloads to Qobuz FLAC (up to 24-Bit/192 kHz) through
  the ZenMusic Qobuz API. The endpoint can be changed in the extension settings.

## ZenMusic (native addon protocol)

ZenMusic itself does not read `registry.json`; it connects to addon servers.
Use the bundled server — see [`zen-addon/README.md`](../zen-addon/README.md):

```bash
cd zen-addon && PORT=8787 node server.js
```

Then in ZenMusic: **Settings → Addons** → paste `http://<host>:8787`.
YouTube Music results resolve to Qobuz lossless automatically; JioSaavn
results stream AAC 320.

## Other extension-based apps

Any app that can import a registry by raw GitHub URL and load `.sflx`
(zip-with-manifest) packages will work with the same link. If an app asks for
a *single extension file* instead, hand it a raw package link directly:

```
https://raw.githubusercontent.com/<YOUR-USERNAME>/zen-extensions/main/extensions/zen-lossless.sflx
```
