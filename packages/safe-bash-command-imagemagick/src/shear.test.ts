import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Dimensions and interior pixels from ImageMagick 7's sequential X/Y shear.
const cases = [
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
        if (geometry === "0x0") expect(output.data).toEqual(data);
    }
);
