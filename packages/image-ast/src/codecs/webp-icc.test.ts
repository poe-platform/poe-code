import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import fixtures from "../../../../tests/fixtures/media/webp-icc.json" with { type: "json" };
import { decodeWebpImage, readWebpMetadata } from "./webp.js";
import { decodeWebpToStorage, readWebpMetadataFromSource } from "./webp-input-storage.js";

// ImageMagick 7.1.2-35: 2x1 xc:#4080c0 -profile srgb.icc webp:-,
// with webp:lossless=true or a second xc:#c08040 frame for the other fixtures.
const icc = new Uint8Array(Buffer.from(fixtures.icc, "base64"));

for (const kind of ["lossless", "lossy", "animated"] as const) {
  it(`retains embedded ICC in ${kind} WebP metadata and decoded frames`, async () => {
    const bytes = new Uint8Array(Buffer.from(fixtures[kind], "base64"));
    const source = { size: bytes.length, async read(at: number, length: number) {
      expect(length).toBeLessThanOrEqual(4096);
      return bytes.slice(at, at + length);
    } };
    const signal = new AbortController().signal;
    expect(readWebpMetadata(bytes).icc).toEqual(icc);
    expect((await readWebpMetadataFromSource(source, signal)).icc).toEqual(icc);
    const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
    try {
      for (let page = 0; page < (kind === "animated" ? 2 : 1); page++) {
        expect(decodeWebpImage(bytes, { page }).icc).toEqual(icc);
        expect((await decodeWebpToStorage(source, storage, signal, { page })).icc).toEqual(icc);
      }
    } finally { await storage.close(); }
  });
}

it.each([0, 8193])("reads an owned %i-byte ICC profile across borrowed source pages", async length => {
  const original = Buffer.from(fixtures.lossless, "base64");
  const profile = Uint8Array.from({ length }, (_, i) => i % 251);
  const header = original.slice(0, 38);
  header.writeUInt32LE(length, 34);
  const bytes = Buffer.concat([header, profile, new Uint8Array(length & 1), original.subarray(38 + icc.length)]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  const borrowed = new Uint8Array(4096);
  const source = { size: bytes.length, async read(at: number, size: number) {
    expect(size).toBeLessThanOrEqual(4096);
    borrowed.fill(0);
    borrowed.set(bytes.subarray(at, at + size));
    return borrowed.subarray(0, size);
  } };
  const buffered = readWebpMetadata(bytes);
  const retained = await readWebpMetadataFromSource(source, new AbortController().signal);
  bytes.fill(0);
  borrowed.fill(0);
  expect(buffered.icc).toEqual(profile);
  expect(retained.icc).toEqual(profile);
});

it("does not read an ICC chunk extending beyond the input", async () => {
  const bytes = Buffer.from(fixtures.lossless, "base64");
  bytes.writeUInt32LE(bytes.length, 34);
  const source = { size: bytes.length, async read(at: number, length: number) {
    return bytes.subarray(at, at + length);
  } };
  expect(readWebpMetadata(bytes).icc).toBeUndefined();
  expect((await readWebpMetadataFromSource(source, new AbortController().signal)).icc).toBeUndefined();
});
