import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: remap discards fully transparent palette RGB,
// preserves partially transparent RGB, and keeps an RGB source opaque.
for (const retained of [false, true]) {
    it.each([
        ["xc:rgba(10,30,70,0)", [0, 0, 0, 255]],
        ["xc:rgba(10,30,70,0.5)", [10, 30, 70, 255]],
        ["xc:none", [0, 0, 0, 255]]
    ] as const)(`retained=${retained}: remaps an opaque image against %s`, async (palette, expected) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n8 4\n255\n"), ...Array.from({ length: 96 }, (_, i) => (13 * i + 9) % 256)]);
        const prefix = ["/in.ppm", "+dither", "-remap", palette];
        for (const info of [false, true]) {
            const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const result = await runConvertCli([...prefix, ...(info ? ["-format", "%[colorspace]|%k", "info:"] : ["-depth", "8", "rgba:/out.raw"])], retained ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            if (info) expect(result.stdout).toBe("sRGB|1");
            else {
                const output = retained ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
                expect(Array.from(output)).toEqual(Array.from({ length: 32 }, () => expected).flat());
            }
        }
    });

    it(`retained=${retained}: preserves hidden RGB without remapping`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["xc:rgba(10,30,70,0)", "-depth", "8", "rgba:/out.raw"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = retained ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Array.from(output)).toEqual([10, 30, 70, 0]);
    });
}
