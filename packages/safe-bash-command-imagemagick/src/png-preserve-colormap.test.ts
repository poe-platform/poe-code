import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABAgMAAACEUudeAAAADFBMVEUA/wD/AAAAAP///wCVJGcZAAAACklEQVR4nGO4BAAA1ADTqstRPwAAAABJRU5ErkJggg==", "base64");
function chunks(bytes: Uint8Array, name: string): Buffer {
  const parts: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    if (Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString() === name) parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return Buffer.concat(parts);
}
for (const retained of [false, true]) {
  for (const write of [false, true]) {
    it(`preserves PNG palette order, depth and indices, retained=${retained}, write=${write}`, async () => {
      const files = new Map([["/input.png", source]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", source);
      const result = await runConvertCli(["/input.png", "-define", "png:preserve-colormap=true", ...(write ? ["-write", "/out.png", "null:"] : ["/out.png"])], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const bytes = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
      expect(Array.from(bytes.subarray(24, 26))).toEqual([2, 3]);
      expect(chunks(bytes, "PLTE")).toEqual(chunks(source, "PLTE"));
      expect(Array.from(inflateSync(chunks(bytes, "IDAT")))).toEqual([0, 0xd2]);
      expect(decodeImage(bytes).data).toEqual(decodeImage(source).data);
    });
  }
}

// Includes unused entries, duplicate RGB entries and distinct alpha values.
const duplicatePalette = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAAD1BMVEUA/wD/AAAA/wAAAP///wCTbbcxAAAABXRSTlP/gP8A/3bMrGYAAAANSURBVHicY2BiZGAGAAATAAco2/rWAAAAAElFTkSuQmCC", "base64");
for (const retained of [false, true]) {
  it(`retains duplicate and unused entries, transparency and original depth, retained=${retained}`, async () => {
    const files = new Map([["/input.png", duplicatePalette]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", duplicatePalette);
    const result = await runConvertCli(["/input.png", "-define", "png:preserve-colormap", "png:-"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = result.stdoutBytes!;
    expect(Array.from(bytes.subarray(24, 26))).toEqual([8,3]);
    expect(chunks(bytes, "PLTE")).toEqual(chunks(duplicatePalette, "PLTE"));
    expect(chunks(bytes, "tRNS")).toEqual(chunks(duplicatePalette, "tRNS"));
    expect(Array.from(inflateSync(chunks(bytes, "IDAT")))).toEqual([0,2,1,0,3]);
    expect(decodeImage(bytes).data).toEqual(decodeImage(duplicatePalette).data);
  });
  it.each([{ options: [] }, { options: ["-define", "png:preserve-colormap=false"] }, { options: ["-define", "png:preserve-colormap", "+define", "png:preserve-colormap"] }])(`keeps ordinary encoding without the enabled define, retained=${retained}, args=$options`, async ({ options }) => {
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", ...options, "png:-"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(chunks(result.stdoutBytes!, "PLTE")).not.toEqual(chunks(source, "PLTE"));
    expect(decodeImage(result.stdoutBytes!).data).toEqual(decodeImage(source).data);
  });
  it(`captures the define at write and falls back safely after color edits, retained=${retained}`, async () => {
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", "-define", "png:preserve-colormap", "-write", "/preserved.png", "-negate", "png:-"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const preserved = retained ? await fs.readFile("/preserved.png") : files.get("/preserved.png")!;
    expect(chunks(preserved, "PLTE")).toEqual(chunks(source, "PLTE"));
    expect(Array.from(decodeImage(result.stdoutBytes!).data)).toEqual(Array.from(decodeImage(source).data, (value, index) => index % 4 === 3 ? value : 255 - value));
  });
}
