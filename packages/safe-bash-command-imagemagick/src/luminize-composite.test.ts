import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runMagickCli } from "./index.js";

const cases = [
  { sourceAlpha: 255, destinationAlpha: 255, source: [255, 255, 255], expected: [192, 255, 255, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, source: [0, 0, 0], expected: [0, 7, 127, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, source: [255, 0, 0], destination: [255, 255, 255], expected: [76, 76, 76, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, source: [0, 255, 0], destination: [0, 0, 0], expected: [150, 150, 150, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, source: [80, 80, 80], expected: [17, 87, 207, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, destination: [100, 100, 100], expected: [77, 77, 77, 255] },
  { sourceAlpha: 128, destinationAlpha: 102, expected: [14, 84, 204, 128] },
  { sourceAlpha: 102, destinationAlpha: 128, expected: [14, 84, 204, 128] },
  { sourceAlpha: 255, destinationAlpha: 255, expected: [14, 84, 204, 255] },
  { sourceAlpha: 0, destinationAlpha: 102, expected: [30, 100, 220, 102] },
  { sourceAlpha: 128, destinationAlpha: 0, expected: [200, 20, 50, 128] },
  { sourceAlpha: 0, destinationAlpha: 0, expected: [30, 100, 220, 0] },
];

for (const retained of [false, true]) {
  for (const entry of ["compose", "magick", ...(retained ? [] : ["sync"])] as const) {
    it.each(cases)(`Luminize ${entry} retained=${retained} alpha=$sourceAlpha/$destinationAlpha matches native`, async ({ sourceAlpha, destinationAlpha, source = [200, 20, 50], destination = [30, 100, 220], expected }) => {
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
      const settings = ["-compose", "Luminize"];
      const result = entry === "sync"
        ? runCompositeCliSync(["-compose", "Luminize", "/overlay.png", "/base.png", "/out.png"], files)
        : entry === "magick"
        ? await runMagickCli(["/base.png", "/overlay.png", ...settings, "-composite", "/out.png"], input)
        : await runCompositeCli([...settings, "/overlay.png", "/base.png", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
    });
  }
}

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies Luminize references against native ImageMagick", async () => {
  for (const { sourceAlpha, destinationAlpha, source = [200, 20, 50], destination = [30, 100, 220], expected } of cases) {
    const inputs = await Promise.all([[...source, sourceAlpha], [...destination, destinationAlpha]].map(async pixels => {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      return `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    }));
    const result = spawnSync("magick", ["composite", "-compose", "Luminize", ...inputs, "png:-"]);
    expect(result.status).toBe(0);
    expect([...decodeImage(result.stdout).data]).toEqual(expected);
  }
});
