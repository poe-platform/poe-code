import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI: RGBA input encoded as PNG, -swirl angle, 8-bit RGBA output.
const cases = [
    { width: 3, height: 3, angle: 30, impulse: true, expected: [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 219, 219, 219, 255, 0, 0, 0, 255, 0, 0, 0, 255, 19, 19, 19, 255, 0, 0, 0, 255] },
    { width: 5, height: 5, angle: 30, impulse: false, expected: [17, 17, 17, 255, 54, 108, 70, 255, 91, 199, 123, 255, 128, 34, 176, 255, 165, 125, 229, 255, 202, 216, 26, 255, 232, 54, 80, 255, 26, 153, 137, 255, 67, 213, 191, 255, 93, 67, 238, 255, 131, 159, 35, 255, 176, 224, 89, 255, 189, 105, 148, 255, 211, 153, 197, 255, 43, 32, 221, 255, 60, 102, 44, 255, 103, 196, 94, 255, 140, 56, 143, 255, 157, 103, 196, 255, 199, 200, 9, 255, 245, 45, 53, 255, 31, 135, 105, 255, 62, 211, 153, 255, 96, 80, 206, 255, 136, 151, 13, 255] },
    { width: 4, height: 4, angle: -60, impulse: false, expected: [17, 17, 17, 255, 54, 108, 70, 255, 91, 199, 123, 255, 128, 34, 176, 255, 165, 125, 229, 255, 189, 196, 61, 255, 226, 95, 66, 255, 48, 126, 131, 255, 57, 233, 185, 255, 131, 97, 222, 255, 131, 159, 35, 255, 131, 219, 98, 255, 205, 85, 141, 255, 221, 161, 199, 255, 36, 40, 189, 255, 70, 116, 48, 255] },
    { width: 6, height: 3, angle: 90, impulse: false, expected: [17, 17, 17, 255, 54, 108, 70, 255, 91, 199, 123, 255, 128, 34, 176, 255, 165, 125, 229, 255, 202, 216, 26, 255, 239, 51, 79, 255, 28, 149, 132, 255, 82, 142, 202, 255, 114, 130, 104, 255, 134, 176, 69, 255, 164, 227, 94, 255, 205, 85, 141, 255, 218, 164, 183, 255, 82, 101, 213, 255, 40, 59, 178, 255, 78, 146, 69, 255, 130, 46, 144, 255] },
    { width: 3, height: 6, angle: -90, impulse: false, expected: [17, 17, 17, 255, 54, 108, 70, 255, 91, 199, 123, 255, 128, 34, 176, 255, 148, 118, 213, 255, 188, 205, 54, 255, 239, 51, 79, 255, 92, 136, 95, 255, 95, 204, 141, 255, 94, 68, 238, 255, 187, 161, 143, 255, 92, 228, 144, 255, 205, 85, 141, 255, 159, 139, 176, 255, 98, 135, 164, 255, 60, 102, 44, 255, 101, 176, 103, 255, 122, 26, 161, 255] },
    { width: 5, height: 5, angle: 0, impulse: false, expected: [17, 17, 17, 255, 54, 108, 70, 255, 91, 199, 123, 255, 128, 34, 176, 255, 165, 125, 229, 255, 202, 216, 26, 255, 239, 51, 79, 255, 20, 142, 132, 255, 57, 233, 185, 255, 94, 68, 238, 255, 131, 159, 35, 255, 168, 250, 88, 255, 205, 85, 141, 255, 242, 176, 194, 255, 23, 11, 247, 255, 60, 102, 44, 255, 97, 193, 97, 255, 134, 28, 150, 255, 171, 119, 203, 255, 208, 210, 0, 255, 245, 45, 53, 255, 26, 136, 106, 255, 63, 227, 159, 255, 100, 62, 212, 255, 137, 153, 9, 255] },
    { width: 6, height: 3, angle: 0, impulse: false, expected: [17, 17, 17, 255, 54, 108, 70, 255, 91, 199, 123, 255, 128, 34, 176, 255, 165, 125, 229, 255, 202, 216, 26, 255, 239, 51, 79, 255, 20, 142, 132, 255, 57, 233, 185, 255, 94, 68, 238, 255, 131, 159, 35, 255, 168, 250, 88, 255, 205, 85, 141, 255, 242, 176, 194, 255, 23, 11, 247, 255, 60, 102, 44, 255, 97, 193, 97, 255, 134, 28, 150, 255] },
];

for (const mode of ["buffered", "retained", "sync"] as const)
it.each(cases)(`matches native swirl $width x $height at $angle degrees via ${mode}`, async ({ width, height, angle, impulse, expected }) => {
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : impulse ? (Math.floor(i / 4) === 4 ? 255 : 0) : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["input.png", "-swirl", String(angle), "out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect([output.width, output.height]).toEqual([width, height]);
    expect(Array.from(output.data)).toEqual(expected);
    if (angle === 0) expect(output.data).toEqual(pixels);
});
