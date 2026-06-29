#!/usr/bin/env bash
# Idempotent setup for fresh clones / Claude Code web sessions:
# install backend + frontend deps and seed the demo database if empty.
set -e
cd "$(dirname "$0")/.."
[ -d server/node_modules ] || npm --prefix server install
[ -d web/node_modules ] || npm --prefix web install
# Seed only if the DB has no data (the seed is a no-op when already seeded).
node server/src/seed.js >/dev/null 2>&1 || true
echo "CallA.I.d setup complete."
