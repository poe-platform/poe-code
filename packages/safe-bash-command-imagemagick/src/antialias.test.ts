import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
it(`draws native hard circle edges and restores antialiasing (${mode}, ${depth}-bit)`, async () => {
    const source = depth === 16 ? [0x3021, 0x6043, 0xa065, 0x8123] : [48, 96, 160, 128];
    const samples = Array.from({ length: 20 * 16 * 4 }, (_, i) => source[i % 4]!);
    const input = encodeImage({ width: 20, height: 16, data: Uint8Array.from(samples, v => depth === 16 ? Math.round(v / 257) : v),
        ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}), format: "png", space: "srgb", channels: 4,
        depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const run = async (options: string[], output: string) => {
        const args = ["/input.png", ...options, output];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        return decodeImage(mode === "retained" ? await filesystem.readFile(output) : files.get(output)!);
    };
    const draw = ["-fill", "red", "-draw", "circle 10,8 14,8"];
    const hard = await run(["+antialias", ...draw], "/hard.png");
    const data = depth === 16 ? hard.data16! : hard.data;
    expect(data).toBeDefined();
    // Native ImageMagick Q16: fully covered x ranges for rows 4 through 12.
    const ranges = [[9, 11], [7, 13], [7, 13], [6, 14], [6, 14], [6, 14], [7, 13], [7, 13], [9, 11]];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 20; x++) {
        const range = ranges[y - 4], inside = range && x >= range[0]! && x <= range[1]!;
        expect(Array.from(data.slice((y * 20 + x) * 4, (y * 20 + x + 1) * 4)), `${x},${y}`).toEqual(
            inside ? [depth === 16 ? 65535 : 255, 0, 0, depth === 16 ? 65535 : 255] : source);
    }
    const smooth = await run(draw, "/smooth.png");
    const restored = await run(["+antialias", "-antialias", ...draw], "/restored.png");
    expect(restored.data).toEqual(smooth.data);
    expect(hard.data).not.toEqual(smooth.data);
    await run(["+antialias", "-vignette", "0x1+3+2"], "/vignette.png");
});

for (const mode of ["buffered", "retained"] as const)
it.each(["ellipse 10,8 4,3 0,360", "roundrectangle 4,3 16,13 4,4"])(`disables SVG curve smoothing without discarding fill opacity (${mode}): %s`, async drawing => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "20x16", "xc:none", "+antialias", "-fill", "#ff000080", "-draw", drawing, "/out.png"];
    const result = await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    const alphas = new Set(image.data.filter((_, i) => i % 4 === 3));
    expect(alphas).toEqual(new Set([0, 128]));
});

it.each(["buffered", "retained"] as const)("accepts antialias switches in mogrify (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
    expect((await runMagickCli(["-size", "20x16", "xc:#3060a080", "/input.png"], input)).exitCode).toBe(0);
    const result = await runMagickCli(["mogrify", "-antialias", "+antialias", "-fill", "red", "-draw", "circle 10,8 14,8", "/input.png"], input);
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(mode === "retained" ? await filesystem.readFile("/input.png") : files.get("/input.png")!);
    expect(Array.from(image.data.slice((4 * 20 + 8) * 4, (4 * 20 + 9) * 4))).toEqual([48, 96, 160, 128]);
    expect(Array.from(image.data.slice((4 * 20 + 9) * 4, (4 * 20 + 10) * 4))).toEqual([255, 0, 0, 255]);
});
