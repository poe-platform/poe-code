import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { assertSafeOutputDirectory } from "./guard-package-dist.mjs";

describe("assertSafeOutputDirectory", () => {
  it("rejects a dist symlink that escapes the package directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/example/src/index.ts": "export {};",
      "/outside/marker": "outside",
    });
    const fileSystem = createFsFromVolume(volume).promises;
    volume.symlinkSync("/outside", "/repo/packages/example/dist");

    await expect(
      assertSafeOutputDirectory("/repo/packages/example", undefined, fileSystem),
    ).rejects.toThrow("output directory must remain inside the package directory");
  });

  it("accepts an absent or local dist directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/example/src/index.ts": "export {};",
    });
    const fileSystem = createFsFromVolume(volume).promises;

    await expect(assertSafeOutputDirectory("/repo/packages/example", undefined, fileSystem)).resolves.toBeUndefined();

    volume.mkdirSync(path.join("/repo/packages/example", "dist"));

    await expect(assertSafeOutputDirectory("/repo/packages/example", undefined, fileSystem)).resolves.toBeUndefined();
  });

  it("rejects a nested output symlink below a local dist directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/example/dist/marker": "local",
      "/outside/marker": "outside",
    });
    const fileSystem = createFsFromVolume(volume).promises;
    volume.symlinkSync("/outside", "/repo/packages/example/dist/templates");

    await expect(
      assertSafeOutputDirectory(
        "/repo/packages/example",
        "/repo/packages/example/dist/templates",
        fileSystem,
      ),
    ).rejects.toThrow("output directory must remain inside the package directory");
  });
});
