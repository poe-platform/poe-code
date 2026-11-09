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

// Native ImageMagick 7.1.2-31 Q16-HDRI, 6x6 patterned RGB, 8-bit RGBA output.
for (const retained of [false, true])
for (const percentage of [false, true])
it.each([
    ["20%", [98, 59, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 62, 255, 255, 255, 0, 255, 255, 255, 0, 255, 181, 137, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 38, 255, 255, 255, 0, 255, 255, 255, 0, 255, 152, 109, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 245, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255]],
    ["40%", [44, 12, 0, 255, 249, 207, 0, 255, 255, 255, 17, 255, 183, 139, 0, 255, 255, 255, 0, 255, 255, 255, 87, 255, 248, 205, 0, 255, 255, 255, 0, 255, 255, 255, 69, 255, 235, 192, 0, 255, 255, 255, 0, 255, 255, 255, 139, 255, 255, 253, 0, 255, 255, 255, 68, 255, 80, 43, 0, 255, 241, 198, 0, 255, 255, 255, 5, 255, 169, 125, 0, 255, 255, 255, 0, 255, 255, 255, 75, 255, 240, 196, 0, 255, 255, 243, 0, 255, 255, 255, 57, 255, 225, 181, 0, 255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 241, 0, 255, 255, 255, 56, 255, 66, 31, 0, 255, 232, 188, 0, 255, 255, 255, 0, 255, 154, 111, 0, 255, 255, 255, 0, 255, 255, 255, 108, 255, 230, 187, 0, 255, 255, 231, 0, 255]],
    ["60%", [28, 0, 0, 255, 176, 132, 0, 255, 255, 249, 83, 255, 115, 75, 0, 255, 248, 206, 36, 255, 255, 255, 130, 255, 174, 130, 0, 255, 214, 170, 0, 255, 255, 255, 118, 255, 160, 116, 0, 255, 251, 209, 41, 255, 255, 255, 165, 255, 213, 169, 0, 255, 255, 255, 117, 255, 50, 17, 0, 255, 166, 122, 0, 255, 255, 241, 75, 255, 105, 65, 0, 255, 243, 200, 28, 255, 255, 255, 122, 255, 164, 121, 0, 255, 206, 162, 0, 255, 255, 255, 110, 255, 150, 107, 0, 255, 246, 204, 33, 255, 255, 255, 157, 255, 205, 161, 0, 255, 255, 255, 109, 255, 42, 10, 0, 255, 156, 113, 0, 255, 255, 233, 67, 255, 95, 56, 0, 255, 237, 194, 20, 255, 255, 255, 144, 255, 154, 111, 0, 255, 198, 153, 0, 255]],
    ["80%", [23, 0, 0, 255, 137, 92, 25, 255, 242, 197, 128, 255, 88, 48, 0, 255, 209, 162, 91, 255, 255, 227, 161, 255, 135, 91, 24, 255, 172, 125, 55, 255, 255, 218, 152, 255, 123, 80, 14, 255, 213, 166, 96, 255, 255, 255, 189, 255, 170, 124, 54, 255, 255, 217, 151, 255, 39, 6, 0, 255, 128, 84, 18, 255, 238, 192, 123, 255, 80, 41, 0, 255, 202, 155, 85, 255, 255, 221, 155, 255, 127, 83, 17, 255, 164, 118, 48, 255, 255, 211, 145, 255, 115, 72, 8, 255, 207, 160, 89, 255, 255, 249, 183, 255, 163, 116, 47, 255, 255, 211, 145, 255, 33, 2, 0, 255, 120, 77, 12, 255, 233, 186, 117, 255, 73, 34, 0, 255, 196, 148, 78, 255, 255, 238, 172, 255, 119, 76, 11, 255, 156, 110, 41, 255]],
    ["100%", [0, 4, 4, 255, 94, 29, 29, 255, 237, 164, 164, 255, 39, 5, 5, 255, 191, 116, 116, 255, 255, 205, 205, 255, 92, 28, 28, 255, 139, 68, 68, 255, 255, 193, 193, 255, 78, 16, 16, 255, 196, 122, 122, 255, 255, 240, 240, 255, 137, 66, 66, 255, 255, 192, 192, 255, 0, 4, 4, 255, 84, 21, 21, 255, 231, 157, 157, 255, 32, 5, 5, 255, 181, 107, 107, 255, 255, 197, 197, 255, 82, 20, 20, 255, 129, 59, 59, 255, 255, 185, 185, 255, 68, 9, 9, 255, 187, 113, 113, 255, 255, 232, 232, 255, 127, 57, 57, 255, 254, 184, 184, 255, 0, 4, 4, 255, 74, 13, 13, 255, 224, 150, 150, 255, 25, 5, 5, 255, 172, 98, 98, 255, 255, 219, 219, 255, 73, 12, 12, 255, 118, 50, 50, 255]],
] as const)(`matches native patterned sepia at %s (retained=${retained}, percentage=${percentage})`, async (threshold, expected) => {
    const pixels = Uint8Array.from({ length: 6 * 6 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const input = await sharp(pixels, { raw: { width: 6, height: 6, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-sepia-tone", percentage ? threshold : String(parseFloat(threshold) * 65536 / 100), "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected);
});

for (const retained of [false, true])
for (const width of [3, 6000])
it.each([
    ["R", [0,98,50,40, 8,98,51,120, 255,127,76,200]],
    ["G", [141,0,54,40, 142,9,55,120, 161,255,76,200]],
    ["B", [141,106,0,40, 142,107,9,120, 161,127,255,200]],
    ["RGB", [0,0,0,40, 4,4,5,120, 255,255,255,200]],
    ["RGB,Sync", [0,0,0,40, 4,4,5,120, 255,255,255,200]],
    ["A", [141,106,54,0, 142,107,55,128, 170,134,80,255]],
    ["RGBA", [0,0,0,0, 4,4,5,128, 255,255,255,255]],
    ["RGBA,Sync", [0,0,0,0, 4,4,5,128, 255,255,255,255]],
] as const)(`matches native sepia channel %s (width=${width}, retained=${retained})`, async (channel, expected) => {
    // ImageMagick 7.1.2-31 Q16-HDRI: independent normalization of selected channels.
    const colors = [32,96,160,40, 192,64,16,120, 80,112,176,200];
    const pixels = Uint8Array.from({ length: width * 4 }, (_, index) => colors[index % colors.length]!);
    const input = await sharp(pixels, { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const result = await runConvertCli(["input.png", "-channel", channel, "-sepia-tone", "80%", "+channel", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data;
    expect(output.length).toBe(pixels.length);
    // Independent Q16 histogram rounding can differ by one output byte.
    expect(Math.max(...output.map((value, index) => Math.abs(value - expected[index % expected.length]!)))).toBeLessThanOrEqual(channel.startsWith("RGB") ? 1 : 0);
});
