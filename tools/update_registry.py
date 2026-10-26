#!/usr/bin/env python3
"""
registry.json generator for the Zen Extension repository.

Usage:
    python3 tools/update_registry.py --username <GH_USERNAME> [--repo <REPO_NAME>] [--branch main]
    python3 tools/update_registry.py --validate --url https://raw.githubusercontent.com/<u>/<r>/main/registry.json

- Scans extensions/*.sflx and icons/ , reads each package's manifest.json
- Emits registry.json in the SpotiFLAC-compatible v1 schema
- sha256 checksums are computed from the actual files, so the registry
  is always in sync with what you ship.
"""
import argparse, hashlib, json, os, sys, zipfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Registry metadata per extension id (order = listing order)
META = {
    "ytmusic-spotiflac": {
        "display_name": "YouTube Music",
        "category": "download",
        "tags": ["youtube", "ytmusic", "metadata", "search", "homefeed", "download"],
        "icon": "icons/ytmusic-spotiflac.jpg",
        "min_app_version": "4.5.1",
    },
    "spotify-web": {
        "display_name": "Spotify Web",
        "category": "integration",
        "tags": ["spotify", "web", "streaming", "homefeed"],
        "icon": "icons/spotify-web.png",
        "min_app_version": "4.3.0",
    },
    "jiosaavn": {
        "display_name": "JioSaavn",
        "category": "download",
        "tags": ["jiosaavn", "metadata", "search", "homefeed", "download"],
        "icon": "icons/jiosaavn.png",
        "min_app_version": "4.9.5",
    },
    "qobuz-web": {
        "display_name": "Qobuz",
        "category": "download",
        "tags": ["qobuz", "download", "lossless", "metadata", "search"],
        "icon": "icons/qobuz-web.png",
        "min_app_version": "4.9.1",
    },
    "zen-lossless": {
        "display_name": "Zen Lossless (Qobuz)",
        "category": "download",
        "tags": ["zenmusic", "qobuz", "lossless", "hires", "flac", "download"],
        "icon": "icons/zen-lossless.png",
        "min_app_version": "4.2.0",
    },
}

ORDER = ["ytmusic-spotiflac", "spotify-web", "jiosaavn", "qobuz-web", "zen-lossless"]

PLACEHOLDER = "YOUR_GITHUB_USERNAME"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest_of(path: str) -> dict:
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("manifest.json").decode("utf-8"))


def build_registry(username: str, repo: str, branch: str) -> dict:
    base = f"https://raw.githubusercontent.com/{username}/{repo}/{branch}"
    entries = []
    for ext_id in ORDER:
        pkg = os.path.join(ROOT, "extensions", f"{ext_id}.sflx")
        if not os.path.exists(pkg):
            print(f"WARN: missing package {pkg}", file=sys.stderr)
            continue
        m = manifest_of(pkg)
        meta = META.get(ext_id, {})
        entry = {
            "id": ext_id,
            "name": m.get("name", ext_id),
            "display_name": meta.get("display_name", m.get("displayName", ext_id)),
            "version": m.get("version", "1.0.0"),
            "description": m.get("description", ""),
            "download_url": f"{base}/extensions/{ext_id}.sflx",
            "sha256": sha256(pkg),
            "category": meta.get("category", "download"),
            "tags": meta.get("tags", ["download"]),
            "downloads": 0,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT00:00:00Z"),
            "min_app_version": meta.get("min_app_version", m.get("minAppVersion", "4.2.0")),
        }
        icon = meta.get("icon")
        if icon and os.path.exists(os.path.join(ROOT, icon)):
            entry["icon_url"] = f"{base}/{icon}"
        entries.append(entry)
    return {
        "version": 1,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT00:00:00Z"),
        "extensions": entries,
    }


def validate(url: str) -> int:
    import urllib.request
    ok = True
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            reg = json.loads(r.read().decode("utf-8"))
        print(f"registry OK: {len(reg.get('extensions', []))} extensions listed")
    except Exception as e:
        print(f"FAIL: cannot load registry: {e}")
        return 1
    for ext in reg.get("extensions", []):
        dl = ext.get("download_url", "")
        try:
            with urllib.request.urlopen(dl, timeout=30) as r:
                data = r.read()
            got = hashlib.sha256(data).hexdigest()
            status = "OK  " if got == ext.get("sha256") else "HASH-MISMATCH"
            if status != "OK  ":
                ok = False
            print(f"{status} {ext['id']:22s} {len(data):>8d} bytes  {got[:16]}...")
        except Exception as e:
            ok = False
            print(f"FAIL {ext['id']}: {e}")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", help="Your GitHub username")
    ap.add_argument("--repo", default="zen-extensions", help="Repository name (default: zen-extensions)")
    ap.add_argument("--branch", default="main", help="Branch (default: main)")
    ap.add_argument("--validate", action="store_true", help="Validate a published registry URL instead of writing")
    ap.add_argument("--url", help="Registry URL to validate")
    args = ap.parse_args()

    if args.validate:
        if not args.url:
            print("--url is required with --validate", file=sys.stderr)
            return 2
        return validate(args.url)

    if not args.username:
        args.username = PLACEHOLDER
        print(f"No --username given: writing registry with placeholder '{PLACEHOLDER}'.\n"
              f"Re-run after push or before push:  python3 tools/update_registry.py --username <you>\n",
              file=sys.stderr)

    reg = build_registry(args.username, args.repo, args.branch)
    out = os.path.join(ROOT, "registry.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {out} with {len(reg['extensions'])} extensions")
    for e in reg["extensions"]:
        print(f"  - {e['id']:22s} v{e['version']:8s} sha256={e['sha256'][:16]}...")
    if args.username == PLACEHOLDER:
        print("\nNOTE: registry currently points to the placeholder username — replace it!")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
