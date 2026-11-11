import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        for (const hasAlpha of [false, true]) {
            it.each(["none", "FloydSteinberg", "Riemersma"])(`${mode}: remaps ${depth}-bit ${hasAlpha ? "RGBA" : "RGB"} with %s dithering`, async dither => {
                const input = encodeImage({ width: 1, height: 1,
                    data: Uint8Array.of(35, 70, 160, 255),
                    ...(depth === 16 ? { data16: Uint16Array.of(35 * 257, 70 * 257, 160 * 257, 65535) } : {}),
                    format: "png", space: "srgb", channels: hasAlpha ? 4 : 3,
                    depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha
                }, { format: "png" }).data;
                expect(decodeImage(input).hasAlpha).toBe(hasAlpha);
                for (const paletteAlpha of [0, 64, 255]) {
                    const palette = encodeImage({ width: 1, height: 1,
                        data: Uint8Array.of(0, 0, 255, paletteAlpha),
                        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
                    }, { format: "png" }).data;
                    const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
                    await fs.writeFile("/in.png", input);
                    await fs.writeFile("/palette.png", palette);
                    const argv = ["in.png", ...(dither === "none" ? ["+dither"] : ["-dither", dither]), "-remap", "palette.png", depth === 8 ? "PNG32:out.png" : "PNG64:out.png"];
                    const args = createCommandArguments(argv);
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} }, stderr: { async write() {} }
                    }) : mode === "sync" ? runConvertCliSync(argv, files)
                        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect(result.exitCode).toBe(0);
                    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
                    const decoded = decodeImage(output);
                    // Native ImageMagick keeps RGB opaque, but copies palette alpha for RGBA,
                    // even when every source alpha sample is fully opaque.
                    const alpha = hasAlpha ? paletteAlpha : 255;
                    const blue = paletteAlpha === 0 ? 0 : 255;
                    expect(Array.from(decoded.data)).toEqual([0, 0, blue, alpha]);
                    if (depth === 16) expect(Array.from(decoded.data16!)).toEqual([0, 0, blue * 257, alpha * 257]);
                }
            });
        }
    }
}
