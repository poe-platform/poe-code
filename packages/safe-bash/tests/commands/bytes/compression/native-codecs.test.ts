import { test } from 'node:test';
import assert from 'node:assert/strict';
import bz2 from '../../../../src/commands/bytes/compression/native/generated/bz2.mjs';
import xz from '../../../../src/commands/bytes/compression/native/generated/xz.mjs';
import zstd from '../../../../src/commands/bytes/compression/native/generated/zstd.mjs';

const wasi = new Proxy({}, { get: (_target, name) => () => {
  if (name === 'fd_prestat_get') return 8;
  throw new Error('Unexpected native host call: ' + String(name));
} });
for (const [name, factory] of Object.entries({ bz2, xz, zstd })) {
  test(name + ' native bridge bounds, remainder, cleanup and isolation', () => {
    const codec = factory(wasi);
    codec._initialize?.();
    const originalMemory = codec.memory.buffer;
    const grow: unknown = Reflect.get(codec.memory, 'grow');
    assert.equal(typeof grow, 'function');
    assert.equal(Reflect.apply(grow as (...args: number[]) => number, codec.memory, [2049]), -1);
    assert.equal(codec.memory.buffer, originalMemory);

    const plain = new TextEncoder().encode('bounded portable streaming\n'.repeat(3000));
    function run(input: Uint8Array, decode: number) {
      assert.equal(codec.bridge_create(decode, 1, 64 * 1024 * 1024, 23), 0);
      const chunks: Uint8Array[] = [];
      let offset = 0;
      try {
        for (let calls = 0; calls < 20000; calls++) {
          const length = Math.min(3001, input.length - offset);
          new Uint8Array(codec.memory.buffer, codec.bridge_input(), length).set(input.subarray(offset, offset + length));
          const status = codec.bridge_step(codec.bridge_input(), length, codec.bridge_output(), 257, Number(offset + length === input.length));
          const consumed = codec.bridge_consumed(), produced = codec.bridge_produced();
          assert.ok(consumed <= length && produced <= 257);
          offset += consumed;
          chunks.push(new Uint8Array(codec.memory.buffer, codec.bridge_output(), produced).slice());
          assert.ok(status > 0, String(status));
          if (status === 1) return { bytes: Buffer.concat(chunks), offset };
          assert.ok(consumed || produced);
        }
        throw new Error('Bridge did not terminate');
      } finally { codec.bridge_destroy(); assert.equal(codec.bridge_used(), 0); }
    }
    const encoded = run(plain, 0).bytes;
    assert.deepEqual(run(encoded, 1).bytes, Buffer.from(plain));
    const doubled = Buffer.concat([encoded, encoded]);
    assert.equal(run(doubled, 1).offset, encoded.length);
    assert.equal(codec.bridge_create(1, 1, 1024, 23), -2);
    assert.equal(codec.bridge_used(), 0);
    assert.equal(codec.bridge_create(1, 1, 64 * 1024 * 1024, 23), 0);
    assert.equal(codec.bridge_step(codec.bridge_input(), 65537, codec.bridge_output(), 1, 0), -1);
    assert.equal(codec.bridge_step(codec.bridge_input(), 0, codec.bridge_output(), 65537, 0), -1);
    codec.bridge_destroy();
    assert.deepEqual(run(encoded, 1).bytes, Buffer.from(plain));
  });
}
