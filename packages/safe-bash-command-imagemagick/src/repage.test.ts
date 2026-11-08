import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        ["8x7+9+6", [], { left: 3, top: 1, width: 8, height: 7 }, 9, 6],
        ["8x7+1+2", [], { left: 0, top: 0, width: 3, height: 4 }, 6, 5],
        ["8x7+0+0", ["-gravity", "center"], { left: 0, top: 0, width: 5, height: 3 }, 6, 5],
    ] as const)("crops an offset input in page coordinates for %s (retained=" + retained + ")", async (geometry, options, area, x, y) => {
        const pixels = Uint8Array.from({ length: 14 * 10 * 3 }, (_, i) => i * 7);
        const input = await sharp(pixels, { raw: { width: 14, height: 10, channels: 3 } }).png().toBuffer();
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["png:-", "-repage", "48x32+6+5", "/part.png"], backend, input)).exitCode).toBe(0);
        const expected = decodeImage(await sharp(input).extract(area).png().toBuffer());
        for (const reset of [false, true]) {
            expect((await runMagickCli(["/part.png", ...options, "-crop", geometry, ...(reset ? ["+repage"] : []), "/crop.png"], backend)).exitCode).toBe(0);
            const actual = decodeImage(retained ? await filesystem.readFile("/crop.png") : files.get("/crop.png")!);
            expect([actual.width, actual.height]).toEqual([area.width, area.height]);
            expect(actual.data).toEqual(expected.data);
            const metadata = await runMagickCli(["identify", "-format", "%g", "/crop.png"], backend);
            expect(metadata.stdout).toBe(reset ? `${area.width}x${area.height}+0+0` : `48x32+${x}+${y}`);
        }
    });

    it.each([
        [["-crop", "2x2+1+1"], "2x2 +1 +1 5x5"],
        [["-repage", "8x8+2+3"], "5x5 +2 +3 8x8"],
        [["-crop", "2x2+1+1", "+repage"], "2x2 +0 +0 2x2"],
        [["-repage", "8x8-2-3"], "5x5 -2 -3 8x8"],
        [["-repage", "8x8+2+3", "-repage", "9x9"], "5x5 +2 +3 9x9"],
        [["-repage", "8x8+2+3", "-repage", "+1+1!"], "5x5 +3 +4 8x8"],
        [["-crop", "2x2+1+1", "-repage", "+2+3"], "2x2 +2 +3 5x5"],
    ])("preserves native canvas geometry for %j (retained=" + retained + ")", async (options, expected) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["-size", "5x5", "gradient:black-white", ...options, "/output.png"], backend)).exitCode).toBe(0);
        const result = await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "/output.png"], backend);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(expected);
        const bytes = retained ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect((await runMagickCli(["/output.png", "/copy.png"], backend)).exitCode).toBe(0);
        const copy = retained ? await filesystem.readFile("/copy.png") : files.get("/copy.png")!;
        expect(decodeImage(copy)).toEqual(decodeImage(bytes));
    });
}
