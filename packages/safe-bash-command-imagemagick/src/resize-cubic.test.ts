import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, 9-pixel grayscale impulse resized to 27.
const fixtures = [
    ["Catrom", 27, [32, 32, 32, 32, 32, 32, 32, 32, 25, 18, 32, 96, 181, 224, 181, 96, 32, 18, 25, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Cubic", 27, [32, 32, 32, 32, 32, 32, 32, 32, 33, 41, 64, 103, 142, 160, 142, 103, 64, 41, 33, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Spline", 27, [32, 32, 32, 32, 32, 32, 32, 32, 33, 41, 64, 103, 142, 160, 142, 103, 64, 41, 33, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["CubicSpline", 27, [32, 32, 32, 32, 32, 32, 32, 32, 22, 17, 32, 102, 180, 224, 180, 102, 32, 17, 22, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Hermite", 27, [32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 82, 174, 224, 174, 82, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Quadratic", 27, [32, 32, 32, 32, 32, 32, 32, 32, 32, 35, 56, 99, 155, 176, 155, 99, 56, 35, 32, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Robidoux", 27, [32, 32, 32, 32, 32, 32, 32, 32, 28, 27, 44, 99, 167, 200, 167, 99, 44, 27, 28, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["RobidouxSharp", 27, [32, 32, 32, 32, 32, 32, 32, 32, 27, 24, 40, 98, 171, 207, 171, 98, 40, 24, 27, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Mitchell", 27, [32, 32, 32, 32, 32, 32, 32, 32, 28, 26, 43, 98, 168, 203, 168, 98, 43, 26, 28, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Lanczos", 27, [32, 32, 32, 32, 32, 35, 38, 32, 14, 4, 32, 105, 188, 224, 188, 105, 32, 4, 14, 32, 38, 35, 32, 32, 32, 32, 32]],
    ["Point", 27, [32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 224, 224, 224, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Catrom", 4, [26, 79, 79, 26]],
    ["Cubic", 4, [34, 73, 73, 34]],
    ["Spline", 4, [34, 73, 73, 34]],
    ["CubicSpline", 4, [25, 80, 80, 25]],
    ["Hermite", 4, [32, 75, 75, 32]],
    ["Quadratic", 4, [32, 75, 75, 32]],
    ["Robidoux", 4, [29, 77, 77, 29]],
    ["RobidouxSharp", 4, [28, 78, 78, 28]],
    ["Mitchell", 4, [29, 77, 77, 29]],
    ["Lanczos", 4, [20, 83, 83, 20]],
    ["Point", 4, [32, 32, 32, 32]],
] as const;

for (const [filter, target, expected] of fixtures) for (const vertical of [false, true]) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it(`matches the complete native ${filter} impulse to ${target}: ${mode}, vertical=${vertical}`, async () => {
            const pixels = Uint8Array.from(Array.from({ length: 9 }, (_, i) => Array(3).fill(i === 4 ? 224 : 32)).flat());
            const input = await sharp(pixels, { raw: { width: vertical ? 1 : 9, height: vertical ? 9 : 1, channels: 3 } }).png().toBuffer();
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["png:-", "-filter", filter, "-resize", vertical ? `1x${target}!` : `${target}x1!`, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files, input)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        });
    }
}
