import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each([
    ["Perspective", "0,0 0,0 2,0 2,0 4,0 4,0 6,0 6,0"],
    ["Perspective", "0,0 0,0 9,0 9,0 0,7 0,7 0,0 0,0"],
    ["Affine", "0,0 0,0 2,0 2,0 4,0 4,0"],
])("rejects unsolvable %s points %s without replacing output", async (method, points) => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runMagickCli(["-size", "10x8", "gradient:red-blue", "-filter", "point", operator, method!, points!, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Unsolvable Matrix");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});

it.each([
    ["Perspective", "0,0 0,0 9,0 9,0 0,7 0,7 9,7 9,7"],
    ["Affine", "0,0 0,0 9,0 9,0 0,7 0,7"],
])("preserves pixels for solvable %s identity points", async (method, points) => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["-size", "10x8", "gradient:red-blue", "/in.png"], backend)).exitCode).toBe(0);
        const result = await runMagickCli(["/in.png", "-filter", "point", "-distort", method!, points!, "/out.png"], backend);
        expect(result.exitCode).toBe(0);
        const input = decodeImage(retained ? await filesystem.readFile("/in.png") : files.get("/in.png")!);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height, output.data]).toEqual([input.width, input.height, input.data]);
    }
});
