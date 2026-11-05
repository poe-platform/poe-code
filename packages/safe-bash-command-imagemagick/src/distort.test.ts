import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// Geometry from ImageMagick 7, including its best-fit border and page offsets.
it.each([
    ["-distort", "45", "9x7+0+0", 9, 7],
    ["+distort", "45", "13x13-2-3", 13, 13],
    ["+distort", "0", "11x9-1-1", 11, 9],
    ["+distort", "2,0", "19x15-5-4", 19, 15],
    ["+distort", "4,3,1,0,14,23", "11x9+9+19", 11, 9],
] as const)("preserves SRT geometry for %s %s", async (operator, args, page, width, height) => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        const result = await runMagickCli(["-size", "9x7", "xc:black", "-fill", "white", "-draw", "rectangle 2,2 6,4", operator, "SRT", args, "/out.png"], backend);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect((await runMagickCli(["identify", "-format", "%g", "/out.png"], backend)).stdout).toBe(page);
        // The translated output must still sample the source, not the old viewport.
        expect(output.data[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4]).toBe(255);
        expect((await runMagickCli(["/out.png", "+repage", "/reset.png"], backend)).exitCode).toBe(0);
        expect((await runMagickCli(["identify", "-format", "%g", "/reset.png"], backend)).stdout).toBe(`${width}x${height}+0+0`);
    }
});
