import { join } from "node:path";
import type { AppConfig } from "./config";
import { inspectControl } from "./control";
import { readControlToken } from "./credentials";

export type AppStatus = "stopped" | "starting" | "ready" | "occupied";

export async function appStatus(config: AppConfig): Promise<AppStatus> {
  const status = await inspectControl(config.controlPort, 1_000, await controlToken(config));
  if (status === "ready") return "ready";
  return status === "stopped" ? "stopped" : "occupied";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startAndWait(config: AppConfig): Promise<void> {
  const status = await appStatus(config);
  if (status === "ready") return;
  if (status === "occupied") {
    throw new Error(
      `${config.id}: port ${config.controlPort} is occupied by a service that does not implement the expected control protocol`,
    );
  }

  const child = Bun.spawn(["setsid", config.launch.command, ...launchArgs(config)], {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();

  const deadline = Date.now() + config.startupTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const nextStatus = await appStatus(config);
    if (nextStatus === "ready") return;
    if (nextStatus === "occupied") {
      throw new Error(
        `${config.id}: port ${config.controlPort} was claimed by a service that does not implement the expected control protocol`,
      );
    }
  }

  throw new Error(`${config.id}: application did not become ready within ${config.startupTimeoutMs} ms`);
}

async function controlToken(config: AppConfig): Promise<string | undefined> {
  if (!config.controlTokenFile) return undefined;
  const home = process.env.HOME;
  return home ? readControlToken(join(home, config.controlTokenFile)) : undefined;
}

function launchArgs(config: AppConfig): string[] {
  if (!config.controlTokenFile) return config.launch.args;
  const home = process.env.HOME;
  if (!home) throw new Error(`${config.id}: HOME is required to locate the control token`);
  return [...config.launch.args, "--control-token-file", join(home, config.controlTokenFile)];
}
