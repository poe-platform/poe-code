import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { collectBytes, toByteSource } from "../../src/contracts/index.js";
import { codec, CodecReader } from "../../src/commands/bytes/compression/codec.js";

test("shared codec encodes raw DEFLATE without a gzip or zlib wrapper", async () => {
  const signal = new AbortController().signal;
  const payload = new TextEncoder().encode("raw deflate".repeat(100));
  const reader = new CodecReader(toByteSource(payload), signal);
  try {
    const compressed = await collectBytes(codec(reader, { mode: "deflate-raw", chunkSize: 512 }, signal), { maxBytes: 4096 });
    assert.deepEqual(new Uint8Array(inflateRawSync(compressed)), payload);
  } finally { await reader.close(); }
});
