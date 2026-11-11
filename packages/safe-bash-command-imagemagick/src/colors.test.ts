import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) for (const dither of [[], ["+dither"], ["-dither", "None"]]) {
    it(`matches native two-color saturated and grayscale palettes, retained=${retained}, dither=${dither.join(" ")}`, async () => {
        // ImageMagick 7.1.2: 2x2 RGBA input, -colors 2 -depth 8 rgba:-.
        for (const [source, expected] of [
            [[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
                [85, 85, 85, 255, 85, 85, 85, 255, 85, 85, 85, 255, 255, 255, 255, 255]],
            [[255, 255, 255, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255],
                [255, 255, 255, 255, 85, 85, 85, 255, 85, 85, 85, 255, 85, 85, 85, 255]],
            [[0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255],
                [43, 43, 43, 255, 43, 43, 43, 255, 213, 213, 213, 255, 213, 213, 213, 255]]
        ] as const) {
            const bytes = await sharp(Uint8Array.from(source), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
            const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const result = await runConvertCli(["in.png", ...dither, "-colors", "2", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual(expected);
        }
    });
}

for (const retained of [false, true]) {
    for (const dither of [[], ["-dither", "None"]]) {
        it(`bounds the whole palette, retained=${retained}, dither=${dither.join(" ")}`, async () => {
            // Native: magick -size 3x1 xc:red -fill green -draw 'point 1,0'
            // -fill blue -draw 'point 2,0' -dither None -colors 2 -depth 8 rgba:-
            const source = [255, 0, 0, 255, 0, 128, 0, 255, 0, 0, 255, 255];
            for (const width of [3, 12003]) {
                const bytes = await sharp(Uint8Array.from({ length: width * 4 }, (_, i) => source[i % 12]!), { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
                for (const colors of [1, 2, 3, 8]) {
                    const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
                    await fs.writeFile("/in.png", bytes);
                    const filesystem = new Proxy(fs, { get(target, key) {
                        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
                        const value = Reflect.get(target, key, target);
                        return typeof value === "function" ? value.bind(target) : value;
                    } });
                    const result = await runConvertCli(["in.png", ...dither, "-colors", String(colors), "out.png"], retained ? { filesystem, cwd: "/" } : files);
                    expect(result.exitCode).toBe(0);
                    const pixels = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data;
                    const palette = new Set<string>();
                    for (let i = 0; i < pixels.length; i += 4) palette.add([...pixels.subarray(i, i + 4)].join(","));
                    expect(palette.size).toBeLessThanOrEqual(colors);
                    if (colors === 1) expect([...pixels.slice(0, 12)]).toEqual(Array(3).fill([85, 43, 85, 255]).flat());
                    if (colors === 2) expect([...pixels.slice(0, 12)]).toEqual([128, 64, 0, 255, 128, 64, 0, 255, 0, 0, 255, 255]);
                    if (colors >= 3) expect([...pixels.slice(0, 12)]).toEqual(source);
                }
            }
        });
    }
}

it("quantizes alpha together with RGB and preserves an already-small palette without dithering", async () => {
    const source = new Uint8Array([10, 20, 30, 255, 10, 20, 30, 128, 11, 21, 31, 255]);
    const bytes = await sharp(source, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    for (const retained of [false, true]) for (const colors of [1, 3]) {
        const files = new Map([["in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        expect((await runConvertCli(["in.png", "+dither", "-colors", String(colors), "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
        const pixels = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data;
        expect([...pixels]).toEqual(colors === 3 ? [...source] : Array(3).fill([10, 20, 30, 213]).flat());
    }
});

it("bounds the histogram for high-color images", async () => {
    const { quantizePixelSteps } = await import("./quantize.js");
    const source = new Uint8Array(70000 * 4), output = new Uint8Array(source.length);
    for (let i = 0; i < 70000; i++) source.set([i >>> 16, i >>> 8 & 255, i & 255, 255], i * 4);
    const steps = quantizePixelSteps(source.length, 7);
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(4096);
            next = steps.next(source.subarray(request.position, request.position + request.length));
        } else {
            if (request?.kind === "write" && !request.evaluate && !request.pngIndices) output.set(request.data, request.position);
            next = steps.next();
        }
    }
    const palette = new Set<string>();
    for (let i = 0; i < output.length; i += 4) palette.add([...output.subarray(i, i + 4)].join(","));
    expect(palette.size).toBeGreaterThan(1);
    expect(palette.size).toBeLessThanOrEqual(7);
});
