#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$1" == "--rebuild" ]]; then
  echo "==> Removing old frontend build..."
  rm -rf "$SCRIPT_DIR/frontend/dist"
fi

if [ ! -f "$SCRIPT_DIR/frontend/dist/index.html" ]; then
  echo "==> Building frontend..."
  cd "$SCRIPT_DIR/frontend"
  npm install --silent
  npm run build
  cd "$SCRIPT_DIR"
else
  echo "==> Skipping frontend build (dist/ already exists)"
fi

echo "==> Starting GPU Observatory on port 5000..."
echo "    (requires sudo on Linux/macOS to bind port 5000)"
exec uvicorn app:app --host 0.0.0.0 --port 5000
