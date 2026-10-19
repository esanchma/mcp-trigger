import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  type CallToolResult,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { BridgeClient } from "./bridge";
import { cachePath, readCache, writeCache } from "./cache";
import { getAppConfig, isAppId } from "./config";
import { installPiConfig } from "./install";
import { desktopPath, hasManagedLauncher, installDesktopLauncher, installedDesktopEntry } from "./desktop";
import { appStatus, startAndWait } from "./launcher";
import { APP_IDS, type AppId } from "./types";

const program = "mcp-trigger";

function usage(): string {
  return `${program} — lazy launcher for ArtCraft MCP bridges

Usage:
  ${program} <app>
  ${program} refresh [--install-launchers] <app>|--all
  ${program} install-desktop [<app>|--all]
  ${program} cache-status <app>
  ${program} status <app>
  ${program} start <app>
  ${program} install-pi [path]
  ${program} help

Apps: ${APP_IDS.join(", ")}`;
}

function requireAppId(value: string | undefined): AppId {
  if (value === undefined || !isAppId(value)) {
    throw new Error(`Expected one of: ${APP_IDS.join(", ")}`);
  }
  return value;
}

async function showCacheStatus(appId: AppId): Promise<void> {
  const cache = await readCache(appId);
  if (cache === undefined) {
    console.log(`${appId}: cache not found (${cachePath(appId)})`);
    process.exitCode = 1;
    return;
  }

  console.log(`${appId}: ${cache.tools.length} cached tools, generated ${cache.generatedAt}`);
}

async function showAppStatus(appId: AppId): Promise<void> {
  console.log(`${appId}: ${await appStatus(getAppConfig(appId))}`);
}

async function startApp(appId: AppId): Promise<void> {
  await startAndWait(getAppConfig(appId));
  console.log(`${appId}: ready`);
}

async function installDesktop(appId: AppId): Promise<void> {
  const config = getAppConfig(appId);
  await installDesktopLauncher(config, await installedDesktopEntry(config));
  console.log(`${appId}: desktop launcher installed`);
}

async function verifyDesktop(appId: AppId): Promise<void> {
  const config = getAppConfig(appId);
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is required to verify desktop launchers");
  let entry: string;
  try {
    entry = await Bun.file(desktopPath(home, appId)).text();
  } catch {
    throw new Error(`${appId}: desktop launcher is missing; run '${program} install-desktop ${appId}'`);
  }
  if (!hasManagedLauncher(entry, config)) {
    throw new Error(`${appId}: desktop launcher is not managed; run '${program} install-desktop ${appId}'`);
  }
}

async function refresh(appId: AppId): Promise<void> {
  await verifyDesktop(appId);
  const bridge = new BridgeClient(getAppConfig(appId));
  try {
    const tools = await bridge.listTools();
    await writeCache({ formatVersion: 1, appId, generatedAt: new Date().toISOString(), tools });
    console.log(`${appId}: cached ${tools.length} tools`);
  } finally {
    await bridge.close();
  }
}

async function serve(appId: AppId): Promise<void> {
  const cache = await readCache(appId);
  const bridge = new BridgeClient(getAppConfig(appId));
  const server = new McpServer(
    { name: `${program}-${appId}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!cache) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `No cached tools for ${appId}; run '${program} refresh ${appId}' before configuring this MCP server.`,
      );
    }
    return { tools: cache.tools };
  });
  server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await bridge.callTool(request.params);
    return result as CallToolResult;
  });

  await server.connect(new StdioServerTransport());
}

async function main(arguments_: string[]): Promise<void> {
  const [command, argument] = arguments_;
  if (command === undefined || ["help", "--help", "-h"].includes(command)) return void console.log(usage());
  if (isAppId(command)) return serve(command);

  const handlers: Record<string, () => Promise<void>> = {
    refresh: async () => {
      const installLaunchers = arguments_.includes("--install-launchers");
      const target = arguments_.find((value) => value !== "refresh" && value !== "--install-launchers");
      const appIds = target === "--all" ? APP_IDS : [requireAppId(target)];
      if (installLaunchers) for (const appId of appIds) await installDesktop(appId);
      for (const appId of appIds) await refresh(appId);
    },
    "install-desktop": async () => {
      const appIds = argument === undefined || argument === "--all" ? APP_IDS : [requireAppId(argument)];
      for (const appId of appIds) await installDesktop(appId);
    },
    "cache-status": () => showCacheStatus(requireAppId(argument)),
    status: () => showAppStatus(requireAppId(argument)),
    start: () => startApp(requireAppId(argument)),
    "install-pi": async () => {
      const path = argument ?? `${process.env.HOME ?? "."}/.pi/agent/mcp.json`;
      await installPiConfig(path);
      console.log(`Updated ${path}`);
    },
  };
  const handler = handlers[command];
  if (!handler) throw new Error(`Unknown command: ${command}`);
  await handler();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`${program}: ${message}`);
  process.exitCode = 1;
});
