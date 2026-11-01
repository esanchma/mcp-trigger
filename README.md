# mcp-trigger

`mcp-trigger` is a local Streamable HTTP MCP server that exposes cached tools from ArtCraft MCP bridges. It opens a desktop application only when a tool is invoked.

A single user service provides four endpoints. Pi registers each endpoint with a distinct identifier:

- `photocraft`
- `wordcraft`
- `deckcraft`
- `gridcraft`

Each endpoint serves only its application. Tools retain their original names and are never mixed across endpoints.

## Problem solved

ArtCraft MCP bridges operate in bridge mode against a TCP port exposed by a desktop application. If the application is not open, the bridge exits at startup. Registering the bridges directly would therefore require all four applications to remain open even when they are not needed.

`mcp-trigger` separates tool discovery from execution:

- `tools/list` responds from a local cache without starting an application.
- `tools/call` checks the control port. If the application is not responding, it starts the application, waits until it is available, creates the real MCP bridge, and forwards the call.
- The application remains open until the user closes it.

## Architecture

```text
MCP client / Pi, including pi-safe
       │ Streamable HTTP over loopback
       ▼
mcp-trigger user service (one endpoint per app)
       │  tools/list: local cache
       │  tools/call: lazy start + MCP proxy
       ▼
real MCP bridge (stdio subprocess)
       │ TCP loopback
       ▼
ArtCraft desktop application
```

The service shares one bridge connection per application across HTTP clients. When a bridge exits, a later call creates a new one. A call that fails is not retried by the proxy; its effects may already have occurred.

## Applications and ports

Fixed loopback ports ensure that the launcher, bridge, and health check share predictable configuration.

| ID | Flatpak application | Port | Real bridge |
| --- | --- | ---: | --- |
| `gridcraft` | `ai.storyteller.gridcraft` | 7979 | `flatpak run --command=gridcraft-cli ai.storyteller.gridcraft mcp --connect 127.0.0.1:7979` |
| `wordcraft` | `ai.storyteller.wordcraft` | 7980 | `flatpak run --command=wordcraft-cli ai.storyteller.wordcraft mcp --connect 127.0.0.1:7980` |
| `photocraft` | `ai.storyteller.photocraft` | 7981 | `flatpak run --share=network --command=photocraft-cli ai.storyteller.photocraft mcp --bridge 127.0.0.1:7981 …` |
| `deckcraft` | `ai.storyteller.deckcraft` | 7982 | `flatpak run --share=network --command=deckcraft-cli ai.storyteller.deckcraft mcp --connect 127.0.0.1:7982` |

The launcher rejects ports that fail the configured health check. DeckCraft's TCP-only check cannot distinguish DeckCraft from an unrelated service.

The expected launch commands are:

```sh
flatpak run ai.storyteller.gridcraft --control 7979
flatpak run ai.storyteller.wordcraft --control 7980
flatpak run --share=network ai.storyteller.photocraft --new-instance --control 7981 --control-token-file <private-path>
flatpak run --share=network ai.storyteller.deckcraft --control 7982
```

GridCraft creates a control token in its Flatpak runtime directory; the trigger and bridge use it for authentication. WordCraft uses its existing control key. PhotoCraft must use a private token file so that the launcher and bridge share the same credential. The CLIs are contained in the Flatpaks, so the trigger runs them with `flatpak run --command=<app>-cli`, rather than as host binaries.

## Verified application-specific requirements

These conditions were verified against the Flatpak versions installed during implementation. Review them after updating any ArtCraft application.

