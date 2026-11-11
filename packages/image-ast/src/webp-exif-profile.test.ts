import { expect, it } from "vitest";
import { buildExifApp1Segment } from "./codecs/exif.js";
import { decodeWebpImage, encodeWebpImage, readWebpMetadata } from "./codecs/webp.js";
import { decodeWebpToStorage, readWebpMetadataFromSource } from "./codecs/webp-input-storage.js";

for (const animated of [false, true]) for (const prefixed of [false, true]) for (const lossless of [false, true]) {
  it(`keeps a complete paged WebP EXIF profile (animated=${animated}, prefixed=${prefixed}, lossless=${lossless})`, async () => {
    const profile = new Uint8Array(9001);
    profile.set(buildExifApp1Segment({ orientation: 6, density: 144 }).subarray(6));
    // Preserve opaque bytes too, including the final odd byte before RIFF padding.
    profile.fill(127, 78);
    const payload = prefixed ? Uint8Array.from([69, 120, 105, 102, 0, 0, ...profile]) : profile;
    const encoded = encodeWebpImage({ width: 1, height: animated ? 2 : 1, data: new Uint8Array(animated ? 8 : 4).fill(255), format: "webp", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { lossless, ...(animated ? { pageHeight: 1 } : {}) });
    const bytes = new Uint8Array(encoded.length + 8 + payload.length + (payload.length & 1));
    bytes.set(encoded); bytes.set([69, 88, 73, 70], encoded.length);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    new DataView(bytes.buffer).setUint32(encoded.length + 4, payload.length, true);
    bytes.set(payload, encoded.length + 8);
    const borrowed = new Uint8Array(4096);
    const source = { size: bytes.length, async read(at: number, length: number) {
      expect(length).toBeLessThanOrEqual(4096);
      borrowed.fill(0); borrowed.set(bytes.subarray(at, at + length)); return borrowed.subarray(0, length);
    } };
    const signal = new AbortController().signal;
    const retained = await readWebpMetadataFromSource(source, signal);
    expect(retained.exif).toEqual(profile);
    expect(retained).toEqual(readWebpMetadata(bytes));
    expect(decodeWebpImage(bytes).exif).toEqual(profile);
    if (animated) expect(decodeWebpImage(bytes, { page: 1 }).exif).toEqual(profile);
    const memory = new Uint8Array(1024 * 1024);
    let end = 0;
    const storage = {
      allocate(length: number) { const at = end; end += length; return at; },
      async read(at: number, length: number) { return memory.slice(at, at + length); },
      async write(at: number, data: Uint8Array) { memory.set(data, at); }
    };
    expect((await decodeWebpToStorage(source, storage, signal)).exif).toEqual(profile);
    if (animated) expect((await decodeWebpToStorage(source, storage, signal, { page: 1 })).exif).toEqual(profile);
    bytes.fill(0); borrowed.fill(0);
    expect(retained.exif).toEqual(profile);
  });
}
