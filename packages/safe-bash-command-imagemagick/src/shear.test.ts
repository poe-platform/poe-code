import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import fixtures from "./shear-fixtures.json" with { type: "json" };
import alphaFixtures from "./shear-alpha-fixtures.json" with { type: "json" };
import { runConvertCli } from "./index.js";

// Full pixel fixtures generated with ImageMagick 7.1.2-31 Q16-HDRI, raw RGBA input/output at depth 8.
const cases = [
    { geometry: "0x-20", width: 9, height: 10, pixels: [] },
    { geometry: "15x-20", width: 11, height: 11, pixels: [] },
    { geometry: "30x-20", width: 13, height: 12, pixels: [] },
    { geometry: "15x20", width: 11, height: 10, pixels: [] },
    { geometry: "-15x20", width: 11, height: 11, pixels: [] },
    { geometry: "-15x-20", width: 11, height: 10, pixels: [] },
    { geometry: "15.5x-20.5", width: 11, height: 11, pixels: [] },
    { geometry: "45x45", width: 16, height: 9, pixels: [[5, 1, 0], [8, 4, 255], [1, 7, 255]] },
    { geometry: "30x20", width: 13, height: 9, pixels: [[5, 1, 0], [6, 4, 255], [11, 1, 255]] },
    { geometry: "-30x20", width: 13, height: 12, pixels: [[2, 2, 0], [6, 5, 255], [11, 2, 255]] },
    { geometry: "45x0", width: 16, height: 7, pixels: [] },
    { geometry: "0x45", width: 9, height: 16, pixels: [] },
    { geometry: "0x0", width: 9, height: 7, pixels: [] }
];

it.each(cases.flatMap(test => [false, true].map(retained => ({ ...test, retained }))))(
    "shears $geometry sequentially, retained=$retained",
    async ({ geometry, width, height, pixels, retained }) => {
        const data = Uint8Array.from({ length: 9 * 7 * 4 }, (_, i) => {
            const x = Math.floor(i / 4) % 9, y = Math.floor(i / 36);
            return i % 4 === 3 || (x >= 2 && x <= 6 && y >= 2 && y <= 4) ? 255 : 0;
        });
        const input = await sharp(data, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        expect((await runConvertCli(["input", "-background", "white", "-shear", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        for (const [x, y, value] of pixels) {
            const offset = (y! * width + x!) * 4;
            expect(Array.from(output.data.slice(offset, offset + 4))).toEqual([value, value, value, 255]);
        }
        expect(Array.from(output.data)).toEqual(fixtures[geometry as keyof typeof fixtures].flatMap(value => [value, value, value, 255]));
        if (geometry === "0x0") expect(output.data).toEqual(data);
    }
);

it.each(alphaFixtures.flatMap(test => [false, true].map(retained => ({ ...test, retained }))))(
    "matches native RGBA shear $geometry on $width x $height, retained=$retained",
    async ({ width, height, geometry, background, rgba, retained }) => {
        const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256);
        const input = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        expect((await runConvertCli(["input", "-background", background, "-shear", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(output.data)).toEqual(Array.from(Buffer.from(rgba, "base64")));
    }
);
