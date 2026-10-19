#!/bin/sh
set -eu

refresh=false
if [ "${1:-}" = "--refresh" ]; then
  refresh=true
elif [ "$#" -gt 0 ]; then
  printf '%s\n' "Usage: $0 [--refresh]" >&2
  exit 64
fi

repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
bun run build
install -Dm755 dist/mcp-trigger "${HOME:?HOME is required}/.local/bin/mcp-trigger"
"$HOME/.local/bin/mcp-trigger" install-desktop --all
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications"
fi
"$HOME/.local/bin/mcp-trigger" install-pi
if [ "$refresh" = true ]; then
  "$HOME/.local/bin/mcp-trigger" refresh --all
fi
