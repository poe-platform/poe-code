import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Classic TIFF: one uncompressed strip, with separate 16-bit R/G/B ColorMap planes.
function paletteTiff(bits: number, little: boolean) {
    const entries = 10, colors = 2 ** bits, paletteOffset = 8 + 2 + entries * 12 + 4;
    const pixelsOffset = paletteOffset + colors * 6;
    const bytes = new Uint8Array(pixelsOffset + 3 * bits / 8);
    const view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73] : [77, 77]);
    view.setUint16(2, 42, little);
    view.setUint32(4, 8, little);
    view.setUint16(8, entries, little);
    const tags = [[256, 4, 1, 3], [257, 4, 1, 1], [258, 3, 1, bits], [259, 3, 1, 1], [262, 3, 1, 3], [273, 4, 1, pixelsOffset], [277, 3, 1, 1], [278, 4, 1, 1], [279, 4, 1, 3 * bits / 8], [320, 3, colors * 3, paletteOffset]];
    tags.forEach(([tag, type, count, value], index) => {
        const at = 10 + index * 12;
        view.setUint16(at, tag!, little);
        view.setUint16(at + 2, type!, little);
        view.setUint32(at + 4, count!, little);
        if (type === 3 && count === 1) view.setUint16(at + 8, value!, little);
        else view.setUint32(at + 8, value!, little);
    });
    const indices = [0, 1, colors - 1];
    const rgb = [[65535, 0, 8224], [0, 65535, 0], [32639, 8224, 65535]];
    indices.forEach((index, pixel) => {
        for (let channel = 0; channel < 3; channel++) view.setUint16(paletteOffset + (channel * colors + index) * 2, rgb[pixel]![channel]!, little);
        if (bits === 16) view.setUint16(pixelsOffset + pixel * 2, index, little);
        else bytes[pixelsOffset + pixel] = index;
    });
    return bytes;
}

for (const bits of [8, 16]) for (const little of [true, false]) {
    it(`reports RGB metadata and preserves palette precision (${bits}, ${little})`, () => {
        const image = decodeImage(paletteTiff(bits, little));
        expect(image).toMatchObject({ channels: 3, hasAlpha: false, space: bits === 16 ? "rgb16" : "srgb" });
        if (bits === 16) expect(Array.from(image.data16!)).toEqual([65535, 0, 8224, 65535, 0, 65535, 0, 65535, 32639, 8224, 65535, 65535]);
    });
    it.each(["sync", "buffered", "retained"] as const)(`looks up ${bits}-bit TIFF palette colors (${little ? "LE" : "BE"}, %s)`, async mode => {
        const input = paletteTiff(bits, little);
        const files = new Map<string, Uint8Array>([["/in.tif", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", input);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual([255, 0, 32, 255, 0, 255, 0, 255, 127, 32, 255, 255]);
    });
}
