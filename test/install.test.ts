import { describe, expect, test } from "bun:test";
import { updateMcpConfig } from "../src/install";

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
        photocraft: { command: "mcp-trigger", args: ["photocraft"] },
        wordcraft: { command: "mcp-trigger", args: ["wordcraft"] },
        deckcraft: { command: "mcp-trigger", args: ["deckcraft"] },
        gridcraft: { command: "mcp-trigger", args: ["gridcraft"] },
      },
    });
  });

  test("rejects invalid root and mcpServers values", () => {
    expect(() => updateMcpConfig([])).toThrow("mcp.json must contain a JSON object");
    expect(() => updateMcpConfig({ mcpServers: [] })).toThrow("mcpServers must contain a JSON object");
  });
});
