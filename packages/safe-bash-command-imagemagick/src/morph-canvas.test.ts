import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem"])
for (const reverse of [false, true])
it(`resizes intermediate morph canvas metadata: ${mode}, reverse=${reverse}`, async () => {
    const small = encodeImage({ width: 2, height: 2, data: Uint8Array.of(0,0,0,255, 0,0,0,255, 0,0,0,255, 255,255,255,255), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, virtualCanvas: { width: 20, height: 20, x: 4, y: 8 } }, { format: "png" }).data;
    const big = encodeImage({ width: 6, height: 4, data: Uint8Array.from(Array.from({ length: 24 }, () => [0,0,255,255]).flat()), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, virtualCanvas: { width: 30, height: 30, x: reverse ? -8 : 8, y: reverse ? -6 : 6 } }, { format: "png" }).data;
    const files = new Map([["/small.png", small], ["/big.png", big]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [...(reverse ? ["/big.png", "/small.png"] : ["/small.png", "/big.png"]), "-morph", "1", "/out-%d.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const outputs = await Promise.all([0, 1, 2].map(async frame => decodeImage(mode === "filesystem" ? await fs.readFile(`/out-${frame}.png`) : files.get(`/out-${frame}.png`)!)));
    // Native ImageMagick 7.1.2: canvas scales from the first frame, including signed offsets.
    expect(outputs[1]!.virtualCanvas).toEqual(reverse ? { width: 20, height: 23, x: -5, y: -4 } : { width: 40, height: 30, x: 6, y: 12 });
    expect([outputs[1]!.width, outputs[1]!.height]).toEqual([4, 3]);
    if (!reverse) expect([...outputs[1]!.data]).toEqual([0,0,128,255, 0,0,127,255, 0,0,127,255, 0,0,126,255, 0,0,126,255, 16,16,143,255, 48,48,176,255, 66,66,193,255, 0,0,124,255, 32,32,159,255, 97,97,224,255, 132,132,255,255]);
    for (const [frame, bytes] of [[0, reverse ? big : small], [2, reverse ? small : big]] as const) {
        const input = decodeImage(bytes);
        expect(outputs[frame]!.virtualCanvas).toEqual(input.virtualCanvas);
        expect(outputs[frame]!.data).toEqual(input.data);
    }
});
