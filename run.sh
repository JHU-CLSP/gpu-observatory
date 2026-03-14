#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building frontend..."
cd "$SCRIPT_DIR/frontend"
npm install --silent
npm run build

cd "$SCRIPT_DIR"

echo "==> Starting GPU Observatory on port 443..."
echo "    (requires sudo on Linux/macOS to bind port 443)"
exec uvicorn app:app --host 0.0.0.0 --port 443
