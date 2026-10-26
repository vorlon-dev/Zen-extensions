#!/usr/bin/env python3
"""Build reproducible .sflx extension packages and (re)generate registry.json.

Pipeline mirrors the SpotiFLAC extension-store conventions:
  * every source lives in sources/<id>/ as {manifest.json, index.js, icon.png}
  * the package is a deterministic ZIP of manifest.json, index.js, the bundled
    icon, LICENSE and NOTICE (fixed timestamps => stable sha256)
  * registry.json entries carry the raw.githubusercontent.com download_url,
    the package sha256 and the icon_url for the extension store UI.
"""

import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
REPO_OWNER = "vorlon-dev"
REPO_NAME = "Zen-extensions"
BRANCH = "main"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{BRANCH}"

# Registry-level metadata that is not part of the app-facing manifest.
REGISTRY_META = {
    "zen-qobuz-lossless": {
        "category": "download",
        "tags": ["qobuz", "lossless", "flac", "hires", "hifi", "download", "zen"],
        "display_name": "Zen Qobuz Lossless",
    },
    "zen-ytmusic": {
        "category": "download",
        "tags": ["youtube", "ytmusic", "metadata", "search", "homefeed", "download", "zen"],
        "display_name": "YouTube Music",
    },
    "zen-jiosaavn": {
        "category": "download",
        "tags": ["jiosaavn", "indian", "aac", "metadata", "search", "homefeed", "download", "zen"],
        "display_name": "JioSaavn",
    },
    "zen-spotify": {
        "category": "integration",
        "tags": ["spotify", "metadata", "search", "homefeed", "integration", "zen"],
        "display_name": "Spotify",
    },
}

REGISTRY_ORDER = ["zen-qobuz-lossless", "zen-ytmusic", "zen-jiosaavn", "zen-spotify"]


def package(source: Path) -> bytes:
    manifest = json.loads((source / "manifest.json").read_text())
    filenames = ["manifest.json", "index.js"]
    licenses = ["LICENSE", "NOTICE"]
    icon = manifest.get("icon")
    if icon:
        if not isinstance(icon, str) or Path(icon).name != icon or icon in (".", "..", *licenses):
            raise ValueError("Bundled icons must be a filename inside the provider source directory")
        if icon not in filenames:
            filenames.append(icon)
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for filename in filenames + licenses:
            entry = ZipInfo(filename, date_time=(2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            # Shared legal files live at the repo root, provider files in sources/<id>/.
            origin = ROOT if filename in licenses else source
            archive.writestr(
                entry, (origin / filename).read_bytes(),
                compress_type=ZIP_DEFLATED, compresslevel=9,
            )
    return buffer.getvalue()


def main() -> int:
    sources = ROOT / "sources"
    providers = sys.argv[1:] or REGISTRY_ORDER
    unknown = [p for p in providers if p not in REGISTRY_META]
    if unknown:
        print(f"Unknown provider(s): {', '.join(unknown)}", file=sys.stderr)
        return 1

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    extensions = []
    for provider in providers:
        source = sources / provider
        manifest = json.loads((source / "manifest.json").read_text())
        meta = REGISTRY_META[provider]
        data = package(source)
        digest = hashlib.sha256(data).hexdigest()
        out = ROOT / "extensions" / f"{provider}.sflx"
        out.write_bytes(data)
        print(f"{provider:20s} v{manifest['version']}  {digest[:16]}…  {out.stat().st_size:6d} bytes")
        extensions.append({
            "id": provider,
            "name": provider,
            "display_name": meta["display_name"],
            "version": manifest["version"],
            "description": manifest["description"],
            "download_url": f"{RAW_BASE}/extensions/{provider}.sflx",
            "sha256": digest,
            "icon_url": f"{RAW_BASE}/icons/{provider}.png",
            "category": meta["category"],
            "tags": meta["tags"],
            "downloads": 0,
            "updated_at": timestamp,
            "min_app_version": manifest.get("minAppVersion", "4.2.0"),
        })

    registry = {
        "version": 1,
        "updated_at": timestamp,
        "extensions": extensions,
    }
    (ROOT / "registry.json").write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"\nregistry.json written with {len(extensions)} extensions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
