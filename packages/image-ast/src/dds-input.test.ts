import { expect, it, vi } from "vitest";
import { decodeImage, decodeImageToStorage, readImageMetadata, readImageMetadataFromSource } from "./portable.js";

function fixture(width = 4, height = 4, first = 0xf800, second = 0x001f) {
    const bytes = new Uint8Array(128 + Math.ceil(width / 4) * Math.ceil(height / 4) * 8);
    const view = new DataView(bytes.buffer);
    bytes.set([68, 68, 83, 32]);
    for (const [offset, value] of [[4, 124], [12, height], [16, width], [76, 32], [80, 4], [84, 0x31545844]]) view.setUint32(offset!, value!, true);
    for (let offset = 128; offset < bytes.length; offset += 8) {
        view.setUint16(offset, first, true);
        view.setUint16(offset + 2, second, true);
        view.setUint32(offset + 4, 0xe4e4e4e4, true);
    }
    return bytes;
}
const source = (bytes: Uint8Array) => ({ size: bytes.length, async read(position: number, length: number) { return bytes.slice(position, position + length); } });

for (const [width, height] of [[4, 4], [5, 7], [517, 5]]) {
    it(`decodes BC1 palettes and cropped edge blocks in ${width}x${height} buffered and retained images`, async () => {
        const bytes = fixture(width, height), image = decodeImage(bytes);
        // Native ImageMagick reads the four palette entries in this order.
        const palette = Buffer.from("ff0000ff0000ffffaa0055ff5500aaff", "hex");
        for (let y = 0; y < height!; y++) for (let x = 0; x < width!; x++)
            expect(image.data.subarray((y * width! + x) * 4, (y * width! + x + 1) * 4)).toEqual(new Uint8Array(palette.subarray(x % 4 * 4, x % 4 * 4 + 4)));
        let backing = new Uint8Array();
        const storage = {
            allocate(length: number) { backing = new Uint8Array(length); return 0; },
            async read(position: number, length: number) { return backing.slice(position, position + length); },
            async write(position: number, bytes: Uint8Array) { backing.set(bytes, position); }
        };
        const retained = await decodeImageToStorage(source(bytes), storage, new AbortController().signal);
        expect(retained).toMatchObject({ width, height, format: "dds", hasAlpha: false });
        expect(backing).toEqual(image.data);
        expect(await readImageMetadataFromSource(source(bytes), new AbortController().signal)).toMatchObject({ width, height, pages: 1, format: "dds" });
    });
}
it("decodes DXT1 three-color mode and transparent palette index", async () => {
    const image = decodeImage(fixture(4, 4, 0x001f, 0xf800));
    expect(Buffer.from(image.data.subarray(0, 16)).toString("hex")).toBe("0000ffffff0000ff7f007fff00000000");
    expect(image.hasAlpha).toBe(true);
    expect(readImageMetadata(fixture(4, 4, 0x001f, 0xf800)).hasAlpha).toBe(true);
    expect((await readImageMetadataFromSource(source(fixture(4, 4, 0x001f, 0xf800)), new AbortController().signal)).hasAlpha).toBe(true);
});
it("rejects truncated and unsupported DDS inputs", () => {
    const bytes = fixture();
    expect(() => decodeImage(bytes.subarray(0, 127))).toThrow("header");
    expect(() => decodeImage(bytes.subarray(0, 135))).toThrow("Truncated DDS");
    bytes[87] = 0x35;
    expect(() => readImageMetadata(bytes)).toThrow("Unsupported DDS compression");
});
it("enforces pixel limits and cancellation before allocating", async () => {
    const bytes = fixture(), allocate = vi.fn(() => 0);
    const storage = { allocate, async read() { return new Uint8Array(); }, async write() {} };
    expect(() => decodeImage(bytes, { limitInputPixels: 15 })).toThrow("pixel limit");
    await expect(decodeImageToStorage(source(bytes), storage, new AbortController().signal, { limitInputPixels: 15 })).rejects.toThrow("pixel limit");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
    expect(allocate).not.toHaveBeenCalled();
});
