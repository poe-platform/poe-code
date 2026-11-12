import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const format of ["psd", "psb"] as const) for (const alpha of [false, true]) for (const depth of [8, 16]) for (const gray of [false, true]) {
    it(`preserves ${format} samples and bounds stored reads (alpha=${alpha}, depth=${depth}, gray=${gray})`, async () => {
        const width = 513, height = 3;
        const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 256);
        const data16 = depth === 16 ? Uint16Array.from(data, (v, i) => v * 256 + i % 256) : undefined;
        if (gray) for (const samples of data16 ? [data, data16] : [data]) {
            for (let offset = 0; offset < samples.length; offset += 4) samples[offset + 1] = samples[offset + 2] = samples[offset]!;
        }
        const channels = gray ? alpha ? 2 : 1 : alpha ? 4 : 3;
        const image: RgbaImage = { width, height, data, ...(data16 ? { data16 } : {}), format: "raw", depth: data16 ? "ushort" : "uchar", space: gray ? depth === 16 ? "grey16" : "b-w" : "srgb", channels, hasAlpha: alpha, density: 72, resolution: { x: 20, y: 40, unit: "cm" } };
        const encoded = encodeImage(image, { format });
        expect(encoded).toMatchObject({ format, channels });
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
        }, new AbortController().signal, { format });
        let step = await steps.next();
        while (!step.done) { chunks.push(step.value); step = await steps.next(); }
        expect(step.value).toMatchObject({ format, channels, size: encoded.data.length });
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded.data));
        const view = new DataView(encoded.data.buffer);
        expect(view.getUint16(22)).toBe(depth);
        expect(view.getUint16(12)).toBe(channels);
        expect(view.getUint16(24)).toBe(gray ? 1 : 3);
        expect(view.getUint32(46) / 65536).toBeCloseTo(50.8, 4);
        expect(view.getUint32(54) / 65536).toBeCloseTo(101.6, 4);
        expect(view.getInt16(format === "psb" ? 78 : 70)).toBe(alpha ? -1 : 1);
        expect(view.getUint16(4)).toBe(format === "psb" ? 2 : 1);
        const layerOffset = format === "psb" ? 80 : 72;
        expect(view.getUint16(layerOffset + 16)).toBe(channels);
        for (let channel = 0; channel < channels; channel++) {
            expect(view.getInt16(layerOffset + 18 + channel * (format === "psb" ? 10 : 6)))
                .toBe(alpha && channel === channels - 1 ? -1 : channel);
        }
        let offset = format === "psb" ? 70 + Number(view.getBigUint64(62)) : 66 + view.getUint32(62);
        expect(view.getUint16(offset)).toBe(0);
        offset += 2;
        for (let channel = 0; channel < channels; channel++) for (let pixel = 0; pixel < width * height; pixel++) {
            const value = depth === 16 ? view.getUint16(offset) : view.getUint8(offset);
            expect(value).toBe((data16 ?? data)[pixel * 4 + (gray && channel === 1 ? 3 : channel)]);
            offset += depth / 8;
        }
        expect(offset).toBe(encoded.data.length);
        // RGB composites are decoded with white-matte removal; layer samples are straight.
        for (const page of !gray && alpha ? [1] : [0, 1]) {
            const decoded = decodeImage(encoded.data, { page });
            expect(decoded).toMatchObject({ channels, hasAlpha: alpha, bitsPerSample: depth, space: gray ? "b-w" : "srgb" });
            const expected = (data16 ?? data).slice();
            if (!alpha) for (let offset = 3; offset < expected.length; offset += 4) expected[offset] = depth === 16 ? 65535 : 255;
            expect(decoded.data16 ?? decoded.data).toEqual(expected);
        }
    });
}

it("rejects PSD dimensions beyond the v1 limit", () => {
    expect(() => encodeImage({ width: 30001, height: 1, data: new Uint8Array(), format: "raw", channels: 3, depth: "uchar", space: "srgb", hasAlpha: false, density: 72 }, { format: "psd" })).toThrow("PSD dimensions");
});


it("writes PSB dimensions beyond the PSD limit and rejects dimensions beyond PSB", () => {
    const image: RgbaImage = { width: 30001, height: 1, data: new Uint8Array(30001 * 4), format: "raw", channels: 3, depth: "uchar", space: "srgb", hasAlpha: false, density: 72 };
    const encoded = encodeImage(image, { format: "psb" });
    expect(new DataView(encoded.data.buffer).getUint32(18)).toBe(30001);
    expect(() => encodeImage({ ...image, width: 300001 }, { format: "psb" })).toThrow("PSB dimensions");
});

for (const format of ["psd", "psb"] as const) for (const hasAlpha of [false, true]) for (const depth of [8, 16]) {
    it(`writes CMYK planes independently from alpha (${format}, ${depth}, alpha=${hasAlpha})`, async () => {
        const width = 1031, size = width * 4;
        const hueSamples = Float64Array.from({ length: size }, (_, i) => ((i * 31) % 65536) / 65535);
        const data16 = Uint16Array.from({ length: size }, (_, i) => i % 4 === 3 ? 0x8001 : 0);
        const image: RgbaImage = { width, height: 1, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16, hueSamples,
            format: "raw", space: "cmyk", channels: hasAlpha ? 5 : 4, hasAlpha, depth: "ushort", bitsPerSample: depth, density: 72 };
        const encoded = encodeImage(image, { format });
        expect(encoded.channels).toBe(hasAlpha ? 5 : 4);
        const backing = Buffer.concat([image.data, new Uint8Array(data16.buffer), new Uint8Array(hueSamples.buffer)]);
        const chunks: Uint8Array[] = [];
        const steps = encodeStoredImage({ ...image, position: 0, storedData16: { position: size, length: data16.byteLength }, storedHueSamples: size * 3 }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) {
                expect(length).toBeLessThanOrEqual(16384);
                const bytes = new Uint8Array(length + 1);
                bytes.set(backing.subarray(position, position + length), 1);
                return bytes.subarray(1);
            }
        }, new AbortController().signal, { format });
        let step = await steps.next();
        while (!step.done) { chunks.push(step.value); step = await steps.next(); }
        expect(step.value.channels).toBe(hasAlpha ? 5 : 4);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded.data));
        const view = new DataView(encoded.data.buffer);
        expect(view.getUint16(24)).toBe(4);
        expect(view.getUint16(12)).toBe(hasAlpha ? 5 : 4);
        const section = 34 + view.getUint32(30);
        let offset = section + (format === "psb" ? 8 + Number(view.getBigUint64(section)) : 4 + view.getUint32(section)) + 2;
        for (let channel = 0; channel < (hasAlpha ? 5 : 4); channel++) for (let pixel = 0; pixel < width; pixel++) {
            const expected = channel === 4 ? depth === 8 ? 128 : 0x8001 : Math.round((1 - hueSamples[pixel * 4 + channel]!) * (depth === 8 ? 255 : 65535));
            expect(depth === 8 ? view.getUint8(offset) : view.getUint16(offset)).toBe(expected);
            offset += depth / 8;
        }
        expect(offset).toBe(encoded.data.length);
    });
}
