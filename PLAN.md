# Implementation plan

## Objective

Create a Bun binary named `mcp-trigger`. It must act as a stdio MCP server for one ArtCraft application identified by its positional argument. It must respond to discovery from a local cache and create the real MCP bridge only when a tool is executed.

The initial scope covers PhotoCraft, WordCraft, DeckCraft, and GridCraft installed locally through Flatpak. Applications are never closed automatically.

## Final decisions

- One binary and four entries in `~/.pi/agent/mcp.json`.
- One `mcp-trigger <app>` process represents exactly one ArtCraft bridge.
- Tool names remain unprefixed because bridges do not share a server and therefore cannot collide.
- `tools/list` uses only the local cache and never opens an application.
- The cache is updated through `mcp-trigger refresh <app>` or `refresh --all`.
- An initial call waits for the application to become ready up to a configured timeout.
- Applications remain open; only the user can close them.
- Bun compiles the executable with `bun build --compile`.
- Installation copies the binary to `~/.local/bin/mcp-trigger`, updates the four Pi entries, and can install desktop overrides idempotently.
- `install-desktop` creates the four controllable launchers; `refresh --install-launchers` combines their explicit repair with cache updates.

## Assumptions to verify

Verify these points before finalizing each adapter's code:

1. Flatpak desktop invocation accepts `--control PORT` for all four applications.
2. The control protocol supports a health check that does not change state.
3. GridCraft and DeckCraft do not require a token; WordCraft and PhotoCraft do.
4. Real bridges publish their complete tools and schemas through `tools/list` after `initialize`.
5. The TypeScript MCP SDK works inside a binary compiled with the installed Bun version.

If an assumption fails, update this plan, the README, and the affected adapter before adding an alternative solution.

## Proposed structure

```text
src/
  index.ts                 # CLI: serve, refresh, install
  config.ts                # Static configuration per application
  cache.ts                 # Atomic tools/list reads and writes
  launcher.ts              # Application startup and readiness waiting
  bridge.ts                # Real MCP bridge stdio client
  install.ts               # Idempotent mcp.json update
  types.ts                 # Small shared types
scripts/
  install.sh               # Build, copy, and run installation
package.json
bun.lock
README.md
PLAN.md
```

The structure may be simplified if the finished code does not justify a module. Do not add an abstraction layer for more providers or remote transports.

## Static configuration per application

Each adapter must define:

- ID: `photocraft`, `wordcraft`, `deckcraft`, or `gridcraft`;
- Flatpak application;
- local control port;
- application launch command;
- real MCP bridge command and arguments;
- health-check method;
- credential strategy: none, a WordCraft key, or a PhotoCraft token file;
- startup timeout;
- cache location.

Initial ports:

| Application | Port |
| --- | ---: |
| GridCraft | 7979 |
| WordCraft | 7980 |
| PhotoCraft | 7981 |
| DeckCraft | 7982 |

The launcher must verify that an unrelated process is not occupying the port before starting the application. After startup, the health check must validate that the expected control protocol responds, rather than merely opening a TCP socket.

## Phases

### 1. Project foundation — completed

Created `package.json`, `tsconfig.json`, the `src/` structure, and Bun tests. Development, type-check, test, and build commands are available. Static application configuration, cache validation and atomic writes, and idempotent `mcp.json` transformation are also implemented with unit tests.

**Verification performed:** `bun run check`, `bun test`, and `bun run build` complete successfully. The generated binary validates an application ID and exposes `cache-status`, `status`, `start`, `refresh`, and `install-pi`.

### 2. Configuration and launcher — implemented with partial validation

Verified locally that all four applications and their CLIs are installed as Flatpaks. The CLIs are not in the host `PATH`, so each bridge runs through `flatpak run --command=<app>-cli ai.storyteller.<app> mcp …`. Implemented corrected configuration, `status` diagnostics, a non-mutating JSON-lines `ui.inspect` check, detection of ports occupied by another protocol, and startup with a 30-second wait.

PhotoCraft token-file and WordCraft control-key handling were subsequently added and the full lifecycle was tested against every application. The launcher uses `setsid` so that the application does not exit when the short diagnostic process ends.

**Verification performed:** tests with fake TCP servers confirm `ready` and `occupied` states. All four real applications started and were detected as `ready`.

### 3. Minimal control client — implemented with partial validation

The installed documentation and CLIs confirmed that control channels use JSON-lines over loopback. The client sends `ui.inspect`, which does not modify documents, and requires a response with the same ID and valid JSON shape (`ok` plus exactly one of `result` or `error`).

The implementation does not rely on a stable application identity response. Therefore, `occupied` means that a port did not pass the expected protocol validation; no MCP call is forwarded to it.

**Verification performed:** when applications are stopped, the result is `stopped`; an unrelated fake TCP server returns `occupied`; all four real ArtCraft applications return `ready` when correctly launched.

### 4. Discovery cache — implemented with partial validation

