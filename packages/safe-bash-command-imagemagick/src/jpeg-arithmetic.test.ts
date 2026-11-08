import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const width = 33, height = 25;
const data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * width + x) * 4);
}
const image = { width, height, data, format: "raw" as const, space: "srgb" as const, channels: 3 as const, depth: "uchar" as const, density: 72, hasAlpha: false };
const png = encodeImage(image, { format: "png" }).data;

function markers(bytes: Uint8Array) {
  const result: number[] = [];
  for (let i = 2; i < bytes.length;) {
    expect(bytes[i++]).toBe(255);
    const marker = bytes[i++]!;
    result.push(marker);
    if (marker === 0xd9) break;
    i += bytes[i]! * 256 + bytes[i + 1]!;
    if (marker !== 0xda) continue;
    while (i < bytes.length) {
      if (bytes[i++] !== 255) continue;
      if (bytes[i] === 0 || (bytes[i]! >= 0xd0 && bytes[i]! <= 0xd7)) { i++; continue; }
      i--; break;
    }
  }
  return result;
}

for (const retained of [false, true]) for (const progressive of [false, true]) for (const restart of [0, 2]) {
  it(`honors arithmetic coding and resets at each write, retained=${retained}, progressive=${progressive}, restart=${restart}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-define", `jpeg:restart-interval=${restart}`, "-define", "jpeg:optimize-coding=true", "-interlace", progressive ? "Plane" : "None", "-define", "jpeg:arithmetic-coding=true", "-write", "arithmetic.jpg", "-define", "jpeg:arithmetic-coding=false", "-write", "huffman.jpg", "-define", "jpeg:arithmetic-coding=true", "+define", "jpeg:arithmetic-coding", "-write", "reset.jpg", "-define", "jpeg:arithmetic-coding=TRUE", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const [arithmetic, huffman, reset, final] = await Promise.all(["arithmetic.jpg", "huffman.jpg", "reset.jpg", "out.jpg"].map(path => retained ? fs.readFile(`/${path}`) : files.get(path)!));
    expect(markers(arithmetic!)).toContain(progressive ? 0xca : 0xc9);
    expect(markers(arithmetic!)).toContain(0xcc);
    expect(markers(arithmetic!)).not.toContain(0xc4);
    expect(markers(huffman!)).toContain(progressive ? 0xc2 : 0xc0);
    expect(markers(huffman!)).toContain(0xc4);
    expect(reset).toEqual(huffman);
    expect(final).toEqual(arithmetic);
  });
}
