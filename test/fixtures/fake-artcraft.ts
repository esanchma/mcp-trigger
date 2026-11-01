import { appendFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

async function main() {
  if (process.argv[2] === "control") {
    const port = Number(process.argv[3]);
    const pidFile = process.argv[4];
    Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
    await appendFile(pidFile, `${process.pid}\n`);
  } else {
    let calls = 0;
    const server = new Server({ name: "fake-bridge", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls++;
      return {
        isError: request.params.name === "fail",
        content: [{ type: "text", text: JSON.stringify({ pid: process.pid, calls }) }],
      };
    });
    await server.connect(new StdioServerTransport());
  }
}

void main();
