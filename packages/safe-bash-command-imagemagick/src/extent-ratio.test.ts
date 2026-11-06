import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([["2:1", 2], ["1:2", 0.5], ["4:3", 4 / 3]])("parses aspect ratio %s", (geometry, aspectRatio) => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ aspectRatio });
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        [4, 3, "2:1", "Center", 4, 2, [1, 2, 3, 4, 5, 6, 7, 8]],
        [4, 3, "1:1", "NorthWest", 3, 3, [1, 2, 3, 5, 6, 7, 9, 10, 11]],
        [4, 3, "1:2", "NorthWest", 2, 3, [1, 2, 5, 6, 9, 10]],
        [4, 3, "4:3", "NorthWest", 4, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
        [4, 3, "3x2!", "NorthWest", 3, 2, [1, 2, 3, 5, 6, 7]],
        [3, 4, "1:2", "NorthWest", 2, 4, [1, 2, 4, 5, 7, 8, 10, 11]],
        [3, 4, "2:1", "NorthWest", 3, 2, [1, 2, 3, 4, 5, 6]],
    ] as const)(`extends %ix%i to %s at %s (${mode})`, async (width, height, geometry, gravity, expectedWidth, expectedHeight, samples) => {
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-gravity", gravity, "-extent", geometry, "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([expectedWidth, expectedHeight]);
        expect(Array.from(output.data)).toEqual(samples.flatMap(value => [value, value, value, 255]));
    });
}
