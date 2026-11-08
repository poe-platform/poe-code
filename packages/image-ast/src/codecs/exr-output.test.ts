import { expect, it } from "vitest";
import { encodeExrImage, encodeExrFromStorage } from "./exr-output.js";
import type { RgbaImage } from "../ast.js";

for (const alpha of [false, true]) for (const depth of [8, 16, 32]) {
    it(`matches bounded stored output with alpha=${alpha}, depth=${depth}`, async () => {
        const width = 513, height = 2;
        const values = Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 0.5 : (i % 37) / 16 - 0.5);
        const samples = depth === 32 ? Float32Array.from(values) : depth === 16 ? Uint16Array.from(values.map(v => Math.max(0, Math.min(1, v)) * 65535)) : Uint8Array.from(values.map(v => Math.max(0, Math.min(1, v)) * 255));
        const data = new Uint8Array(values.length);
        const image: RgbaImage = { width, height, data, ...(samples instanceof Float32Array ? { dataFloat: samples } : samples instanceof Uint16Array ? { data16: samples } : { data: samples }), hasAlpha: alpha, channels: alpha ? 4 : 3, format: "raw", depth: "uchar", space: "srgb", density: 72 };
        const encoded = encodeExrImage(image), chunks: Uint8Array[] = [], bytes = new Uint8Array(samples.buffer);
        for await (const chunk of encodeExrFromStorage({ ...image, position: 0, ...(depth === 32 ? { storedDataFloat: { position: 0 } } : depth === 16 ? { storedData16: { position: 0 } } : {}) }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) { expect(length).toBeLessThanOrEqual(8192); return bytes.subarray(position, position + length); }
        }, new AbortController().signal)) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded));
        // Last channel is R; float samples retain negative and HDR values.
        const view = new DataView(encoded.buffer), start = encoded.length - width * 4;
        for (let x = 0; x < width; x++) expect(view.getFloat32(start + x * 4, true)).toBeCloseTo(samples[(width + x) * 4]! / (depth === 32 ? 1 : depth === 16 ? 65535 : 255), 6);
    });
}
