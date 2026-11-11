import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, decodeImageToStorage, readImageMetadata, readImageMetadataFromSource } from "./index.js";

// External ImageMagick 7.1.2-35 bitmaps; the CORE/bitfield cases omit only the BMP file header.
const fixtures = [
    ["RGB24", "KAAAAAMAAAACAAAAAQAYAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAADu/3cRmYRTJAAAAAAA/wD/AP8AAAAAAA==", "ff000000ff000000ffffee00991177245384"],
    ["palette4", "KAAAAAMAAAACAAAAAQAEAAAAAAAIAAAAAAAAAAAAAAAQAAAAEAAAAAAA/wB3EZkAAP8AAADu/wCEUyQA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxQAAAAlAAAA==", "ff000000ff000000ffffee00991177245384"],
    ["CORE", "DAAAAAMAAgABABgAAO7/dxGZhFMkAAAAAAD/AP8A/wAAAAAA", "ff000000ff000000ffffee00991177245384"],
    ["bitfields", "fAAAAAMAAAACAAAAAQAQAAMAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAD4AADgBwAAHwAAAAAAAABCR1Jzj8L1KFG4HhUehesBMzMzE2ZmZiZmZmYGmZmZCT0K1wMoXI8yAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAGD/jpiwIgAAAPjgBx8AAAA=", "ff000000ff000000ffffef009c1073215584"],
] as const;

for (const [name, base64, rgb] of fixtures) {
    it(`reads standalone ${name} metadata and pixels through both SDK paths`, async () => {
        // Keep a nonzero byte offset to exercise caller-owned views.
        const bytes = Buffer.concat([Buffer.alloc(3), Buffer.from(base64, "base64")]).subarray(3);
        const source = { size: bytes.length, read: async (position: number, length: number) => bytes.subarray(position, position + length) };
        const signal = new AbortController().signal;
        const metadata = readImageMetadata(bytes);
        expect(metadata).toMatchObject({ format: "bmp", width: 3, height: 2, size: bytes.length });
        expect(await readImageMetadataFromSource(source, signal)).toEqual(metadata);
        const buffered = decodeImage(bytes);
        expect(Buffer.from(buffered.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(rgb);
        const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
        try {
            const stored = await decodeImageToStorage(source, storage, signal);
            expect(await storage.read(stored.position, stored.width * stored.height * 4)).toEqual(buffered.data);
        } finally { await storage.close(); }
    });
}

it("retains DIB-relative V5 profiles and rejects truncated profile ranges", async () => {
    const image = Buffer.from(fixtures[3][1], "base64"), profile = Uint8Array.of(1, 2, 3, 4);
    const bytes = Buffer.concat([image, profile]);
    bytes.writeUInt32LE(0x4d424544, 56);
    bytes.writeUInt32LE(image.length, 112);
    bytes.writeUInt32LE(profile.length, 116);
    const source = { size: bytes.length, read: async (position: number, length: number) => bytes.subarray(position, position + length) };
    const signal = new AbortController().signal;
    expect(Array.from(readImageMetadata(bytes).icc!)).toEqual(Array.from(profile));
    expect((await readImageMetadataFromSource(source, signal)).icc).toEqual(profile);
    const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
    try {
        expect((await decodeImageToStorage(source, storage, signal)).icc).toEqual(profile);
        expect(Array.from(decodeImage(bytes).icc!)).toEqual(Array.from(profile));
    } finally { await storage.close(); }
    bytes.writeUInt32LE(profile.length + 1, 116);
    expect(() => readImageMetadata(bytes)).toThrow("Invalid BMP embedded profile range");
    await expect(readImageMetadataFromSource(source, signal)).rejects.toThrow("Invalid BMP embedded profile range");
});
