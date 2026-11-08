import { expect, it } from "vitest";
import { encodeHdrImage, encodeHdrFromStorage } from "./hdr-output.js";
import type { RgbaImage } from "../ast.js";

for (const width of [1, 7, 8, 129, 513, 32768]) for (const depth of [8, 16, 32]) {
    it(`encodes bounded stored RGBE scanlines, width=${width}, depth=${depth}`, async () => {
        const values = Array.from({ length: width * 2 * 4 }, (_, i) => i % 4 === 3 ? 0 : (i % 17) / 16);
        const samples = depth === 32 ? Float32Array.from(values) : depth === 16 ? Uint16Array.from(values.map(v => v * 65535)) : Uint8Array.from(values.map(v => v * 255));
        const image: RgbaImage = { width, height: 2, data: new Uint8Array(values.length), ...(samples instanceof Float32Array ? { dataFloat: samples } : samples instanceof Uint16Array ? { data16: samples } : { data: samples }), hasAlpha: true, channels: 4, format: "raw", depth: "uchar", space: "srgb" };
        const bytes = new Uint8Array(samples.buffer), chunks: Uint8Array[] = [];
        for await (const chunk of encodeHdrFromStorage({ ...image, position: 0, ...(depth === 32 ? { storedDataFloat: { position: 0 } } : depth === 16 ? { storedData16: { position: 0 } } : {}) }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) { expect(length).toBeLessThanOrEqual(8192); return bytes.subarray(position, position + length); }
        }, new AbortController().signal)) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encodeHdrImage(image)));
    });
}

it("encodes black, white and shared-exponent primaries without alpha", () => {
    const image: RgbaImage = { width: 4, height: 1, data: Uint8Array.of(0,0,0,255,255,255,255,0,255,0,0,0,0,255,0,128), hasAlpha: true, channels: 4, format: "raw", depth: "uchar", space: "srgb" };
    expect([...encodeHdrImage(image).slice(-16)]).toEqual([0,0,0,0,128,128,128,129,128,0,0,129,0,128,0,129]);
});
