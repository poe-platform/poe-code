import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runConvertCliSync } from "./index.js";

// Dimensions and alpha bytes captured from ImageMagick 7.1.2.
const cases = [
    {"size": "4x4", "angle": 45, "width": 8, "height": 8, "alpha": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 95, 95, 0, 0, 0, 0, 0, 87, 255, 255, 87, 0, 0, 0, 95, 255, 255, 255, 255, 95, 0, 0, 95, 255, 255, 255, 255, 95, 0, 0, 0, 87, 255, 255, 87, 0, 0, 0, 0, 0, 95, 95, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
    {"size": "4x4", "angle": 30, "width": 8, "height": 8, "alpha": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 132, 15, 0, 0, 0, 0, 0, 113, 255, 247, 113, 2, 0, 0, 15, 247, 255, 255, 255, 132, 0, 0, 132, 255, 255, 255, 247, 15, 0, 0, 2, 113, 247, 255, 113, 0, 0, 0, 0, 0, 15, 132, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
    {"size": "1x1", "angle": 45, "width": 3, "height": 3, "alpha": [0, 16, 0, 16, 223, 16, 0, 16, 0]},
    {"size": "3x2", "angle": -30, "width": 5, "height": 6, "alpha": [0, 0, 0, 0, 0, 0, 0, 48, 69, 0, 7, 158, 255, 252, 10, 10, 252, 255, 158, 7, 0, 69, 48, 0, 0, 0, 0, 0, 0, 0]},
    {"size": "3x2", "angle": 135, "width": 5, "height": 6, "alpha": [0, 0, 0, 0, 0, 0, 0, 105, 56, 0, 0, 111, 255, 252, 18, 18, 252, 255, 111, 0, 0, 56, 105, 0, 0, 0, 0, 0, 0, 0]},
    {"size": "3x2", "angle": 450, "width": 2, "height": 3, "alpha": [255, 255, 255, 255, 255, 255]},
    {"size": "3x2", "angle": 0, "width": 3, "height": 2, "alpha": [255, 255, 255, 255, 255, 255]},
    {"size": "3x2", "angle": 180, "width": 3, "height": 2, "alpha": [255, 255, 255, 255, 255, 255]},
    {"size": "3x2", "angle": 270, "width": 2, "height": 3, "alpha": [255, 255, 255, 255, 255, 255]},
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`fills the expanded canvas with the requested opaque background, ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "4x4", "xc:red", "-background", "blue", "-rotate", "30", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([8, 8]);
        expect([...output.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
        expect([...output.data.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4)]).toEqual([255, 0, 0, 255]);
        expect(output.data.filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
    });
    it.each(cases)(`matches native rotation $size $angle, ${mode}`, async ({ size, angle, width, height, alpha }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", size, "xc:red", "-background", "none", "-rotate", String(angle), "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        for (let i = 0; i < alpha.length; i++) {
            expect(Math.abs(output.data[i * 4 + 3]! - alpha[i]!)).toBeLessThanOrEqual(1);
            if (alpha[i]! > 1) expect([...output.data.slice(i * 4, i * 4 + 3)]).toEqual([255, 0, 0]);
        }
    });
}
