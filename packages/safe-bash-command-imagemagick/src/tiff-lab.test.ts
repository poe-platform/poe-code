import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent uncompressed TIFF: Pillow LAB bytes are signed on disk.
function tiff(little: boolean): Uint8Array {
    const pixels = [127, 0, 0, 64, 12, 218, 190, 218, 32];
    const tags = [[256, 3], [257, 1], [258, 8], [259, 1], [262, 8], [273, 8], [277, 3], [278, 1], [279, 9]];
    const bytes = new Uint8Array(18 + 2 + tags.length * 12 + 4), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
    view.setUint32(4, 18, little);
    bytes.set(pixels, 8);
    view.setUint16(18, tags.length, little);
    tags.forEach(([tag, value], i) => {
        const offset = 20 + i * 12;
        view.setUint16(offset, tag!, little);
        view.setUint16(offset + 2, 4, little);
        view.setUint32(offset + 4, 1, little);
        view.setUint32(offset + 8, value!, little);
    });
    return bytes;
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([true, false])(`converts signed CIELab TIFF pixels to sRGB (${mode}, little=%s)`, async little => {
        const input = tiff(little), files = new Map([["/in.tif", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", input);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        // ImageMagick 7.1.2 TIFF -> PNG reference: neutral and both chromatic pixels.
        expect(Array.from(decodeImage(output).data)).toEqual([118, 118, 118, 255, 30, 57, 116, 255, 131, 200, 123, 255]);
    });
}
