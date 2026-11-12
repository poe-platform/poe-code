import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeStoredImage } from "../image-encode.js";
import { encodeImage } from "./index.js";

for (const format of ["psd", "psb"] as const) for (const depth of [8, 16]) for (const alpha of [false, true]) {
    it.each(["rle", "zip"] as const)(`${format} ${depth}-bit alpha=${alpha}: compresses layers and composite with %s`, async psdCompression => {
        const width = 1100, height = 3, channels = alpha ? 4 : 3;
        // Repeats, literal runs, 128-byte boundaries and multiple storage chunks/rows.
        const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 1000 < 520 ? 17 : i % 251);
        const data16 = depth === 16 ? Uint16Array.from(data, (value, i) => value * 256 + i % 256) : undefined;
        const image: RgbaImage = { width, height, data, ...(data16 ? { data16 } : {}), format: "raw", depth: data16 ? "ushort" : "uchar", space: "srgb", channels, hasAlpha: alpha, density: 72 };
        const options = { format, psdCompression };
        const bytes = Buffer.from(encodeImage(image, options).data);
        const backing = new Uint8Array((data16 ?? data).buffer), chunks: Uint8Array[] = [];
        for await (const chunk of encodeStoredImage({ ...image, position: 0, ...(data16 ? { storedData16: { position: 0, length: backing.length } } : {}) }, {
            allocate() { throw new Error("Must not allocate storage"); },
            async write() { throw new Error("Must not mutate storage"); },
            async read(position, length) {
                expect(length).toBeLessThanOrEqual(8192);
                return backing.slice(position, position + length);
            }
        }, new AbortController().signal, options)) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(bytes);
        const large = format === "psb", lengthBytes = large ? 8 : 4, rowLengthBytes = large ? 4 : 2;
        const length = (at: number) => large ? Number(bytes.readBigUInt64BE(at)) : bytes.readUInt32BE(at);
        const section = 34 + bytes.readUInt32BE(30);
        const compositeOffset = section + lengthBytes + length(section);
        let offset = section + 2 * lengthBytes;
        expect(bytes.readInt16BE(offset)).toBe(alpha ? -1 : 1);
        offset += 20;
        const channelLengths: number[] = [];
        for (let channel = 0; channel < channels; channel++, offset += 2 + lengthBytes) channelLengths.push(length(offset + 2));
        offset += 12;
        offset += 4 + bytes.readUInt32BE(offset);
        const readPlane = (rowLengths: number[]): Buffer => {
            if (psdCompression === "zip") {
                const result = inflateSync(bytes.subarray(offset), { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
                offset += result.engine.bytesWritten;
                return result.buffer;
            }
            const samples: number[] = [];
            for (const rowLength of rowLengths) {
                const end = offset + rowLength, start = samples.length;
                while (offset < end) {
                    const count = bytes[offset++]!;
                    if (count < 128) for (let i = 0; i <= count; i++) samples.push(bytes[offset++]!);
                    else if (count > 128) samples.push(...Array<number>(257 - count).fill(bytes[offset++]!));
                }
                expect(offset).toBe(end);
                expect(samples.length - start).toBe(width * depth / 8);
            }
            return Buffer.from(samples);
        };
        const readRowLengths = (count: number): number[] => Array.from({ length: psdCompression === "rle" ? count : 0 }, () => {
            const value = large ? bytes.readUInt32BE(offset) : bytes.readUInt16BE(offset);
            offset += rowLengthBytes;
            return value;
        });
        const checkPlane = (plane: Buffer, channel: number) => {
            const expected = Buffer.alloc(width * height * depth / 8);
            for (let i = 0; i < width * height; i++) {
                if (data16) expected.writeUInt16BE(data16[i * 4 + channel]!, i * 2);
                else expected[i] = data[i * 4 + channel]!;
            }
            expect(plane).toEqual(expected);
        };
        for (let channel = 0; channel < channels; channel++) {
            const end = offset + channelLengths[channel]!;
            expect(bytes.readUInt16BE(offset)).toBe(psdCompression === "rle" ? 1 : 2);
            offset += 2;
            checkPlane(readPlane(readRowLengths(height)), channel);
            expect(offset).toBe(end);
        }
        // Layer info is padded to even size, followed by the empty global mask.
        expect(compositeOffset - offset).toBe(4 + offset % 2);
        offset = compositeOffset;
        expect(bytes.readUInt16BE(offset)).toBe(psdCompression === "rle" ? 1 : 2);
        offset += 2;
        const rowLengths = readRowLengths(channels * height);
        for (let channel = 0; channel < channels; channel++) checkPlane(readPlane(rowLengths.slice(channel * height, (channel + 1) * height)), channel);
        expect(offset).toBe(bytes.length);
    });
}

it.each(["none", "zip"] as const)("keeps storage reads batched for tall, narrow %s images", async psdCompression => {
    const data = new Uint8Array(4096 * 4);
    let reads = 0;
    for await (const chunk of encodeStoredImage({ width: 1, height: 4096, position: 0, format: "raw", depth: "uchar", space: "srgb", channels: 3, hasAlpha: false, density: 72 }, {
        allocate() { throw new Error("Must not allocate storage"); },
        async write() { throw new Error("Must not mutate storage"); },
        async read(position, length) { reads++; return data.subarray(position, position + length); }
    }, new AbortController().signal, { format: "psd", psdCompression })) expect(chunk.length).toBeGreaterThan(0);
    expect(reads).toBeLessThan(40);
});
