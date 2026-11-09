import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each([
    ["0,0 4,3", "0,0 4,3 10,0 14,3 0,10 4,13"],
    ["0,0 4,3 10,0 14,3", "0,0 4,3 10,0 14,3 0,10 4,13"],
    ["0,0 14,0 10,0 14,10", "0,0 14,0 10,0 14,10 0,10 4,0"],
    ["2,1 4,3 12,1 24,3", "2,1 4,3 12,1 24,3 2,11 4,23"],
])("applies Affine control pairs %s", async (points, reference) => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        for (const [args, path] of [[points, "/out.png"], [reference, "/reference.png"]]) {
            const result = await runMagickCli(["-size", "15x13", "gradient:red-blue", operator, "Affine", args!, path!], backend);
            expect(result.exitCode).toBe(0);
        }
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const expected = decodeImage(retained ? await filesystem.readFile("/reference.png") : files.get("/reference.png")!);
        expect([output.width, output.height]).toEqual([expected.width, expected.height]);
        // Native EWA rounding also varies by one level between equivalent point sets.
        expect(Math.max(...output.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(1);
        expect((await runMagickCli(["identify", "-format", "%g", "/out.png"], backend)).stdout)
            .toBe((await runMagickCli(["identify", "-format", "%g", "/reference.png"], backend)).stdout);
    }
});

it.each([
    ["0,0 4,3", 8, 6, 4, 3],
    ["0,0 4,3 10,0 14,3", 8, 6, 4, 3],
    ["0,0 14,0 10,0 14,10", 8, 6, 6, 5],
] as const)("maps Affine pixels for %s", async (points, x, y, sx, sy) => {
    const files = new Map<string, Uint8Array>();
    expect((await runMagickCli(["-size", "15x13", "gradient:red-blue", "/in.png"], files)).exitCode).toBe(0);
    expect((await runMagickCli(["/in.png", "-filter", "point", "-distort", "Affine", points, "/out.png"], files)).exitCode).toBe(0);
    const input = decodeImage(files.get("/in.png")!), output = decodeImage(files.get("/out.png")!);
    const offset = (y * output.width + x) * 4, source = (sy * input.width + sx) * 4;
    expect(output.data.slice(offset, offset + 4)).toEqual(input.data.slice(source, source + 4));
});
