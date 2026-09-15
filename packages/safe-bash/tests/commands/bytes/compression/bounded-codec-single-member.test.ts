import assert from "node:assert/strict";
import test from "node:test";
import { boundedCodec } from "../../../../src/commands/bytes/compression/bounded-codec.js";
import { CodecReader } from "../../../../src/commands/bytes/compression/codec.js";

// Independently generated with Python bz2.compress(..., compresslevel=9).
const compressed = Uint8Array.from(Buffer.from("QlpoOTFBWSZTWV7/O+UAAAPfgMAQQAAQAAAgQBASIlAQAACgACIQ9IaZlCmAALXNmZ6fYpELIXxdyRThQkF7/O+U", "base64"));
const payload = Uint8Array.of(...new TextEncoder().encode("ZIP bzip2 member"), 0, 255, 10);

for (const chunkSize of [1, 7, 65536]) {
  test(`real BZIP2 single member preserves trailing bytes with input chunks ${chunkSize}`, async () => {
    const signal = new AbortController().signal;
    const bytes = Uint8Array.of(...compressed, 0, 1, 2);
    const reader = new CodecReader((async function* () {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
    })(), signal);
    const chunks: Uint8Array[] = [];
    for await (const chunk of boundedCodec(reader, { format: "bzip2", decompress: true, level: 9, singleMember: true }, signal)) chunks.push(chunk);
    assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), payload);
    const trailing: Uint8Array[] = [];
    for (;;) { const chunk = await reader.chunk(); if (!chunk) break; trailing.push(chunk); }
    assert.deepEqual(new Uint8Array(Buffer.concat(trailing)), Uint8Array.of(0, 1, 2));
    await reader.close();
  });
}

for (const format of ["bzip2", "xz", "zstd"] as const) {
  for (const split of [false, true]) {
    test(`single ${format} member restores remainder with split=${split}`, async () => {
      let pulls = 0, creates = 0, closes = 0;
      const signal = new AbortController().signal;
      const reader = new CodecReader((async function* () {
        pulls++;
        yield split ? Uint8Array.of(7) : Uint8Array.of(7, 0, 8);
        if (split) { pulls++; yield Uint8Array.of(0, 8); }
      })(), signal);
      const output = boundedCodec(reader, { format, decompress: true, level: 1, singleMember: true }, signal, () => {
        creates++;
        return {
          step(bytes, result) {
            result[0] = bytes[0]!;
            return { consumed: 1, produced: 1, status: "end" };
          },
          close() { closes++; },
        };
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of output) chunks.push(chunk);
      assert.deepEqual(chunks, [Uint8Array.of(7)]);
      assert.equal(pulls, 1, "ending a member must not pull the following member");
      assert.equal(creates, 1);
      assert.equal(closes, 1);
      assert.deepEqual(await reader.chunk(), Uint8Array.of(0, 8), "padding and following member bytes remain untouched");
      await reader.close();
    });
  }
}
