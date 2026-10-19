import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { APP_IDS, type AppId } from "./types";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export function triggerEntry(appId: AppId): { command: string; args: string[] } {
  return { command: "mcp-trigger", args: [appId] };
}

export function updateMcpConfig(value: unknown): McpConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("mcp.json must contain a JSON object");
  }

  const config = value as McpConfig;
  if (config.mcpServers !== undefined && (typeof config.mcpServers !== "object" || config.mcpServers === null || Array.isArray(config.mcpServers))) {
    throw new Error("mcp.json field mcpServers must contain a JSON object");
  }

  const mcpServers = { ...(config.mcpServers ?? {}) };
  for (const appId of APP_IDS) mcpServers[appId] = triggerEntry(appId);
  return { ...config, mcpServers };
}

export async function installPiConfig(path: string): Promise<void> {
  const file = Bun.file(path);
  let current: unknown = {};
  if (await file.exists()) {
    try {
      current = await file.json();
    } catch {
      throw new Error(`Cannot parse JSON in ${path}`);
    }
  }

  const next = updateMcpConfig(current);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(next, null, 2)}\n`);
  await rename(temporary, path);
}
