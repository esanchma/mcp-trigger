import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { APP_IDS, type AppId } from "./types";
import { HTTP_PORT } from "./http";
import { ensureHttpToken } from "./http-auth";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export function triggerEntry(appId: AppId) {
  return {
    url: `http://127.0.0.1:${HTTP_PORT}/mcp/${appId}`,
    headers: { Authorization: "!~/.local/bin/mcp-trigger auth-header" },
  };
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
  await ensureHttpToken();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fileHandle = await open(temporary, "wx", 0o600);
  try {
    try {
      await fileHandle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
    } finally {
      await fileHandle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
