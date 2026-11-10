import { expect, it, vi } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage, readMiffFromSource } from "./miff-input-storage.js";

// ImageMagick 7.1.2-35: -size 2050x1 -depth 16 -endian MSB rgba:-
// -compress LZMA miff:-, with the RGBA sample 123456789abc8001 repeated 2050 times.
const stream = Buffer.from("/Td6WFoAAArh+wyhAgAhAQwAAACPmEGc4EAPAD9dAAkN898PQC0ZRf4MTRcPDCPTvgYewIR29pLti+k//te55tgspcR72hZcshgEUpKBBcfxmQxaXqhiV2BSnLHRAAAAVD6JpONDX1J/KevWzKwYnliF+Z5OiWtVFVsdql1Pph8AAXOQgAEAAK5QfnO26d8cAgAAAAAKWVo=", "base64");
function fixture(payload: Uint8Array = stream, fields = "", packetSize = payload.length) {
    const chunks: Uint8Array[] = [Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass matte=True\ncolumns=2050 rows=1 depth=16 colorspace=sRGB compression=LZMA\n${fields}\n:\x1a`)];
    for (let start = 0; start < payload.length; start += packetSize) {
        const packet = payload.subarray(start, start + packetSize), length = Buffer.alloc(4);
        length.writeUInt32BE(packet.length); chunks.push(length, packet);
    }
    return Buffer.concat(chunks);
}

it("reads fragmented LZMA packets and adjacent mixed-compression frames", async () => {
    const plain = Buffer.concat([Buffer.from("id=ImageMagick\nclass=DirectClass columns=1 rows=1 depth=8 compression=None\n:\x1a"), Buffer.from([255, 0, 0])]);
    const bytes = Buffer.concat([fixture(stream, "", 7), plain, fixture()]);
    expect(readMiffHeader(bytes).metadata.pages).toBe(3);
    expect([...decodeMiffImage(bytes, { page: 1 }).data]).toEqual([255, 0, 0, 255]);
    const image = decodeMiffImage(bytes, { page: 2 });
    expect(image.data16!.length).toBe(2050 * 4);
    for (const pixel of [0, 1023, 1024, 2049]) expect([...image.data16!.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([0x1234, 0x5678, 0x9abc, 0x8001]);
    const stored = await readMiffFromSource({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, new AbortController().signal, 1);
    expect(stored.metadata).toMatchObject({ pages: 3, width: 1, height: 1 });
});

it("decodes into storage with bounded reads, writes and borrowed input", async () => {
    const bytes = fixture(stream, "", 13), borrowed = new Uint8Array(8192), backing = new Uint8Array(2050 * 12);
    let end = 0;
    const source = { size: bytes.length, read: async (offset: number, length: number) => {
        expect(length).toBeLessThanOrEqual(8192);
        borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
        return borrowed.subarray(0, length);
    } };
    const storage = {
        allocate(length: number) { const offset = end; end += length; return offset; },
        read: vi.fn(),
        async write(offset: number, data: Uint8Array) {
            expect(data.length).toBeLessThanOrEqual(8192);
            backing.set(data, offset); borrowed.fill(0);
        }
    };
    const image = await decodeMiffToStorage(source, storage, new AbortController().signal);
    expect(backing.subarray(image.position, image.position + 2050 * 4)).toEqual(decodeMiffImage(bytes).data);
    expect(new Uint16Array(backing.buffer, image.storedData16!.position, image.storedData16!.length)).toEqual(decodeMiffImage(bytes).data16);
});

it.each([
    ["truncated packet header", () => fixture().subarray(0, fixture().indexOf(stream) - 2)],
    ["truncated packet", () => fixture().subarray(0, -1)],
    ["corrupt stream", () => fixture(Buffer.from(stream).fill(0, 40, 50))],
    ["extra samples", () => fixture(stream, "columns=2049")],
    ["missing samples", () => fixture(stream, "columns=2051")],
    ["trailing packet bytes", () => fixture(Buffer.concat([stream, Buffer.from([0])]))],
    ["empty packet", () => { const bytes = fixture(); bytes.writeUInt32BE(0, bytes.indexOf(stream) - 4); return bytes; }]
] as const)("rejects %s in buffered and retained decoding", async (_, input) => {
    const bytes = input(), storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    expect(() => decodeMiffImage(bytes)).toThrow("MIFF");
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal)).rejects.toThrow("MIFF");
    expect(storage.allocate).not.toHaveBeenCalled();
});

it("enforces pixel limits before decompressing and stops on cancellation", async () => {
    const bytes = fixture(), storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    const controller = new AbortController();
    const source = { size: bytes.length, read: vi.fn(async (offset: number, length: number) => bytes.subarray(offset, offset + length)) };
    expect(() => decodeMiffImage(bytes, { limitInputPixels: 1 })).toThrow("pixel limit");
    await expect(decodeMiffToStorage(source, storage, controller.signal, { limitInputPixels: 1 })).rejects.toThrow("pixel limit");
    expect(source.read).toHaveBeenCalledTimes(1);
    expect(storage.allocate).not.toHaveBeenCalled();
    source.read.mockImplementation(async (offset, length) => {
        if (length === 4) controller.abort(new Error("cancelled"));
        return bytes.subarray(offset, offset + length);
    });
    await expect(decodeMiffToStorage(source, storage, controller.signal)).rejects.toThrow("cancelled");
    expect(storage.allocate).not.toHaveBeenCalled();
});
