import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-32 RGBA references, including transparent alpha boundaries.
for (const operator of ["Minus", "MinusDst"])
for (const retained of [false, true]) {
  for (const composite of [false, true]) {
    it.each([
      { sourceAlpha: 128, destinationAlpha: 102, expected: [143, 14, 35, 179] },
      { sourceAlpha: 255, destinationAlpha: 255, expected: [170, 0, 0, 255] },
      { sourceAlpha: 0, destinationAlpha: 102, expected: [30, 100, 220, 102] },
      { sourceAlpha: 128, destinationAlpha: 0, expected: [200, 20, 50, 128] },
      { sourceAlpha: 0, destinationAlpha: 0, expected: [0, 0, 0, 0] },
      { sourceAlpha: 204, destinationAlpha: 204, expected: [152, 0, 0, 245] },
    ])(`${operator} retained=${retained} composite=${composite} alpha=$sourceAlpha/$destinationAlpha matches native`, async ({ sourceAlpha, destinationAlpha, expected }) => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      for (const [path, pixels] of [
        ["/overlay.png", [200, 20, 50, sourceAlpha]],
        ["/base.png", [30, 100, 220, destinationAlpha]],
      ] as const) {
        const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
      }
      const input = retained ? { filesystem: fs, cwd: "/" } : files;
      const result = composite
        ? await runCompositeCli(["-compose", operator, "/overlay.png", "/base.png", "/out.png"], input)
        : await runMagickCli(["/base.png", "/overlay.png", "-compose", operator, "-composite", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
      expect(Array.from(output.data)).toEqual(expected);
    });
  }
}
