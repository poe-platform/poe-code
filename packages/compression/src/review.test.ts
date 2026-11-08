import { deflateRawSync, deflateSync, gzipSync, inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { createByteCodec } from "./index.js";

it.each([1, 7, 65536])("decodes independent concatenated gzip members through reused %i-byte input windows", step => {
  const plain = Buffer.from("independent gzip member".repeat(4000));
  const encoded = Buffer.concat([gzipSync(""), gzipSync(plain), gzipSync("last")]);
  const input = new Uint8Array(step);
  const codec = createByteCodec({ direction: "decode", format: "gzip", chunkSize: 1024 });
  const output: Uint8Array[] = [];
  try {
    for (let offset = 0; offset < encoded.length; offset += step) {
      const count = Math.min(step, encoded.length - offset);
      input.set(encoded.subarray(offset, offset + count));
      for (const chunk of codec.push(input.subarray(0, count), offset + count === encoded.length)) {
        expect(chunk.length).toBeLessThanOrEqual(1024);
        output.push(chunk);
      }
      expect(codec.consumed).toBe(count);
      input.fill(0);
    }
    expect(codec.complete).toBe(true);
  } finally { codec.close(); }
  expect(Buffer.concat(output)).toEqual(Buffer.concat([plain, Buffer.from("last")]));
});

it.each(["raw", "zlib"] as const)("preserves the exact unread suffix after a %s frame", format => {
  const compressed = format === "raw" ? deflateRawSync("payload") : deflateSync("payload");
  const suffix = Uint8Array.of(0, 255, 1, 2);
  const input = Buffer.concat([compressed, suffix]);
  const codec = createByteCodec({ direction: "decode", format, chunkSize: 2 });
  try {
    expect(Buffer.concat([...codec.push(input, true)]).toString()).toBe("payload");
    expect(codec.complete).toBe(true);
    expect(codec.consumed).toBe(compressed.length);
    expect(new Uint8Array(input.subarray(codec.consumed))).toEqual(suffix);
  } finally { codec.close(); }
});

it("encodes reused caller windows without retaining their later mutations", () => {
  const codec = createByteCodec({ direction: "encode", format: "zlib", chunkSize: 17 });
  const window = new Uint8Array(4096);
  const output: Uint8Array[] = [];
  try {
    for (let index = 0; index < 32; index++) {
      window.fill(index);
      output.push(...codec.push(window, false));
      window.fill(255);
    }
    output.push(...codec.push(new Uint8Array(), true));
    expect(codec.complete).toBe(true);
  } finally { codec.close(); }
  const expected = Buffer.concat(Array.from({ length: 32 }, (_, index) => Buffer.alloc(4096, index)));
  expect(inflateSync(Buffer.concat(output))).toEqual(expected);
  expect(output.every(chunk => chunk.length <= 17)).toBe(true);
});
