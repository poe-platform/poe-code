import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Expected pixels verified against native ImageMagick using the same RGBA input.
for (const filesystem of [false, true]) {
  it(`keeps opaque canvases opaque after negation (filesystem=${filesystem})`, async () => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const result = await runConvertCli(["-size", "1x1", "xc:red", "xc:rgb(100,100,100)", "+append", "+negate", "/output.png"], filesystem ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = filesystem ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual([255, 0, 0, 255, 155, 155, 155, 255]);
  });
  it.each([
    { args: ["-negate"], pixel: [100, 150, 200, 160], expected: [155, 105, 55, 95] },
    { args: ["-channel", "RGB", "-negate"], pixel: [100, 150, 200, 160], expected: [155, 105, 55, 160] },
    { args: ["-channel", "RGBA", "-negate"], pixel: [100, 150, 200, 160], expected: [155, 105, 55, 95] },
    { args: ["-channel", "RGB", "+channel", "-negate"], pixel: [100, 150, 200, 160], expected: [155, 105, 55, 95] },
    { args: ["+negate"], pixel: [100, 100, 100, 160], expected: [155, 155, 155, 95] },
    { args: ["+negate"], pixel: [100, 150, 200, 160], expected: [100, 150, 200, 160] },
    { args: ["-alpha", "off", "-negate"], pixel: [100, 150, 200, 160], expected: [155, 105, 55, 255] }
  ])(`matches native negate channels (filesystem=${filesystem}): $args $pixel`, async ({ args, pixel, expected }) => {
    const bytes = await sharp(Uint8Array.from(pixel), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/input.png", bytes]]);
    const fs = new MemoryFileSystem();
    if (filesystem) await fs.writeFile("/input.png", bytes);
    const result = await runConvertCli(["/input.png", ...args, "/output.png"], filesystem ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = filesystem ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(expected);
  });
}
