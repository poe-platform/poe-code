import { expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "./index.js";
import { decodeImage, encodeImage } from "./codecs/index.js";
import { encodeTiffFromStorage } from "./codecs/tiff-storage.js";
import type { OutputEncodeOptions } from "./ast.js";

for (const compression of ["lzw", "deflate"] as const) {
    for (const channels of [1, 2, 3, 4] as const) {
        for (const options of [
            { tiffRowsPerStrip: 2 },
            { tiffIntegerDepth: 16, tiffEndian: "lsb", tiffPlanar: true },
            { tiffIntegerDepth: 16, tiffEndian: "msb", tiffTile: { width: 32, height: 16 }, tiffBig: true },
            { tiffIntegerDepth: 32, tiffPredictor: 2, tiffEndian: "msb" }
        ] satisfies OutputEncodeOptions[]) {
            it(`preserves samples across rows, chunks and blocks (${compression}, ${channels}, ${JSON.stringify(options)})`, async () => {
                const width = 1025, height = 3;
                const samples = Uint8Array.from({ length: width * height * channels }, (_, i) => (i * 71 + Math.floor(i / 7)) % 256);
                const source = sharp(samples, { raw: { width, height, channels } }).png().toBufferSync();
                const image = decodeImage(source), original = image.data.slice();
                const encoding = { ...options, format: "tiff" as const, tiffCompression: compression };
                const buffered = encodeImage(image, encoding).data;
                const memory = new Uint8Array(2 ** 20);
                memory.set(image.data);
                let end = image.data.length;
                const storage = {
                    allocate(length: number) { const at = end; end += length; return at; },
                    async read(at: number, length: number) { return memory.slice(at, at + length); },
                    async write(at: number, bytes: Uint8Array) { memory.set(bytes, at); }
                };
                const parts: Uint8Array[] = [];
                for await (const part of encodeTiffFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, encoding)) parts.push(part);
                const retained = new Uint8Array(Buffer.concat(parts));
                expect(retained).toEqual(buffered);
                expect(image.data).toEqual(original);
                expect(memory.subarray(0, original.length)).toEqual(original);
                expect(decodeImage(buffered).data).toEqual(original);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/predicted.tif", retained);
                expect(await sharp("/predicted.tif", { filesystem }).raw().toBuffer()).toEqual(sharp(source).raw().toBufferSync());
            });
        }
    }
}

it.each(["lsb", "msb"] as const)("differences whole 16-bit samples with wrapping (%s)", endian => {
    const image = decodeImage(Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("123456234567012345", "hex")]));
    const bytes = encodeImage(image, { format: "tiff", tiffCompression: "deflate", tiffIntegerDepth: 16, tiffEndian: endian }).data;
    const little = endian === "lsb", view = new DataView(bytes.buffer), ifd = view.getUint32(4, little);
    const tags = new Map<number, number>();
    for (let i = 0; i < view.getUint16(ifd, little); i++) {
        const at = ifd + 2 + i * 12;
        tags.set(view.getUint16(at, little), view.getUint32(at + 8, little));
    }
    const raw = inflateSync(bytes.subarray(tags.get(273)!, tags.get(273)! + tags.get(279)!));
    const samples = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    expect(Array.from({ length: 9 }, (_, i) => samples.getUint16(i * 2, little))).toEqual([0x1212, 0x3434, 0x5656, 0x1111, 0x1111, 0x1111, 0xddde, 0xddde, 0xddde]);
});

it.each(["none", "horizontal"] as const)("honors the SDK TIFF %s predictor", async predictor => {
    const source = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("123456234567345678", "hex")]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", source);
    const buffered = sharp(source).tiff({ compression: "deflate", predictor }).toBufferSync();
    await sharp("/in.ppm", { filesystem }).tiff({ compression: "deflate", predictor }).toFile("/out.tif");
    expect(await filesystem.readFile("/out.tif")).toEqual(buffered);
    const view = new DataView(buffered.buffer, buffered.byteOffset, buffered.byteLength), ifd = view.getUint32(4, true);
    let tag: number | undefined;
    for (let i = 0; i < view.getUint16(ifd, true); i++) {
        const at = ifd + 2 + i * 12;
        if (view.getUint16(at, true) === 317) tag = view.getUint16(at + 8, true);
    }
    expect(tag).toBe(predictor === "none" ? 1 : 2);
});
