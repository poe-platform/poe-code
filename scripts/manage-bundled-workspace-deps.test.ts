import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { assertSafeBundledPath } from "./manage-bundled-workspace-deps.mjs";

describe("assertSafeBundledPath", () => {
  it("rejects dependency output through a symlinked node_modules directory", () => {
    const volume = Volume.fromJSON({ "/repo/pkg/package.json": "{}", "/outside/marker": "outside" });
    volume.symlinkSync("/outside", "/repo/pkg/node_modules");
    const fs = createFsFromVolume(volume);

    expect(() =>
      assertSafeBundledPath("/repo/pkg", "/repo/pkg/node_modules/auth-store", fs)
    ).toThrow("Bundled dependency output must remain inside the package directory.");
  });

  it("rejects a symlinked stamp file and crafted cleanup target", () => {
    const volume = Volume.fromJSON({
      "/repo/pkg/package.json": "{}",
      "/outside/stamp.json": "{}",
      "/outside/dependency/package.json": "{}"
    });
    volume.symlinkSync("/outside/stamp.json", "/repo/pkg/.bundled-workspace-deps.json");
    const fs = createFsFromVolume(volume);

    expect(() =>
      assertSafeBundledPath("/repo/pkg", "/repo/pkg/.bundled-workspace-deps.json", fs)
    ).toThrow("Bundled dependency output must remain inside the package directory.");
    expect(() => assertSafeBundledPath("/repo/pkg", "/outside/dependency", fs)).toThrow(
      "Bundled dependency output must remain inside the package directory."
    );
  });
});
