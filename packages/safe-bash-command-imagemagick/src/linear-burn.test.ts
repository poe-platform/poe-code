import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runMagickCli } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;

// ImageMagick 7.1.2-35 Q16-HDRI RGBA references, including transparent alpha boundaries.
for (const retained of [false, true]) {
  for (const composite of [false, true]) {
    it.each([
      { sourceAlpha: 128, destinationAlpha: 102, expected: [94, 37, 88, 179] },
      { sourceAlpha: 255, destinationAlpha: 255, expected: [0, 0, 15, 255] },
      { sourceAlpha: 0, destinationAlpha: 102, expected: [30, 100, 220, 102] },
      { sourceAlpha: 128, destinationAlpha: 0, expected: [200, 20, 50, 128] },
      { sourceAlpha: 0, destinationAlpha: 0, expected: [0, 0, 0, 0] },
      { sourceAlpha: 255, destinationAlpha: 255, source: [0, 0, 0], destination: [255, 100, 0], expected: [0, 0, 0, 255] },
    ])(`LinearBurn retained=${retained} composite=${composite} alpha=$sourceAlpha/$destinationAlpha matches native`, async ({ sourceAlpha, destinationAlpha, source = [200, 20, 50], destination = [30, 100, 220], expected }) => {
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
      const result = composite
        ? await runCompositeCli(["-compose", "LinearBurn", "/overlay.png", "/base.png", "/out.png"], input)
        : await runMagickCli(["/base.png", "/overlay.png", "-compose", "LinearBurn", "-composite", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
      expect(Array.from(output.data)).toEqual(expected);
      if (nativeAvailable && composite && !retained) {
        const inputs = ["/overlay.png", "/base.png"].map(path => `inline:data:image/png;base64,${Buffer.from(files.get(path)!).toString("base64")}`);
        const native = spawnSync("magick", ["composite", "-compose", "LinearBurn", ...inputs, "png:-"]);
        expect(native.status).toBe(0);
        expect([...decodeImage(native.stdout).data]).toEqual(expected);
      }
    });
  }
}
