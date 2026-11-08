import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        [undefined, 2, 1, 4, 4],
        ["north", 0, 1, 9, 6],
        ["east", 0, 0, 6, 7],
        ["south", 0, 0, 9, 5],
        ["west", 2, 0, 7, 7],
        ["north,east", 0, 1, 6, 6],
        ["north,east,south,west", 2, 1, 4, 4],
        ["NORTH", 0, 1, 9, 6],
        ["none", 0, 0, 9, 7],
        ["reset", 2, 1, 4, 4],
    ] as const)(`trims selected edges %s (retained=${retained})`, async (edges, left, top, width, height) => {
        const pixels = new Uint8Array(9 * 7 * 4).fill(255);
        for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) pixels.set([255, 0, 0, 255], (y * 9 + x) * 4);
        const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        const args = edges === undefined ? [] : edges === "reset" ? ["-define", "trim:edges=north", "+define", "trim:edges"] : ["-define", `trim:edges=${edges}`];
        expect((await runConvertCli(["input.png", ...args, "-trim", "out.png"], backend)).exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        const expected = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) expected.set(pixels.subarray(((y + top) * 9 + left) * 4, ((y + top) * 9 + left + width) * 4), y * width * 4);
        expect(output.data).toEqual(expected);
        expect((await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend)).stdout).toBe(`${width}x${height} +${left} +${top} 9x7`);
    });
}
