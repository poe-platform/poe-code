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

function inspect(bytes: Uint8Array) {
  let interval = 0;
  const scans: number[][] = [];
  for (let i = 2; i < bytes.length;) {
    expect(bytes[i++]).toBe(255);
    const marker = bytes[i++]!;
    if (marker === 0xd9) break;
    const length = bytes[i]! * 256 + bytes[i + 1]!;
    if (marker === 0xdd) interval = bytes[i + 2]! * 256 + bytes[i + 3]!;
    i += length;
    if (marker !== 0xda) continue;
    const restarts: number[] = [];
    scans.push(restarts);
    while (i < bytes.length) {
      if (bytes[i++] !== 255) continue;
      if (bytes[i] === 0) { i++; continue; }
      if (bytes[i]! >= 0xd0 && bytes[i]! <= 0xd7) { restarts.push(bytes[i++]!); continue; }
      i--;
      break;
    }
  }
  return { interval, scans };
}

for (const retained of [false, true]) for (const progressive of [false, true]) for (const quality of [80, 92]) {
  it(`places restart markers between scan units, retained=${retained}, progressive=${progressive}, quality=${quality}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-quality", String(quality), "-interlace", progressive ? "Plane" : "None", "-define", "jpeg:restart-interval=2", "-write", "restart.jpg", "-define", "jpeg:restart-interval=0", "-write", "zero.jpg", "-define", "jpeg:restart-interval=2", "+define", "jpeg:restart-interval", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const [restart, zero, reset] = await Promise.all(["restart.jpg", "zero.jpg", "out.jpg"].map(path => retained ? fs.readFile(`/${path}`) : files.get(path)!));
    const inspected = inspect(restart!);
    expect(inspected.interval).toBe(2);
    const units = quality < 90 ? 48 : 192;
    expect(inspected.scans.map(scan => scan.length)).toEqual(progressive ? [units / 2 - 1, 95, units / 2 - 1, units / 2 - 1] : [units / 2 - 1]);
    for (const scan of inspected.scans) expect(scan).toEqual(scan.map((_, index) => 0xd0 + index % 8));
    // The decoder checks that each marker occurs at the declared MCU boundary.
    expect(decodeImage(restart!).data).toEqual(decodeImage(zero!).data);
    expect(reset).toEqual(zero);
    expect(inspect(zero!).interval).toBe(0);
    expect(inspect(zero!).scans.every(scan => scan.length === 0)).toBe(true);
  });
}
