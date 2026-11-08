import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { copyTerminalPngAssets } from "./build-assets.mjs";

describe("terminal-pilot build assets", () => {
  it("copies terminal-png fonts into the bundled runtime asset directory", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/terminal-png/assets/regular.ttf": "regular-font",
      "/repo/packages/terminal-png/assets/bold.ttf": "bold-font"
    });
    const fs = createFsFromVolume(volume).promises;

    await copyTerminalPngAssets(
      fs,
      "/repo/packages/terminal-png/assets",
      "/repo/packages/terminal-pilot/assets"
    );

    await expect(
      fs.readFile("/repo/packages/terminal-pilot/assets/regular.ttf", "utf8")
    ).resolves.toBe("regular-font");
    await expect(
      fs.readFile("/repo/packages/terminal-pilot/assets/bold.ttf", "utf8")
    ).resolves.toBe("bold-font");
  });
});
