#!/bin/bash
# Last Epoch Save Editor — portable launcher
# Auto-detects: project dir, system Electron, save directory

set -e

# Find project directory (this script lives in it)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Find system Electron (check common Arch/Debian paths)
ELECTRON_BIN=""
for e in /usr/lib/electron*/electron /usr/bin/electron /usr/lib/node_modules/electron/dist/electron; do
  if [ -x "$e" ]; then
    ELECTRON_BIN="$e"
    break
  fi
done

# Ensure Python venv exists
if [ ! -d ".venv" ]; then
  echo "Creating Python venv..."
  python3 -m venv .venv
  .venv/bin/pip install flask
fi

# Pass save dir override if set
export LE_SAVE_DIR="${LE_SAVE_DIR:-}"

# Launch with system Electron or fall back to npx
if [ -n "$ELECTRON_BIN" ]; then
  exec "$ELECTRON_BIN" . "$@"
else
  echo "No system Electron found, trying npx..."
  exec npx electron . "$@"
fi