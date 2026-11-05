import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Nonzero grayscale samples from ImageMagick 7.1.2 Q16-HDRI, depth 8 RGBA output.
const cases = [
    {"op": "-distort", "method": "SRT", "args": "45", "width": 9, "height": 7, "rect": [2, 2, 6, 4], "expected": [[3, 20], [11, 33], [12, 243], [13, 162], [19, 20], [20, 243], [21, 255], [22, 255], [23, 154], [29, 162], [30, 255], [31, 255], [32, 255], [33, 162], [39, 154], [40, 255], [41, 255], [42, 243], [43, 20], [49, 162], [50, 243], [51, 33], [59, 20]]},
    {"op": "+distort", "method": "SRT", "args": "45", "width": 9, "height": 7, "rect": [2, 2, 6, 4], "expected": [[44, 20], [56, 33], [57, 243], [58, 162], [68, 20], [69, 243], [70, 255], [71, 255], [72, 154], [82, 162], [83, 255], [84, 255], [85, 255], [86, 162], [96, 154], [97, 255], [98, 255], [99, 243], [100, 20], [110, 162], [111, 243], [112, 33], [124, 20]]},
    {"op": "-distort", "method": "SRT", "args": "0.6,25", "width": 9, "height": 7, "rect": [2, 2, 6, 4], "expected": [[12, 1], [21, 153], [22, 131], [23, 30], [29, 28], [30, 233], [31, 255], [32, 233], [33, 28], [39, 30], [40, 131], [41, 153], [50, 1]]},
    {"op": "-distort", "method": "SRT", "args": "4,3,0.6,1.4,25", "width": 9, "height": 7, "rect": [2, 2, 6, 4], "expected": [[12, 112], [13, 93], [14, 16], [20, 39], [21, 255], [22, 255], [23, 193], [24, 24], [29, 144], [30, 255], [31, 255], [32, 196], [33, 2], [37, 26], [38, 236], [39, 255], [40, 255], [41, 77], [46, 11], [47, 109], [48, 202], [49, 198], [50, 5], [57, 19], [58, 33]]},
    {"op": "-distort", "method": "Barrel", "args": "0.4,0,0", "width": 31, "height": 31, "rect": [22, 13, 24, 15], "expected": [[365, 8], [366, 21], [396, 49], [397, 227], [398, 202], [399, 71], [427, 31], [428, 255], [429, 255], [430, 130], [458, 22], [459, 255], [460, 255], [461, 140], [489, 25], [490, 252], [491, 255], [492, 141], [520, 3], [521, 70], [522, 58], [523, 26]]},
    {"op": "-distort", "method": "Barrel", "args": "-0.4,0,0", "width": 31, "height": 31, "rect": [22, 13, 24, 15], "expected": [[423, 65], [424, 86], [425, 38], [454, 217], [455, 255], [456, 127], [485, 179], [486, 230], [487, 103], [516, 2], [517, 1]]}
];
it.each(cases.flatMap(test => [false, true].map(retained => ({ ...test, retained }))))(
    "matches native $op $method $args, retained=$retained",
    async ({ op, method, args, width, height, rect, expected, retained }) => {
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => {
            const x = Math.floor(i / 4) % width, y = Math.floor(i / 4 / width);
            return i % 4 === 3 || (x >= rect[0]! && x <= rect[2]! && y >= rect[1]! && y <= rect[3]!) ? 255 : 0;
        });
        const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const files = new Map([["input", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input", input);
        const result = await runConvertCli(["input", "-background", "black", op, method, args, "out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const values = new Map(expected.map(([index, value]) => [index!, value!]));
        expect([output.width, output.height]).toEqual(op === "+distort" ? [13, 13] : [width, height]);
        for (let i = 0; i < output.data.length; i += 4) {
            const gray = values.get(i / 4) ?? 0;
            expect([...output.data.slice(i, i + 4)], `pixel ${i / 4}`).toEqual([gray, gray, gray, 255]);
        }
    }
);

it.each([false, true])("filters colors with alpha, retained=%s", async retained => {
    const pixels = Uint8Array.from(Array.from({ length: 63 }, (_, i) =>
        i % 9 >= 2 && i % 9 <= 6 && Math.floor(i / 9) >= 2 && Math.floor(i / 9) <= 4
            ? [240, 60, 20, 128] : [0, 0, 255, 0]).flat());
    const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
    const files = new Map([["input", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input", input);
    expect((await runConvertCli(["input", "-distort", "SRT", "45", "out.png"], retained ? { filesystem, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    const expected = Buffer.from("000000000000000000000000f03c140a00000000000000000000000000000000000000000000000000000000f03c1411f03c147af03c14510000000000000000000000000000000000000000f03c140af03c147af03c1484f03c1488f03c144d0000000000000000000000000000000000000000f03c1451f03c1488f03c1480f03c1488f03c14510000000000000000000000000000000000000000f03c144df03c1488f03c1484f03c147af03c140a0000000000000000000000000000000000000000f03c1451f03c147af03c141100000000000000000000000000000000000000000000000000000000f03c140a000000000000000000000000", "hex");
    for (let i = 0; i < expected.length; i++) {
        // Fully transparent RGB is not visible and can be discarded by PNG encoding.
        if (i % 4 !== 3 && expected[Math.floor(i / 4) * 4 + 3] === 0) continue;
        expect(output.data[i], `channel ${i}`).toBe(expected[i]);
    }
});

it.each([false, true].flatMap(retained => ["0.000001,45", "4,3,1,0,1e30,1e30"].map(args => ({ retained, args }))))("rejects unbounded sampling $args before replacing output, retained=$retained", async ({ retained, args }) => {
    const original = new Uint8Array([1, 2, 3]), files = new Map([["out.png", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out.png", original);
    const result = await runConvertCli(["-size", "9x7", "xc:black", "-distort", "SRT", args, "out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Distortion sampling area exceeds limit");
    expect(retained ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(original);
});
