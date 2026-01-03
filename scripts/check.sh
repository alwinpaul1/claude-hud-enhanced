#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/tui"

echo "==> Installing dependencies"
bun install

echo "==> Lint"
bun run lint

echo "==> Typecheck"
bun run typecheck

echo "==> Test"
bun test

echo "==> Build"
bun run build
