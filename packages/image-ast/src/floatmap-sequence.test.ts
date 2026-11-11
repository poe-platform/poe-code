import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";
import { decodePfmToStorage } from "./codecs/pfm-storage.js";
import { decodePhmToStorage } from "./codecs/phm-storage.js";

for (const format of ["pfm", "phm"] as const) {
    const frames = format === "pfm" ? [
        Buffer.from("50660a3220310a312e300a3e0000003f000000", "hex"),
        // RGB, little-endian, bottom row first, scaled by two.
        Buffer.concat([Buffer.from("PF\n1 2\n-2.0\n"), Buffer.from("000000000000803e0000003f0000003f0000000000000000", "hex")])
    ] : [
        Buffer.from("50680a3220310a312e300a30003800", "hex"),
        Buffer.concat([Buffer.from("PH\n1 2\n-2.0\n"), Buffer.from("000000340038003800000000", "hex")])
    ];
    const bytes = Buffer.concat(frames);
    const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
    const signal = new AbortController().signal;
    const decodeStored = format === "pfm" ? decodePfmToStorage : decodePhmToStorage;

    it(`counts ${format} frames in buffered and retained metadata`, async () => {
        expect(readImageMetadata(bytes)).toMatchObject({ pages: 2, width: 2, height: 1, size: bytes.length });
        expect(await readImageMetadataFromSource(source, signal)).toEqual(readImageMetadata(bytes));
        expect(readImageMetadata(bytes, { page: 1 })).toMatchObject({ width: 1, height: 2, channels: 3, size: bytes.length });
        expect(await readImageMetadataFromSource(source, signal, { page: 1 })).toEqual(readImageMetadata(bytes, { page: 1 }));
    });

    it(`selects ${format} frames with their own dimensions, channels, scale and endian`, async () => {
        const memory = new Uint8Array(256);
        let end = 0;
        const storage = {
            allocate(length: number) { const position = end; end += length; return position; },
            async write(position: number, data: Uint8Array) { memory.set(data, position); },
            async read(position: number, length: number) { return memory.slice(position, position + length); }
        };
        for (const page of [0, 1]) {
            const expected = decodeImage(frames[page]!);
            const image = decodeImage(bytes, { page });
            expect(image.data).toEqual(expected.data);
            expect(image.data16).toEqual(expected.data16);
            expect(image.dataFloat).toEqual(expected.dataFloat);
            const stored = await decodeStored(source, storage, signal, { page });
            expect(memory.slice(stored.position, stored.position + expected.data.length)).toEqual(expected.data);
        }
        expect(Array.from(decodeImage(bytes, { page: 1 }).data)).toEqual([255, 0, 0, 255, 0, 128, 255, 255]);
        expect(() => decodeImage(bytes, { page: 2 })).toThrow("page out of range");
        await expect(decodeStored(source, storage, signal, { page: 2 })).rejects.toThrow("page out of range");
        expect(() => decodeImage(bytes, { page: 1, limitInputPixels: 1 })).toThrow();
        await expect(decodeStored(source, storage, signal, { page: 1, limitInputPixels: 1 })).rejects.toThrow();
    });

    it(`rejects a truncated second ${format} raster during sequence inspection`, async () => {
        expect(() => readImageMetadata(bytes.subarray(0, -1))).toThrow(`Truncated ${format.toUpperCase()} raster`);
        await expect(readImageMetadataFromSource({ ...source, size: source.size - 1 }, signal)).rejects.toThrow(`Truncated ${format.toUpperCase()} raster`);
    });
}
