import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function tiff(values: number[], signed: boolean, little: boolean): Uint8Array {
    const ifd = 8 + values.length * 2;
    const tags = [[256, values.length], [257, 1], [258, 16], [259, 1], [262, 1], [273, 8], [277, 1], [278, 1], [279, values.length * 2], [339, signed ? 2 : 1]];
    const bytes = new Uint8Array(ifd + 2 + tags.length * 12 + 4), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
    view.setUint32(4, ifd, little);
    values.forEach((value, i) => view.setUint16(8 + i * 2, value, little));
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
        it.each([false, true])(`preserves 16-bit TIFF samples (${mode}, little=${little}, signed=%s)`, async signed => {
            const values = signed ? [-32768, -16384, 0, 16383, 32767] : [0, 16384, 32768, 49151, 65535];
            const input = tiff(values, signed, little), files = new Map([["/in.tif", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.tif", input);
            const args = ["/in.tif", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect(output[24]).toBe(16);
            expect(Array.from(decodeImage(output).data16!)).toEqual(values.flatMap(value => [value & 65535, value & 65535, value & 65535, 65535]));
        });
    }
}
