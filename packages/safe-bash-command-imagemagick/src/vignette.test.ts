import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// ImageMagick 7.1.2: 5x5 xc:red -background blue -vignette GEOMETRY, RGBA8.
it.each([
    ["5x5", "0x0", [12,204,255,255,204, 204,255,255,255,255, 255,255,255,255,255, 255,255,255,255,255, 204,255,255,255,255]],
    ["5x5", "0x1", [121,185,232,241,230, 185,220,244,249,244, 232,244,252,254,253, 241,249,254,255,255, 230,244,253,255,255]],
    ["5x5", "1x1", [108,186,245,245,228, 186,223,251,251,245, 245,251,255,255,255, 245,251,255,255,255, 228,245,255,255,255]],
    ["5x5", "0x2", [155,183,207,223,228, 183,203,221,232,237, 207,221,233,241,244, 223,232,241,247,249, 228,237,244,249,252]],
    ["7x5", "2x1+1+0", [31,98,181,233,233,186,120, 54,137,210,245,245,220,186, 70,165,231,252,252,245,233, 73,170,235,254,254,249,242, 69,163,231,253,253,244,230]]
] as const)("matches native vignette %s %s in both backends", async (size, geometry, red) => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", size, "xc:red", "-background", "blue", "-vignette", geometry, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual(size.split("x").map(Number));
        for (let i = 0; i < red.length; i++) {
            // Allow one 8-bit level for native polygon/quantum rounding.
            expect(Math.abs(image.data[i * 4]! - red[i]!)).toBeLessThanOrEqual(1);
            expect(image.data[i * 4 + 1]).toBe(0);
            expect(Math.abs(image.data[i * 4 + 2]! - (255 - red[i]!))).toBeLessThanOrEqual(1);
            expect(image.data[i * 4 + 3]).toBe(255);
        }
    }
});

it("fades into a transparent background in both backends", async () => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", "5x5", "xc:red", "-background", "none", "-vignette", "0x0", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 0, 12]);
        expect(Array.from(image.data.slice(48, 52))).toEqual([255, 0, 0, 255]);
    }
});

// Native ImageMagick 7.1.2 Q16-HDRI RGBA8 output for opaque patterned RGB input.
it.each([
    [7, 5, "0x1", [225,225,225,255,177,198,184,255,139,215,162,255,140,55,183,255,173,137,231,255,216,227,88,255,247,158,171,255,205,231,229,255,149,243,218,255,123,102,241,255,137,164,46,255,172,250,96,255,212,109,157,255,246,198,211,255,191,187,253,255,130,157,120,255,113,199,113,255,136,32,152,255,172,121,204,255,210,212,11,255,246,64,71,255,189,221,212,255,128,236,191,255,113,79,216,255,138,154,12,255,175,244,63,255,212,83,118,255,248,175,173,255,193,187,246,255,134,153,104,255,118,194,89,255,142,26,126,255,178,114,178,255,216,206,231,255,251,60,49,255]],
    [5, 5, "0x1", [142,142,142,255,109,148,120,255,106,204,135,255,135,46,180,255,174,138,232,255,216,227,88,255,241,79,103,255,30,147,137,255,62,234,187,255,101,76,239,255,142,168,55,255,172,250,95,255,206,87,142,255,242,176,194,255,25,13,247,255,71,110,56,255,101,195,101,255,135,29,151,255,171,119,203,255,208,210,0,255,246,65,73,255,36,141,112,255,65,227,160,255,100,62,212,255,137,153,9,255]],
    [7, 5, "0x0", [255,255,255,255,246,248,247,255,124,210,150,255,128,34,176,255,165,125,229,255,213,224,72,255,254,246,247,255,255,255,255,255,97,237,199,255,94,68,238,255,131,159,35,255,168,250,88,255,205,85,141,255,245,192,206,255,255,255,255,255,60,102,44,255,97,193,97,255,134,28,150,255,171,119,203,255,208,210,0,255,245,45,53,255,255,255,255,255,63,227,159,255,100,62,212,255,137,153,9,255,174,244,62,255,211,79,115,255,248,170,168,255,255,255,255,255,104,128,65,255,103,187,71,255,140,22,124,255,177,113,177,255,214,204,230,255,252,82,73,255]],
    [7, 5, "1x1", [238,238,238,255,184,203,190,255,136,214,159,255,133,43,179,255,169,130,230,255,216,227,88,255,248,169,181,255,213,235,233,255,146,243,217,255,114,91,240,255,133,160,38,255,169,250,91,255,211,106,155,255,246,197,211,255,194,191,253,255,119,148,108,255,99,194,99,255,134,28,150,255,171,119,203,255,209,211,4,255,245,53,61,255,195,224,216,255,121,235,188,255,102,65,213,255,137,153,9,255,174,244,62,255,212,82,117,255,248,173,172,255,201,195,247,255,131,150,99,255,109,190,78,255,140,22,124,255,177,113,177,255,216,206,231,255,251,62,51,255]],
    [7, 5, "0x2", [189,189,189,255,165,190,173,255,155,221,174,255,164,96,198,255,188,158,236,255,218,228,96,255,245,133,150,255,182,220,217,255,158,244,221,255,149,132,244,255,159,181,86,255,185,251,120,255,216,123,166,255,246,199,212,255,176,171,252,255,152,174,144,255,145,212,145,255,156,70,170,255,183,138,210,255,215,217,39,255,247,85,92,255,172,212,201,255,149,240,202,255,143,115,224,255,156,169,48,255,183,245,82,255,216,98,130,255,249,181,179,255,171,163,242,255,149,166,122,255,143,205,120,255,157,56,143,255,184,126,184,255,218,208,232,255,251,62,52,255]]
] as const)("matches native patterned vignette %ix%i %s exactly in both backends", async (width, height, geometry, expected) => {
    const data = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const input = encodeImage({ width, height, data, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    for (const retained of [false, true]) {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runMagickCli(["/in.png", "-vignette", geometry, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([width, height]);
        expect(Array.from(image.data)).toEqual(expected);
    }
});
