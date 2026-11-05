import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each([
    ["80x0+0+0", 5, [5, 5, 0, 0]],
    ["80x0+1+2", 5, [6, 7, 1, 2]],
    ["80x1+1+2", 9, [8, 9, -1, 0]],
    ["80x0-2-3", 5, [3, 2, -2, -3]],
    ["80x0.6+0+0", 7, [6, 6, -1, -1]],
    ["80x0.8+0+0", 9, [7, 7, -2, -2]],
] as const)("matches native shadow geometry %s in both backends", async (geometry, size, canvas) => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        const result = await runMagickCli(["-size", "5x5", "xc:none", "-fill", "red", "-draw", "rectangle 1,1 3,3", "-background", "none", "-shadow", geometry, "/shadow.png"], backend);
        expect(result.exitCode).toBe(0);
        const bytes = retained ? await filesystem.readFile("/shadow.png") : files.get("/shadow.png")!;
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([size, size]);
        let actualCanvas: number[] | undefined;
        for (let offset = 8; offset + 12 <= bytes.length;) {
            const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
            const length = view.getUint32(0);
            if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "caNv") {
                actualCanvas = [view.getUint32(8), view.getUint32(12), view.getInt32(16), view.getInt32(20)];
            }
            offset += length + 12;
        }
        expect(actualCanvas).toEqual(canvas);
        expect(image.virtualCanvas).toEqual({width:canvas[0],height:canvas[1],x:canvas[2],y:canvas[3]});
        expect((await runMagickCli(["/shadow.png", "/copy.png"], backend)).exitCode).toBe(0);
        const copied = retained ? await filesystem.readFile("/copy.png") : files.get("/copy.png")!;
        expect(decodeImage(copied).virtualCanvas).toEqual(image.virtualCanvas);
        const identify = await runMagickCli(["identify", "-format", "%wx%h page=%[page] offset=%X,%Y", "/shadow.png"], backend);
        const signed = (value: number) => value < 0 ? String(value) : `+${value}`;
        expect(identify.stdout).toBe(`${size}x${size} page=${canvas[0]}x${canvas[1]} offset=${signed(canvas[2])},${signed(canvas[3])}`);
        if (size === 5) {
            expect(image.data[(2 * 5 + 2) * 4 + 3]).toBe(204);
            expect(image.data[3]).toBe(0);
        }
    }
});

it("clears shadow page offsets with +repage in both backends", async () => {
    for (const retained of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["-size", "5x5", "xc:red", "-shadow", "80x0+1+2", "+repage", "/shadow.png"], backend)).exitCode).toBe(0);
        expect((await runMagickCli(["identify", "-format", "%g", "/shadow.png"], backend)).stdout).toBe("5x5+0+0");
    }
});
