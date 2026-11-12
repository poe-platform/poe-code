import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const format of ["psd", "psb"] as const) {
    it(`omits default physical resolution from buffered and stored ${format}`, async () => {
        const image: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "raw", channels: 3, depth: "uchar", space: "srgb", hasAlpha: false, density: 72 };
        const encoded = encodeImage(image, { format }).data;
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeStoredImage({ ...image, position: 0 }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) { return image.data.subarray(position, position + length); }
        }, new AbortController().signal, { format })) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded));
        expect(new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(30)).toBe(0);
        for (const page of [0, 1]) {
            const decoded = decodeImage(encoded, { page });
            expect(decoded.resolution).toBeUndefined();
            expect(decoded.density).toBe(72);
            expect(decoded.data).toEqual(image.data);
        }
    });
}
