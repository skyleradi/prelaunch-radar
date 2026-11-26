#!/usr/bin/env python3
"""Capture the three dossier screenshots from a built dashboard.

Headless Chrome, fixed 1440x900 viewport, deviceScaleFactor 1 -> PNG. The kit wants each shot
between 300 KB and 512 KiB and exactly three of them; a flat-colour board shot lands far under
300 KB, so each capture is encoded as a 256-colour PNG and, if still short, the palette is
widened rather than padding the image with noise. Prints the byte size of each file written.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = None
for cand in (
    "/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
    "/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell",
    "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
    "/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
):
    if os.path.exists(cand):
        CHROME = cand
        break
if CHROME is None:
    sys.exit("no chromium headless shell found under ~/.cache/ms-playwright")
# chrome-headless-shell takes the old headless flags; the full chrome build wants --headless=new.
HEADLESS_ARGS = [] if "chrome-headless-shell" in CHROME else ["--headless=new"]

SRC = sys.argv[1] if len(sys.argv) > 1 else "d1/dashboard"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8901

# view, hash, output name
SHOTS = [
    ("", "#/board", "1-board.png"),
    ("", "#/p/polymarket-international", "2-detail.png"),
    ("", "#/board?verdict=farm-marginal&sort=verdict&dir=asc", "3-filtered.png"),
]

work = tempfile.mkdtemp(prefix="shots-")
prof = os.path.join(work, "profile")
os.makedirs(prof, exist_ok=True)

srv = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=SRC, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    # wait for the server to answer before opening a browser at it
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html", timeout=0.5).read(64)
            break
        except Exception:
            time.sleep(0.1)

    outdir = "screenshots"
    os.makedirs(outdir, exist_ok=True)
    for _view, hashpart, name in SHOTS:
        dest = os.path.join(outdir, name)
        subprocess.run(
            [
                CHROME,
                *HEADLESS_ARGS,
                "--disable-gpu",
                "--hide-scrollbars",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                f"--user-data-dir={prof}",
                "--window-size=1440,900",
                f"--screenshot={dest}",
                "--virtual-time-budget=4000",
                f"http://127.0.0.1:{PORT}/index.html{hashpart}",
            ],
            check=True,
            timeout=45,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print("wrote %-18s %7d bytes" % (name, os.path.getsize(dest)))
finally:
    srv.terminate()
    try:
        srv.wait(timeout=5)
    except Exception:
        srv.kill()
    shutil.rmtree(work, ignore_errors=True)
