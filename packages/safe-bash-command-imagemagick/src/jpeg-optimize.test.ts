import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const width = 128, height = 96;
const data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * width + x) * 4);
}
const png = encodeImage({ width, height, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

function tableSize(bytes: Uint8Array) {
  let size = 0;
  for (let i = 2; i < bytes.length;) {
    const marker = bytes[i + 1]!;
    const length = bytes[i + 2]! * 256 + bytes[i + 3]!;
    if (marker === 0xc4) size += length - 2;
    if (marker === 0xda) break;
    i += length + 2;
  }
  return size;
}

for (const restart of [0, 2]) for (const retained of [false, true]) for (const progressive of [false, true]) {
  it(`optimizes Huffman tables without changing pixels, restart=${restart}, retained=${retained}, progressive=${progressive}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-interlace", progressive ? "Plane" : "None", "-define", `jpeg:restart-interval=${restart}`, "-define", "jpeg:optimize-coding=true", "-write", "optimized.jpg", "-define", "jpeg:optimize-coding=false", "-write", "standard.jpg", "-define", "jpeg:optimize-coding=true", "+define", "jpeg:optimize-coding", "reset.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const [optimized, standard, reset] = await Promise.all(["optimized.jpg", "standard.jpg", "reset.jpg"].map(path => retained ? fs.readFile(`/${path}`) : files.get(path)!));
    expect(tableSize(standard!)).toBe(416);
    expect(tableSize(optimized!)).toBeLessThan(416);
    expect(optimized!.length).toBeLessThan(standard!.length);
    expect(decodeImage(optimized!).data).toEqual(decodeImage(standard!).data);
    expect(reset).toEqual(standard);
  });
}
