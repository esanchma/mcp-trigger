import { APP_IDS, type AppId } from "./types";

export interface CommandSpec {
  command: string;
  args: string[];
}

export interface AppConfig {
  id: AppId;
  flatpakApp: string;
  controlPort: number;
  launch: CommandSpec;
  bridge: CommandSpec;
  startupTimeoutMs: number;
  controlTokenFile?: string;
  newInstance?: boolean;
  shareNetwork?: boolean;
}

function flatpakCommand(app: string, executable: string, args: string[]): CommandSpec {
  return {
    command: "flatpak",
    args: ["run", `--command=${executable}`, app, ...args],
  };
}

function appConfig(
  id: AppId,
  controlPort: number,
  bridgeArgs: string[],
  controlTokenFile?: string,
  newInstance = false,
  shareNetwork = false,
): AppConfig {
  const flatpakApp = `ai.storyteller.${id}`;
  return {
    id,
    flatpakApp,
    controlPort,
    launch: {
      command: "flatpak",
      args: ["run", ...(shareNetwork ? ["--share=network"] : []), flatpakApp, ...(newInstance ? ["--new-instance"] : []), "--control", String(controlPort)],
    },
    bridge: {
      ...flatpakCommand(flatpakApp, `${id}-cli`, bridgeArgs),
      args: ["run", ...(shareNetwork ? ["--share=network"] : []), `--command=${id}-cli`, flatpakApp, ...bridgeArgs],
    },
    startupTimeoutMs: 30_000,
    controlTokenFile,
    newInstance,
    shareNetwork,
  };
}

const configs: Record<AppId, AppConfig> = {
  gridcraft: appConfig("gridcraft", 7979, ["mcp", "--connect", "127.0.0.1:7979"]),
  wordcraft: appConfig("wordcraft", 7980, ["mcp", "--connect", "127.0.0.1:7980"]),
  photocraft: appConfig(
    "photocraft",
    7981,
    ["mcp", "--bridge", "127.0.0.1:7981"],
    ".var/app/ai.storyteller.photocraft/config/photocraft/control-token",
    true,
    true,
  ),
  deckcraft: appConfig("deckcraft", 7982, ["mcp", "--connect", "127.0.0.1:7982"], undefined, false, true),
};

export function isAppId(value: string): value is AppId {
  return (APP_IDS as readonly string[]).includes(value);
}

export function getAppConfig(id: AppId): AppConfig {
  return configs[id];
}
