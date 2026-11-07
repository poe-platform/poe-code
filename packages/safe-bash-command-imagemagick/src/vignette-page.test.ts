import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["white", [[65535,65535,65535,65535], [65535,65535,65535,65535], [17746,28843,43470,65535], [12385,24727,40995,65535], [18262,29240,43709,65535], [65533,65534,65534,65535], [65535,65535,65535,65535]]],
        ["none", [[0,0,0,0], [12385,24727,40995,0], [12385,24727,40995,58925], [12385,24727,40995,65535], [12385,24727,40995,58288], [12385,24727,40995,2], [0,0,0,0]]],
        ["#12345680", [[4626,13364,22102,32896], [4626,13364,22102,32896], [11971,24121,39988,62243], [12385,24727,40995,65535], [11929,24060,39885,61926], [4626,13365,22103,32897], [4626,13364,22102,32896]]],
    ] as const)(`preserves native 16-bit positioned vignette pixels on %s (${mode})`, async (background, expected) => {
        const data16 = Uint16Array.from({ length: 20 * 16 * 4 }, (_, i) => [0x3061, 0x6097, 0xa023, 0x8021][i % 4]!);
        const input = encodeImage({ width: 20, height: 16, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16,
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true,
            virtualCanvas: { width: 40, height: 36, x: 5, y: 3 } }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-background", background, "-vignette", "0x1+3+2", "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([40, 36]);
        expect(output.data16).toBeDefined();
        // Native ImageMagick 7.1.2 Q16-HDRI samples, including canvas, feather and opaque center.
        for (const [i, [x, y]] of [[0,0], [5,3], [10,8], [15,11], [19,15], [24,18], [25,19]].entries()) {
            for (let channel = 0; channel < 4; channel++) {
                expect(Math.abs(output.data16![(y! * 40 + x!) * 4 + channel]! - expected[i]![channel]!)).toBeLessThanOrEqual(1);
            }
        }
    });
    it.each([
        ["40x36+5+3", false, 40, 36, 5, 3],
        ["10x10+5+3", false, 10, 10, 5, 3],
        ["0x0-5-3", false, 20, 16, -5, -3],
        ["40x36+5+3", true, 20, 16, 0, 0],
    ] as const)(`renders vignette pixels onto page %s, reset=%s (${mode})`, async (page, reset, width, height, offsetX, offsetY) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const read = async (name: string) => decodeImage(mode === "retained" ? await filesystem.readFile(name) : files.get(name)!);
        expect((await run(["-size", "20x16", "xc:#3061a080", "-repage", page, "/input.png"])).exitCode).toBe(0);
        const result = await run(["/input.png", ...(reset ? ["+repage"] : []), "-vignette", "0x1+3+2", "/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(`${width}x${height} ${width}x${height}+0+0`);
        expect((await run(["/input.png", "+repage", "-vignette", "0x1+3+2", "/local.png"])).exitCode).toBe(0);
        const output = await read("/output.png"), local = await read("/local.png");
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const sx = x - offsetX, sy = y - offsetY, position = (y * width + x) * 4;
            const expected = sx >= 0 && sx < 20 && sy >= 0 && sy < 16
                ? local.data.slice((sy * 20 + sx) * 4, (sy * 20 + sx + 1) * 4) : Uint8Array.of(255, 255, 255, 255);
            expect(output.data.slice(position, position + 4)).toEqual(expected);
        }
        if (width === 40) {
            expect(Array.from(output.data.slice((18 * 40 + 15) * 4, (18 * 40 + 15) * 4 + 4))).toEqual([192, 207, 226, 255]);
            // Native ImageMagick 7.1.2 Q16-HDRI, RGBA8.
            expect(Array.from(output.data.slice((8 * 40 + 10) * 4, (8 * 40 + 10) * 4 + 4))).toEqual([69, 113, 170, 255]);
        }
    });
}
