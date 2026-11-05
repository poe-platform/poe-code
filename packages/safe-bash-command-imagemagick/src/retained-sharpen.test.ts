import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        ["0x1", [35, 100, 165]],
        ["0x2", [20, 100, 180]],
        ["1x1", [39, 100, 161]],
        ["2.2x1", [35, 100, 165]],
        ["0x0", [50, 100, 150]]
    ] as const)(`matches native opaque sharpen %s (retained=${retained})`, async (geometry, values) => {
        const pixels = Uint8Array.from([50, 100, 150].flatMap(value => [value, value, value, 255]));
        const input = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        expect((await runConvertCli(["input.png", "-sharpen", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
    });
}

for (const retained of [false, true]) {
    it(`matches native two-dimensional color sharpening (retained=${retained})`, async () => {
        const pixels = Uint8Array.from(Array.from({ length: 9 }, (_, i) => {
            const x = i % 3, y = Math.floor(i / 3);
            return [30 + 30 * x + 10 * y, 200 - 40 * x - 20 * y, 20 + 20 * x + 50 * y, 255];
        }).flat());
        const input = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file sharpen I/O forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        expect((await runConvertCli(["input.png", "-sharpen", "0x1", "out.png"], retained ? { filesystem, cwd: "/" } : files)).exitCode).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        // ImageMagick 7 opaque RGB output, including clipping at zero.
        expect(output.data).toEqual(Uint8Array.from([
            18, 219, 0, 255, 57, 166, 25, 255, 96, 114, 51, 255,
            31, 192, 64, 255, 70, 140, 90, 255, 109, 88, 116, 255,
            44, 166, 129, 255, 83, 114, 155, 255, 122, 61, 182, 255
        ]));
    });
}