`refresh <app>` and `refresh --all` use the MCP SDK client to start the real bridge, complete `initialize`, request `tools/list`, and save a validated cache through atomic replacement. A corrupt cache is treated as missing.

**Verification performed:** `refresh` was tested against all four real applications. GridCraft discovered 21 tools; WordCraft, 16; PhotoCraft, 25; and DeckCraft, 25. WordCraft requires its temporary key and PhotoCraft requires a private token file. PhotoCraft and DeckCraft run with `--share=network` because their Flatpak permissions do not expose host loopback by default.

### 5. Lazy MCP proxy — MVP implemented

The stdio server exposed to Pi uses the MCP SDK. It serves `tools/list` from the cache loaded at startup without touching the launcher. On `tools/call`, it creates the bridge on demand, forwards the result, and retains the bridge while its stdio transport remains alive. Transport closure invalidates it. It does not implicitly retry a tool.

**Verification performed:** a real MCP stdio session received `initialize` and GridCraft's 21 cached tools. A real read-only call to `list_commands` was forwarded through the bridge and returned GridCraft command data.

The bridge serializes its initial connection. Recovery was verified with DeckCraft: after it was manually closed, its status became `stopped`; an MCP call opened a new instance and returned the result of `list_commands`. When no cache exists, `tools/list` returns an actionable error instructing the user to run `refresh`.

### 6. Pi installation and desktop launchers — completed

`install-desktop [<app>|--all]` creates managed entries in `~/.local/share/applications`. Each preserves metadata from the Flatpak-exported file, adds the control port, and is marked with `X-Mcp-Trigger-Version=1`. Before replacing an unmanaged override, it saves a `.mcp-trigger.bak` copy. PhotoCraft also receives a private token file so that its launcher and bridge share the credential.

`refresh` verifies that the launcher is managed. `refresh --install-launchers <app>|--all` explicitly installs or repairs it before updating the cache.

**Verification performed:** installed all four launchers locally. GridCraft and WordCraft use ports 7979 and 7980. The PhotoCraft and DeckCraft controllable launchers include `--share=network`; PhotoCraft also includes `--new-instance` and its private token file.

### 7. Pi installation

Implement a safe JSON update for `~/.pi/agent/mcp.json` that replaces only the `photocraft`, `wordcraft`, `deckcraft`, and `gridcraft` entries. Preserve all other entries, including unknown fields.

**Verification:** running the installation twice leaves the file unchanged, preserves servers such as `mdn`, and removes direct Flatpak configuration for the four ArtCraft applications.

### 8. Build and local installation — implemented

`scripts/install.sh` compiles the binary, installs it under `~/.local/bin`, installs or repairs desktop launchers, updates the launcher database when available, and updates Pi. Its optional `--refresh` argument regenerates caches.

```sh
bun run install-local
./scripts/install.sh --refresh
```

The compiled binary does not depend on the repository working directory.

**Verification performed:** `scripts/install.sh` passes ShellCheck. An installation in a temporary `$HOME` created the binary, all four launchers, and all four MCP entries without modifying the real configuration. The real installation then updated `~/.pi/agent/mcp.json` and replaced direct ArtCraft configuration.

## Priority test cases

| Case | Expected result |
| --- | --- |
| Valid cache, application stopped, `tools/list` | Respond from cache; application remains stopped. |
| Missing cache, `tools/list` | Return an actionable error instructing the user to run `refresh`. |
| Valid cache, application stopped, `tools/call` | Open the application, wait, create the bridge, and forward the call. |
| Two simultaneous `tools/call` requests at startup | One launcher and one child bridge only. |
| Reserved port occupied by an unrelated process | Explicit error; no call is forwarded. |
| User closes the application | Invalidate the bridge; a later call starts it again. |
| Child bridge exits | Report the error and recreate it only on a later call. |
| Missing token/key | Error names the application and missing credential without revealing secrets. |
| Repeated installation | `mcp.json` is identical after the second execution. |

Unit tests cover configuration parsing, cache validation and atomic writes, `mcp.json` transformation, and the startup state machine. Integration tests use fake TCP processes and fake MCP bridges; tests against installed ArtCraft applications are manual and documented.

## Risks and limits

- A tool call may cause changes before a connection is lost. The trigger must not retry it implicitly.
- If a user starts an application manually without the reserved port, the trigger cannot reuse that instance. It opens, or asks to open, a controllable instance with the configured port.
- ArtCraft updates may change schemas or their protocol. Run `refresh` after updating applications.
- TCP control tokens grant local automation access. Use loopback listeners and private user files only.
- The first version does not implement automatic shutdown, multiplexing between trigger processes, or remote connections.

## First-version completion criterion

The first version is complete when Pi, with the four `mcp.json` entries, can load them with ArtCraft applications closed; `tools/list` works from cache; and one real tool call per application starts only its application, executes the call, and leaves the application open.
