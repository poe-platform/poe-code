import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        [[], [], "3x3 +1 +1 5x5"],
        [[], ["+repage"], "3x3 +0 +0 3x3"],
        [["-repage", "8x9-2+3"], [], "3x3 -1 +4 5x5"],
        [["-repage", "8x9-2+3"], ["+repage"], "3x3 +0 +0 3x3"],
    ])("preserves trim page geometry with %j then %j (retained=" + retained + ")", async (before, after, expected) => {
        const pixels = new Uint8Array(5 * 5 * 4).fill(255);
        for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
            pixels.set([255, 0, 0, 255], (y * 5 + x) * 4);
        }
        const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runConvertCli(["input.png", ...before, "-trim", ...after, "out.png"], backend)).exitCode).toBe(0);
        const result = await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(expected);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(output.data).toEqual(new Uint8Array(Array.from({ length: 9 }, () => [255, 0, 0, 255]).flat()));
    });

    for (const background of ["white", "black", "red", "transparent"]) {
        it(`trims uniform ${background} to transparent white (retained=${retained})`, async () => {
            const input = await sharp({ create: { width: 5, height: 5, channels: 4, background } }).png().toBuffer();
            const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const result = await runConvertCli(["input.png", "-trim", "+repage", "out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual([1, 1]);
            expect(output.hasAlpha).toBe(true);
            expect(output.data).toEqual(new Uint8Array([255, 255, 255, 0]));
        });
    }
    for (const [cornerX, cornerY] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const)
    for (const fuzz of ["0%", "0.5%"]) {
        it(`trims a one-level corner difference (retained=${retained}, fuzz=${fuzz}, corner=${cornerX},${cornerY})`, async () => {
            // Native: -size 5x5 xc:white -fill '#fefefe' -draw 'point 0,0'
            // -fill red -draw 'rectangle 1,1 3,3' -fuzz FUZZ -trim +repage
            const pixels = new Uint8Array(5 * 5 * 4).fill(255);
            const corner = (cornerY * 5 + cornerX) * 4;
            pixels.fill(254, corner, corner + 3);
            for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
                pixels.set([255, 0, 0, 255], (y * 5 + x) * 4);
            }
            const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
            const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const result = await runConvertCli(["input.png", "-fuzz", fuzz, "-trim", "+repage", "out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            const size = fuzz === "0%" ? 4 : 3;
            const left = fuzz === "0%" && cornerX === 0 ? 0 : 1, top = fuzz === "0%" && cornerY === 0 ? 0 : 1;
            expect([output.width, output.height]).toEqual([size, size]);
            const expected = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) expected.set(pixels.subarray(((y + top) * 5 + left) * 4, ((y + top) * 5 + left + size) * 4), y * size * 4);
            expect(output.data).toEqual(expected);
        });
    }
}

for (const retained of [false, true]) for (const fuzz of ["0%", "1%"]) {
    it(`trims sub-byte Q16 differences (retained=${retained}, fuzz=${fuzz})`, async () => {
        const data16 = new Uint16Array(9 * 7 * 4);
        for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) {
            const value = x >= 2 && x <= 5 && y >= 1 && y <= 4 ? 0x4020 : 0x4000;
            data16.set([value, value, value, 65535], (y * 9 + x) * 4);
        }
        const input = encodeImage({ width: 9, height: 7, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 3, depth: "ushort", density: 72, hasAlpha: false,
        }, { format: "png" }).data;
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runConvertCli(["input.png", "-fuzz", fuzz, "-trim", "out.png"], backend)).exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        if (fuzz === "0%") {
            expect([output.width, output.height]).toEqual([4, 4]);
            expect(output.data16).toEqual(Uint16Array.from(Array.from({ length: 16 }, () => [0x4020, 0x4020, 0x4020, 65535]).flat()));
            expect((await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend)).stdout).toBe("4x4 +2 +1 9x7");
        } else {
            expect([output.width, output.height]).toEqual([1, 1]);
            expect(output.data).toEqual(new Uint8Array([255, 255, 255, 0]));
        }
    });
}
