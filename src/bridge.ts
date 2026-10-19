import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config";
import { join } from "node:path";
import { readWordcraftControlKey } from "./credentials";
import { startAndWait } from "./launcher";
import type { ToolDefinition } from "./types";

export class BridgeClient {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  private transport: StdioClientTransport | undefined;

  constructor(private readonly config: AppConfig) {}

  async listTools(): Promise<ToolDefinition[]> {
    const client = await this.connect();
    const result = await client.listTools();
    return result.tools as ToolDefinition[];
  }

  async callTool(params: CallToolRequest["params"]): Promise<unknown> {
    return (await this.connect()).callTool(params);
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.client = undefined;
    this.connecting = undefined;
    this.transport = undefined;
    if (transport) await transport.close();
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) this.connecting = this.createClient();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async createClient(): Promise<Client> {
    await startAndWait(this.config);
    const transport = new StdioClientTransport({
      command: this.config.bridge.command,
      args: await this.bridgeArgs(),
      stderr: "ignore",
    });
    const client = new Client(
      { name: "mcp-trigger", version: "0.1.0" },
      { capabilities: {} },
    );
    transport.onclose = () => {
      if (this.transport === transport) {
        this.client = undefined;
        this.connecting = undefined;
        this.transport = undefined;
      }
    };

    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }

    this.client = client;
    this.transport = transport;
    return client;
  }

  private async bridgeArgs(): Promise<string[]> {
    if (this.config.id === "photocraft") {
      const home = process.env.HOME;
      if (!home || !this.config.controlTokenFile) throw new Error("PhotoCraft control token path is unavailable");
      return [...this.config.bridge.args, "--control-token-file", join(home, this.config.controlTokenFile)];
    }
    if (this.config.id !== "wordcraft") return this.config.bridge.args;

    const [run, commandOption, flatpakApp, ...bridgeArgs] = this.config.bridge.args;
    if (run !== "run" || commandOption === undefined || flatpakApp === undefined) {
      throw new Error("Invalid WordCraft Flatpak bridge configuration");
    }
    return [run, `--env=WORDCRAFT_CONTROL_KEY=${await readWordcraftControlKey()}`, commandOption, flatpakApp, ...bridgeArgs];
  }
}
