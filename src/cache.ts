import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { APP_IDS, type AppId, type ToolDefinition, type ToolsCache } from "./types";

const FORMAT_VERSION = 1 as const;

export function cacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME ?? join(env.HOME ?? ".", ".cache"), "mcp-trigger");
}

export function cachePath(appId: AppId, env?: NodeJS.ProcessEnv): string {
  return join(cacheDirectory(env), `${appId}.tools.json`);
}

function isTool(value: unknown): value is ToolDefinition {
  if (typeof value !== "object" || value === null) return false;
  const tool = value as Record<string, unknown>;
  return (
    typeof tool.name === "string" &&
    tool.name.length > 0 &&
    typeof tool.inputSchema === "object" &&
    tool.inputSchema !== null &&
    !Array.isArray(tool.inputSchema)
  );
}

export function isToolsCache(value: unknown, expectedAppId?: AppId): value is ToolsCache {
  if (typeof value !== "object" || value === null) return false;
  const cache = value as Record<string, unknown>;
  return (
    cache.formatVersion === FORMAT_VERSION &&
    typeof cache.appId === "string" &&
    (APP_IDS as readonly string[]).includes(cache.appId) &&
    (expectedAppId === undefined || cache.appId === expectedAppId) &&
    typeof cache.generatedAt === "string" &&
    !Number.isNaN(Date.parse(cache.generatedAt)) &&
    (cache.bridgeVersion === undefined || typeof cache.bridgeVersion === "string") &&
    Array.isArray(cache.tools) &&
    cache.tools.every(isTool)
  );
}

export async function readCache(appId: AppId, env?: NodeJS.ProcessEnv): Promise<ToolsCache | undefined> {
  const file = Bun.file(cachePath(appId, env));
  if (!(await file.exists())) return undefined;

  try {
    const value: unknown = await file.json();
    return isToolsCache(value, appId) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCache(cache: ToolsCache, env?: NodeJS.ProcessEnv): Promise<void> {
  if (!isToolsCache(cache, cache.appId)) throw new Error("Invalid tools cache");

  const destination = cachePath(cache.appId, env);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(cache, null, 2)}\n`);
  await rename(temporary, destination);
}
