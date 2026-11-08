import { beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

import * as native from "../dist/runtime-io.js";
import * as reference from "../../toolcraft/src/runtime/io.js";

beforeEach(() => { vol.reset(); });

it("default filesystem capabilities preserve encoding, stat, writes, rename and removal", async () => {
  const run = async (lib: typeof reference) => {
    vol.reset();
    vol.fromJSON({ "/input": "héllo" });
    const fs = lib.createFs();
    const contents = await fs.readFile("/input");
    const hex = await fs.readFile("/input", "hex");
    const stats = await fs.lstat("/input");
    const written = await fs.writeFile("/output", "next", { flag: "wx", mode: 0o600 });
    await fs.rename("/output", "/renamed");
    const exists = await fs.exists("/renamed");
    await fs.unlink("/renamed");
    return { contents, hex, size: stats.size, file: stats.isFile(), written, exists, removed: !await fs.exists("/renamed") };
  };
  expect(await run(native)).toEqual(await run(reference));
});

it("filesystem operations preserve rejection codes while exists consumes access failures", async () => {
  for (const lib of [native, reference]) {
    vol.fromJSON({ "/input": "before" });
    const fs = lib.createFs();
    await expect(fs.readFile("/missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.writeFile("/input", "after", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.rename("/missing", "/target")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.unlink("/missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.exists("/missing")).resolves.toBe(false);
    await expect(fs.readFile("/input")).resolves.toBe("before");
  }
});
