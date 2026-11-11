import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";
import { decodePhmToStorage } from "./codecs/phm-storage.js";

for (const little of [false, true]) it(`decodes grayscale half-float edge values, little=${little}`, async () => {
    const samples = [0, 0x8000, 1, 0x3ff, 0x400, 0x3800, 0xbc00, 0x7bff, 0x7c00, 0xfc00, 0x7e00];
    const header = Buffer.from(`Ph\n${samples.length} 1\n${little ? "-1.0" : "1.0"}\n`);
    const bytes = Buffer.alloc(header.length + samples.length * 2);
    bytes.set(header);
    samples.forEach((sample, i) => little ? bytes.writeUInt16LE(sample, header.length + i * 2) : bytes.writeUInt16BE(sample, header.length + i * 2));
    const image = decodeImage(bytes);
    expect(Array.from(image.data).filter((_, i) => i % 4 === 0)).toEqual([0, 0, 0, 0, 0, 128, 0, 255, 255, 0, 0]);
    expect(Array.from(image.data16!).filter((_, i) => i % 4 === 0)).toEqual([0, 0, 0, 4, 4, 32768, 0, 65535, 65535, 0, 0]);
    expect(Array.from(image.dataFloat!).filter((_, i) => i % 4 === 0)).toEqual([0, -0, 2 ** -24, 1023 * 2 ** -24, 2 ** -14, 0.5, -1, 65504, Infinity, -Infinity, NaN]);
    const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
    const signal = new AbortController().signal;
    expect(await readImageMetadataFromSource(source, signal)).toEqual(readImageMetadata(bytes));
    const data = new Uint8Array(samples.length * 28);
    let end = 0;
    const storage = {
        allocate(length: number) { const position = end; end += length; return position; },
        async write(position: number, bytes: Uint8Array) { data.set(bytes, position); },
        async read(position: number, length: number) { return data.subarray(position, position + length); }
    };
    const stored = await decodePhmToStorage(source, storage, signal);
    expect(data.subarray(stored.position, stored.position + image.data.length)).toEqual(image.data);
    expect(new Uint16Array(data.buffer, stored.storedData16!.position, image.data16!.length)).toEqual(image.data16);
    expect(new Float32Array(data.buffer.slice(stored.storedDataFloat!.position, stored.storedDataFloat!.position + image.dataFloat!.byteLength))).toEqual(image.dataFloat);
    expect(() => decodeImage(bytes, { limitInputPixels: 1 })).toThrow();
    await expect(decodePhmToStorage(source, storage, signal, { limitInputPixels: 1 })).rejects.toThrow();
    await expect(decodePhmToStorage({ ...source, size: bytes.length - 1 }, storage, signal)).rejects.toThrow("Truncated PHM raster");
});
