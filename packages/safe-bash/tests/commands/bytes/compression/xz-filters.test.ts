import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';
import { parseOptions } from '../../../../src/commands/bytes/compression/options.js';

const plain = Buffer.from('hello world');
const delta = Buffer.from('fd377a585a000004e6d6b44602010301002101104c85a70701000a68fd070003b157f803faf80000da5223efcd7e03530001230bc21bfd091fb6f37d010000000004595a', 'hex');
test('BCJ filters transform real branch instruction operands like native XZ', async () => {
  for (const [filter, instruction, count, expected] of [
    ['x86', 'e810000000e920000000', 16, 'e0009f00455d0074053c193e0918904b1b8477453bc2536925ed5a478b0e0a300e0a69e32f130c3dfcaff33526671677e3be585fda3f1ddfda202e90d41c0d6a1db886d5226be505b149bad200'],
    ['arm64', '01000094', 32, 'e0007f00375d000080390f3185f00fae600d980baa3db7b6ae090139b88dc556f7423b17abacc162a43575778fc603e776255af6cef9092315aa3bbccdfd00'],
  ] as const) {
    const input = Buffer.from(instruction.repeat(count), 'hex');
    const result = await run('xz', ['-c', '--format=raw', `--${filter}`, '--lzma2=dict=1MiB'], chunks(input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString('hex'), expected);
  }
});
for (const command of ['xz', 'unxz', 'xzcat']) {
  test(`${command} custom filters match native XZ and raw chains`, async () => {
    const encoded = await run(command, ['--compress', '-c', '--delta=dist=1', '--lzma2=dict=1MiB'], chunks(plain));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.deepEqual(encoded.stdout, delta);
    for (const filters of [[], ['--lzma2=dict=1MiB'], ['--x86', '--lzma2'], ['--arm64', '--lzma2'], ['--delta=dist=2', '--lzma2']]) {
      const raw = await run(command, ['--compress', '-c', '--format=raw', ...filters], chunks(plain));
      assert.equal(raw.exitCode, 0, raw.stderr);
      const decoded = await run(command, ['-dcf', '--format=raw', ...filters], chunks(raw.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
      const trailing = await run(command, ['-dc', '--format=raw', ...filters], chunks(raw.stdout, Buffer.from('extra')));
      assert.equal(trailing.exitCode, 1);
    }
  });
}
test('XZ presets reset custom chains and invalid filters fail without output', async () => {
  const reset = await run('xz', ['-c', '--delta', '--lzma2=dict=1MiB', '-3'], chunks(plain));
  const preset = await run('xz', ['-3c'], chunks(plain));
  assert.deepEqual(reset.stdout, preset.stdout);
  for (const filters of [['--delta'], ['--lzma2=dict=bad'], ['--format=lzma', '--lzma2'], ['--format=raw', '--lzma2', '--memlimit=16MiB']]) {
    const result = await run('xz', ['-c', ...filters], chunks(plain));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
  }
  assert.throws(() => parseOptions('xz', ['--lzma2=dict=1MiB x86']));
});
test('nonraw decoders validate filter syntax without requiring an encoding chain', async () => {
  const encoded = await run('xz', ['-3c'], chunks(plain));
  for (const filter of ['--lzma2=dict=bad', '--delta=dist=999', '--lzma1=lc=99']) {
    const result = await run('xz', ['-dc', filter], chunks(encoded.stdout));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
  }
  const decoded = await run('xz', ['-dc', '--delta'], chunks(encoded.stdout));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, plain);
});
test('raw named output needs a suffix and supports a retained-file round trip', async () => {
  const fs = (await run('xz', ['--help'])).fs;
  await fs.writeFile('/data', plain);
  assert.equal((await run('xz', ['--format=raw', '/data'], chunks(), { fs })).exitCode, 1);
  const encoded = await run('xz', ['--format=raw', '-S.raw', '/data'], chunks(), { fs });
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const decoded = await run('unxz', ['--format=raw', '--suffix=.raw', '/data.raw'], chunks(), { fs });
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile('/data')), plain);
});