| Application | Required setting | Reason and verification |
| --- | --- | --- |
| GridCraft | `--control 7979` | GridCraft 0.14.2 requires a control token. The trigger reads the Flatpak runtime token for its health check and passes `XDG_RUNTIME_DIR` to the bridge. It also supports `GRIDCRAFT_CONTROL_TOKEN` when explicitly configured. |
| WordCraft | `--control 7980` and `WORDCRAFT_CONTROL_KEY` | When started with control enabled, WordCraft creates `control-key.*` in its configuration directory. The trigger selects the newest key without logging it and passes it only to the Flatpak bridge. |
| PhotoCraft | `--share=network`, `--new-instance`, `--control 7981`, and `--control-token-file` | The sandbox does not share networking by default, so its loopback was inaccessible from the host. `--new-instance` prevents launch delegation to an instance without control enabled. The token file lets the application and bridge authenticate the channel. |
| DeckCraft | `--share=network` and `--control 7982` | Its sandbox also does not share networking by default. Both the launcher and `deckcraft-cli` need `--share=network` to use the host loopback. Its health check verifies TCP availability, but does not identify the listening service. |

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

The script compiles and atomically installs the binary, installs launchers, updates the desktop launcher database when available, and updates `~/.pi/agent/mcp.json`. It installs and enables `~/.config/systemd/user/mcp-trigger.service`, then starts or restarts it. `--refresh` opens applications when needed and leaves their windows open. A running systemd user manager is required. Reload Pi sessions after updating their MCP configuration.

After installation and cache generation, Pi has a configuration equivalent to:

```json
{
  "mcpServers": {
    "photocraft": { "url": "http://127.0.0.1:19797/mcp/photocraft", "headers": { "Authorization": "!~/.local/bin/mcp-trigger auth-header" } },
    "deckcraft": { "url": "http://127.0.0.1:19797/mcp/deckcraft", "headers": { "Authorization": "!~/.local/bin/mcp-trigger auth-header" } },
    "gridcraft": { "url": "http://127.0.0.1:19797/mcp/gridcraft", "headers": { "Authorization": "!~/.local/bin/mcp-trigger auth-header" } },
    "wordcraft": { "url": "http://127.0.0.1:19797/mcp/wordcraft", "headers": { "Authorization": "!~/.local/bin/mcp-trigger auth-header" } }
  }
}
```

The installer preserves unrelated MCP entries and replaces the four existing ArtCraft entries. `install-pi` creates a private HTTP token if needed and does not replace an existing token. Pi obtains its authorization header by executing the command shown above; the token is not embedded in `mcp.json`.

Check the service with `systemctl --user status mcp-trigger.service` and inspect its log with `journalctl --user -u mcp-trigger.service`. The service inherits the user manager's graphical session environment; if it cannot open windows, check that the manager has the correct `DISPLAY`, `WAYLAND_DISPLAY`, and session bus environment. Stopping the service does not intentionally close application windows. `KillMode=process` prevents systemd from killing applications launched in the service's cgroup; an abrupt service crash can leave a bridge subprocess behind.

## Tool-call behavior

Before forwarding a tool call, the service checks the control port. If the application has stopped, it discards any old bridge, starts the application, waits for readiness, and initializes a new bridge. Concurrent connection attempts share this work. An application can still stop between the check and the call; the proxy reports that failure without retrying.

The proxy does not automatically retry a tool. An operation may have reached the application before a connection failed, so clients must avoid retrying non-idempotent calls without checking their effects. HTTP is stateless: the server does not provide server-initiated notifications or cancellation across requests.

## Security

The HTTP service binds only to `127.0.0.1:19797`, validates the Host and Origin headers, and requires a bearer token. The token is stored in `${XDG_CONFIG_HOME:-~/.config}/mcp-trigger/http-token` with private permissions. The service and Pi must use the same `HOME` and `XDG_CONFIG_HOME`. The token and ArtCraft credentials are not written to the tool cache or logged by the proxy. GridCraft authentication does not independently identify the server: another local service could imitate its authentication challenge.

An authorized sandboxed Pi session can invoke ArtCraft outside the sandbox. Those applications can read and modify files available to them, not just the sandbox's writable paths. The sandbox and host use different `/tmp` directories; use a shared path when exchanging files. Loopback authentication is not a security boundary against another process with access to the same user's token.

The trigger does not close applications, send `app.quit`, or attempt document recovery after the user closes a window.

## Development

The implementation and planned tests are described in [PLAN.md](PLAN.md).
