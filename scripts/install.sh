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
bin_dir="${HOME:?HOME is required}/.local/bin"
mkdir -p "$bin_dir"
tmp_binary="$bin_dir/.mcp-trigger.$$.tmp"
trap 'rm -f "$tmp_binary"' EXIT HUP INT TERM
install -m755 dist/mcp-trigger "$tmp_binary"
mv -f "$tmp_binary" "$bin_dir/mcp-trigger"
"$HOME/.local/bin/mcp-trigger" install-desktop --all
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications"
fi
"$HOME/.local/bin/mcp-trigger" install-pi
install -Dm644 systemd/mcp-trigger.service "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/mcp-trigger.service"
systemctl --user daemon-reload
systemctl --user enable mcp-trigger.service
systemctl --user restart mcp-trigger.service
if [ "$refresh" = true ]; then
  "$HOME/.local/bin/mcp-trigger" refresh --all
fi
