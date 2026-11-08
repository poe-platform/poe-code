import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each([false, true])("applies forward PerspectiveProjection coefficients, retained=%s", async retained => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const backend = retained ? { filesystem, cwd: "/" } : files;
    for (const [tx, ty] of [[2, 1], [-2, -1]] as const) {
        const result = await runMagickCli(["-size", "15x13", "xc:black", "-fill", "white", "-draw", "rectangle 4,3 6,5", "-background", "black", "-distort", "PerspectiveProjection", `1,0,${tx},0,1,${ty},0,0`, "/out.png"], backend);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([15, 13]);
        const bright = [];
        for (let y = 0; y < 13; y++) for (let x = 0; x < 15; x++) {
            if (output.data[(y * 15 + x) * 4]! > 128) bright.push([x, y]);
        }
        expect(bright).toHaveLength(9);
        expect(bright.reduce((sum, point) => sum + point[0]!, 0) / bright.length).toBe(5 + tx);
        expect(bright.reduce((sum, point) => sum + point[1]!, 0) / bright.length).toBe(4 + ty);
    }
});

it.each([false, true])("matches Perspective control points for a forward projective transform, retained=%s", async retained => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const backend = retained ? { filesystem, cwd: "/" } : files;
    const points = [[0, 0], [14, 0], [0, 12], [14, 12]].flatMap(([x, y]) => {
        const denominator = 0.01 * x! + 0.02 * y! + 1;
        return [x, y, (x! + 0.1 * y! + 2) / denominator, (0.2 * x! + y! - 1) / denominator];
    });
    for (const [method, args] of [["PerspectiveProjection", "1,0.1,2,0.2,1,-1,0.01,0.02"], ["Perspective", points.join(",")]]) {
        expect((await runMagickCli(["-size", "15x13", "xc:black", "-fill", "white", "-draw", "rectangle 4,3 6,5", "-distort", method!, args!, `/${method}.png`], backend)).exitCode).toBe(0);
    }
    const projection = decodeImage(retained ? await filesystem.readFile("/PerspectiveProjection.png") : files.get("/PerspectiveProjection.png")!);
    const perspective = decodeImage(retained ? await filesystem.readFile("/Perspective.png") : files.get("/Perspective.png")!);
    expect([projection.width, projection.height]).toEqual([perspective.width, perspective.height]);
    // Solving the control points can shift floating-point rounding by one byte.
    for (let i = 0; i < projection.data.length; i++) expect(Math.abs(projection.data[i]! - perspective.data[i]!)).toBeLessThanOrEqual(1);
});

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
    ["white", [255, 255, 255, 255]], ["gray", [132, 132, 132, 255]],
    ["tile", [223, 223, 223, 255]], ["mirror", [0, 0, 0, 255]],
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

// Best-fit geometry checked against ImageMagick 7, with physical pixel edges.
it.each([
    ["Affine", "0,0,2,1 14,0,16,1 0,12,2,13", 17, 15, "+1+0"],
    ["Perspective", "0,0,2,1 14,0,16,1 0,12,2,13 14,12,16,13", 17, 15, "+1+0"],
    ["PerspectiveProjection", "1,0,2,0,1,1,0,0", 17, 15, "+1+0"],
    ["PerspectiveProjection", "1,0,-2,0,1,-1,0,0", 17, 15, "-3-2"],
    ["Affine", "0,0,2,1 14,0,30,1 0,12,2,25", 32, 28, "+1+0"],
    ["PerspectiveProjection", "1,0.1,2,0.2,1,-1,0.01,0.02", 15, 14, "+1-2"],
    ["Perspective", "0,0,1,2 12,0,11,1 0,16,2,15 12,16,12,16", 16, 14, "+0+0"],
] as const)("expands %s %s and preserves its page", async (method, args, width, height, offset) => {
    for (const retained of [false, true]) for (const operator of ["+distort", "-distort"]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        const result = await runMagickCli(["-size", "15x13", "xc:black", "-fill", "white", "-draw", "rectangle 4,3 6,5", operator, method, args, "/out.png"], backend);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual(operator === "+distort" ? [width, height] : [15, 13]);
        expect((await runMagickCli(["identify", "-format", "%g", "/out.png"], backend)).stdout).toBe(operator === "+distort" ? `${width}x${height}${offset}` : "15x13+0+0");
        if (operator === "+distort" && width === 17) {
            const bright = [];
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                if (output.data[(y * width + x) * 4]! > 128) bright.push([x, y]);
            }
            expect(bright).toHaveLength(9);
            expect(bright.reduce((sum, point) => sum + point[0]!, 0) / bright.length).toBe(6);
            expect(bright.reduce((sum, point) => sum + point[1]!, 0) / bright.length).toBe(5);
        }
    }
});
