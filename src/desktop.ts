import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "./config";

const marker = "X-Mcp-Trigger-Version=1";

export function desktopPath(home: string, appId: string): string {
  return join(home, ".local", "share", "applications", `ai.storyteller.${appId}.desktop`);
}

export function desktopEntry(source: string, config: AppConfig, home: string): string {
  const controlArgs = [...(config.newInstance ? ["--new-instance"] : []), "--control", String(config.controlPort)];
  if (config.controlTokenFile) controlArgs.push("--control-token-file", join(home, config.controlTokenFile));
  const exec = `/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=${config.id} ${config.shareNetwork ? "--share=network " : ""}--file-forwarding ${config.flatpakApp} ${controlArgs.join(" ")} @@ %F @@`;
  const lines = source.split("\n").filter((line) => !line.startsWith("Exec=") && !line.startsWith("X-Mcp-Trigger-Version="));
  const entryEnd = lines.findIndex((line) => line === "");
  lines.splice(entryEnd === -1 ? lines.length : entryEnd, 0, `Exec=${exec}`, marker);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function hasManagedLauncher(entry: string, config: AppConfig): boolean {
  return entry.includes(marker) && entry.includes(`--control ${config.controlPort}`);
}

export async function installedDesktopEntry(config: AppConfig): Promise<string> {
  const process = Bun.spawn(["flatpak", "info", "--show-location", config.flatpakApp], { stdout: "pipe", stderr: "pipe" });
  if ((await process.exited) !== 0) throw new Error(`${config.id}: Flatpak application is not installed`);
  const location = (await new Response(process.stdout).text()).trim();
  return readFile(join(location, "export", "share", "applications", `${config.flatpakApp}.desktop`), "utf8");
}

export async function installDesktopLauncher(
  config: AppConfig,
  source: string,
  home = process.env.HOME,
): Promise<void> {
  if (!home) throw new Error("HOME is required to install desktop launchers");
  const target = desktopPath(home, config.id);
  await mkdir(join(home, ".local", "share", "applications"), { recursive: true });

  try {
    const existing = await readFile(target, "utf8");
    if (!hasManagedLauncher(existing, config)) await copyFile(target, `${target}.mcp-trigger.bak`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const temporary = `${target}.tmp`;
  await writeFile(temporary, desktopEntry(source, config, home), { mode: 0o644 });
  await rename(temporary, target);
}
