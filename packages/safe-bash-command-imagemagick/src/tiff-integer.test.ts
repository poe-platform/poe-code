import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function integerTiff(signed: boolean, little: boolean): Uint8Array {
    const values = signed ? [-2147483648, -1073741824, 0, 1073741823, 2147483647] : [0, 1073741824, 2147483648, 3221225471, 4294967295];
    const ifd = 8 + values.length * 4;
    const tags = [[256, values.length], [257, 1], [258, 32], [259, 1], [262, 1], [273, 8], [277, 1], [278, 1], [279, ifd - 8], [339, signed ? 2 : 1]];
    const bytes = new Uint8Array(ifd + 2 + tags.length * 12 + 4), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
    view.setUint32(4, ifd, little);
    values.forEach((value, i) => {
        if (signed) view.setInt32(8 + i * 4, value, little);
        else view.setUint32(8 + i * 4, value, little);
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
        it.each([false, true])(`converts 32-bit integer TIFF intensities (signed=%s) (${mode}, ${little ? "little" : "big"} endian)`, async signed => {
            const input = integerTiff(signed, little), files = new Map([["/in.tif", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.tif", input);
            const args = ["/in.tif", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect(Array.from(decodeImage(output).data)).toEqual((signed ? [128, 191, 0, 64, 128] : [0, 64, 128, 191, 255]).flatMap(gray => [gray, gray, gray, 255]));
        });
    }
}
