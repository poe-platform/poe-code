import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";
import { decodeMiffImage } from "./miff-input.js";

for (const depth of [8, 16] as const) for (const hasAlpha of [false, true]) {
    it.each(["none", "rle", "zip", "bzip"] as const)(`saves CMYK inks separately from alpha (${depth} bits, alpha=${hasAlpha}, %s)`, async compression => {
        const width = 1031, size = width * 4;
        const inks = [0x1234, 0x5678, 0x9abc, 0x3456];
        const hueSamples = Float64Array.from({ length: size }, (_, index) => (inks[index % 4]! + Math.floor(index / 4) % 257) / 65535);
        const data16 = Uint16Array.from({ length: size }, (_, index) => index % 4 === 3 ? 0x8001 : 0);
        const image: RgbaImage = { width, height: 1, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16, hueSamples,
            format: "miff", space: "cmyk", magickColorspace: "CMYK", hasAlpha, channels: hasAlpha ? 5 : 4, depth: "ushort", density: 72 };
        const backing = Buffer.concat([image.data, new Uint8Array(data16.buffer), new Uint8Array(hueSamples.buffer)]);
        const borrowed = new Uint8Array(16384);
        const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (position: number, length: number) => {
            expect(length).toBeLessThanOrEqual(borrowed.length);
            borrowed.fill(0); borrowed.set(backing.subarray(position, position + length));
            return borrowed.subarray(0, length);
        }) };
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeMiffFromStorage({ ...image, position: 0, storedData16: { position: size, length: size }, storedHueSamples: size * 3 }, storage, new AbortController().signal, depth, compression)) chunks.push(chunk);
        const expected = Float64Array.from(hueSamples, value => depth === 8 ? Math.round(value * 255) / 255 : value);
        for (const bytes of [encodeMiffImage(image, depth, compression), Buffer.concat(chunks)]) {
            const decoded = decodeMiffImage(bytes);
            expect(decoded).toMatchObject({ space: "cmyk", channels: image.channels, hasAlpha, width, height: 1 });
            expect(decoded.hueSamples).toEqual(expected);
            expect(decoded.data16?.filter((_, index) => index % 4 === 3).every(value => value === (hasAlpha ? depth === 8 ? 0x8080 : 0x8001 : 65535))).toBe(true);
        }
    });
}
