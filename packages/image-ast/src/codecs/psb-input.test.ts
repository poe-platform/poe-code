import { expect, it, vi } from "vitest";
import { decodePsdImage, decodePsdToStorage, readPsdHeader } from "./psd-input.js";
import fixtures from "../../../../tests/fixtures/media/psb-input-fixtures.json" with { type: "json" };

for (const compression of ["none", "rle"] as const) for (const page of [0, 1]) {
    it(`reads native PSB ${compression} page ${page} with borrowed storage ranges`, async () => {
        const bytes = Buffer.from(fixtures[`psb_${compression}`], "base64");
        const image = decodePsdImage(bytes, { page });
        expect(image).toMatchObject({ width: 8, height: 4, pages: 2, channels: 3, bitsPerSample: 8 });
        expect(Buffer.from(image.data).toString("hex")).toBe(("ff0000ff".repeat(4) + "0000ffff".repeat(4)).repeat(4));
        const backing = new Uint8Array(128), borrowed = new Uint8Array(bytes.length);
        const source = { size: bytes.length, async read(offset: number, length: number) { borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length)); return borrowed.subarray(0, length); } };
        const storage = { allocate: vi.fn(() => 0), async read(offset: number, length: number) { return backing.subarray(offset, offset + length); }, async write(offset: number, bytes: Uint8Array) { backing.set(bytes, offset); } };
        const stored = await decodePsdToStorage(source, storage, new AbortController().signal, { page });
        expect(stored).toMatchObject({ width: 8, height: 4, pages: 2 });
        expect(backing).toEqual(image.data);
        storage.allocate.mockClear();
        await expect(decodePsdToStorage(source, storage, new AbortController().signal, { page, limitInputPixels: 31 })).rejects.toThrow();
        expect(storage.allocate).not.toHaveBeenCalled();
    });
}

it("rejects truncated PSB sections and unsafe 64-bit lengths", () => {
    const bytes = Buffer.from(fixtures.psb_rle, "base64");
    for (const length of [10, 30, 65, bytes.length - 1]) expect(() => decodePsdImage(bytes.subarray(0, length))).toThrow("Truncated PSD");
    // Color data and resources retain 32-bit lengths; layer section, info and channels use 64 bits.
    const resources = 30 + bytes.readUInt32BE(26), layers = resources + 4 + bytes.readUInt32BE(resources);
    for (const offset of [layers, layers + 8, layers + 8 + 8 + 2 + 18 + 2]) {
        const invalid = Buffer.from(bytes);
        invalid.writeBigUInt64BE(1n << 53n, offset);
        expect(() => readPsdHeader(invalid)).toThrow("Invalid PSD section length");
        invalid.writeBigUInt64BE(BigInt(bytes.length), offset);
        expect(() => readPsdHeader(invalid)).toThrow("Truncated PSD");
    }
});

it("accepts PSB dimensions above the PSD limit while enforcing input pixel limits", () => {
    const bytes = Buffer.alloc(42);
    bytes.write("8BPS"); bytes.writeUInt16BE(2, 4); bytes.writeUInt16BE(3, 12);
    bytes.writeUInt32BE(1, 14); bytes.writeUInt32BE(30001, 18); bytes.writeUInt16BE(8, 22); bytes.writeUInt16BE(3, 24);
    expect(readPsdHeader(bytes).metadata).toMatchObject({ width: 30001, height: 1 });
    expect(() => readPsdHeader(bytes, { limitInputPixels: 30000 })).toThrow();
    bytes.writeUInt32BE(300001, 18);
    expect(() => readPsdHeader(bytes)).toThrow("Invalid PSD dimensions");
    bytes.writeUInt32BE(30001, 18); bytes.writeUInt16BE(1, 4);
    expect(() => readPsdHeader(bytes)).toThrow("Invalid PSD dimensions");
});
