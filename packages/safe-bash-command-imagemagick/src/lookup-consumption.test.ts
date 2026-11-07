import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const operation of ["-clut", "-hald-clut"])
for (const extra of [false, true])
it(`${mode}: ${operation} consumes the image list, extra=${extra}`, async () => {
    const hald = operation === "-hald-clut";
    const files = new Map<string, Uint8Array>();
    const images = hald
        ? [Uint8Array.of(64, 128, 192, 255), ...[false, true].map(inverted => Uint8Array.from({ length: 256 }, (_, offset) => {
            const channel = offset % 4;
            if (channel === 3) return 255;
            const value = Math.floor(Math.floor(offset / 4) / 4 ** channel) % 4 * 85;
            return inverted ? 255 - value : value;
        }))]
        : [Uint8Array.of(64, 128, 192, 255), Uint8Array.of(128, 128, 128, 255), Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255)];
    for (const [index, data] of images.entries()) {
        const width = hald && index > 0 ? 8 : data.length / 4;
        files.set(`/${index}.png`, encodeImage({ width, height: data.length / 4 / width, data,
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const filesystem = new MemoryFileSystem();
    for (const [path, data] of files) await filesystem.writeFile(path, data);
    const args = ["/0.png", "/1.png", ...(extra ? ["/2.png"] : []), operation, "+append", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([1, 1]);
    // ImageMagick 7: CLUT uses the second image; Hald CLUT uses the last.
    expect([...output.data]).toEqual(hald ? (extra ? [191, 127, 63, 255] : [64, 128, 192, 255]) : [128, 128, 128, 255]);
});
