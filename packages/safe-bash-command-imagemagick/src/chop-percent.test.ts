import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([
    ["25x50%", 25, 50, true],
    ["1x1%", 1, 1, true],
    ["1x2", 1, 2, false],
] as const)("parses chop geometry %s", (geometry, width, height, isPercent) => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ width, height, isPercent });
});

// Expected pixels from native ImageMagick on an opaque 4x3 grayscale grid.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["25%", 3, 2, [6, 7, 8, 10, 11, 12]],
        ["50%", 2, 1, [11, 12]],
        ["25x%", 3, 2, [6, 7, 8, 10, 11, 12]],
        ["25x25%", 3, 2, [6, 7, 8, 10, 11, 12]],
        ["50x50%", 2, 1, [11, 12]],
        ["25x0%", 3, 3, [2, 3, 4, 6, 7, 8, 10, 11, 12]],
        ["25x50%", 3, 1, [10, 11, 12]],
        ["1x1%", 4, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
        ["1x2", 3, 1, [10, 11, 12]],
    ] as const)(`chops %s with native dimensions and pixels (${mode})`, async (geometry, width, height, values) => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-gravity", "NorthWest", "-chop", geometry, "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
    });
}
