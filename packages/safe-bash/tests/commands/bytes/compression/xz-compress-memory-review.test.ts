import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCodec } from '../../../../src/commands/bytes/compression/codec-loader.js';
import factory from '../../../../src/commands/bytes/compression/native/generated/xz.mjs';

test('XZ no-adjust admits the precise bundled codec boundary and rejects one byte below', async () => {
  // liblzma memory estimates contain sizeof terms: this wasm32 boundary differs
  // from native 64-bit XZ's 32608775-byte preset-3 boundary by 352 bytes.
  const options = { format: 'xz', level: 3, decompress: false, xzNoAdjust: true } as const;
  const signal = new AbortController().signal;
  await assert.rejects(createCodec({ ...options, xzCompressMemory: 32608422 }, signal), /memory limit/);
  const codec = await createCodec({ ...options, xzCompressMemory: 32608423 }, signal);
  codec.close();
  codec.close();
});

test('XZ closes its codec when an adjustment observer rejects acquisition', async () => {
  let destroyed = 0;
  const failure = new Error('observer failed');
  await assert.rejects(createCodec({
    format: 'xz', level: 3, decompress: false, xzCompressMemory: 16 * 1024 ** 2,
    onXzAdjust(dictionary) {
      assert.equal(dictionary, 1024 ** 2);
      throw failure;
    },
  }, new AbortController().signal, wasi => {
    const module = factory(wasi);
    return { ...module, bridge_destroy() { destroyed++; module.bridge_destroy(); } };
  }), error => error === failure);
  assert.equal(destroyed, 1);
});

test('XZ checks cancellation after the adjustment observer and closes acquisition', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled during observer');
  let destroyed = 0;
  await assert.rejects(createCodec({
    format: 'xz', level: 3, decompress: false, xzCompressMemory: 16 * 1024 ** 2,
    onXzAdjust() { controller.abort(reason); },
  }, controller.signal, wasi => {
    const module = factory(wasi);
    return { ...module, bridge_destroy() { destroyed++; module.bridge_destroy(); } };
  }), error => error === reason);
  assert.equal(destroyed, 1);
});
