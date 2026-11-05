import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7, RGB checkerboard PNG, -resize 4x4 (or montage -geometry 4x4+0+0).
const resized = [124, 129, 126, 131, 129, 127, 128, 126, 126, 128, 127, 129, 131, 126, 129, 124]
    .flatMap(value => [value, value, value, 255]);
for (const [operation, geometry, gray] of [
    ["resize", "4x4", undefined],
    ["resize", "3x5!", [124, 128, 131, 129, 128, 126, 128, 128, 128, 126, 128, 129, 131, 128, 124]],
    ["thumbnail", "4x4", [124, 128, 127, 131, 128, 127, 128, 127, 127, 128, 127, 128, 131, 127, 128, 124]],
    ["montage", "4x4", [124, 128, 127, 131, 128, 127, 128, 127, 127, 128, 127, 128, 131, 127, 128, 124]],
] as const) for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`matches native checkerboard resize: ${operation} ${geometry}, ${mode}`, async () => {
        const montage = operation === "montage";
        const pixels = Uint8Array.from({ length: 8 * 8 * 3 }, (_, i) => ((Math.floor(i / 3) % 8 + Math.floor(i / 24)) % 2) * 255);
        const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...(montage ? ["-tile", "1x1", "-geometry", "4x4+0+0"] : ["-" + operation, geometry]), "out.png"];
        const expected = gray ? gray.flatMap(value => [value, value, value, 255]) : resized;
        const result = mode === "sync" ? (montage ? runMontageCliSync : runConvertCliSync)(args, files)
            : await (montage ? runMontageCli : runConvertCli)(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual(geometry === "3x5!" ? [3, 5] : [4, 4]);
        expect([...output.data]).toEqual(expected);
    });
}
