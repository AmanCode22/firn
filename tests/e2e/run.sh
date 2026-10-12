#!/usr/bin/env bash
# Runs Firn's end-to-end checks: each one starts the real app and clicks
# through it. Linux only (it uses a virtual screen); see README.md.
#
#   bash tests/e2e/run.sh              every check
#   bash tests/e2e/run.sh settings     just one (or a few, by name)

E2E="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$E2E/../.." && pwd)"
# Screenshots and logs land here (not saved in Git).
export SP="$E2E/out"
mkdir -p "$SP"
DATA="$HOME/.config/Firn"

ALL="all settings perm ctxmenu lookout addrtop downloads passwords safebrowsing welcome brand bottom updates macmenu basecamp whatsnew adblock defaultbrowser tooltips sound player splitdrag realdrag splithandle shortcuts demo archive installer mactips restore splitpin updatestatus"
CHECKS="${*:-$ALL}"

cleanup() {
  pkill -f 'electron/dist/electro[n]'
  pkill -f 'electron-forg[e]'
  pkill -f 'bin/vit[e]'
  pkill -f 'http.serve[r] 8765'
  pkill Xvf[b]
  sleep 2
  true
}

cleanup
# The test website the checks visit.
(cd "$E2E/site" && python3 -m http.server 8765 >/dev/null 2>&1) &
# A virtual screen to run Firn on.
export DISPLAY=:99
Xvfb :99 -screen 0 1400x900x24 >/dev/null 2>&1 &

# Build Firn's main process once, then serve its UI with Vite alone, so each
# check can start its own Firn.
cd "$ROOT"
rm -rf node_modules/.vite
npx electron-forge start -- --no-sandbox >"$SP/app.log" 2>&1 &
FORGE=$!
sleep 12
kill $FORGE
pkill -f 'electron/dist/electro[n]'
pkill -f 'electron-forg[e]'
sleep 2
npx vite --config vite.renderer.config.mts --port 5173 --strictPort >"$SP/vite.log" 2>&1 &
sleep 4

for t in $CHECKS; do
  echo "=== $t"
  # Start each check from a clean slate: no saved tabs, the welcome done,
  # and this version already run (so no What's new; the welcome and
  # whatsnew checks set up their own).
  mkdir -p "$DATA"
  rm -f "$DATA/session.json"
  if [ "$t" != welcome ]; then
    python3 -c "import json,os,sys;f=sys.argv[1];d=json.load(open(f)) if os.path.exists(f) else {};d['onboarded']=True;d['lastVersion']=json.load(open(sys.argv[2]))['version'];json.dump(d,open(f,'w'))" "$DATA/settings.json" "$ROOT/package.json"
  fi
  timeout 300 node "$E2E/$t.cjs" 2>&1 | grep -E 'PASS|FAIL' | tail -60
  pkill -f 'electron/dist/electro[n]'
  sleep 1
done

cleanup
