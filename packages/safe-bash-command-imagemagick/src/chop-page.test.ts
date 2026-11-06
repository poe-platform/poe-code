import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Page geometries verified with native ImageMagick's ChopImage/CloneImage.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["48x32+6+5", "2x2+0+0", "12x8 41x26+5+4", 2, 2],
        ["48x32-6-5", "2x2+0+0", "12x8 41x26-5-4", 2, 2],
        ["48x32+6+5", "2x2-1-1", "13x9 45x29+5+4", 1, 1],
        ["48x32+6+5", "2x2+99+99", "14x10 48x32+6+5", 0, 0],
        ["48x32+6+5", "99x99", "14x10 48x32+6+5", 0, 0],
        ["14x10+0+0", "2x2+0+0", "12x8 12x8+0+0", 2, 2],
    ] as const)(`chop updates page %s for %s (${mode})`, async (page, geometry, expected, left, top) => {
        const pixels = Uint8Array.from({ length: 14 * 10 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251);
        const input = await sharp(pixels, { raw: { width: 14, height: 10, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect((await run(["/input.png", "-repage", page, "/part.png"])).exitCode).toBe(0);
        const result = await run(["/part.png", "-chop", geometry, "/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(expected);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        const expectedPixels = await sharp(input).extract({ left, top, width: 14 - left, height: 10 - top }).raw().toBuffer();
        expect(output.data).toEqual(new Uint8Array(expectedPixels));
    });
}
