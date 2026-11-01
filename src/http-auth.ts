import { constants } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function tokenPath(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.HOME) throw new Error("HOME is required for HTTP authentication");
  return join(env.XDG_CONFIG_HOME || join(env.HOME, ".config"), "mcp-trigger", "http-token");
}

export async function readHttpToken(env?: NodeJS.ProcessEnv): Promise<string> {
  const path = tokenPath(env);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
      throw new Error(`HTTP token must be a private file owned by the current user: ${path}`);
    }
    const token = (await file.readFile("utf8")).trim();
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error(`Invalid HTTP token file: ${path}`);
    return token;
  } finally {
    await file.close();
  }
}

export async function ensureHttpToken(env?: NodeJS.ProcessEnv): Promise<void> {
  const path = tokenPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(`${randomBytes(32).toString("hex")}\n`);
    } finally {
      await file.close();
    }
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await unlink(temporary);
  }
  await readHttpToken(env);
}
