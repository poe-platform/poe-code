import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { compareImageSteps } from "./compare-kernel.js";
import { runCompareCli, runCompareCliSync } from "./index.js";

const gradient = [[0, 20, 40], [60, 80, 100], [120, 140, 160], [180, 200, 220], [240, 100, 50], [30, 60, 90]];
// ImageMagick 7.1.2 Q16-HDRI, RGB inputs, default xyY and HSB hashes.
for (const retained of [false, true]) {
    for (const [name, a, b, metric] of [
        ["solid colors", Array.from({ length: 6 }, () => [255, 0, 0]), Array.from({ length: 6 }, () => [0, 0, 255]), "198541 (198541)"],
        ["gradient", gradient, gradient.map((pixel, i) => i === 4 ? [240, 120, 50] : pixel), "12.4211 (12.4211)"],
        ["identical", gradient, gradient, "0 (0)"]
    ] as const) {
        it(`compares PHASH ${name}, retained=${retained}`, async () => {
            const images = await Promise.all([a, b].map(pixels => sharp(Uint8Array.from(pixels.flat()), { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer()));
            const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            const result = await runCompareCli(["-metric", "PHASH", "a.png", "b.png", "null:"], retained ? { filesystem, cwd: "/" } : files);
            if (!retained) expect(runCompareCliSync(["-metric", "PHASH", "a.png", "b.png", "null:"], files)).toEqual(result);
            expect(result.stderr).toBe(`${metric}\n`);
            expect(result.exitCode).toBe(name === "identical" ? 0 : 1);
        });
    }
}

for (const hasAlpha of [false, true]) {
    it(`matches native PHASH with borrowed bounded reads, alpha=${hasAlpha}`, () => {
        const info = { width: hasAlpha ? 4 : 1025, height: hasAlpha ? 3 : 2, hasAlpha };
        const steps = compareImageSteps(info, info, { metric: "phash", fuzz: 255, highlightColor: { r: 255, g: 0, b: 0, a: 255 }, composeSrc: false, diff: false });
        const buffer = new Uint8Array(4096);
        let next = steps.next();
        while (!next.done) {
            const request = next.value;
            if (request?.kind === "read") {
                expect(request.length).toBeLessThanOrEqual(buffer.length);
                for (let i = 0; i < request.length; i++) {
                    const pixel = Math.floor((request.position + i) / 4), c = (request.position + i) % 4;
                    const x = pixel % info.width, y = Math.floor(pixel / info.width);
                    buffer[i] = hasAlpha ? (x * 57 + y * 31 + c * 53 + request.image * (c === 1 ? 10 : 0)) % 256
                        : c === 3 ? 255 : (x * 17 + y * 31 + c * 73 + request.image * (x >= 1012 ? 19 : 0)) % 256;
                }
                next = steps.next(buffer.subarray(0, request.length));
            } else next = steps.next();
        }
        // Native and JS color transforms can differ in the last printed digit
        // after accumulating moments over thousands of pixels.
        expect(next.value.distortion).toBeCloseTo(hasAlpha ? 2.11001 : 0.87093, 5);
        expect(next.value.exitCode).toBe(1);
    });
}
