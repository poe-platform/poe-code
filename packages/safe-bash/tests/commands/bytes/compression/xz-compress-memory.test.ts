import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';
import { parseOptions } from '../../../../src/commands/bytes/compression/options.js';
import { createCodec } from '../../../../src/commands/bytes/compression/codec-loader.js';

const plain = Buffer.from('bounded compression memory'.repeat(50));
// XZ 5.8.3, single-thread preset 3, 16 MiB limit: adjusts only the dictionary.
const adjustedXz = Buffer.from('fd377a585a000004e6d6b4460200210110000000a8708e86e0051300275d00311bcb119b05063cd30b894136045bf7047e93d88d50caafe4c44868ea1e59cae3ffc5d246c900000035f58735d4b9da3a000143940a000000abcda201b1c467fb020000000004595a', 'hex');
const adjustedLzma = Buffer.from('5d00001000ffffffffffffffff00311bcb119b05063cd30b894136045bf7047e93d88d50caafe4c44868ea1e59cae3ffc5d9f85efffffc7f0000', 'hex');

test('XZ general memory limits set both directions, with ordered directional overrides', () => {
  const options = parseOptions('xz', ['--memlimit=24MiB', '--memlimit-compress', '16MiB']);
  assert.equal(options.xzCompressMemory, 16 * 1024 ** 2);
  assert.equal(options.xzDecompressMemory, 24 * 1024 ** 2);
  const overridden = parseOptions('xz', ['--memlimit-decompress=1MiB', '--memlimit=0']);
  assert.equal(overridden.xzCompressMemory, 0);
  assert.equal(overridden.xzDecompressMemory, 0);
  for (const flag of ['--memlimit', '--memlimit-compress']) {
    for (const value of ['', '-1', '1.5MiB', '1B', '50%', '999999999999999999999999']) {
      assert.throws(() => parseOptions('xz', [`${flag}=${value}`]));
    }
  }
});

for (const command of ['xz', 'unxz', 'xzcat']) {
  test(`${command} adjusts compression dictionaries without changing the preset`, async () => {
    for (const [format, expected] of [['xz', adjustedXz], ['lzma', adjustedLzma]] as const) {
      const result = await run(command, ['--compress', '-3c', `--format=${format}`, '--memlimit-compress=16MiB'], chunks(plain));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout, expected);
      assert.match(result.stderr, /dictionary/);
      const decoded = await run(command, ['-dc', '--memlimit=2MiB'], chunks(result.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
      const strict = await run(command, ['--compress', '-3c', `--format=${format}`, '--memlimit=16MiB', '--no-adjust'], chunks(plain));
      assert.equal(strict.exitCode, 1);
      assert.equal(strict.stdout.length, 0);
      const impossible = await run(command, ['--compress', '-3c', `--format=${format}`, '--memlimit=1MiB'], chunks(plain));
      assert.equal(impossible.exitCode, 1);
      assert.equal(impossible.stdout.length, 0);
    }
  });
}

test('compression limits do not restrict decoding, and quiet suppresses adjustment messages', async () => {
  const encoded = await run('xz', ['-3c'], chunks(plain));
  const decoded = await run('xz', ['-dc', '--memlimit-compress=1', '--no-adjust'], chunks(encoded.stdout));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, plain);
  const quiet = await run('xz', ['-3cq', '--memlimit=16MiB'], chunks(plain));
  assert.equal(quiet.exitCode, 0, quiet.stderr);
  assert.equal(quiet.stderr, '');
  assert.deepEqual(quiet.stdout, adjustedXz);
  const strict = await run('xz', ['-3c', '--memlimit=64MiB', '--no-adjust'], chunks(plain));
  assert.equal(strict.exitCode, 0, strict.stderr);
  assert.deepEqual(strict.stdout, encoded.stdout);
});

test('failed compression admission preserves input and existing output files', async () => {
  const fs = (await run('xz', ['--help'])).fs;
  await fs.writeFile('/data', plain);
  await fs.writeFile('/data.xz', Buffer.from('existing'));
  const result = await run('xz', ['-3f', '--memlimit-compress=16MiB', '--no-adjust', '/data'], chunks(), { fs });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(Buffer.from(await fs.readFile('/data')), plain);
  assert.equal(Buffer.from(await fs.readFile('/data.xz')).toString(), 'existing');
});

test('SDK compression limits validate before codec acquisition', async () => {
  for (const memory of [-1, NaN, 1.5]) {
    await assert.rejects(createCodec({ format: 'xz', level: 3, decompress: false, xzCompressMemory: memory }, new AbortController().signal), /memory limit/);
  }
  await assert.rejects(createCodec({ format: 'xz', level: 3, decompress: false, xzCompressMemory: 16 * 1024 ** 2, xzNoAdjust: true }, new AbortController().signal), /memory limit/);
});
