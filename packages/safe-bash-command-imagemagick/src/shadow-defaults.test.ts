import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["60", "60x1+4+4", 9, 8, 11, 10, 2, 2],
        ["60x", "60x1+4+4", 9, 8, 11, 10, 2, 2],
        ["80x0", "80x0+4+4", 5, 4, 9, 8, 4, 4],
        ["80x0+2", "80x0+2+4", 5, 4, 7, 8, 2, 4],
        ["80x0+0", "80x0+0+4", 5, 4, 5, 8, 0, 4],
        ["80x0+0+0", "80x0+0+0", 5, 4, 5, 4, 0, 0],
        ["80x0-2+0", "80x0-2+0", 5, 4, 3, 4, -2, 0],
    ] as const)(`resolves omitted shadow values for %s (${mode})`, async (geometry, explicit, width, height, pageWidth, pageHeight, x, y) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = mode === "retained" ? { filesystem, cwd: "/" } : files;
        for (const [spec, output] of [[geometry, "/actual.png"], [explicit, "/expected.png"]] as const) {
            const args = ["-size", "5x4", "xc:none", "-fill", "red", "-draw", "rectangle 1,1 3,2", "-background", "blue", "-shadow", spec, output];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, backend);
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const actual = decodeImage(mode === "retained" ? await filesystem.readFile("/actual.png") : files.get("/actual.png")!);
        const expected = decodeImage(mode === "retained" ? await filesystem.readFile("/expected.png") : files.get("/expected.png")!);
        expect([actual.width, actual.height]).toEqual([width, height]);
        expect(actual.virtualCanvas ?? { width: actual.width, height: actual.height, x: 0, y: 0 }).toEqual({ width: pageWidth, height: pageHeight, x, y });
        expect(actual.data).toEqual(expected.data);
        if (width === 9) {
            // RGBA8 pixels captured from native ImageMagick for -shadow 60.
            const alpha = [
                0, 0, 0, 1, 1, 1, 0, 0, 0,
                0, 1, 3, 7, 9, 7, 3, 1, 0,
                0, 3, 14, 32, 40, 32, 14, 3, 0,
                1, 6, 29, 66, 83, 66, 29, 6, 1,
                1, 6, 29, 66, 83, 66, 29, 6, 1,
                0, 3, 14, 32, 40, 32, 14, 3, 0,
                0, 1, 3, 7, 9, 7, 3, 1, 0,
                0, 0, 0, 1, 1, 1, 0, 0, 0,
            ];
            expect(actual.data).toEqual(Uint8Array.from(alpha.flatMap(a => [0, 0, 255, a])));
        }
    });
}
