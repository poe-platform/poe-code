import { expect, it, vi } from "vitest";
import { decodePsdImage, decodePsdToStorage, readPsdHeader, readPsdFromSource } from "./psd-input.js";
import fixtures from "./psd-input-fixtures.json";

// Native ImageMagick fixtures from the 3x2 PPM used by the CLI regression:
// magick in.ppm -depth 16 -compress RLE rle.psd
// magick in.ppm -alpha set -channel A -evaluate set 50% +channel -compress RLE alpha.psd
for (const name of ["rle", "alpha"] as const) {
    it.each([0, 1])(`decodes native ${name} composite/layer %i through borrowed source ranges`, async page => {
        const bytes = Buffer.from(fixtures[name].psd, "base64"), image = decodePsdImage(bytes, { page });
        const backing = new Uint8Array(1024), borrowed = new Uint8Array(1024); let end = 0;
        const source = { size: bytes.length, async read(offset: number, length: number) { borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length)); return borrowed.subarray(0, length); } };
        const storage = { allocate(length: number) { const start = end; end += length; return start; }, async read(offset: number, length: number) { return backing.subarray(offset, offset + length); }, async write(offset: number, bytes: Uint8Array) { backing.set(bytes, offset); } };
        const stored = await decodePsdToStorage(source, storage, new AbortController().signal, { page });
        expect(backing.subarray(stored.position, stored.position + image.data.length)).toEqual(image.data);
        expect(stored).toMatchObject({ width: 3, height: 2, pages: 2 });
        if (name === "rle") {
            const high = new Uint16Array(backing.buffer, stored.storedData16!.position, stored.storedData16!.length);
            expect(high).toEqual(image.data16);
            const rgb = Buffer.alloc(36);
            for (let pixel = 0; pixel < 6; pixel++) for (let channel = 0; channel < 3; channel++) rgb.writeUInt16BE(high[pixel * 4 + channel]!, (pixel * 3 + channel) * 2);
            expect(rgb.toString("hex")).toBe(fixtures.rle.pixels);
        } else expect(Buffer.from(image.data).toString("hex")).toBe(fixtures.alpha.pixels.slice(page * 48, (page + 1) * 48));
        expect((await readPsdFromSource(source, new AbortController().signal, { page })).metadata).toEqual(readPsdHeader(bytes, { page }).metadata);
    });
}

it("rejects truncation, invalid pages, unsupported compression and pixel limits", async () => {
    const bytes = Buffer.from(fixtures.rle.psd, "base64");
    for (const length of [10, 30, 65, bytes.length - 1]) expect(() => decodePsdImage(bytes.subarray(0, length))).toThrow("Truncated PSD");
    expect(() => decodePsdImage(bytes, { page: 2 })).toThrow("PSD page out of range");
    expect(() => decodePsdImage(bytes, { limitInputPixels: 1 })).toThrow();
    const invalid = Buffer.from(bytes), header = readPsdHeader(bytes);
    invalid.writeUInt16BE(9, header.frame.channels[0]!.offset);
    expect(() => decodePsdImage(invalid)).toThrow("Unsupported PSD compression");
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodePsdToStorage({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }, storage, new AbortController().signal, { limitInputPixels: 1 })).rejects.toThrow();
    expect(storage.allocate).not.toHaveBeenCalled();
});

it("honors cancellation before reading", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    const source = { size: 100, read: vi.fn() }, storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodePsdToStorage(source, storage, controller.signal)).rejects.toThrow("cancelled");
    expect(source.read).not.toHaveBeenCalled();
});
