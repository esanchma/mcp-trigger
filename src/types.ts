export const APP_IDS = ["photocraft", "wordcraft", "deckcraft", "gridcraft"] as const;

export type AppId = (typeof APP_IDS)[number];

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolsCache {
  formatVersion: 1;
  appId: AppId;
  generatedAt: string;
  bridgeVersion?: string;
  tools: ToolDefinition[];
}
