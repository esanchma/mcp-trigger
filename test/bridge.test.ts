import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BridgeClient } from "../src/bridge";
import type { AppConfig } from "../src/config";

function parse(result: unknown): { pid: number; calls: number } {
  const content = (result as CallToolResult).content[0];
  if (content.type !== "text") throw new Error("Expected text result");
  return JSON.parse(content.text);
}

test("restarts a stopped application and replaces its live stale bridge without retrying calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-trigger-bridge-"));
  const pidFile = join(directory, "control-pids");
  const fixture = join(import.meta.dir, "fixtures/fake-artcraft.ts");
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  const config: AppConfig = {
    id: "deckcraft", flatpakApp: "fake", controlPort: port,
    controlHealth: "tcp", startupTimeoutMs: 5_000,
    launch: { command: process.execPath, args: [fixture, "control", String(port), pidFile] },
    bridge: { command: process.execPath, args: [fixture, "bridge"] },
  };
  const bridge = new BridgeClient(config);
  try {
    const initial = (await Promise.all([bridge.callTool({ name: "test" }), bridge.callTool({ name: "test" })])).map(parse);
    expect(initial[0].pid).toBe(initial[1].pid);
    expect(initial.map((result) => result.calls).sort()).toEqual([1, 2]);
    listener.stop(true);
    const recovered = (await Promise.all([bridge.callTool({ name: "test" }), bridge.callTool({ name: "test" })])).map(parse);
    expect(recovered[0].pid).not.toBe(initial[0].pid);
    expect(recovered[0].pid).toBe(recovered[1].pid);
    expect(recovered.map((result) => result.calls).sort()).toEqual([1, 2]);
    expect((await readFile(pidFile, "utf8")).trim().split("\n")).toHaveLength(1);
    const failure = await bridge.callTool({ name: "fail" }) as CallToolResult;
    expect(failure.isError).toBe(true);
    const afterFailure = parse(await bridge.callTool({ name: "test" }));
    expect(afterFailure.calls).toBe(parse(failure).calls + 1);
  } finally {
    listener.stop(true);
    await bridge.close();
    try {
      const pids = (await readFile(pidFile, "utf8")).trim().split("\n");
      for (const pid of pids) process.kill(Number(pid), "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
