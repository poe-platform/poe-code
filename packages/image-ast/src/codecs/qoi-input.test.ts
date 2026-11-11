import { expect, it } from "vitest";
import { decodeQoiImage, decodeQoiToStorage, readQoiMetadata } from "./qoi-input.js";

const fixture = (ops: string, width = 1) => {
  const bytes = Buffer.from(`716f696600000001000000010400${ops}0000000000000001`, "hex");
  bytes.writeUInt32BE(width, 4);
  return bytes;
};

it("wraps DIFF and LUMA components modulo 256", () => {
  expect(Array.from(decodeQoiImage(fixture("40")).data)).toEqual([254, 254, 254, 255]);
  expect(Array.from(decodeQoiImage(fixture("8000")).data)).toEqual([216, 224, 216, 255]);
});
it("initializes the index with transparent black", () => {
  expect(Array.from(decodeQoiImage(fixture("00")).data)).toEqual([0, 0, 0, 0]);
});
for (const ops of ["fe12", "ff123456", "a0", "c1", "fe123456c0"]) {
  it(`rejects truncated or oversized pixels: ${ops}`, () => {
    expect(() => decodeQoiImage(fixture(ops))).toThrow(/QOI/);
  });
}
it("rejects invalid headers and end markers", () => {
  for (const [position, value] of [[0, 0], [7, 0], [12, 2], [13, 2]] as const) {
    const bytes = fixture("c0"); bytes[position] = value;
    expect(() => readQoiMetadata(bytes)).toThrow(/QOI/);
  }
  const bytes = fixture("c0"); bytes[bytes.length - 1] = 0;
  expect(() => decodeQoiImage(bytes)).toThrow(/end marker/);
});
it("honors pixel limits before allocating", () => {
  expect(() => decodeQoiImage(fixture("c1", 2), { limitInputPixels: 1 })).toThrow(/pixel limit/);
});
it("decodes runs across bounded storage blocks", async () => {
  const input = fixture("fd".repeat(33) + "c3", 2050), data = new Uint8Array(2050 * 4);
  const result = await decodeQoiToStorage({ size: input.length, async read(offset, length) { expect(length).toBeLessThanOrEqual(4096); return input.subarray(offset, offset + length); } }, {
    allocate(length) { expect(length).toBe(data.length); return 0; },
    async read(offset, length) { return data.subarray(offset, offset + length); },
    async write(offset, bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); data.set(bytes, offset); }
  }, new AbortController().signal);
  expect(result.width).toBe(2050);
  expect(data).toEqual(decodeQoiImage(input).data);
  expect(Array.from(data.subarray(-4))).toEqual([0, 0, 0, 255]);
});

for (const flag of [0, 1]) {
  it(`preserves QOI colorspace flag ${flag} in metadata and both decoders`, async () => {
    const input = fixture("fe804020");
    input[13] = flag;
    const expected = flag === 1 ? { magickColorspace: "RGB", gamma: 1 } : { space: "srgb" };
    expect(readQoiMetadata(input)).toMatchObject(expected);
    const decoded = decodeQoiImage(input);
    expect(decoded).toMatchObject(expected);
    expect([...decoded.data]).toEqual([128, 64, 32, 255]);
    const data = new Uint8Array(4);
    const stored = await decodeQoiToStorage({
      size: input.length,
      async read(offset, length) { return input.subarray(offset, offset + length); }
    }, {
      allocate() { return 0; },
      async read(offset, length) { return data.subarray(offset, offset + length); },
      async write(offset, bytes) { data.set(bytes, offset); }
    }, new AbortController().signal);
    expect(stored).toMatchObject(expected);
    expect(data).toEqual(decoded.data);
  });
}
