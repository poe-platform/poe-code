import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { assertSafeDistDirectory } from "./guard-package-dist.mjs";

describe("assertSafeDistDirectory", () => {
  it("rejects a dist symlink that escapes the package directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/example/src/index.ts": "export {};",
      "/outside/marker": "outside",
    });
    const fileSystem = createFsFromVolume(volume).promises;
    volume.symlinkSync("/outside", "/repo/packages/example/dist");

    await expect(
      assertSafeDistDirectory("/repo/packages/example", fileSystem),
    ).rejects.toThrow("dist directory must remain inside the package directory");
  });

  it("accepts an absent or local dist directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/example/src/index.ts": "export {};",
    });
    const fileSystem = createFsFromVolume(volume).promises;

    await expect(assertSafeDistDirectory("/repo/packages/example", fileSystem)).resolves.toBeUndefined();

    volume.mkdirSync(path.join("/repo/packages/example", "dist"));

    await expect(assertSafeDistDirectory("/repo/packages/example", fileSystem)).resolves.toBeUndefined();
  });
});
