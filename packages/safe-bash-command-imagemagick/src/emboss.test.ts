import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, 3x3 RGBA input, -emboss 1 -depth 8 RGBA:-.
it.each(["translucent", "transparent", "partial", "opaque", "alpha-off"])("matches native emboss with %s pixels in both execution paths", async (mode) => {
    const pixels = Uint8Array.from({ length: 36 }, (_, i) => i % 4 === 3
        ? (mode !== "opaque" && Math.floor(i / 4) === 4 ? (mode === "transparent" ? 0 : mode === "partial" ? 200 : 128) : 255)
        : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const input = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["input.png", ...(mode === "alpha-off" ? ["-alpha", "off"] : []), "-emboss", "1", "out.png"];
    const expected = mode === "transparent"
        ? [0,0,0,255,0,73,0,255,73,182,109,255,73,0,255,255,146,109,109,0,255,255,0,255,182,73,73,255,0,146,255,255,0,255,255,255]
        : mode === "partial"
        ? [0,0,0,255,0,109,0,255,36,255,73,255,109,0,255,255,109,109,255,73,255,255,0,255,255,0,0,255,0,109,255,255,0,255,255,255]
        : mode === "translucent"
        ? [0,0,0,255,0,109,0,255,73,182,109,255,109,0,255,255,146,146,0,0,255,255,0,255,255,0,0,255,0,146,255,255,0,255,255,255]
        : [0,0,0,255,0,109,0,255,0,255,0,255,109,0,255,255,109,109,255,255,255,255,0,255,255,0,0,255,0,109,255,255,0,255,255,255];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    expect(Array.from(decodeImage(files.get("out.png")!).data)).toEqual(expected);
    expect(Array.from(decodeImage(await fs.readFile("/out.png")).data)).toEqual(expected);
});

// ImageMagick 7.1.2 Q16-HDRI: 5x5 black image with a white center pixel,
// -emboss <geometry> -depth 8 gray:-.
const cases: [string, number[]][] = [
    ["0x1", [0,0,0,0,0, 0,0,0,0,0, 0,0,255,0,0, 0,0,0,0,0, 0,0,0,0,0]],
    ["0x2", [0,0,0,0,128, 0,0,0,255,0, 0,0,0,0,0, 0,255,0,0,0, 128,0,0,0,0]],
    ["1x2", [0,0,0,0,0, 0,0,0,255,0, 0,0,0,0,0, 0,255,0,0,0, 0,0,0,0,0]],
    ["2.2x2", [0,0,0,0,128, 0,0,0,255,0, 0,0,0,0,0, 0,255,0,0,0, 128,0,0,0,0]],
    ["0x0", [0,0,0,0,0, 0,0,0,0,0, 0,0,255,0,0, 0,0,0,0,0, 0,0,0,0,0]]
];
it.each(cases)("matches native emboss %s in both execution paths", async (geometry, expected) => {
    const pixels = new Uint8Array(100);
    for (let i = 0; i < 25; i++) pixels[i * 4 + 3] = 255;
    pixels.fill(255, 48, 52);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["input.png", "-emboss", geometry, "out.png"];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    const rgba = expected.flatMap(value => [value, value, value, 255]);
    expect(Array.from(decodeImage(files.get("out.png")!).data)).toEqual(rgba);
    expect(Array.from(decodeImage(await fs.readFile("/out.png")).data)).toEqual(rgba);
});

it("matches native 0x1 color and edge pixels", async () => {
    const pixels = Uint8Array.from({ length: 100 }, (_, i) => i % 4 === 3 ? 255 : i * 37 % 256);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-emboss", "0x1", "out.png"], files)).exitCode).toBe(0);
    expect((await runConvertCli(["input.png", "-emboss", "0x1", "out.png"], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect(Array.from(decodeImage(files.get("out.png")!).data)).toEqual([0, 0, 0, 255, 91, 255, 255, 255, 0, 0, 55, 255, 255, 255, 0, 255, 0, 0, 18, 255, 255, 0, 0, 255, 36, 55, 255, 255, 0, 0, 18, 255, 73, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 255, 36, 55, 73, 255, 255, 0, 0, 255, 55, 91, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 36, 55, 255, 255, 255, 0, 255, 55, 55, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 18, 255, 255, 255, 0, 255, 0, 36, 255, 255, 255, 0, 0, 255]);
});

it("matches native 0x2 color and edge pixels", async () => {
    const pixels = Uint8Array.from({ length: 100 }, (_, i) => i % 4 === 3 ? 255 : i * 37 % 256);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-emboss", "0x2", "out.png"], files)).exitCode).toBe(0);
    expect((await runConvertCli(["input.png", "-emboss", "0x2", "out.png"], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect(Array.from(decodeImage(files.get("out.png")!).data)).toEqual([255, 194, 133, 255, 143, 41, 0, 255, 214, 235, 61, 255, 0, 0, 214, 255, 153, 122, 173, 255, 71, 255, 204, 255, 143, 194, 10, 255, 214, 235, 143, 255, 71, 0, 31, 255, 143, 194, 173, 255, 51, 112, 255, 255, 122, 173, 143, 255, 0, 214, 255, 255, 51, 122, 10, 255, 133, 184, 143, 255, 41, 71, 112, 255, 235, 143, 194, 255, 0, 20, 235, 255, 51, 92, 0, 255, 0, 143, 122, 255, 112, 71, 133, 255, 235, 255, 194, 255, 0, 20, 235, 255, 214, 71, 0, 255, 51, 143, 112, 255]);
});
