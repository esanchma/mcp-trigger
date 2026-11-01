import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolRequest, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BridgeClient } from "./bridge";
import { readCache } from "./cache";
import { getAppConfig, isAppId } from "./config";
import { APP_IDS, type AppId } from "./types";

export const HTTP_PORT = 19797;

interface Bridge {
  callTool(params: CallToolRequest["params"]): Promise<unknown>;
  close(): Promise<void>;
}

function matchesToken(header: string | null, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function startHttpServer(token: string, options: {
  port?: number;
  bridges?: Record<AppId, Bridge>;
} = {}) {
  const bridges = options.bridges ?? Object.fromEntries(APP_IDS.map((id) => [id, new BridgeClient(getAppConfig(id))])) as unknown as Record<AppId, Bridge>;
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? HTTP_PORT,
    idleTimeout: 0,
    async fetch(request, server) {
      const host = `127.0.0.1:${server.port}`;
      const origin = request.headers.get("origin");
      if (request.headers.get("host") !== host || (origin !== null && origin !== `http://${host}`)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!matchesToken(request.headers.get("authorization"), token)) {
        return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
      }
      const path = new URL(request.url).pathname;
      const match = /^\/mcp\/([a-z]+)$/.exec(path);
      if (!match || !isAppId(match[1])) return new Response("Not found", { status: 404 });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const appId = match[1];
      const mcp = new McpServer({ name: `mcp-trigger-${appId}`, version: "0.1.0" }, { capabilities: { tools: {} } });
      mcp.server.setRequestHandler(ListToolsRequestSchema, async () => {
        const cache = await readCache(appId);
        if (!cache) throw new McpError(ErrorCode.InvalidRequest, `No cached tools for ${appId}; run 'mcp-trigger refresh ${appId}'.`);
        return { tools: cache.tools };
      });
      mcp.server.setRequestHandler(CallToolRequestSchema, async (message): Promise<CallToolResult> => {
        return await bridges[appId].callTool(message.params) as CallToolResult;
      });
      // Stateless HTTP needs a new server and transport for every request. The bridge is shared per app.
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await mcp.connect(transport);
      try {
        return await transport.handleRequest(request);
      } finally {
        await mcp.close();
      }
    },
  });
  return {
    port: http.port,
    async close() {
      http.stop(true);
      await Promise.all(APP_IDS.map((id) => bridges[id].close()));
    },
  };
}
