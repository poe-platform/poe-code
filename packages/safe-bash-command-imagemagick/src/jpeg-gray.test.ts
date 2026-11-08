import { expect, it } from "vitest";
import jpeg from "jpeg-js";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) for (const progressive of [false, true]) for (const optimize of [false, true]) {
  it(`writes one grayscale component, retained=${retained}, progressive=${progressive}, optimize=${optimize}`, async () => {
    const width = 33, height = 19, data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * width + x) * 4);
    }
    const png = encodeImage({ width, height, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-colorspace", "Gray", "-interlace", progressive ? "Plane" : "None", "-define", `jpeg:optimize-coding=${optimize}`, "-define", "jpeg:restart-interval=2", "-write", "gray.png", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = retained ? await fs.readFile("/out.jpg") : files.get("out.jpg")!;
    let frame: Uint8Array | undefined;
    for (let i = 2; i < bytes.length;) {
      const marker = bytes[i + 1]!, length = bytes[i + 2]! * 256 + bytes[i + 3]!;
      if (marker === (progressive ? 0xc2 : 0xc0)) frame = bytes.subarray(i + 4, i + 2 + length);
      if (marker === 0xda) break;
      i += length + 2;
    }
    expect(frame?.length).toBe(9);
    expect(frame?.[5]).toBe(1);
    expect(frame?.[7]).toBe(0x11);
    const decoded = jpeg.decode(bytes, { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([width, height]);
    const gray = decodeImage(retained ? await fs.readFile("/gray.png") : files.get("gray.png")!);
    let error = 0;
    for (let i = 0; i < decoded.data.length; i += 4) {
      expect(decoded.data[i]).toBe(decoded.data[i + 1]);
      expect(decoded.data[i]).toBe(decoded.data[i + 2]);
      error += Math.abs(decoded.data[i]! - gray.data[i]!);
    }
    expect(error / (width * height)).toBeLessThan(6);
    expect(decodeImage(bytes)).toMatchObject({ space: "b-w", channels: 1 });
  });
}
