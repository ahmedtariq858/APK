#!/usr/bin/env python3
"""Headless installer for the Unity Editor (Linux) + Android Build Support.

Usage:
  python3 scripts/install_unity.py                 # latest stable (non-alpha/beta)
  python3 scripts/install_unity.py --stream LTS    # latest LTS
  python3 scripts/install_unity.py --version 6000.6.10f1

Installs to /opt/unity/<version> (override with --prefix) and links
/opt/unity/current -> that version. Android module includes OpenJDK,
Android SDK (platforms, build-tools, platform-tools, cmdline-tools), NDK, CMake.

Requires: curl, xz, unzip, bsdtar (libarchive-tools), cpio.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, urllib.parse

API = "https://services.api.unity.com/unity/editor/release/v1/releases"


def sh(cmd, **kw):
    print("+", cmd if isinstance(cmd, str) else " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, shell=isinstance(cmd, str), **kw)


def fetch_release(version, stream):
    q = {"limit": 1, "order": "RELEASE_DATE_DESC", "platform": "LINUX", "architecture": "X86_64"}
    if version:
        q["version"] = version
    elif stream:
        q["stream"] = stream
    else:
        # latest stable = newest of SUPPORTED / LTS / TECH
        rels = []
        for s in ("SUPPORTED", "LTS", "TECH"):
            try:
                rels.append(fetch_release(None, s))
            except SystemExit:
                pass
        return max(rels, key=lambda r: r["releaseDate"])
    out = subprocess.run(["curl", "-fsSL", "--retry", "3", API + "?" + urllib.parse.urlencode(q)],
                         check=True, capture_output=True).stdout
    res = json.loads(out).get("results", [])
    if not res:
        sys.exit(f"no release found for {q}")
    return res[0]


def download(url, dest):
    sh(["curl", "-fL", "--retry", "5", "--retry-delay", "5", "-C", "-", "-o", dest, url])


def extract(path, kind, dest, tmp):
    os.makedirs(dest, exist_ok=True)
    if kind == "ZIP":
        sh(["unzip", "-q", "-o", path, "-d", dest])
    elif kind in ("TAR_XZ", "TAR_GZ", "TAR"):
        sh(["tar", "-xf", path, "-C", dest])
    elif kind == "PKG":
        # macOS .pkg = xar archive; module payload is a gzip'd cpio. Contents are platform-neutral.
        x = tempfile.mkdtemp(dir=tmp)
        sh(["bsdtar", "-xf", path, "-C", x])
        payloads = [os.path.join(r, f) for r, _, fs in os.walk(x) for f in fs if f == "Payload"]
        for p in payloads:
            sh(f"gzip -dc '{p}' | cpio -idmu --quiet", cwd=dest)
        shutil.rmtree(x)
    else:
        sys.exit(f"unsupported module type {kind}")


def install_module(m, unity, tmp):
    sub = lambda s: s.replace("{UNITY_PATH}", unity)
    dest = sub(m["destination"])
    if m["downloadSize"]["value"] > 1000:  # skip empty placeholder archives
        f = os.path.join(tmp, os.path.basename(urllib.parse.urlparse(m["url"]).path))
        download(m["url"], f)
        extract(f, m["type"], dest, tmp)
        os.remove(f)
    ren = m.get("extractedPathRename")
    if ren:
        src, dst = sub(ren["from"]), sub(ren["to"])
        if os.path.exists(src):
            if os.path.normpath(dst) == os.path.dirname(os.path.normpath(src)):
                # move children of src up into dst
                for c in os.listdir(src):
                    shutil.move(os.path.join(src, c), os.path.join(dst, c))
                os.rmdir(src)
            else:
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
    for s in m.get("subModules", []):
        install_module(s, unity, tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version")
    ap.add_argument("--stream", choices=["LTS", "SUPPORTED", "TECH", "BETA", "ALPHA"])
    ap.add_argument("--prefix", default="/opt/unity")
    ap.add_argument("--modules", default="android", help="comma-separated module ids")
    a = ap.parse_args()

    rel = fetch_release(a.version, a.stream)
    ver, dl = rel["version"], rel["downloads"][0]
    unity = os.path.join(a.prefix, ver)
    print(f"Installing Unity {ver} ({rel['stream']}) -> {unity}", flush=True)
    tmp = tempfile.mkdtemp(prefix="unity-dl-", dir=os.environ.get("UNITY_DL_DIR"))

    if not os.path.exists(os.path.join(unity, "Editor", "Unity")):
        f = os.path.join(tmp, "editor.tar.xz")
        download(dl["url"], f)
        os.makedirs(unity, exist_ok=True)
        sh(["tar", "-xJf", f, "-C", unity])
        os.remove(f)
    mods = {m["id"]: m for m in dl["modules"]}
    for mid in filter(None, a.modules.split(",")):
        install_module(mods[mid], unity, tmp)

    shutil.rmtree(tmp, ignore_errors=True)
    cur = os.path.join(a.prefix, "current")
    if os.path.islink(cur):
        os.remove(cur)
    if not os.path.exists(cur):
        os.symlink(unity, cur)
    print(f"\nDone. Editor: {unity}/Editor/Unity")


if __name__ == "__main__":
    main()
