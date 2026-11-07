import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent full-resolution uncompressed YCbCr TIFF, matching Pillow output.
function tiff(little: boolean, pixels: Uint8Array = Uint8Array.of(128, 128, 128, 76, 85, 255, 150, 44, 21), compression = 1): Uint8Array {
    const directory = 8 + pixels.length;
    const tags = [[256, 3], [257, 1], [258, 8], [259, compression], [262, 6], [273, 8], [277, 3], [278, 1], [279, pixels.length], [530, 0x00010001]];
    const bytes = new Uint8Array(directory + 2 + tags.length * 12 + 4), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
    view.setUint32(4, directory, little);
    bytes.set(pixels, 8);
    view.setUint16(directory, tags.length, little);
    tags.forEach(([tag, value], i) => {
        const offset = directory + 2 + i * 12;
        view.setUint16(offset, tag!, little);
        view.setUint16(offset + 2, tag === 530 ? 3 : 4, little);
        view.setUint32(offset + 4, tag === 530 ? 2 : 1, little);
        view.setUint32(offset + 8, value!, little);
    });
    return bytes;
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([true, false])(`converts YCbCr TIFF pixels to sRGB (${mode}, little=%s)`, async little => {
        const input = tiff(little), files = new Map([["/in.tif", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", input);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        // ImageMagick 7.1.2 TIFF -> PNG reference: neutral and both chromatic pixels.
        expect(Array.from(decodeImage(output).data)).toEqual([128, 128, 128, 255, 254, 0, 0, 255, 0, 255, 1, 255]);
    });
}

for (const compression of [6, 7]) {
    it(`does not convert embedded JPEG RGB pixels twice (compression=${compression})`, async () => {
        const jpeg = encodeImage({
            width: 3, height: 1, data: Uint8Array.of(128, 128, 128, 255, 254, 0, 0, 255, 0, 255, 1, 255),
            format: "raw", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "jpeg" }).data;
        const input = tiff(true, jpeg, compression);
        const expected = decodeImage(jpeg).data;
        for (const mode of ["sync", "buffered", "retained"] as const) {
            const files = new Map([["/in.tif", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.tif", input);
            const args = ["/in.tif", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect(decodeImage(output).data).toEqual(expected);
        }
    });
}
