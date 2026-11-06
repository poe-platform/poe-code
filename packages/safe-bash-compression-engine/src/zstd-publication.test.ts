import { strict as assert } from "node:assert";
import { test } from "node:test";
import { boundedCodec } from "./bounded-codec.js";
import { zstdDecode } from "./zstd-decode.js";
import { CodecReader } from "./codec.js";

const signal = new AbortController().signal;
const options = { format: "zstd", decompress: true, level: 3 } as const;
async function decode(bytes: Uint8Array, chunkSize: number) {
  const reader = new CodecReader((async function* () {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
  })(), signal);
  const output: Uint8Array[] = [];
  let error: unknown;
  try { for await (const part of zstdDecode(reader, options, signal)) output.push(part); }
  catch (caught) { error = caught; }
  return { output: Buffer.concat(output), error };
}

for (const size of [1717, 131072, 131073, 300000]) {
  test(`Zstd checksum failures preserve native publication boundaries for ${size} bytes`, async () => {
    const payload = Buffer.alloc(size, 97);
    const reader = new CodecReader((async function* () { yield payload; })(), signal);
    const parts: Uint8Array[] = [];
    for await (const part of boundedCodec(reader, { ...options, decompress: false }, signal)) parts.push(part);
    const frame = Buffer.concat(parts);
    const damaged = Buffer.from(frame);
    damaged[damaged.length - 1]! ^= 1;
    for (const chunkSize of [1, 97, frame.length * 2]) {
      for (const prefix of [Buffer.alloc(0), frame]) {
        const result = await decode(Buffer.concat([prefix, damaged]), chunkSize);
        assert.ok(result.error);
        const published = Math.floor((size - 1) / 131072) * 131072;
        assert.deepEqual(result.output, Buffer.concat([prefix.length ? payload : Buffer.alloc(0), payload.subarray(0, published)]));
      }
      const valid = await decode(Buffer.concat([frame, frame]), chunkSize);
      assert.equal(valid.error, undefined);
      assert.deepEqual(valid.output, Buffer.concat([payload, payload]));
    }
  });
}

test("Zstd publishes before EOF with bounded read-ahead", async () => {
  const payload = Buffer.alloc(400000);
  let state = 123;
  for (let i = 0; i < payload.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    payload[i] = state & 255;
  }
  const source = new CodecReader((async function* () { yield payload; })(), signal);
  const parts: Uint8Array[] = [];
  for await (const part of boundedCodec(source, { ...options, decompress: false }, signal)) parts.push(part);
  const frame = Buffer.concat(parts);
  let read = 0;
  const reader = new CodecReader((async function* () {
    for (let offset = 0; offset < frame.length; offset += 97) {
      const part = frame.subarray(offset, offset + 97);
      read += part.length;
      yield part;
    }
  })(), signal);
  const output = zstdDecode(reader, options, signal)[Symbol.asyncIterator]();
  const first = await output.next();
  assert.ok(first.value?.length);
  assert.deepEqual(Buffer.from(first.value), payload.subarray(0, first.value.length));
  assert.ok(read <= 131075 + 96, "read-ahead stays within one input buffer plus its final source chunk");
  assert.ok(read < frame.length, "output must not wait for the entire frame");
  await output.return?.();
  await reader.close();
});
