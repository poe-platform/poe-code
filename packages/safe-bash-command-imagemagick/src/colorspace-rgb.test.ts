import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
for (const retained of [false, true]) {
    it.each([
        { pixel: [200, 100, 50, 255], expected: [147, 32, 8, 255] },
        { pixel: [20, 200, 100, 128], expected: [2, 147, 32, 128] },
        { pixel: [0, 10, 255, 0], expected: [0, 1, 255, 0] },
    ])(`converts sRGB to linear RGB, retained=${retained}, pixel=$pixel`, async ({ pixel, expected }) => {
        const bytes = await sharp(new Uint8Array(pixel), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map<string, Uint8Array>([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        for (const extra of [[], ["-colorspace", "RGB"], ["-colorspace", "sRGB"]]) {
            const result = await runMagickCli(["/in.png", "-colorspace", "RGB", ...extra, "/out.png"], input);
            expect(result.exitCode).toBe(0);
            const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
            const decoded = decodeImage(output);
            // Round high-depth output to 8-bit, as ImageMagick does with -depth 8.
            const rgba = decoded.data16 ? Array.from(decoded.data16, value => Math.round(value / 257)) : [...decoded.data];
            expect(rgba).toEqual(extra.includes("sRGB") ? pixel : expected);
        }
    });
}
import { spawnSync } from "node:child_process";

it.skipIf(!nativeAvailable)("matches native RGB conversion for identical PNG bytes", async () => {
    const pixels = new Uint8Array([200, 100, 50, 255, 20, 200, 100, 128, 0, 10, 255, 0]);
    const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const native = spawnSync("magick", ["png:-", "-colorspace", "RGB", "-depth", "8", "rgba:-"], { input: bytes });
    expect(native.status).toBe(0);
    const files = new Map<string, Uint8Array>([["in.png", bytes]]);
    expect((await runMagickCli(["in.png", "-colorspace", "RGB", "out.png"], files)).exitCode).toBe(0);
    const actual = spawnSync("magick", ["png:-", "-depth", "8", "rgba:-"], { input: files.get("out.png")! });
    expect(actual.status).toBe(0);
    expect([...actual.stdout]).toEqual([...native.stdout]);
});
