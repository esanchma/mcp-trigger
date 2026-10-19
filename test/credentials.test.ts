import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWordcraftControlKey } from "../src/credentials";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "mcp-trigger-credentials-"));
  directories.push(path);
  return path;
}

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
