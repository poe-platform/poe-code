import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { downloadFont } from "./download-font.js";

describe("downloadFont", () => {
  it("rejects a symlinked font output outside the package", async () => {
    const volume = Volume.fromJSON({ "/repo/packages/terminal-png/assets/marker": "local", "/outside.ttf": "original" });
    volume.symlinkSync("/outside.ttf", "/repo/packages/terminal-png/assets/font.ttf");
    const fs = createFsFromVolume(volume).promises;

    await expect(
      downloadFont({
        fetch: vi.fn(async () => new Response("font", { status: 200 })),
        fs,
        packageDir: "/repo/packages/terminal-png",
        outPath: "/repo/packages/terminal-png/assets/font.ttf"
      })
    ).rejects.toThrow("output directory must remain inside the package directory");
    await expect(fs.readFile("/outside.ttf", "utf8")).resolves.toBe("original");
  });
});
