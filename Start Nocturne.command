#!/bin/bash
# Double-click on a Mac: starts Nocturne and opens it in your default browser.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed. macOS will offer to install it (\"command line developer tools\"); accept, then double-click this file again."
  python3 --version
  read -r -p "Press Enter to close."
  exit 1
fi
PORT=8000
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
( sleep 1; open "http://localhost:$PORT" ) &
echo ""
echo "  Nocturne is playing at http://localhost:$PORT"
echo "  Keep this window open while you listen. Close it (or press Ctrl+C) to stop."
echo ""
python3 -m http.server "$PORT" --bind 127.0.0.1
