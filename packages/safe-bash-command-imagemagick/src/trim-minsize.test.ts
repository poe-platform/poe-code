import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        [[], 4, 4, 2, 1],
        [["-define", "trim:minSize=7x5"], 7, 5, 2, 1],
        [["-define", "trim:minSize=8x6"], 8, 6, 1, 1],
        [["-define", "trim:minSize=20x20"], 9, 7, 0, 0],
        [["-define", "trim:minSize=2x2"], 4, 4, 2, 1],
        [["-define", "trim:minSize=7"], 7, 4, 2, 1],
        [["-define", "trim:minSize=x6"], 4, 6, 2, 1],
        [["-define", "trim:minSize=7x5", "+define", "trim:minSize"], 4, 4, 2, 1],
    ] as const)(`retains minimum trim dimensions and source margins (retained=${retained}, %j)`, async (options, width, height, left, top) => {
        const pixels = new Uint8Array(9 * 7 * 4).fill(255);
        for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) pixels.set([255, 0, 0, 255], (y * 9 + x) * 4);
        const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runConvertCli(["input.png", ...options, "-trim", "out.png"], backend)).exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect((await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend)).stdout).toBe(`${width}x${height} +${left} +${top} 9x7`);
        const expected = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) expected.set(pixels.subarray(((y + top) * 9 + left) * 4, ((y + top) * 9 + left + width) * 4), y * width * 4);
        expect(output.data).toEqual(expected);
    });
}
