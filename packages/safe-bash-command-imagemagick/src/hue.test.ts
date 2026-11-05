import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runMagickCli } from "./index.js";

const cases = [
  { sourceAlpha: 255, destinationAlpha: 255, source: [20, 200, 50], destination: [230, 240, 250], expected: [226, 246, 229, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, source: [50, 20, 200], destination: [200, 100, 10], expected: [120, 88, 255, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, source: [80, 80, 80], expected: [226, 36, 36, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, destination: [100, 100, 100], expected: [100, 100, 100, 255] },
  { sourceAlpha: 128, destinationAlpha: 102, expected: [222, 32, 64, 128] },
  { sourceAlpha: 102, destinationAlpha: 128, expected: [222, 32, 64, 128] },
  { sourceAlpha: 255, destinationAlpha: 255, expected: [222, 32, 64, 255] },
  { sourceAlpha: 0, destinationAlpha: 102, expected: [30, 100, 220, 102] },
  { sourceAlpha: 128, destinationAlpha: 0, expected: [200, 20, 50, 128] },
  { sourceAlpha: 0, destinationAlpha: 0, expected: [30, 100, 220, 0] },
];

for (const retained of [false, true]) {
  for (const entry of ["compose", "magick", ...(retained ? [] : ["sync"])] as const) {
    it.each(cases)(`Hue ${entry} retained=${retained} alpha=$sourceAlpha/$destinationAlpha matches native`, async ({ sourceAlpha, destinationAlpha, source = [200, 20, 50], destination = [30, 100, 220], expected }) => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      for (const [path, pixels] of [
        ["/overlay.png", [...source, sourceAlpha]],
        ["/base.png", [...destination, destinationAlpha]],
      ] as const) {
        const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
      }
      const input = retained ? { filesystem: fs, cwd: "/" } : files;
      const settings = ["-compose", "Hue"];
      const result = entry === "sync"
        ? runCompositeCliSync(["-compose", "Hue", "/overlay.png", "/base.png", "/out.png"], files)
        : entry === "magick"
        ? await runMagickCli(["/base.png", "/overlay.png", ...settings, "-composite", "/out.png"], input)
        : await runCompositeCli([...settings, "/overlay.png", "/base.png", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
    });
  }
}

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies Hue references against native ImageMagick", async () => {
  for (const { sourceAlpha, destinationAlpha, source = [200, 20, 50], destination = [30, 100, 220], expected } of cases) {
    const inputs = await Promise.all([[...source, sourceAlpha], [...destination, destinationAlpha]].map(async pixels => {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      return `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    }));
    const result = spawnSync("magick", ["composite", "-compose", "Hue", ...inputs, "png:-"]);
    expect(result.status).toBe(0);
    expect([...decodeImage(result.stdout).data]).toEqual(expected);
  }
});
