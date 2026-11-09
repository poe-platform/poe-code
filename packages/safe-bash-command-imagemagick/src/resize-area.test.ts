import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: 4x3 gradient GIF on a 10x8 page at +3+2.
const input = Buffer.from("R0lGODlhCgAIAPEAAP8AAAAA/4AAgAAAACH5BAAAAAAALAMAAgAEAAMAAAIFhCEpwVEAOw==", "base64");

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["4x4@", 2, 2, 5, 5, 1, 1],
        ["4x9@", 2, 2, 5, 5, 1, 1],
        ["9x4@", 3, 3, 8, 8, 2, 1],
        ["4@", 2, 2, 5, 5, 1, 1],
        ["9@", 3, 3, 8, 8, 2, 1],
    ] as const)(`resizes area %s with native raster and page dimensions (${mode})`, async (geometry, width, height, pageWidth, pageHeight, x, y) => {
        const files = new Map([["/input.gif", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.gif", input);
        const args = ["/input.gif", "-resize", geometry, "/output.gif"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.gif") : files.get("/output.gif")!, { coalesce: false });
        expect(output).toMatchObject({ width, height, virtualCanvas: { width: pageWidth, height: pageHeight, x, y } });
    });

    it(`keeps two-component crop @ geometry as subdivisions (${mode})`, async () => {
        const files = new Map([["/input.gif", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.gif", input);
        const args = ["/input.gif", "-crop", "2x3@", "/tile-%d.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        for (let tile = 0; tile < 6; tile++) {
            const output = decodeImage(mode === "retained" ? await filesystem.readFile(`/tile-${tile}.png`) : files.get(`/tile-${tile}.png`)!);
            expect(output).toMatchObject({ width: 2, height: 1, virtualCanvas: { width: 10, height: 8, x: 3 + tile % 2 * 2, y: 2 + Math.floor(tile / 2) } });
        }
    });
}
