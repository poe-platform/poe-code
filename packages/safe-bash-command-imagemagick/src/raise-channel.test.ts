import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
for (const option of ["-raise", "+raise"])
for (const selection of ["R", "A", "GB", "RGBA", "reset"])
it(`honors ${selection} channels for ${option}, ${depth}-bit, ${mode}`, async () => {
    const source = [64, 96, 128, 128];
    const data = Uint8Array.from(Array.from({ length: 120 }, () => source).flat());
    const input = encodeImage({ width: 12, height: 10, data,
        ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257) } : {}),
        format: "png", space: "srgb", channels: 4, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const channelArgs = selection === "reset" ? ["-channel", "A", "+channel"] : ["-channel", selection];
    // The trailing reset must not change the mask captured by retained execution.
    const args = ["/input.png", ...channelArgs, option, "2", "+channel", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    const pixels = depth === 16 ? output.data16! : output.data;
    const original = source.map(value => value * (depth === 16 ? 257 : 1));
    // Native ImageMagick Q16 top-left values for this input and bevel.
    const shade = depth === 16
        ? option === "-raise" ? [39548, 43902, 48256, 48256] : [8708, 13062, 17416, 17416]
        : option === "-raise" ? [154, 171, 188, 188] : [34, 51, 68, 68];
    const mask = selection === "reset" ? "RGBA" : selection;
    expect(Array.from(pixels.slice(0, 4))).toEqual(original.map((value, channel) => mask.includes("RGBA"[channel]!) ? shade[channel] : value));
    expect(Array.from(pixels.slice((5 * 12 + 5) * 4, (5 * 12 + 5) * 4 + 4))).toEqual(original);
    for (let offset = 0; offset < pixels.length; offset++) {
        if (!mask.includes("RGBA"[offset % 4]!)) expect(pixels[offset]).toBe(original[offset % 4]);
    }
});
