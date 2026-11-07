import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function floatTiff(bits: number, little: boolean): Uint8Array {
    const values = [0, .25, .5, .75, 1, -.5, 2];
    const halfBits = [0, 0x3400, 0x3800, 0x3a00, 0x3c00, 0xb800, 0x4000];
    const ifd = 8 + values.length * bits / 8;
    const tags = [[256, values.length], [257, 1], [258, bits], [259, 1], [262, 1], [273, 8], [277, 1], [278, 1], [279, ifd - 8], [339, 3]];
    const bytes = new Uint8Array(ifd + 2 + tags.length * 12 + 4), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
    view.setUint32(4, ifd, little);
    values.forEach((value, i) => {
        const offset = 8 + i * bits / 8;
        if (bits === 16) view.setUint16(offset, halfBits[i]!, little);
        else if (bits === 32) view.setFloat32(offset, value, little);
        else view.setFloat64(offset, value, little);
    });
    view.setUint16(ifd, tags.length, little);
    tags.forEach(([tag, value], i) => {
        const offset = ifd + 2 + i * 12;
        view.setUint16(offset, tag!, little);
        view.setUint16(offset + 2, 4, little);
        view.setUint32(offset + 4, 1, little);
        view.setUint32(offset + 8, value!, little);
    });
    return bytes;
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const little of [true, false]) {
        it.each([16, 32, 64])(`converts float%i TIFF intensities (${mode}, ${little ? "little" : "big"} endian)`, async bits => {
            const input = floatTiff(bits, little), files = new Map([["/in.tif", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.tif", input);
            const args = ["/in.tif", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect(Array.from(decodeImage(output).data)).toEqual([0, 64, 128, 191, 255, 0, 255].flatMap(gray => [gray, gray, gray, 255]));
        });
    }
}
