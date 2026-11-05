import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
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
