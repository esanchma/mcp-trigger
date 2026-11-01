import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGridcraftControlToken, readWordcraftControlKey } from "../src/credentials";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "mcp-trigger-credentials-"));
  directories.push(path);
  return path;
}

describe("GridCraft control token", () => {
  test("reads the Flatpak runtime token and honors the explicit environment token", async () => {
    const runtime = await directory();
    const tokenDir = join(runtime, ".flatpak", "ai.storyteller.gridcraft", "xdg-run", "gridcraft");
    await mkdir(tokenDir, { recursive: true });
    const previousRuntime = process.env.XDG_RUNTIME_DIR;
    const previousToken = process.env.GRIDCRAFT_CONTROL_TOKEN;
    try {
      process.env.XDG_RUNTIME_DIR = runtime;
      delete process.env.GRIDCRAFT_CONTROL_TOKEN;
      expect(await readGridcraftControlToken(7979)).toBeUndefined();
      await writeFile(join(tokenDir, "control-7979.token"), "first-secret\n", { mode: 0o600 });
      expect(await readGridcraftControlToken(7979)).toBe("first-secret");
      await writeFile(join(tokenDir, "control-7979.token"), "rotated-secret\n");
      expect(await readGridcraftControlToken(7979)).toBe("rotated-secret");
      process.env.GRIDCRAFT_CONTROL_TOKEN = "explicit-secret";
      expect(await readGridcraftControlToken(7979)).toBe("explicit-secret");
    } finally {
      if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = previousRuntime;
      if (previousToken === undefined) delete process.env.GRIDCRAFT_CONTROL_TOKEN;
      else process.env.GRIDCRAFT_CONTROL_TOKEN = previousToken;
    }
  });
});

describe("WordCraft control key", () => {
  test("reads the newest generated key without exposing its filename", async () => {
    const path = await directory();
    const oldKey = join(path, "control-key.old");
    const newKey = join(path, "control-key.new");
    await writeFile(oldKey, "old-secret\n", { mode: 0o600 });
    await writeFile(newKey, "new-secret\n", { mode: 0o600 });
    await chmod(newKey, 0o600);
    await utimes(oldKey, new Date(1_000), new Date(1_000));
    await utimes(newKey, new Date(2_000), new Date(2_000));

    expect(await readWordcraftControlKey(path)).toBe("new-secret");
  });

  test("fails without a generated key", async () => {
    await expect(readWordcraftControlKey(await directory())).rejects.toThrow("control key not found");
  });
});
