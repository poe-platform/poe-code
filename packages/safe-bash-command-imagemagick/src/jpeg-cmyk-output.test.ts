import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import jpeg from "jpeg-js";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) for (const progressive of [false, true]) {
  it(`encodes four CMYK components, retained=${retained}, progressive=${progressive}`, async () => {
    const width = 128, height = 96, data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * width + x) * 4);
    }
    const png = encodeImage({ width, height, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-colorspace", "CMYK", "-quality", "100", "-interlace", progressive ? "Plane" : "None", "-define", "jpeg:optimize-coding=true", "-define", "jpeg:restart-interval=2", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = retained ? await fs.readFile("/out.jpg") : files.get("out.jpg")!;
    expect(decodeImage(bytes)).toMatchObject({ width, height, space: "cmyk", channels: 4 });
    const decoded = jpeg.decode(bytes, { useTArray: true });
    let error = 0;
    for (let i = 0; i < data.length; i++) error += Math.abs(decoded.data[i]! - data[i]!);
    expect(error / data.length).toBeLessThan(2);
    const reverted = await runConvertCli(["grid.png", "-colorspace", "CMYK", "-colorspace", "sRGB", "rgb.jpg"], files);
    expect(reverted.exitCode, reverted.stderr).toBe(0);
    expect(decodeImage(files.get("rgb.jpg")!)).toMatchObject({ channels: 3, space: "srgb" });
  });
}

it("reports four channels from the direct encoder", () => {
  const encoded = encodeImage({ width: 1, height: 1, data: new Uint8Array([80, 120, 160, 255]), format: "raw", space: "cmyk", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "jpeg", quality: 100 });
  expect(encoded.channels).toBe(4);
  const decoded = jpeg.decode(encoded.data).data;
  for (const [index, value] of [80, 120, 160, 255].entries()) expect(Math.abs(decoded[index]! - value)).toBeLessThanOrEqual(1);
});

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
for (const progressive of [false, true]) for (const arithmetic of [false, true]) {
  it.skipIf(!nativeAvailable)(`native ImageMagick reads CMYK output, progressive=${progressive}, arithmetic=${arithmetic}`, async () => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["-size", "17x9", "xc:#5078a0", "-colorspace", "CMYK", "-interlace", progressive ? "Plane" : "None", "-define", `jpeg:arithmetic-coding=${arithmetic}`, "-define", "jpeg:restart-interval=2", "out.jpg"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    const input = files.get("out.jpg")!;
    const metadata = spawnSync("magick", ["identify", "-format", "%w %h %[colorspace]", "jpeg:-"], { input, encoding: "utf8" });
    expect(metadata.status, metadata.stderr).toBe(0);
    expect(metadata.stdout).toBe("17 9 CMYK");
    const pixels = spawnSync("magick", ["jpeg:-", "-colorspace", "sRGB", "-depth", "8", "rgb:-"], { input });
    expect(pixels.status, pixels.stderr.toString()).toBe(0);
    expect(pixels.stdout.length).toBe(17 * 9 * 3);
    for (let i = 0; i < pixels.stdout.length; i++) expect(Math.abs(pixels.stdout[i]! - [80, 120, 160][i % 3]!)).toBeLessThanOrEqual(4);
  });
}
