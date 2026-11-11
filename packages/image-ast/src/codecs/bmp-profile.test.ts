import { expect, it, vi } from "vitest";
import { readBmpMetadata, decodeBmpImage } from "./netpbm.js";
import { readImageMetadataFromSource } from "./metadata-source.js";
import { decodeBmpToStorage } from "./bmp-storage.js";

function fixture() {
  const bytes = new Uint8Array(5000), view = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 138, true);
  view.setUint32(14, 124, true);
  view.setInt32(18, 1, true);
  view.setInt32(22, 1, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(70, 0x4d424544, true);
  view.setUint32(126, 4090 - 14, true);
  view.setUint32(130, 910, true);
  bytes.fill(123, 4090);
  return { bytes, view };
}
const signal = new AbortController().signal;
function source(bytes: Uint8Array) {
  return { size: bytes.length, async read(position: number, length: number) {
    expect(length).toBeLessThanOrEqual(4096);
    return bytes.subarray(position, position + length);
  } };
}

it("reads a DIB-relative profile across source pages without retaining borrowed bytes", async () => {
  const { bytes } = fixture();
  const expected = bytes.slice(4090);
  const metadata = await readImageMetadataFromSource(source(bytes), signal);
  expect(metadata.icc).toEqual(expected);
  expect(readBmpMetadata(bytes).icc).toEqual(expected);
  expect(decodeBmpImage(bytes).icc).toEqual(expected);
  bytes.fill(0, 4090);
  expect(metadata.icc).toEqual(expected);
});

for (const [offset, length] of [[0, 910], [4980, 910], [0xffffffff, 910], [4090 - 14, 0xffffffff]]) {
  it(`rejects invalid embedded profile range ${offset}/${length} before raster allocation`, async () => {
    const { bytes, view } = fixture();
    view.setUint32(126, offset!, true);
    view.setUint32(130, length!, true);
    expect(() => readBmpMetadata(bytes)).toThrow("Invalid BMP embedded profile range");
    await expect(readImageMetadataFromSource(source(bytes), signal)).rejects.toThrow("Invalid BMP embedded profile range");
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeBmpToStorage(source(bytes), storage, signal)).rejects.toThrow("Invalid BMP embedded profile range");
    expect(storage.allocate).not.toHaveBeenCalled();
  });
}

for (const colorSpace of [0x73524742, 0x4c494e4b]) {
  it(`ignores non-embedded profile fields for color space ${colorSpace}`, async () => {
    const { bytes, view } = fixture();
    view.setUint32(70, colorSpace, true);
    view.setUint32(126, 0xffffffff, true);
    expect(readBmpMetadata(bytes).icc).toBeUndefined();
    expect((await readImageMetadataFromSource(source(bytes), signal)).icc).toBeUndefined();
  });
}

it("accepts an empty embedded profile", () => {
  const { bytes, view } = fixture();
  view.setUint32(130, 0, true);
  expect(readBmpMetadata(bytes).icc).toBeUndefined();
});
