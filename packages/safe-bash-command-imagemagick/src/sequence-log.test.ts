import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick Q16-HDRI reference, decoded as 8-bit RGB.
const samples = [[36, 108, 201], [83, 17, 223], [194, 150, 49]];
for (const mode of ["filesystem", "buffered", "sync"] as const)
for (const { name, pixels, log, inverse, mean } of [
    { name: "forward", pixels: samples, log: [249, 242, 217], inverse: [255, 255, 255], mean: [104, 92, 158] },
    { name: "reverse", pixels: [...samples].reverse(), log: [210, 235, 250], inverse: [255, 255, 131], mean: [104, 92, 158] },
    { name: "single", pixels: [samples[0]!], log: samples[0]!, inverse: samples[0]!, mean: samples[0]! },
    { name: "zero", pixels: [[0, 0, 0], [0, 0, 0]], log: [0, 0, 0], inverse: [255, 255, 255], mean: [0, 0, 0] },
    { name: "zero parameter", pixels: [[0, 0, 0], [128, 128, 128]], log: [0, 0, 0], inverse: [255, 255, 255], mean: [64, 64, 64] },
    { name: "zero sample", pixels: [[255, 255, 255], [0, 0, 0]], log: [0, 0, 0], inverse: [0, 0, 0], mean: [128, 128, 128] },
])
it.each(["Log", "InverseLog", "Mean"])(`evaluates sequence %s (${mode}, ${name})`, async operation => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    for (const [index, rgb] of pixels.entries()) {
        const input = encodeImage({ width: 1, height: 1, data: Uint8Array.of(...rgb, 255),
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        files.set(`/in${index}.png`, input);
        await filesystem.writeFile(`/in${index}.png`, input);
    }
    const args = [...files.keys(), "-evaluate-sequence", operation, "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode !== "filesystem" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
    const expected = operation === "Mean" ? mean : operation === "Log" ? log : inverse;
    expect(Array.from(output.data)).toEqual([...expected, 255]);
});
