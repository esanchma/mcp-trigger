# Implementation plan

## Objective

Create a Bun binary named `mcp-trigger`. It serves one Streamable HTTP MCP endpoint per ArtCraft application from a single host-side user service. It responds to discovery from a local cache and creates the real MCP bridge only when a tool is executed.

The initial scope covers PhotoCraft, WordCraft, DeckCraft, and GridCraft installed locally through Flatpak. Applications are never closed automatically.

## Final decisions

- One binary, one systemd user service, and four HTTP entries in `~/.pi/agent/mcp.json`.
- One endpoint and shared lazy bridge represent each ArtCraft application.
- Tool names remain unprefixed because application endpoints are separate.
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
3. GridCraft, WordCraft, and PhotoCraft require credentials in the versions tested; DeckCraft does not.
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

The launcher checks the control protocol where supported. DeckCraft uses TCP availability because its `ui.inspect` check was unreliable; this cannot distinguish an unrelated service.

## Phases

Phases 1–8 describe the original stdio implementation and its historical verification. The HTTP migration supersedes its Pi-facing transport.

### 1. Project foundation — completed

Created `package.json`, `tsconfig.json`, the `src/` structure, and Bun tests. Development, type-check, test, and build commands are available. Static application configuration, cache validation and atomic writes, and idempotent `mcp.json` transformation are also implemented with unit tests.

**Verification performed:** `bun run check`, `bun test`, and `bun run build` complete successfully. The generated binary validates an application ID and exposes `cache-status`, `status`, `start`, `refresh`, and `install-pi`.

### 2. Configuration and launcher — implemented with partial validation

Verified locally that all four applications and their CLIs are installed as Flatpaks. The CLIs are not in the host `PATH`, so each bridge runs through `flatpak run --command=<app>-cli ai.storyteller.<app> mcp …`. Implemented corrected configuration, `status` diagnostics, a non-mutating JSON-lines `ui.inspect` check, detection of ports occupied by another protocol, and startup with a 30-second wait.

PhotoCraft token-file and WordCraft control-key handling were subsequently added and the full lifecycle was tested against every application. The launcher uses `setsid` so that the application does not exit when the short diagnostic process ends.

**Verification performed:** tests with fake TCP servers confirm `ready` and `occupied` states. All four real applications started and were detected as `ready`.

### 3. Minimal control client — implemented with partial validation

The installed documentation and CLIs confirmed that control channels use JSON-lines over loopback. GridCraft, WordCraft, and PhotoCraft use `ui.inspect`, which does not modify documents, and require a response with the same ID and valid JSON shape (`ok` plus exactly one of `result` or `error`).

DeckCraft 0.11.1 sometimes stopped responding to `ui.inspect` while its MCP bridge continued to work. DeckCraft therefore uses a TCP availability check, which does not identify the service. GridCraft 0.14.2 requires authentication before `ui.inspect`; the trigger reads its Flatpak runtime token and passes the runtime directory to its bridge. For the other applications, `occupied` means that a port did not pass the configured protocol check.

**Verification performed:** when applications are stopped, the result is `stopped`; an unrelated fake TCP server returns `occupied` for protocol-validated applications; all four real ArtCraft applications return `ready` when correctly launched. The DeckCraft regression was reproduced and verified with TCP availability plus a successful proxied `inspect_document` call.

### 4. Discovery cache — implemented with partial validation

`refresh <app>` and `refresh --all` use the MCP SDK client to start the real bridge, complete `initialize`, request `tools/list`, and save a validated cache through atomic replacement. A corrupt cache is treated as missing.

**Verification performed:** `refresh` was tested against all four real applications. GridCraft 0.14.2 discovered 22 tools; WordCraft discovered 16, PhotoCraft 25, and DeckCraft 25 in earlier tests. GridCraft and WordCraft use generated credentials; PhotoCraft uses a private token file. PhotoCraft and DeckCraft run with `--share=network` because their Flatpak permissions do not expose host loopback by default.

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

### 9. Host-side HTTP and systemd migration

The host service listens on loopback and exposes four authenticated Streamable HTTP endpoints. Pi obtains a private bearer token through `auth-header`; `install-pi` creates the token and replaces the four stdio entries. Each HTTP request uses a fresh stateless MCP transport, while connections to the ArtCraft bridges are shared per application. The user unit uses `KillMode=process` so stopping it does not deliberately terminate application windows.

The sandbox can invoke ArtCraft with host-side application permissions. Different `/tmp` mounts are not shared. HTTP clients must not retry non-idempotent calls after an ambiguous failure. The HTTP server does not relay server-initiated notifications or cross-request cancellation.

**Verification performed:** type-check, 19 tests, build, ShellCheck, and systemd unit verification pass. Normal Pi and the actual `pi-safe mcp list` discover all four endpoints; discovery leaves stopped PhotoCraft and WordCraft closed. Pi's MCP runtime successfully calls GridCraft `inspect_workbook` and DeckCraft `inspect_document` from the host and under the same sandbox bindings; both documents report `dirty: false`. Two concurrent Pi runtime clients successfully inspect GridCraft. An existing SDK client succeeds again after a service restart.

With PhotoCraft and WordCraft stopped, concurrent read-only calls from Pi started both applications through the HTTP service and returned their command lists. Pi's MCP runtime also retrieved those lists on the host and under the `pi-safe` sandbox bindings.

A subsequent test from an actual `pi-safe` session found that closing PhotoCraft left its bridge alive; the next call failed because the proxy reused it. The proxy now checks application readiness before each call and discards a stale bridge. A simulated regression test covers restart, concurrent calls, and the absence of automatic retries. After installing the fix, Pi's MCP runtime successfully restarted PhotoCraft under equivalent sandbox bindings. A second call succeeded after PhotoCraft was manually closed while its bridge remained alive; the service replaced the bridge without restarting.

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
- The HTTP service does not close applications, expose non-loopback listeners, or provide multi-document routing.

## Current completion criterion

Pi can discover the four HTTP endpoints from the host and `pi-safe`, and can execute read-only tools through the host service. Discovery does not open applications, and the service never intentionally closes them. Closed-state lazy startup and stale-bridge recovery have been verified for PhotoCraft using Pi's MCP runtime under equivalent sandbox bindings.
