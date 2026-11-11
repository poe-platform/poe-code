import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35/libwebp: equal-sized inputs are independent display frames.
const cases = [
  { colors: ["red", "none", "blue"], pixels: [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 255, 255]], delay: [20, 30, 70] },
  { colors: ["red", "#00ff0080", "blue"], pixels: [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 255]], delay: [20, 30, 70] },
  { colors: ["red", "#ff000080", "red"], pixels: [[255, 0, 0, 255], [255, 0, 0, 128], [255, 0, 0, 255]], delay: [20, 30, 70] },
  { colors: ["red", "red", "blue"], pixels: [[255, 0, 0, 255], [0, 0, 255, 255]], delay: [50, 70] }
];

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const write of [false, true]) {
    it.each(cases)(`preserves WebP opacity and merges only duplicate frames: $colors (${mode}, write=${write})`, async ({ colors, pixels, delay }) => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      const args = [
        ...colors.flatMap((color, index) => ["-delay", String([2, 3, 7][index]), `xc:${color}`]),
        "-loop", "5", "-define", "webp:lossless=true",
        ...(write ? ["-write", "/out.webp", "-format", "%T;", "info:"] : ["/out.webp"])
      ];
      const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      if (write) expect(result.stdout).toBe("2;3;7;");
      const bytes = mode === "retained" ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
      expect(readImageMetadata(bytes)).toMatchObject({ width: 1, height: 1, pages: pixels.length, delay, loop: 5 });
      for (const [page, pixel] of pixels.entries()) {
        expect(Array.from(decodeImage(bytes, { page }).data)).toEqual(pixel);
      }
    });
  }
}
