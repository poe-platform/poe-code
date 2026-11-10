import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runConvertCli, runConvertCliSync } from "./index.js";

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
        expect(actualCanvas).toEqual(geometry === "80x0+0+0" ? undefined : canvas);
        expect(image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 }).toEqual({width:canvas[0],height:canvas[1],x:canvas[2],y:canvas[3]});
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

// Complete alpha planes captured from native ImageMagick 7.1.2-31.
const cases = [
    { width: 3, height: 3, sigma: 0, impulse: true, alpha: [0, 0, 0, 0, 204, 0, 0, 0, 0] },
    { width: 3, height: 3, sigma: 1, impulse: true, alpha: [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 3, 1, 0, 0, 3, 12, 19, 12, 3, 0, 0, 5, 19, 30, 19, 5, 0, 0, 3, 12, 19, 12, 3, 0, 0, 1, 3, 5, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
    { width: 7, height: 5, sigma: 2, impulse: false, alpha: [0, 1, 2, 3, 5, 6, 7, 7, 7, 6, 5, 3, 2, 1, 0, 1, 2, 5, 9, 13, 17, 19, 20, 19, 17, 13, 9, 5, 2, 1, 2, 5, 10, 18, 28, 36, 41, 42, 41, 36, 28, 18, 10, 5, 2, 3, 9, 18, 33, 49, 63, 72, 75, 72, 63, 49, 33, 18, 9, 3, 5, 13, 27, 48, 72, 92, 106, 110, 106, 92, 72, 48, 27, 13, 5, 6, 16, 34, 60, 90, 115, 132, 138, 132, 115, 90, 60, 34, 16, 6, 6, 17, 36, 65, 96, 124, 142, 148, 142, 124, 96, 65, 36, 17, 6, 6, 16, 34, 60, 90, 115, 132, 138, 132, 115, 90, 60, 34, 16, 6, 5, 13, 27, 48, 72, 92, 106, 110, 106, 92, 72, 48, 27, 13, 5, 3, 9, 18, 33, 49, 63, 72, 75, 72, 63, 49, 33, 18, 9, 3, 2, 5, 10, 18, 28, 36, 41, 42, 41, 36, 28, 18, 10, 5, 2, 1, 2, 5, 9, 13, 17, 19, 20, 19, 17, 13, 9, 5, 2, 1, 0, 1, 2, 3, 5, 6, 7, 7, 7, 6, 5, 3, 2, 1, 0] }
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["x2", "13x12+0+0"],
        ["0x2+4+4", "13x12+0+0"],
        ["x2+0+0", "9x8-4-4"],
    ])(`keeps sigma-only shadows transparent with native page geometry (${mode}): %s`, async (geometry, page) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = mode === "retained" ? { filesystem, cwd: "/" } : files;
        const args = ["-size", "5x4", "xc:none", "-fill", "red", "-draw", "rectangle 1,1 3,2", "-background", "blue", "-shadow", geometry!, "/shadow.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runMagickCli(args, backend);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/shadow.png") : files.get("/shadow.png")!);
        expect([output.width, output.height]).toEqual([13, 12]);
        expect(Array.from(output.data).filter((_, index) => index % 4 === 3)).toEqual(Array(156).fill(0));
        expect((await runMagickCli(["identify", "-format", "%g", "/shadow.png"], backend)).stdout).toBe(page);
    });
    it.each(cases)(`matches native shadow alpha at sigma $sigma (${mode})`, async ({ width, height, sigma, impulse, alpha }) => {
        const raw = Uint8Array.from(Array.from({ length: width * height }, (_, pixel) =>
            [255, 0, 0, !impulse || pixel === 4 ? 255 : 0]).flat());
        const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-shadow", `80x${sigma}+0+0`, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width + sigma * 4, height + sigma * 4]);
        expect(Array.from(output.data).filter((_, index) => index % 4 === 3)).toEqual(alpha);
    });
}
