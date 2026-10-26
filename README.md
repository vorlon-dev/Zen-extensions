# Zen-extensions

Extension repository for **Zen Music** (and any extension-compatible music app).
Paste the registry link below into the app's extension/registry settings and all
four sources install and update from here.

## 🔗 Your extension link

```
https://raw.githubusercontent.com/vorlon-dev/Zen-extensions/main/registry.json
```

After you push this repository to `github.com/vorlon-dev/Zen-extensions`
(default branch `main`), that link works as-is — no other configuration needed.

## Sources included

| Extension | What it does | Category |
|---|---|---|
| **Zen Qobuz Lossless** | Lossless FLAC downloads through your own Zen Music qobuz-api (`justfreefun.antideploy.app`): Hi-Res Max 24-bit/192 kHz, Hi-Res 96, Lossless CD, MP3 320 — with the same downward tier-fallback ladder the ZenMusic app uses | download |
| **YouTube Music** | Songs/videos/albums/artists/playlists search & metadata, home feed, direct audio stream resolution (same innertube clients as ZenMusic) | download |
| **JioSaavn** | Song/album/playlist/artist search & metadata, home feed, AAC downloads up to 320 kbps (encrypted media URLs decrypted with the standard web-player key) | download |
| **Spotify** | Full catalog search & metadata (tracks/albums/artists/playlists), ISRC + duration matching fields for lossless providers, URL imports, home feed | integration |

## How to publish (one time)

```sh
cd Zen-extensions
git add .
git commit -m "Zen extension store: Qobuz lossless, YTM, JioSaavn, Spotify"
git branch -M main
git remote add origin https://github.com/vorlon-dev/Zen-extensions.git
git push -u origin main
```

(If you cloned this folder from the already-created empty repo, the
`origin` remote already exists — skip the `remote add` line.)

Verify the link in any browser after pushing:

```
https://raw.githubusercontent.com/vorlon-dev/Zen-extensions/main/registry.json
```

## How to use in an app

1. Open the app's **Extensions / Extension store** settings.
2. Choose **Add registry / Paste extension link**.
3. Paste: `https://raw.githubusercontent.com/vorlon-dev/Zen-extensions/main/registry.json`
4. The four extensions appear with icons — enable the ones you want.

## Repository layout

```
registry.json              <- the manifest the app fetches (extension link target)
extensions/*.sflx          <- installable packages (deterministic ZIPs)
icons/*.png                <- 512x512 store icons
sources/<id>/              <- reviewable provider code (manifest.json + index.js)
scripts/build_packages.py  <- rebuilds .sflx packages + refreshes registry.json
```

## Editing & re-publishing an extension

1. Edit `sources/<id>/index.js` (or its `manifest.json`).
2. Bump the `version` in that manifest.
3. Rebuild — this rewrites the matching `.sflx` and updates `registry.json`
   with the new sha256:

   ```sh
   python3 scripts/build_packages.py                # all
   python3 scripts/build_packages.py zen-jiosaavn   # one provider
   ```

4. Commit and push. Apps pick the update up on their next registry refresh.

## Notes

* The Qobuz endpoint can be changed per-user in the extension's settings
  (Settings → Zen Qobuz Lossless → *Lossless API endpoint*), so reinstalling
  the app never locks you to one deployment.
* Spotify never exposes direct stream URLs; it provides catalog metadata and
  the ISRC/duration data that download providers (Qobuz lossless etc.) use
  for matching — the same division of labour the SpotiFLAC store uses.
* All packages are reproducible: `sha256` in `registry.json` matches the
  `.sflx` byte-for-byte.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with YouTube, Spotify, JioSaavn or Qobuz.
