import { expect, it } from "vitest";
import { encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const alpha of [false, true]) for (const depth of [8, 16]) {
    it(`preserves PSD samples and bounds stored reads (alpha=${alpha}, depth=${depth})`, async () => {
        const width = 513, height = 3;
        const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 256);
        const data16 = depth === 16 ? Uint16Array.from(data, (v, i) => v * 256 + i % 256) : undefined;
        const image: RgbaImage = { width, height, data, ...(data16 ? { data16 } : {}), format: "raw", depth: data16 ? "ushort" : "uchar", space: "srgb", channels: alpha ? 4 : 3, hasAlpha: alpha, density: 72, resolution: { x: 20, y: 40, unit: "cm" } };
        const encoded = encodeImage(image, { format: "psd" });
        expect(encoded).toMatchObject({ format: "psd", channels: alpha ? 4 : 3 });
        const backing = new Uint8Array((data16 ?? data).buffer), chunks: Uint8Array[] = [];
        const steps = encodeStoredImage({ ...image, position: 5, ...(data16 ? { storedData16: { position: 5, length: data16.byteLength } } : {}) }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) {
                expect(length).toBeLessThanOrEqual(8192);
                // A borrowed, unaligned buffer exercises ownership and sample alignment.
                const bytes = new Uint8Array(length + 1);
                bytes.set(backing.subarray(position - 5, position - 5 + length), 1);
                return bytes.subarray(1);
            }
        }, new AbortController().signal, { format: "psd" });
        let step = await steps.next();
        while (!step.done) { chunks.push(step.value); step = await steps.next(); }
        expect(step.value).toMatchObject({ format: "psd", channels: alpha ? 4 : 3, size: encoded.data.length });
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded.data));
        const view = new DataView(encoded.data.buffer);
        expect(view.getUint16(22)).toBe(depth);
        expect(view.getUint32(46) / 65536).toBeCloseTo(50.8, 4);
        expect(view.getUint32(54) / 65536).toBeCloseTo(101.6, 4);
        expect(view.getInt16(70)).toBe(alpha ? -1 : 1);
        let offset = 66 + view.getUint32(62);
        expect(view.getUint16(offset)).toBe(0);
        offset += 2;
        for (let channel = 0; channel < (alpha ? 4 : 3); channel++) for (let pixel = 0; pixel < width * height; pixel++) {
            const value = depth === 16 ? view.getUint16(offset) : view.getUint8(offset);
            expect(value).toBe((data16 ?? data)[pixel * 4 + channel]);
            offset += depth / 8;
        }
        expect(offset).toBe(encoded.data.length);
    });
}

it("rejects PSD dimensions beyond the v1 limit", () => {
    expect(() => encodeImage({ width: 30001, height: 1, data: new Uint8Array(), format: "raw", channels: 3, depth: "uchar", space: "srgb", hasAlpha: false, density: 72 }, { format: "psd" })).toThrow("PSD dimensions");
});
