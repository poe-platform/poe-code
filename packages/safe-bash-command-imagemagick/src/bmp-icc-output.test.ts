import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 encoded this 3x2 RGB PNG with Ghostscript's sRGB profile.
const input = new Uint8Array(readFileSync(new URL("./fixtures/bmp-icc-tagged.png", import.meta.url)));
const icc = new Uint8Array(readFileSync(new URL("./fixtures/icc/srgb.icc", import.meta.url)));
const pixels = Uint8Array.from(Buffer.from("ff000000ff000000ffffee00991177245384", "hex"));
const cases = [
  { name: "truecolor", args: [], depth: 24, dib: 124, profile: true },
  { name: "alpha", args: ["-alpha", "set"], depth: 32, dib: 124, profile: true },
  { name: "palette", args: ["-type", "Palette"], depth: 4, dib: 124, profile: true },
  { name: "RLE", args: ["-type", "Palette", "-compress", "RLE"], depth: 8, dib: 124, profile: true },
  { name: "BMP2", args: ["-define", "bmp:format=bmp2"], depth: 24, dib: 12, profile: false },
  { name: "BMP3", args: ["-define", "bmp:format=bmp3"], depth: 24, dib: 40, profile: false },
  { name: "stripped", args: ["-strip"], depth: 24, dib: 124, profile: false },
  { name: "removed", args: ["+profile", "icc"], depth: 24, dib: 124, profile: false }
];

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each(cases)(`writes BMP ICC profiles ($name, ${mode})`, async ({ args, depth, dib, profile }) => {
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const argv = ["/input.png", ...args, "-write", "/copy.bmp", "/output.bmp"];
    const result = mode === "sync" ? runConvertCliSync(argv, files)
      : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    for (const path of ["/copy.bmp", "/output.bmp"]) {
      const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getUint32(2, true)).toBe(bytes.length);
      expect(view.getUint32(14, true)).toBe(dib);
      expect(view.getUint16(dib === 12 ? 24 : 28, true)).toBe(depth);
      if (dib === 124) {
        expect(view.getUint32(70, true)).toBe(profile ? 0x4d424544 : 0x73524742);
        const start = view.getUint32(126, true), length = view.getUint32(130, true);
        expect(length).toBe(profile ? icc.length : 0);
        if (profile) {
          // bV5ProfileData is relative to the DIB, not the file header.
          expect(start + 14).toBe(view.getUint32(10, true) + view.getUint32(34, true));
          expect(start + 14 + length).toBe(bytes.length);
          expect(bytes.subarray(start + 14, start + 14 + length)).toEqual(icc);
        } else expect(start).toBe(0);
      }
      const decoded = decodeImage(bytes);
      expect([decoded.width, decoded.height]).toEqual([3, 2]);
      expect(decoded.data.filter((_, index) => index % 4 !== 3)).toEqual(pixels);
    }
  });
}
