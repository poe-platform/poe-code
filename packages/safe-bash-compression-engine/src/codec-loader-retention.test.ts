import assert from "node:assert/strict";
import test from "node:test";
import { createCodec } from "./codec-loader.js";
import type { BoundedCodecOptions } from "./bounded-codec.js";

async function convert(format: BoundedCodecOptions["format"], decompress: boolean, bytes: Uint8Array): Promise<Uint8Array> {
  const codec = await createCodec({ format, decompress, level: 1 }, new AbortController().signal);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  try {
    for (let step = 0; step < 64; step++) {
      const output = new Uint8Array(65536);
      const result = codec.step(bytes.subarray(offset), output, true);
      offset += result.consumed;
      if (result.produced) chunks.push(output.subarray(0, result.produced));
      if (result.status === "end") {
        assert.equal(offset, bytes.length);
        return new Uint8Array(Buffer.concat(chunks));
      }
    }
    assert.fail("small codec fixture did not finish within 64 steps");
  } finally { codec.close(); }
}

for (const format of ["bzip2", "xz", "zstd"] as const) {
  test(`${format} default codec invocations do not reuse prior tenant linear memory`, async context => {
    const first = new TextEncoder().encode("tenant-one-3582-private-payload".repeat(32));
    const second = new TextEncoder().encode("tenant-two-3582-distinct-payload".repeat(32));
    const inputBuffers = new Map<ArrayBufferLike, ArrayBufferLike>();
    const set = Uint8Array.prototype.set;
    // Observe the real bridge input copy without replacing factories or codecs.
    context.mock.method(Uint8Array.prototype, "set", function(this: Uint8Array, source: ArrayLike<number>, offset?: number) {
      if (source instanceof Uint8Array && (source.buffer === first.buffer || source.buffer === second.buffer)) {
        inputBuffers.set(source.buffer, this.buffer);
      }
      return set.call(this, source, offset);
    });
    const firstCompressed = await convert(format, false, first);
    const firstMemory = inputBuffers.get(first.buffer);
    assert.ok(firstMemory, "the first codec copied its input into linear memory");
    const secondCompressed = await convert(format, false, second);
    const secondMemory = inputBuffers.get(second.buffer);
    assert.ok(secondMemory, "the second codec copied its input into linear memory");
    assert.ok(secondMemory !== firstMemory, "a new invocation must not reacquire the destroyed tenant module");
    assert.equal(Buffer.from(secondMemory).includes(Buffer.from(first)), false);
    assert.deepEqual(await convert(format, true, firstCompressed), first);
    assert.deepEqual(await convert(format, true, secondCompressed), second);
  });
}
