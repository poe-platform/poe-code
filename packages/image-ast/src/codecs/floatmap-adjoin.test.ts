import { expect, it } from "vitest";
import { encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const format of ["pfm", "phm"] as const) {
    it(`adjoins independently sized grayscale and RGB ${format} frames without losing float samples`, async () => {
        const pages: RgbaImage[] = [
            { width: 2, height: 1, channels: 1, space: "b-w", format, depth: "float", hasAlpha: false, data: new Uint8Array(8), dataFloat: Float32Array.of(-0.5, -0.5, -0.5, 1, 1.5, 1.5, 1.5, 1), properties: { comment: "gray" } },
            { width: 1, height: 2, channels: 3, space: "srgb", format, depth: "float", hasAlpha: false, data: new Uint8Array(8), dataFloat: Float32Array.of(0.125, 0.5, 1, 1, 2, 0.25, -1, 1), properties: { comment: "rgb" } }
        ];
        const expected = Buffer.concat([
            Buffer.from(`${format === "pfm" ? "Pf" : "Ph"}\n#gray\n2 1\n1.0\n`),
            Buffer.from(format === "pfm" ? "bf0000003fc00000" : "b8003e00", "hex"),
            Buffer.from(`${format === "pfm" ? "PF" : "PH"}\n#rgb\n1 2\n1.0\n`),
            Buffer.from(format === "pfm" ? "400000003e800000bf8000003e0000003f0000003f800000" : "40003400bc00300038003c00", "hex")
        ]);
        expect(Buffer.from(encodeImage({ ...pages[0]!, netpbmPages: pages }, { format }).data)).toEqual(expected);
        const memory = Buffer.concat(pages.map(page => new Uint8Array(page.dataFloat!.buffer)));
        const stored = pages.map((page, index) => ({ ...page, position: index * 32, storedDataFloat: { position: index * 32, length: 32 } }));
        const stream = encodeStoredImage({ ...stored[0]!, storedNetpbmPages: { length: stored.length, async at(index) { return stored[index]!; } } }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) { return memory.subarray(position, position + length); }
        }, new AbortController().signal, { format });
        const chunks: Uint8Array[] = [];
        let next = await stream.next();
        while (!next.done) { chunks.push(next.value); next = await stream.next(); }
        expect(Buffer.concat(chunks)).toEqual(expected);
        expect(next.value).toMatchObject({ format, width: 2, height: 1, channels: 1, size: expected.length });
    });
}
