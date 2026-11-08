import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it(`honors grayscale quantization and setting order, retained=${retained}`, async () => {
        // ImageMagick 7.1.2: gray with two colors uses black/white, even for a single pixel.
        const source = [100, 150, 200, 255];
        const bytes = await sharp(new Uint8Array(source), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        for (const [args, expected] of [
            [["-quantize", "gray", "-colors", "2"], [255, 255, 255, 255]],
            [["-quantize", "Gray", "-colors", "3"], [143, 143, 143, 255]],
            [["-quantize", "gray", "-colors", "1"], [143, 143, 143, 255]],
            [["-quantize", "gray"], source],
            [["-colors", "2", "-quantize", "gray"], source],
            [["-quantize", "gray", "+quantize", "-colors", "2"], source],
            [["-quantize", "gray", "-quantize", "sRGB", "-colors", "2"], source],
            [["-quantize", "gray", "-colors", "3", "+quantize"], [143, 143, 143, 255]],
        ] as const) {
            const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const result = await runConvertCli(["in.png", ...args, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual(expected);
        }
    });

    it(`reduces colored pixels to a grayscale palette, retained=${retained}`, async () => {
        const bytes = await sharp(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
        const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        expect((await runConvertCli(["in.png", "-quantize", "gray", "-colors", "2", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
        expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    });

    it(`preserves grayscale and alpha across raster chunks, retained=${retained}`, async () => {
        const width = 2051, source = [100, 150, 200, 128];
        const bytes = await sharp(Uint8Array.from({ length: width * 4 }, (_, i) => source[i % 4]!), { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
        for (const colors of [2, 3]) {
            const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const filesystem = new Proxy(fs, { get(target, key) {
                if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } });
            expect((await runConvertCli(["in.png", "-quantize", "gray", "-colors", String(colors), "out.png"], retained ? { filesystem, cwd: "/" } : files)).exitCode).toBe(0);
            const pixels = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data;
            expect([...pixels]).toEqual(Array(width).fill(colors === 2 ? [255, 255, 255, 255] : [143, 143, 143, 128]).flat());
        }
    });
}

