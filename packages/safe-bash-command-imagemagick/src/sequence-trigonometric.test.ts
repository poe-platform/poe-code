import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick Q16-HDRI reference, decoded as 8-bit RGB.
const samples = [[36, 108, 201], [83, 17, 223], [194, 150, 49]];
for (const mode of ["filesystem", "sync"] as const)
for (const { name, pixels, sine, cosine, mean } of [
    { name: "forward", pixels: samples, sine: [250, 80, 168], cosine: [251, 169, 202], mean: [104, 92, 158] },
    { name: "reverse", pixels: [...samples].reverse(), sine: [255, 128, 15], cosine: [251, 255, 100], mean: [104, 92, 158] },
    { name: "single", pixels: [samples[0]!], sine: samples[0]!, cosine: samples[0]!, mean: samples[0]! },
])
it.each(["Sine", "Sin", "Cosine", "Cos", "Mean"])(`evaluates sequence %s (${mode}, ${name})`, async operation => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    for (const [index, rgb] of pixels.entries()) {
        const input = encodeImage({ width: 1, height: 1, data: Uint8Array.of(...rgb, 255),
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        files.set(`/in${index}.png`, input);
        await filesystem.writeFile(`/in${index}.png`, input);
    }
    const args = [...files.keys(), "-evaluate-sequence", operation, "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual([...(operation === "Mean" ? mean : operation.startsWith("Sin") ? sine : cosine), 255]);
});
