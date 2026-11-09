import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCli } from "./index.js";

for (const retained of [false, true]) for (const depth of [8, 16]) {
    it.each([
        { name: "black percentage background", args: ["-define", "trim:percent-background=50%", "-define", "trim:background-color=black"], cropped: false },
        { name: "white percentage background", args: ["-define", "trim:percent-background=50%", "-define", "trim:background-color=white"], cropped: true },
        { name: "plain trim", args: [], cropped: true },
        { name: "black background without percentage", args: ["-define", "trim:background-color=black"], cropped: true },
        { name: "reset background", args: ["-define", "trim:percent-background=50%", "-define", "trim:background-color=black", "+define", "trim:background-color"], cropped: true },
        { name: "reset percentage", args: ["-define", "trim:percent-background=50%", "-define", "trim:background-color=black", "+define", "trim:percent-background"], cropped: true },
    ])(`honors $name (retained=${retained}, depth=${depth})`, async ({ args, cropped }) => {
        const pixels = new Uint8Array(9 * 7 * 4).fill(255);
        for (let y = 2; y < 5; y++) for (let x = 2; x < 7; x++) pixels.set([255, 0, 0, 255], (y * 9 + x) * 4);
        const input = encodeImage({ width: 9, height: 7, data: pixels,
            ...(depth === 16 ? { data16: Uint16Array.from(pixels, value => value * 257) } : {}),
            format: "png", space: "srgb", channels: 3, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: false,
        }, { format: "png" }).data;
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        const result = await runConvertCli(["input.png", ...args, "-trim", "out.png"], backend);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const width = cropped ? 5 : 9, height = cropped ? 3 : 7, offset = cropped ? 2 : 0;
        expect([output.width, output.height]).toEqual([width, height]);
        const expected = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) expected.set(pixels.subarray(((y + offset) * 9 + offset) * 4, ((y + offset) * 9 + offset + width) * 4), y * width * 4);
        expect(output.data).toEqual(expected);
        expect((await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend)).stdout).toBe(`${width}x${height} +${offset} +${offset} 9x7`);
    });
}
