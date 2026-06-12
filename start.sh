#!/usr/bin/env bash
# ===== High Velocity Paintball - server launcher (Mac/Linux/server) =====
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed. Get it from https://nodejs.org"
  echo
  exit 1
fi

echo
echo "  Starting High Velocity Paintball server..."
echo "  Open http://localhost:${PORT:-3000} in your browser."
echo "  Press Ctrl+C to stop."
echo
exec node server.js
