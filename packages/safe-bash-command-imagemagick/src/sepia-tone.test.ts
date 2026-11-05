import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2-32: 1x1 PNG input, -sepia-tone threshold, 8-bit RGB output.
for (const retained of [false, true])
it.each([
    ["blue", "0%", [255, 255, 18]],
    ["blue", "40%", [182, 164, 15]],
    ["blue", "80%", [57, 29, 24]],
    ["blue", "100%", [12, 25, 25]],
    ["#808080", "80%", [85, 85, 85]],
    ["red", "80%", [99, 67, 27]],
] as const)(`matches native sepia for %s at %s (retained=${retained})`, async (color, threshold, expected) => {
    const image = sharp({ create: { width: 1, height: 1, channels: 3, background: color } });
    const input = await (color === "#808080" ? image.grayscale() : image).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-sepia-tone", threshold, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual([...expected, 255]);
});

for (const retained of [false, true])
for (const width of [6, 6000])
it.each([
    ["0%", [255,255,0,255, 255,255,0,0, 255,255,0,255, 255,255,0,0, 255,255,0,0, 255,255,255,255]],
    ["40%", [73,43,0,255, 255,255,0,0, 167,130,0,255, 255,255,72,0, 33,8,0,0, 255,255,222,255]],
    ["80%", [29,1,0,255, 180,138,75,110, 72,38,0,255, 241,200,139,35, 12,0,0,0, 255,255,218,255]],
    ["100%", [0,6,6,255, 132,76,76,131, 22,7,7,255, 217,157,157,47, 0,6,6,0, 255,243,243,255]],
] as const)(`normalizes sepia globally at %s (width=${width}, retained=${retained})`, async (threshold, expected) => {
    // Native RGBA vectors include normalization of alpha and span retained storage chunks.
    const colors = [0,0,255,255, 128,128,128,128, 255,0,0,255, 0,255,0,64, 0,0,0,0, 255,255,255,255];
    const pixels = Uint8Array.from({ length: width * 4 }, (_, index) => colors[index % colors.length]!);
    const input = await sharp(pixels, { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-sepia-tone", threshold, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data;
    expect(output.length).toBe(pixels.length);
    expect(Math.max(...output.map((value, index) => Math.abs(value - expected[index % expected.length]!)))).toBeLessThanOrEqual(1);
});
