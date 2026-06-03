import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { assertSafeBundleOutputs, assertSafeOutputDirectory } from "./guard-package-dist.mjs";

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

  it("rejects a generated output file symlink below a local directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/dist/bin/marker": "local",
      "/outside/wrapper.js": "outside",
    });
    const fileSystem = createFsFromVolume(volume).promises;
    volume.symlinkSync("/outside/wrapper.js", "/repo/dist/bin/poe-codex.js");

    await expect(
      assertSafeOutputDirectory("/repo", "/repo/dist/bin/poe-codex.js", fileSystem),
    ).rejects.toThrow("output directory must remain inside the package directory");
  });
});

describe("assertSafeBundleOutputs", () => {
  it.each([
    ["root dist", "/repo/dist"],
    ["provider bundles", "/repo/dist/providers"],
    ["skill templates", "/repo/dist/templates/skill"],
    ["memory dist", "/repo/packages/memory/dist"],
  ])("rejects a symlinked %s output", async (_name, outputPath) => {
    const volume = Volume.fromJSON({
      "/repo/package.json": "{}",
      "/repo/packages/memory/package.json": "{}",
      "/outside/marker": "outside",
    });
    const fileSystem = createFsFromVolume(volume).promises;
    volume.mkdirSync(path.dirname(outputPath), { recursive: true });
    volume.symlinkSync("/outside", outputPath);

    await expect(assertSafeBundleOutputs("/repo", fileSystem)).rejects.toThrow(
      "output directory must remain inside the package directory",
    );
  });
});
