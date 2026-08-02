#!/usr/bin/env bash
#
# Packages the built server as an MCPB bundle (monobank-mcp-server.mcpb).
#
# Layout inside the archive:
#   manifest.json      MCPB metadata; entry_point is server/index.js
#   package.json       needed at the root so "type": "module" applies to server/*.js
#   server/            compiled output from build/
#   node_modules/      production dependencies only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING="$ROOT/mcpb-staging"
BUNDLE="$ROOT/monobank-mcp-server.mcpb"

cd "$ROOT"

rm -rf "$STAGING" "$BUNDLE"
mkdir -p "$STAGING/server"

cp -R build/. "$STAGING/server/"
cp package.json package-lock.json manifest.json "$STAGING/"

# Install production dependencies only. Dev dependencies would otherwise be
# copied in wholesale — typescript@7 alone pulls a ~26MB platform-specific Go
# binary that has no business shipping to end users.
#
# --ignore-scripts is safe while every runtime dependency is pure JS. Drop it if
# one ever needs a native build step.
npm ci --omit=dev --ignore-scripts --prefix "$STAGING"

# The lockfile was only needed to drive `npm ci`.
rm -f "$STAGING/package-lock.json"

# -X strips extended attributes; excludes keep macOS cruft out of the archive.
(cd "$STAGING" && zip -r -X "$BUNDLE" . -x '.DS_Store' -x '**/.DS_Store')

rm -rf "$STAGING"

echo "Built $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
