import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { inspectControl } from "../src/control";
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

  test("rejects a TCP service with an unexpected protocol", async () => {
    const port = await startServer("not JSON\n");
    expect(await inspectControl(port)).toBe("invalid");
    expect(await appStatus(config(port))).toBe("occupied");
  });
});
