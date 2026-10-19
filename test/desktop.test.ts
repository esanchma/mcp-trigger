import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopEntry, desktopPath, hasManagedLauncher, installDesktopLauncher } from "../src/desktop";
import { getAppConfig } from "../src/config";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-trigger-desktop-"));
  directories.push(directory);
  return directory;
}

const source = "[Desktop Entry]\nName=PhotoCraft\nExec=old-command\nIcon=ai.storyteller.photocraft\n";

describe("desktop launchers", () => {
  test("adds a managed control-port launcher without dropping desktop metadata", () => {
    const config = getAppConfig("photocraft");
    const entry = desktopEntry(source, config, "/home/example");
    expect(entry).toContain("Name=PhotoCraft");
    expect(entry).toContain("--new-instance --control 7981");
    expect(entry).toContain("--control-token-file /home/example/.var/app/ai.storyteller.photocraft/config/photocraft/control-token");
    expect(hasManagedLauncher(entry, config)).toBe(true);
  });

  test("backs up an unmanaged override before replacing it", async () => {
    const root = await home();
    const config = getAppConfig("gridcraft");
    const path = desktopPath(root, config.id);
    await mkdir(join(root, ".local", "share", "applications"), { recursive: true });
    await writeFile(path, source);
    await installDesktopLauncher(config, source, root);
    expect(await readFile(`${path}.mcp-trigger.bak`, "utf8")).toBe(source);
    expect(hasManagedLauncher(await readFile(path, "utf8"), config)).toBe(true);
  });
});
