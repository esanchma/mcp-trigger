import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPiConfig, updateMcpConfig } from "../src/install";

describe("updateMcpConfig", () => {
  test("preserves unrelated entries and replaces all ArtCraft entries", () => {
    const result = updateMcpConfig({
      custom: { keep: true },
      mcpServers: {
        mdn: { command: "mdn-server" },
        photocraft: { command: "flatpak", args: ["run", "old"] },
      },
    });

    expect(result).toEqual({
      custom: { keep: true },
      mcpServers: {
        mdn: { command: "mdn-server" },
        photocraft: { url: "http://127.0.0.1:19797/mcp/photocraft", headers: { Authorization: "!~/.local/bin/mcp-trigger auth-header" } },
        wordcraft: { url: "http://127.0.0.1:19797/mcp/wordcraft", headers: { Authorization: "!~/.local/bin/mcp-trigger auth-header" } },
        deckcraft: { url: "http://127.0.0.1:19797/mcp/deckcraft", headers: { Authorization: "!~/.local/bin/mcp-trigger auth-header" } },
        gridcraft: { url: "http://127.0.0.1:19797/mcp/gridcraft", headers: { Authorization: "!~/.local/bin/mcp-trigger auth-header" } },
      },
    });
  });

  test("rejects invalid root and mcpServers values", () => {
    expect(() => updateMcpConfig([])).toThrow("mcp.json must contain a JSON object");
    expect(() => updateMcpConfig({ mcpServers: [] })).toThrow("mcpServers must contain a JSON object");
  });

  test("writes private configuration, preserving unrelated entries and remaining idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-trigger-install-"));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = directory;
    try {
      const path = join(directory, "mcp.json");
      await writeFile(path, JSON.stringify({ mcpServers: { other: { command: "other" } } }));
      await installPiConfig(path);
      const first = await readFile(path, "utf8");
      expect(JSON.parse(first).mcpServers.other).toEqual({ command: "other" });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await installPiConfig(path);
      expect(await readFile(path, "utf8")).toBe(first);
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
