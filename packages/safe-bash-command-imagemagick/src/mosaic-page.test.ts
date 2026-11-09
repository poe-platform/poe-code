import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Opaque native PNGs with pages 12x10+3+4 and 12x10+7+2.
const a = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAEGNhTnYAAAAMAAAACgAAAAMAAAAEHG+qAAAAABlJREFUCNdj5BKR+y/Ey84AwyweJjIMeAUAeB4Dy0lErLYAAAAASUVORK5CYII=", "base64");
const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEGNhTnYAAAAMAAAACgAAAAcAAAACAIyp9QAAABxJREFUCNdjVJv14b8QLzuDEC87A4uZuigDjAMASg8DvxmDohoAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const operation of [["-mosaic"], ["-layers", "Mosaic"]]) {
    it.each([
      { reset: "none", width: 12, height: 10, ax: 3, ay: 4, bx: 7, by: 2 },
      { reset: "first", width: 10, height: 4, ax: 0, ay: 0, bx: 7, by: 2 },
      { reset: "both", width: 4, height: 3, ax: 0, ay: 0, bx: 0, by: 0 },
      { reset: "negative", width: 3, height: 2, ax: -1, ay: -1, bx: -1, by: -1 },
      { reset: "single", width: 12, height: 10, ax: 3, ay: 4, bx: 7, by: 2 }
    ])(`${mode} ${operation.join(" ")} anchors and extends the first canvas ($reset)`, async ({ reset, width, height, ax, ay, bx, by }) => {
      const files = new Map<string, Uint8Array>([["a.png", a], ["b.png", b]]), fs = new MemoryFileSystem();
      for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
      const args = ["a.png", ...(reset === "first" ? ["+repage"] : []), ...(reset === "single" ? [] : ["b.png"]),
        ...(reset === "both" ? ["+repage"] : reset === "negative" ? ["-repage", "2x2-1-1"] : []), "-background", "none", ...operation, "PNG32:out.png"];
      const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
      // Geometry and origin verified with native ImageMagick.
      expect([output.width, output.height]).toEqual([width, height]);
      expect(output.virtualCanvas ?? { width, height, x: 0, y: 0 }).toEqual({ width, height, x: 0, y: 0 });
      const expected = new Uint8Array(width * height * 4);
      for (const [bytes, left, top] of (reset === "single" ? [[a, ax, ay]] : [[a, ax, ay], [b, bx, by]]) as [Uint8Array, number, number][]) {
        const input = decodeImage(bytes);
        for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
          if (x + left < 0 || y + top < 0 || x + left >= width || y + top >= height) continue;
          expected.set(input.data.subarray((y * input.width + x) * 4, (y * input.width + x + 1) * 4), ((y + top) * width + x + left) * 4);
        }
      }
      expect(output.data).toEqual(expected);
    });
  }
}
