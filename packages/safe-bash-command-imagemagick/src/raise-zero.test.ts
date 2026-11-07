import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
for (const raised of [true, false])
for (const geometry of ["0x0", "2x0", "0x2"])
it(`matches native zero-dimension raise: ${geometry}, ${raised}, ${depth}-bit, ${mode}`, async () => {
    const source = [64, 96, 128, 255];
    const data = Uint8Array.from(Array.from({ length: 25 }, () => source).flat());
    const input = encodeImage({ width: 5, height: 5, data,
        ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257) } : {}),
        format: "png", space: "srgb", channels: 3, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", raised ? "-raise" : "+raise", geometry, "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    // Native ImageMagick Q16: center, top, left, right, bottom shades.
    const shades = depth === 16
        ? [[16448, 24672, 32896], [39548, 43902, 48256], [28960, 35088, 41216], [12255, 18383, 24511], [8708, 13062, 17416]]
        : [[64, 96, 128], [154, 171, 188], [113, 137, 160], [48, 72, 95], [34, 51, 68]];
    const regions = geometry === "0x0" ? Array<number>(25).fill(0)
        : geometry === "2x0" ? Array.from({ length: 5 }, () => [2, 2, 0, 3, 3]).flat()
        : [1, 1, 1, 1, 1, 2, 1, 1, 1, 3, 0, 0, 0, 0, 0, 2, 2, 4, 3, 3, 2, 4, 4, 4, 3];
    const expected = regions.flatMap(region => [...shades[raised || region === 0 ? region : 5 - region]!, depth === 16 ? 65535 : 255]);
    expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(expected);
});
