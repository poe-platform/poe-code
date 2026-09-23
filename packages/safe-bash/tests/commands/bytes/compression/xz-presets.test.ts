import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { chunks, run } from './helpers.js';
import { createCodec } from '../../../../src/commands/bytes/compression/codec-loader.js';
import xz from '../../../../src/commands/bytes/compression/native/generated/xz.mjs';

for (const flag of ['-0', '--fast', '-10']) test(`XZ ${flag} encodes with the 256 KiB dictionary and round trips bytes`, async () => {
  const input = Uint8Array.of(0, 255, 97, 98, 99, 10);
  const encoded = await run('xz', [flag, '-c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  // XZ block header: one LZMA2 filter (0x21), one property byte;
  // dictionary property 12 specifies the standard preset-zero 256 KiB.
  assert.deepEqual(encoded.stdout.subarray(14, 17), Buffer.from([0x21, 1, 12]));
  const decoded = await run('xz', ['-d0c'], chunks(encoded.stdout));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, Buffer.from(input));
});

test('XZ uses the last specified preset', async () => {
  const presetOne = await run('xz', ['-01c'], chunks(Uint8Array.of(97)));
  assert.equal(presetOne.exitCode, 0, presetOne.stderr);
  assert.equal(presetOne.stdout[16], 16);
});

test('XZ preset zero works through the virtual-file shell pipeline', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', Buffer.from('abc\n'));
  const shell = new Shell({ fs, commands: new CommandRegistry(createCompressionCommands()) });
  const result = await shell.exec('xz -0 -c /input | xz -dc');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'abc\n');
  assert.equal(result.stderr, '');
});

test('preset zero remains invalid for other compression formats', async () => {
  for (const command of ['gzip', 'bzip2', 'zstd']) {
    const result = await run(command, ['-0']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /invalid option/);
  }
});

for (const command of ['xz', 'unxz', 'xzcat']) {
  for (const flags of [['--compress'], ['--extreme'], ['-e'], ['--threads=1'], ['--threads', '1'], ['-T1'], ['-T', '1'], ['-0eT1']]) {
    test(`${command} ${flags.join(' ')} compresses and round trips`, async () => {
      const input = Buffer.from('abc\n');
      const encoded = await run(command, ['--compress', ...flags, '-c'], chunks(input));
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      assert.deepEqual(encoded.stdout.subarray(0, 6), Buffer.from('fd377a585a00', 'hex'));
      const decoded = await run('xz', ['-dc'], chunks(encoded.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, input);
    });
  }
}

test('XZ rejects unsupported thread counts explicitly', async () => {
  for (const flags of [['--threads=2'], ['-T0'], ['--threads=abc'], ['--threads']]) {
    const result = await run('xz', flags);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /thread/);
    assert.equal(result.stdout.length, 0);
  }
});

test('XZ extreme reaches liblzma as an extreme preset, retaining the selected level', async () => {
  let preset: number | undefined;
  const codec = await createCodec({ format: 'xz', decompress: false, level: 0, extreme: true }, new AbortController().signal, wasi => {
    const module = xz(wasi);
    const create = module.bridge_create;
    module.bridge_create = (decode, level, memory, window) => {
      preset = level;
      return create(decode, level, memory, window);
    };
    return module;
  });
  try { assert.equal(preset! >>> 0, 0x80000000); }
  finally { codec.close(); }
});

test('XZ reported options work through virtual-file shell pipelines', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', Buffer.from('abc\n'));
  const shell = new Shell({ fs, commands: new CommandRegistry(createCompressionCommands()) });
  for (const flag of ['--compress', '--extreme', '--threads=1']) {
    const result = await shell.exec(`xz ${flag} -c /input | xz -dc`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'abc\n');
    assert.equal(result.stderr, '');
  }
});

test('XZ-specific controls remain invalid for other formats', async () => {
  for (const command of ['gzip', 'bzip2', 'zstd']) {
    for (const flag of ['--compress', '--extreme', '-e', '--threads=1', '-T1']) {
      const result = await run(command, [flag]);
      assert.equal(result.exitCode, 2);
    }
  }
});
