import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { chunks, run } from './helpers.js';

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
