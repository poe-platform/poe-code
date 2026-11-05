import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runMagickCli } from "./index.js";

const native = spawnSync("magick", ["-version"]);

// ImageMagick 7.1.2-32 RGBA references, including transparent alpha boundaries.
for (const retained of [false, true]) {
  for (const composite of [false, true]) {
    it.each([
      { sourceAlpha: 128, destinationAlpha: 102, expected: [112, 50, 113, 230] },
      { sourceAlpha: 255, destinationAlpha: 255, expected: [230, 120, 15, 255] },
      { sourceAlpha: 0, destinationAlpha: 102, expected: [12, 40, 88, 102] },
      { sourceAlpha: 128, destinationAlpha: 0, expected: [100, 10, 25, 128] },
      { sourceAlpha: 0, destinationAlpha: 0, expected: [0, 0, 0, 0] },
      { sourceAlpha: 204, destinationAlpha: 204, expected: [184, 96, 216, 153] },
      { sourceAlpha: 127, destinationAlpha: 128, expected: [115, 60, 135, 255] },
      { sourceAlpha: 255, destinationAlpha: 255, source: [255, 255, 0], destination: [0, 255, 255], expected: [0, 0, 0, 255] },
    ])(`ModulusAdd retained=${retained} composite=${composite} alpha=$sourceAlpha/$destinationAlpha matches native`, async ({ sourceAlpha, destinationAlpha, source = [200, 20, 50], destination = [30, 100, 220], expected }) => {
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
      if (!native.error && !retained && composite) {
        const reference = spawnSync("magick", ["composite", "-compose", "ModulusAdd",
          ...["/overlay.png", "/base.png"].map(path => `inline:data:image/png;base64,${Buffer.from(files.get(path)!).toString("base64")}`), "png:-"]);
        expect(reference.status).toBe(0);
        expect(Array.from(decodeImage(reference.stdout).data)).toEqual(expected);
      }
      const input = retained ? { filesystem: fs, cwd: "/" } : files;
      const result = composite
        ? await runCompositeCli(["-compose", "ModulusAdd", "/overlay.png", "/base.png", "/out.png"], input)
        : await runMagickCli(["/base.png", "/overlay.png", "-compose", "ModulusAdd", "-composite", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
      expect(Array.from(output.data)).toEqual(expected);
    });
  }
}
