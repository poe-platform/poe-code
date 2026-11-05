import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
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
