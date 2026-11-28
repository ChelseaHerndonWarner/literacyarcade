#!/usr/bin/env bash
# End-to-end tests on LOCAL Firebase emulators only.
#   bash tests/e2e/run.sh              plan access, saving, sharing and student links
#   bash tests/e2e/run.sh <suite>      tests/e2e/<suite>.e2e.js with firebase.e2e.<suite>.json
# Needs Java, functions/node_modules, firebase-tools (set FIREBASE_BIN if it is not on PATH) and
# the Node version named in functions/package.json (set NODE_BIN_DIR to its bin folder).
# Emulator files are read from ~/.cache/firebase/emulators; firebase-tools downloads any missing.
# Safety: demo project id, 127.0.0.1 only, and an empty HOME so no Firebase or Google sign-in
# is available to the emulators.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUITE="${1:-entitlements}"
CONFIG="$ROOT/firebase.e2e.json"
[ "$SUITE" = entitlements ] || CONFIG="$ROOT/firebase.e2e.$SUITE.json"
[ -f "$CONFIG" ] && [ -f "$ROOT/tests/e2e/$SUITE.e2e.js" ] || { echo "Unknown test suite: $SUITE"; exit 1; }
[ -z "${NODE_BIN_DIR:-}" ] || PATH="$NODE_BIN_DIR:$PATH"
WANT="$(node -p "require('$ROOT/functions/package.json').engines.node")"
HAVE="$(node -p "process.versions.node.split('.')[0]")"
if [ "$HAVE" != "$WANT" ] && [ -z "${ALLOW_OTHER_NODE:-}" ]; then
  echo "These tests need Node $WANT (found $(node --version)). Set NODE_BIN_DIR, or ALLOW_OTHER_NODE=1."
  exit 1
fi
echo "Running $SUITE on Node $(node --version)"
FIREBASE_BIN="${FIREBASE_BIN:-$(command -v firebase || true)}"
if [ -z "$FIREBASE_BIN" ]; then
  # Most recently installed copy that npx has cached.
  FIREBASE_BIN="$(ls -t "$HOME"/.npm/_npx/*/node_modules/.bin/firebase 2>/dev/null | head -1 || true)"
fi
[ -n "$FIREBASE_BIN" ] || { echo "firebase-tools not found. Set FIREBASE_BIN."; exit 1; }
EMULATORS="${FIREBASE_EMULATORS_PATH:-$HOME/.cache/firebase/emulators}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" # emulator debug logs are written here, not into the project
env -i PATH="$PATH" HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/config" CLOUDSDK_CONFIG="$WORK/gcloud" \
  FIREBASE_EMULATORS_PATH="$EMULATORS" NO_UPDATE_NOTIFIER=1 CI=true \
  "$FIREBASE_BIN" emulators:exec --config "$CONFIG" --project demo-literacy-arcade \
  "node '$ROOT/tests/e2e/$SUITE.e2e.js'"
