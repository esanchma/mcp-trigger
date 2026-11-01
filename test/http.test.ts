import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeCache } from "../src/cache";
import { startHttpServer } from "../src/http";
import { ensureHttpToken, readHttpToken, tokenPath } from "../src/http-auth";
import { APP_IDS, type AppId } from "../src/types";

const token = "a".repeat(64);

describe("HTTP authentication token", () => {
  test("creates one private token without replacing it and rejects unsafe files", async () => {
    const home = await mkdtemp(join(tmpdir(), "mcp-trigger-auth-"));
    const env = { HOME: home };
    try {
      await Promise.all([ensureHttpToken(env), ensureHttpToken(env)]);
      const first = await readHttpToken(env);
      expect(first).toMatch(/^[a-f0-9]{64}$/);
      await ensureHttpToken(env);
      expect(await readHttpToken(env)).toBe(first);
      await chmod(tokenPath(env), 0o644);
      await expect(readHttpToken(env)).rejects.toThrow("private file");
      await rm(tokenPath(env));
      await symlink("/etc/passwd", tokenPath(env));
      await expect(readHttpToken(env)).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("HTTP MCP service", () => {
  let directory: string;
  let originalCache: string | undefined;
  let server: ReturnType<typeof startHttpServer>;
  let base: string;
  let calls: string[] = [];
  let closed: string[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "mcp-trigger-http-"));
    originalCache = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = directory;
    await writeCache({ formatVersion: 1, appId: "gridcraft", generatedAt: new Date().toISOString(), tools: [{ name: "example", inputSchema: { type: "object" } }] });
    const bridges = Object.fromEntries(APP_IDS.map((id) => [id, {
      async callTool(params: { name: string }) {
        calls.push(`${id}:${params.name}`);
        if (params.name === "fail") throw new Error("bridge failure");
        return { content: [{ type: "text", text: id }] };
      },
      async close() { closed.push(id); },
    }])) as unknown as Record<AppId, { callTool(params: { name: string }): Promise<unknown>; close(): Promise<void> }>;
    server = startHttpServer(token, { port: 0, bridges });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    expect(closed.sort()).toEqual([...APP_IDS].sort());
    if (originalCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalCache;
    await rm(directory, { recursive: true, force: true });
  });

  test("rejects unauthenticated, wrong-host, and cross-origin requests", async () => {
    const url = `${base}/mcp/gridcraft`;
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, Host: "evil.example" } })).status).toBe(403);
    expect((await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(`${base}/mcp/unknown`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(405);
  });

  test("missing cache reports how to refresh without invoking a bridge", async () => {
    calls = [];
    const client = new Client({ name: "test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/wordcraft`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      await expect(client.listTools()).rejects.toThrow("mcp-trigger refresh wordcraft");
      expect(calls).toEqual([]);
    } finally {
      await client.close();
    }
  });

  test("independent clients discover cached tools and call only the selected bridge", async () => {
    calls = [];
    const clients = Array.from({ length: 2 }, () => new Client({ name: "test", version: "1" }));
    try {
      await Promise.all(clients.map((client) => client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/gridcraft`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))));
      expect((await clients[0].listTools()).tools.map((tool) => tool.name)).toEqual(["example"]);
      expect(calls).toEqual([]);
      const results = await Promise.all(clients.map((client) => client.callTool({ name: "example", arguments: {} })));
      expect(results).toHaveLength(2);
      expect(calls).toEqual(["gridcraft:example", "gridcraft:example"]);
      await expect(clients[0].callTool({ name: "fail", arguments: {} })).rejects.toThrow("bridge failure");
      expect(calls.filter((call) => call === "gridcraft:fail")).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  });
});
