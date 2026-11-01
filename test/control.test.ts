import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { inspectControl, inspectGridcraftControl, isTcpPortOpen } from "../src/control";
import { appStatus } from "../src/launcher";
import type { AppConfig } from "../src/config";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    ),
  );
});

async function startServer(reply: string): Promise<number> {
  const server = createServer((socket) => socket.once("data", () => socket.end(reply)));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  return address.port;
}

function config(port: number): AppConfig {
  return {
    id: "gridcraft",
    flatpakApp: "ai.storyteller.gridcraft",
    controlPort: port,
    launch: { command: "false", args: [] },
    bridge: { command: "false", args: [] },
    startupTimeoutMs: 100,
  };
}

describe("control-channel health check", () => {
  test("accepts an expected JSON-lines response", async () => {
    const port = await startServer('{"id":1,"ok":true,"result":{}}\n');
    expect(await inspectControl(port)).toBe("ready");
    expect(await appStatus(config(port))).toBe("ready");
  });

  test("authenticates GridCraft before inspecting and rejects a wrong token", async () => {
    const requests: Array<{ method: string; params?: { token?: string } }> = [];
    const server = createServer((socket) => {
      let buffer = "";
      let authenticated = false;
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        let end: number;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const request = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          requests.push(request);
          if (!authenticated) {
            if (request.method !== "auth") return socket.end('{"ok":false,"error":"authentication required"}\n');
            if (request.params?.token !== "secret") return socket.end('{"ok":false,"error":"authentication required"}\n');
            authenticated = true;
            socket.write('{"id":0,"ok":true,"result":{"authenticated":true}}\n');
          } else {
            socket.write('{"id":1,"ok":true,"result":{}}\n');
          }
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
    expect(await inspectGridcraftControl(address.port, async () => "secret")).toBe("ready");
    expect(requests.map((request) => request.method)).toEqual(["ui.inspect", "auth", "ui.inspect"]);
    expect(await inspectGridcraftControl(address.port, async () => "wrong")).toBe("invalid");
    expect(await inspectGridcraftControl(address.port, async () => undefined)).toBe("invalid");
  });

  test("does not send a token to a service without an authentication challenge", async () => {
    const port = await startServer("not JSON\n");
    let readToken = false;
    expect(await inspectGridcraftControl(port, async () => { readToken = true; return "secret"; })).toBe("invalid");
    expect(readToken).toBe(false);
  });

  test("rejects a TCP service with an unexpected protocol", async () => {
    const port = await startServer("not JSON\n");
    expect(await inspectControl(port)).toBe("invalid");
    expect(await appStatus(config(port))).toBe("occupied");
  });

  test("uses TCP availability for a native MCP health check", async () => {
    const port = await startServer("not JSON\n");
    expect(await isTcpPortOpen(port)).toBe("ready");
    expect(await appStatus({ ...config(port), controlHealth: "tcp" })).toBe("ready");
  });
});
