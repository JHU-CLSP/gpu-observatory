#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$1" = "--rebuild" ]; then
  echo "==> Removing old frontend build..."
  rm -rf "$SCRIPT_DIR/frontend/dist"
fi

if [ ! -f "$SCRIPT_DIR/frontend/dist/index.html" ]; then
  echo "==> Building frontend..."
  cd "$SCRIPT_DIR/frontend"
  corepack pnpm install --frozen-lockfile
  corepack pnpm build
  cd "$SCRIPT_DIR"
else
  echo "==> Skipping frontend build (dist/ already exists)"
fi

echo "==> Starting GPU Observatory on port 5000..."

if command -v uv >/dev/null 2>&1; then
  exec uv run uvicorn app:app --host 0.0.0.0 --port 5000
fi
exec uvicorn app:app --host 0.0.0.0 --port 5000
