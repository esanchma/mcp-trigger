# mcp-trigger

`mcp-trigger` is a stdio MCP server that exposes cached tools from an ArtCraft MCP bridge and opens the desktop application only when a tool is invoked.

It is installed as a single binary. Pi registers it four times, once per application, with a distinct identifier:

- `photocraft`
- `wordcraft`
- `deckcraft`
- `gridcraft`

Each process serves only its application. Tools retain their original names and are never mixed across servers.

## Problem solved

ArtCraft MCP bridges operate in bridge mode against a TCP port exposed by a desktop application. If the application is not open, the bridge exits at startup. Registering the bridges directly would therefore require all four applications to remain open even when they are not needed.

`mcp-trigger` separates tool discovery from execution:

- `tools/list` responds from a local cache without starting an application.
- `tools/call` checks the control port. If the application is not responding, it starts the application, waits until it is available, creates the real MCP bridge, and forwards the call.
- The application remains open until the user closes it.

## Architecture

```text
MCP client / Pi
       │ stdio
       ▼
mcp-trigger <app>
       │  tools/list: local cache
       │  tools/call: lazy start + MCP proxy
       ▼
real MCP bridge (stdio subprocess)
       │ TCP loopback
       ▼
ArtCraft desktop application
```

The trigger keeps the real bridge while the application responds. If the user closes the application, a later call detects the failure, discards the bridge, and starts the cycle again.

## Applications and ports

Fixed loopback ports ensure that the launcher, bridge, and health check share predictable configuration.

| ID | Flatpak application | Port | Real bridge |
| --- | --- | ---: | --- |
| `gridcraft` | `ai.storyteller.gridcraft` | 7979 | `flatpak run --command=gridcraft-cli ai.storyteller.gridcraft mcp --connect 127.0.0.1:7979` |
| `wordcraft` | `ai.storyteller.wordcraft` | 7980 | `flatpak run --command=wordcraft-cli ai.storyteller.wordcraft mcp --connect 127.0.0.1:7980` |
| `photocraft` | `ai.storyteller.photocraft` | 7981 | `flatpak run --share=network --command=photocraft-cli ai.storyteller.photocraft mcp --bridge 127.0.0.1:7981 …` |
| `deckcraft` | `ai.storyteller.deckcraft` | 7982 | `flatpak run --share=network --command=deckcraft-cli ai.storyteller.deckcraft mcp --connect 127.0.0.1:7982` |

All four ports were free when this document was written. The launcher must fail with an explicit error if another process uses a reserved port; it must not connect to an unknown service.

The expected launch commands are:

```sh
flatpak run ai.storyteller.gridcraft --control 7979
flatpak run ai.storyteller.wordcraft --control 7980
flatpak run --share=network ai.storyteller.photocraft --new-instance --control 7981 --control-token-file <private-path>
flatpak run --share=network ai.storyteller.deckcraft --control 7982
```

WordCraft uses its existing control key. PhotoCraft must use a private token file so that the launcher and bridge share the same credential. The CLIs are contained in the Flatpaks, so the trigger runs them with `flatpak run --command=<app>-cli`, rather than as host binaries.

## Verified application-specific requirements

These conditions were verified against the Flatpak versions installed during implementation. Review them after updating any ArtCraft application.

| Application | Required setting | Reason and verification |
| --- | --- | --- |
| GridCraft | `--control 7979` | `gridcraft-cli mcp --connect 127.0.0.1:7979` responded to `tools/list` and to a real call. It required neither a credential nor additional network sharing. |
| WordCraft | `--control 7980` and `WORDCRAFT_CONTROL_KEY` | When started with control enabled, WordCraft creates `control-key.*` in its configuration directory. The trigger selects the newest key without logging it and passes it only to the Flatpak bridge. |
| PhotoCraft | `--share=network`, `--new-instance`, `--control 7981`, and `--control-token-file` | The sandbox does not share networking by default, so its loopback was inaccessible from the host. `--new-instance` prevents launch delegation to an instance without control enabled. The token file lets the application and bridge authenticate the channel. |
| DeckCraft | `--share=network` and `--control 7982` | Its sandbox also does not share networking by default. Both the launcher and `deckcraft-cli` need `--share=network` to use the host loopback. |

The overrides created by `install-desktop` apply these settings. If a future version changes arguments, authentication, or Flatpak permissions, run `install-desktop --all`, run `refresh --all`, and review this table.

## Tool cache

The cache is stored outside the repository:

```text
${XDG_CACHE_HOME:-~/.cache}/mcp-trigger/<app>.tools.json
```

It contains the `tools/list` result, version metadata, and its generation time. It never contains tokens or control keys.

Generate or update the cache with:

```sh
mcp-trigger refresh photocraft
mcp-trigger refresh --all
# install or repair launchers and update caches
mcp-trigger refresh --install-launchers --all
```

`refresh` requires a managed desktop launcher. If it is missing, the command instructs you to run `mcp-trigger install-desktop <app>`. `refresh --install-launchers` explicitly installs or repairs it before continuing. The command may open the relevant application, leaves it open, and writes the cache atomically.

`mcp-trigger install-desktop [<app>|--all]` generates overrides in `~/.local/share/applications` with the reserved control port. Overrides are marked with `X-Mcp-Trigger-Version=1`; before replacing an unmanaged override, the command preserves a `.mcp-trigger.bak` copy.

If a server starts without a valid cache, `tools/list` returns an error instructing the user to run `mcp-trigger refresh <app>`. It does not open an application during discovery because MCP clients may call `tools/list` repeatedly without intending to execute a tool.

## Installation

The project uses Bun and compiles a native binary with:

```sh
bun install
bun run build
# internally: bun build --compile ...
```

Run a complete installation with:

```sh
bun run install-local
# install or repair launchers and Pi, then update caches
./scripts/install.sh --refresh
```

The script compiles the binary, copies it to `~/.local/bin/mcp-trigger`, installs launchers, updates the desktop launcher database when `update-desktop-database` is available, and updates `~/.pi/agent/mcp.json` idempotently. `--refresh` opens applications when needed and leaves their windows open.

After installation and cache generation, Pi has a configuration equivalent to:

```json
{
  "mcpServers": {
    "photocraft": { "command": "mcp-trigger", "args": ["photocraft"] },
    "deckcraft": { "command": "mcp-trigger", "args": ["deckcraft"] },
    "gridcraft": { "command": "mcp-trigger", "args": ["gridcraft"] },
    "wordcraft": { "command": "mcp-trigger", "args": ["wordcraft"] }
  }
}
```

The installer preserves unrelated MCP entries and replaces the four existing direct ArtCraft entries.

## Tool-call behavior

For each tool call:

1. The trigger performs an authenticated or unauthenticated health check, depending on the application.
2. If the application is unavailable, it launches it only once even when calls arrive concurrently.
3. It waits for the control port to respond, up to the configured timeout.
4. It starts and initializes the real MCP bridge as a stdio subprocess.
5. It forwards the original request and relays its MCP response.

A timeout does not automatically retry a tool. An operation may have reached the application before the connection failed, so retrying must remain the client's decision.

## Security

Control ports bind to `127.0.0.1`. WordCraft and PhotoCraft secrets are never written to the cache or logged. Token files must be readable only by the current user.

The trigger does not close applications, send `app.quit`, or attempt document recovery after the user closes a window.

## Development

The implementation and planned tests are described in [PLAN.md](PLAN.md).
