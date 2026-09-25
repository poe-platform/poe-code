import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';
import { parseOptions } from '../../../../src/commands/bytes/compression/options.js';
import { createCodec } from '../../../../src/commands/bytes/compression/codec-loader.js';

const plain = Buffer.from('hello world');
const blocks = Buffer.from('fd377a585a000004e6d6b4460200210114000000ffe7ec0901000368656c6c00d010b07a302ff1a80200210114000000ffe7ec090100036f20776f00cb046b4a093f27c10200210114000000ffe7ec09010002726c6400008b1332c7ae5e3cfc00031c041c041b030f7ba7f8b1c467fb020000000004595a', 'hex');
const listed = Buffer.from('fd377a585a000004e6d6b4460200210114000000ffe7ec0901000368656c6c00d010b07a302ff1a80200210114000000ffe7ec090100026f2077000018efb7f26295efea0200210114000000ffe7ec090100026f726c0000ef205add32aef82f0200210114000000ffe7ec090100006400000000592a4dd24d0bfcfb00041c041b031b0319010000cd4829b914173b30030000000004595a', 'hex');
test('XZ zero block size disables splitting and nonfinal zero list entries fail', async () => {
  const zero = await run('xz', ['-3c', '--block-size=0'], chunks(plain));
  const normal = await run('xz', ['-3c'], chunks(plain));
  assert.equal(zero.exitCode, 0, zero.stderr);
  assert.deepEqual(zero.stdout, normal.stdout);
  assert.throws(() => parseOptions('xz', ['--block-list=0,4']));
  for (const invalid of [{ xzBlockSize: -1 }, { xzBlockList: [0, 4] }, { xzFlushTimeout: NaN }]) {
    await assert.rejects(createCodec({ format: 'xz', level: 3, decompress: false, ...invalid }, new AbortController().signal));
  }
});
test('XZ block boundaries match native for fragmented and whole inputs', async () => {
  for (const input of [[plain], [...plain].map(byte => Uint8Array.of(byte))]) {
    for (const [flag, expected] of [['--block-size=4', blocks], ['--block-list=4,3', listed]] as const) {
      const result = await run('xz', ['-3c', flag], chunks(...input));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout, expected);
      const decoded = await run('xzcat', [], chunks(result.stdout));
      assert.deepEqual(decoded.stdout, plain);
    }
  }
});
test('XZ idle flush publishes decodable data before input completes', async () => {
 for (const format of ['xz', 'raw']) {
  let published!: () => void;
  const outputReady = new Promise<void>(resolve => { published = resolve; });
  const output: Uint8Array[] = [];
  const input = (async function* () { yield plain; await outputReady; yield plain; })();
  const result = await run('xz', ['-3c', `--format=${format}`, '--flush-timeout=1'], input, { stdout: { async write(bytes) { output.push(bytes.slice()); if (Buffer.concat(output).length >= (format === 'raw' ? 14 : 30)) published(); } } });
  assert.equal(result.exitCode, 0, result.stderr);
  const decoded = await run('xzcat', [`--format=${format}`], chunks(Buffer.concat(output)));
  assert.deepEqual(decoded.stdout, Buffer.concat([plain, plain]));
 }
});
test('XZ flush rejects unsupported chains before output and retires on abort', async () => {
  for (const flags of [['--format=lzma'], ['--x86', '--lzma2'], ['--arm64', '--lzma2']]) {
    const result = await run('xz', ['-c', '--flush-timeout=1', ...flags], chunks(plain));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
  }
  const controller = new AbortController();
  let closed = false;
  const input = (async function* () {
    try {
      yield plain;
      await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    } finally { closed = true; }
  })();
  await assert.rejects(run('xz', ['-c', '--flush-timeout=1'], input, { signal: controller.signal, stdout: { async write(bytes) { if (bytes.length > 12) controller.abort(new Error('stop idle input')); } } }), /stop idle input/);
  assert.equal(closed, true);
});
