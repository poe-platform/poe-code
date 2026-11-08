import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const data = Uint8Array.from({ length: 23 * 19 * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * 3 + i % 4) % 256);
const input = encodeImage({ width: 23, height: 19, channels: 3, hasAlpha: false, space: "srgb", format: "raw", depth: "uchar", density: 72, data }, { format: "tiff", tiffRowsPerStrip: 5 }).data;

// Inspect the on-disk BigTIFF layout independently of the image-ast decoder.
function inspect(bytes: Uint8Array, little: boolean, pages: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(Array.from(bytes.subarray(0, 8))).toEqual(little ? [73, 73, 43, 0, 8, 0, 0, 0] : [77, 77, 0, 43, 0, 8, 0, 0]);
  let offset = Number(view.getBigUint64(8, little));
  for (let page = 0; page < pages; page++) {
    expect(offset % 8).toBe(0);
    const count = Number(view.getBigUint64(offset, little)), tags = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const at = offset + 8 + i * 20, tag = view.getUint16(at, little), type = view.getUint16(at + 2, little), length = Number(view.getBigUint64(at + 4, little));
      const size = type === 3 ? 2 : type === 4 ? 4 : 8;
      const start = size * length <= 8 ? at + 12 : Number(view.getBigUint64(at + 12, little));
      tags.set(tag, Array.from({ length }, (_, j) => size === 2 ? view.getUint16(start + j * size, little) : size === 4 ? view.getUint32(start + j * size, little) : Number(view.getBigUint64(start + j * size, little))));
    }
    expect(tags.get(256)).toEqual([23]);
    expect(tags.get(257)).toEqual([19]);
    expect(tags.get(258)).toEqual([8, 8, 8]);
    const pixels = tags.get(273)!.flatMap((at, i) => Array.from(bytes.subarray(at, at + tags.get(279)![i]!)));
    expect(pixels).toEqual(Array.from(data).filter((_, i) => i % 4 !== 3));
    offset = Number(view.getBigUint64(offset + 8 + count * 20, little));
  }
  expect(offset).toBe(0);
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const little of [true, false]) {
    it(`writes TIFF64 at the requested path (${mode}, little=${little})`, async () => {
      const files = new Map([["in.tif", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/in.tif", input);
      const args = ["in.tif", "in.tif", "-define", `tiff:endian=${little ? "lsb" : "msb"}`, "-define", "tiff:rows-per-strip=5", "-write", "TIFF64:copy.tif", "TIFF64:out.tif"];
      const result = mode === "command" ? await createMagickCommand().execute({command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write() {}}, stderr: {async write() {}}}) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? {filesystem: fs, cwd: "/"} : files);
      expect(result.exitCode).toBe(0);
      for (const name of ["copy.tif", "out.tif"]) {
        const output = mode === "retained" || mode === "command" ? await fs.readFile(`/${name}`) : files.get(name);
        expect(output, `missing ${name}; files: ${[...files.keys()]}`).toBeDefined();
        inspect(output!, little, 2);
      }
    });
  }
}
