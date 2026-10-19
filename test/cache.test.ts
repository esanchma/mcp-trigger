import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isToolsCache, readCache, writeCache } from "../src/cache";
import type { ToolsCache } from "../src/types";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-trigger-test-"));
  directories.push(directory);
  return { XDG_CACHE_HOME: directory };
}

const cache: ToolsCache = {
  formatVersion: 1,
  appId: "photocraft",
  generatedAt: "2026-01-01T00:00:00.000Z",
  tools: [{ name: "edit_image", inputSchema: { type: "object" } }],
};

describe("tools cache", () => {
  test("validates the owning app and tool schema", () => {
    expect(isToolsCache(cache, "photocraft")).toBe(true);
    expect(isToolsCache(cache, "wordcraft")).toBe(false);
    expect(isToolsCache({ ...cache, tools: [{ name: "invalid" }] })).toBe(false);
  });

  test("writes and reads a cache atomically", async () => {
    const env = await environment();
    await writeCache(cache, env);
    expect(await readCache("photocraft", env)).toEqual(cache);
  });
});
