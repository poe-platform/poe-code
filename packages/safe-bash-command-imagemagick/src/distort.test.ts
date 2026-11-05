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

// Native ImageMagick extends the edge by default, independently of background.
it.each([["-distort", "45"], ["+distort", "45"], ["+distort", "0"]])("samples default virtual pixels for %s %s", async (operator, angle) => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", "9x7", "xc:black", "-fill", "white", "-draw", "rectangle 2,2 6,4", "-background", "red", operator!, "SRT", angle!, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    }
});

it.each([
    ["edge", [0, 0, 0, 255]], ["background", [255, 0, 0, 255]],
    ["transparent", [0, 0, 0, 0]], ["black", [0, 0, 0, 255]],
    ["white", [255, 255, 255, 255]], ["gray", [128, 128, 128, 255]],
    ["tile", [255, 255, 255, 255]], ["mirror", [0, 0, 0, 255]],
] as const)("honors virtual-pixel %s in both backends", async (method, expected) => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", "9x7", "xc:black", "-fill", "white", "-draw", "point 8,6", "-background", "red", "-virtual-pixel", method, "+distort", "SRT", "0", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data.slice(0, 4)]).toEqual(expected);
    }
});

it("captures and resets virtual-pixel settings in pipeline order", async () => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["-size", "9x7", "xc:black", "-background", "red", "-virtual-pixel", "BACKGROUND", "+distort", "SRT", "0", "-write", "/background.png", "+virtual-pixel", "-background", "blue", "+distort", "SRT", "0", "/edge.png"], backend)).exitCode).toBe(0);
        for (const path of ["/background.png", "/edge.png"]) {
            const output = decodeImage(retained ? await filesystem.readFile(path) : files.get(path)!);
            expect([...output.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
        }
    }
});

it("rejects unsupported virtual pixels before replacing output", async () => {
    for (const retained of [false, true]) {
        const original = new Uint8Array([1, 2, 3]);
        const files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runMagickCli(["-size", "9x7", "xc:black", "-virtual-pixel", "unknown", "+distort", "SRT", "0", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Unsupported virtual-pixel method");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});
