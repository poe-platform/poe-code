import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function fixture(width: number, rows: number, little: boolean, photometric: number, fillOrder: number) {
    const height = 19, stride = Math.ceil(width / 8), strips = Math.ceil(height / rows);
    const tags: [number, number, number[]][] = [
        [256, 4, [width]], [257, 4, [height]], [258, 3, [1]], [259, 3, [1]],
        [262, 3, [photometric]], [266, 3, [fillOrder]],
        [273, 4, Array.from({ length: strips }, (_, i) => 8 + i * rows * stride)],
        [277, 3, [1]], [278, 4, [rows]],
        [279, 4, Array.from({ length: strips }, (_, i) => Math.min(rows, height - i * rows) * stride)]
    ];
    const ifd = 8 + height * stride, extra = ifd + 2 + tags.length * 12 + 4;
    const bytes = new Uint8Array(extra + (strips > 1 ? strips * 8 : 0)), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
    view.setUint32(4, ifd, little);
    const expected: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const gray = x >= 2 && x <= 11 && y >= 3 && y <= 15 ? 0 : 255;
        expected.push(gray, gray, gray, 255);
        if (photometric === 0 ? gray === 0 : gray === 255) bytes[8 + y * stride + (x >>> 3)]! |= 1 << (fillOrder === 2 ? x % 8 : 7 - x % 8);
    }
    view.setUint16(ifd, tags.length, little);
    let tail = extra;
    tags.forEach(([tag, type, values], i) => {
        const at = ifd + 2 + i * 12, size = type === 3 ? 2 : 4;
        view.setUint16(at, tag, little); view.setUint16(at + 2, type, little); view.setUint32(at + 4, values.length, little);
        const start = values.length * size <= 4 ? at + 8 : tail;
        if (start === tail) { view.setUint32(at + 8, tail, little); tail += values.length * size; }
        values.forEach((value, j) => { if (size === 2) view.setUint16(start + j * size, value, little); else view.setUint32(start + j * size, value, little); });
    });
    return { bytes, expected };
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`matches the native ImageMagick one-bit rectangle (${mode})`, async () => {
        // magick -size 23x19 xc:white -fill black -draw 'rectangle 2,3 11,15' -type bilevel -depth 1 -compress None one.tif
        const bytes = Uint8Array.from(Buffer.from("SUkqAEIAAAD///7///7///7AD/7AD/7AD/7AD/7AD/7AD/7AD/7AD/7AD/7AD/7AD/7AD/7AD/7///7///7///4ADQAAAQMAAQAAABcAAAABAQMAAQAAABMAAAACAQMAAQAAAAEAAAADAQMAAQAAAAEAAAAGAQMAAQAAAAEAAAAKAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQMAAQAAABMAAAAXAQQAAQAAADkAAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQAAAAAA", "base64"));
        const files = new Map([["/in.tif", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", bytes);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(fixture(23, 19, true, 1, 1).expected);
    });
    it.each([
        [23, 19, true, 0, 1], [23, 4, false, 1, 1], [24, 4, true, 0, 1], [23, 4, true, 1, 2]
    ] as const)(`decodes packed bilevel TIFF (${mode}, width=%i, rows=%i, little=%s, photometric=%i, fillOrder=%i)`, async (width, rows, little, photometric, fillOrder) => {
        const { bytes, expected } = fixture(width, rows, little, photometric, fillOrder);
        const files = new Map([["/in.tif", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", bytes);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([width, 19]);
        expect(Array.from(image.data)).toEqual(expected);
    });
}
