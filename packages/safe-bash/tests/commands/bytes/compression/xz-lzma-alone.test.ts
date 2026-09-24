import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';
import { createStandardCommands } from '../../../../src/commands/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { chunks, run } from './helpers.js';

// Native xz --format=lzma -0 fixtures, including non-UTF-8 and NUL bytes.
const fixtures = [
  ['XQAABAD//////////wAhmggnELc2u4Yoz07SZ8acUQtFqP//78UAAA==', 'Q2hhbmdlZExlZ2Fjef4ACg=='],
  ['XQAABAD//////////wAhmggnELc2u4Yoz07SZt/Sc9XXlcUDAf//ue4AAA==', 'Q2hhbmdlZExlZ2FjeVBsYWluCg=='],
  ['XQAABAD//////////wCD//v//8AAAAA=', ''],
] as const;

for (const [command, flags] of [['xz', '-dc'], ['unxz', '-c'], ['xzcat', '-c']] as const) {
  test(`${command} auto-decodes LZMA-alone files and pipes without changing input`, async () => {
    for (const [encoded, plain] of fixtures) {
      for (const pipe of [false, true]) {
        const fs = createMemoryFileSystem();
        const input = Buffer.from(encoded, 'base64');
        await fs.writeFile('/input.lzma', input);
        const shell = new Shell({ fs, commands: new CommandRegistry([...createCompressionCommands(), ...createStandardCommands().filter(entry => entry.name === 'cat')]) });
        const result = await shell.exec(`${pipe ? 'cat /input.lzma | ' : ''}${command} ${flags} ${pipe ? '-' : '/input.lzma'} > /restored`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.deepEqual(Buffer.from(await fs.readFile('/restored')), Buffer.from(plain, 'base64'));
        assert.deepEqual(Buffer.from(await fs.readFile('/input.lzma')), input);
      }
    }
  });
}

test('LZMA-alone rejects truncation and honors explicit dictionary memory quotas', async () => {
  const input = Buffer.from(fixtures[0][0], 'base64');
  const oversized = Buffer.from(input);
  oversized.writeUInt32LE(128 * 1024 * 1024, 1);
  for (const [bytes, flags] of [[input.subarray(0, input.length - 5), []], [oversized, ['--memlimit-decompress=64MiB']]] as const) {
    const result = await run('xz', ['-dc', ...flags], chunks(bytes));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.length > 0);
  }
  for (const flags of [[], ['--memlimit-decompress=0'], ['--memlimit-decompress=1GiB']]) {
    const bounded = await run('xz', ['-dc', ...flags], chunks(oversized));
    assert.equal(bounded.exitCode, 0, bounded.stderr);
    assert.deepEqual(bounded.stdout, Buffer.from(fixtures[0][1], "base64"));
  }
});
