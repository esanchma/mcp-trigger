import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

function wordcraftConfigDirectory(): string {
  const home = process.env.HOME;
  if (!home) throw new Error("WORDCRAFT_CONTROL_KEY is unavailable because HOME is not set");
  return join(home, ".var", "app", "ai.storyteller.wordcraft", "config", "wordcraft");
}

export function runtimeDirectory(): string | undefined {
  if (process.env.XDG_RUNTIME_DIR) return process.env.XDG_RUNTIME_DIR;
  if (process.platform === "linux" && typeof process.getuid === "function") return `/run/user/${process.getuid()}`;
  return undefined;
}

export async function readGridcraftControlToken(port: number): Promise<string | undefined> {
  if (process.env.GRIDCRAFT_CONTROL_TOKEN) return process.env.GRIDCRAFT_CONTROL_TOKEN;
  const runtime = runtimeDirectory();
  if (!runtime) return undefined;
  return readControlToken(join(runtime, ".flatpak", "ai.storyteller.gridcraft", "xdg-run", "gridcraft", `control-${port}.token`));
}

export async function readControlToken(file: string): Promise<string | undefined> {
  try {
    const token = (await readFile(file, "utf8")).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export async function readWordcraftControlKey(directory = wordcraftConfigDirectory()): Promise<string> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    throw new Error("WordCraft control key not found; start WordCraft with --control before calling tools");
  }

  const candidates = await Promise.all(
    names
      .filter((name) => name.startsWith("control-key."))
      .map(async (name) => ({ name, modified: (await stat(join(directory, name))).mtimeMs })),
  );
  const newest = candidates.sort((left, right) => right.modified - left.modified)[0];
  if (!newest) {
    throw new Error("WordCraft control key not found; start WordCraft with --control before calling tools");
  }

  const key = (await readFile(join(directory, newest.name), "utf8")).trim();
  if (!key) throw new Error("WordCraft control key is empty; restart WordCraft with --control");
  return key;
}
