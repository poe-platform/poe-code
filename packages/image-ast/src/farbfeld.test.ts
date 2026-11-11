import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";
import { decodeImageToStorage } from "./codecs/source-decode.js";

const fixture = Buffer.from("6661726266656c6400000002000000011234abcd8001000080011235cdef8000", "hex");
function source(bytes: Uint8Array) {
    return { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
}
function storage() {
    const bytes = new Uint8Array(32768);
    let end = 0;
    return {
        bytes,
        allocate(length: number) { const position = end; end += length; return position; },
        async write(position: number, data: Uint8Array) { bytes.set(data, position); },
        async read(position: number, length: number) { return bytes.subarray(position, position + length); }
    };
}
const signal = new AbortController().signal;
it("preserves RGBA16 in buffered and bounded storage decoding", async () => {
    const bytes = Buffer.concat([fixture.subarray(0, 16), ...Array.from({ length: 601 }, () => fixture.subarray(16))]);
    bytes.writeUInt32BE(601, 12);
    const image = decodeImage(bytes), target = storage();
    expect(Array.from(image.data16!.subarray(0, 8))).toEqual([0x1234, 0xabcd, 0x8001, 0, 0x8001, 0x1235, 0xcdef, 0x8000]);
    expect(await readImageMetadataFromSource(source(bytes), signal)).toEqual(readImageMetadata(bytes));
    const stored = await decodeImageToStorage(source(bytes), target, signal);
    expect(target.bytes.subarray(stored.position, stored.position + image.data.length)).toEqual(image.data);
    expect(new Uint16Array(target.bytes.buffer, stored.storedData16!.position, image.data16!.length)).toEqual(image.data16);
});
for (const [name, bytes] of [
    ["short header", fixture.subarray(0, 12)],
    ["short raster", fixture.subarray(0, -1)],
    ["zero width", Buffer.from("6661726266656c640000000000000001", "hex")],
    ["overflow dimensions", Buffer.from("6661726266656c64ffffffffffffffff", "hex")]
] as const) it(`rejects ${name} before allocating`, async () => {
    expect(() => decodeImage(bytes)).toThrow();
    await expect(decodeImageToStorage(source(bytes), { ...storage(), allocate() { throw new Error("must not allocate"); } }, signal)).rejects.not.toThrow("must not allocate");
});
it("enforces pixel limits", async () => {
    expect(() => decodeImage(fixture, { limitInputPixels: 1 })).toThrow("pixel limit");
    await expect(decodeImageToStorage(source(fixture), storage(), signal, { limitInputPixels: 1 })).rejects.toThrow("pixel limit");
});
