import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { FsError } from 'safe-bash-contracts';
import fixtures from '../tests/list-fixtures.json' with { type: 'json' };
import { chunks, run } from '../tests/helpers.js';

test('listing diagnostics retain operands and continue listing valid files', async () => {
  const fs = createMemoryFileSystem();
  const bytes = Buffer.from(fixtures[0]!.hex, 'hex');
  await fs.mkdir('/archives');
  await fs.writeFile('/archives/good.xz', bytes);
  await fs.writeFile('/archives/bad.xz', bytes.subarray(0, bytes.length - 4));
  await fs.symlink('bad.xz', '/archives/link.xz');
  for (const [operand, reason] of [
    ['./bad.xz', 'Compressed data is corrupt'],
    ['link.xz', 'Compressed data is corrupt'],
    ['missing', 'No such file or directory'],
  ]) {
    for (const args of [['-l'], ['-lvv'], ['--robot', '-l']]) {
      const expected = await run('xz', [...args, 'good.xz'], chunks(), { fs, cwd: '/archives' });
      for (const operands of [[operand!, 'good.xz'], ['good.xz', operand!]]) {
        const result = await run('xz', [...args, ...operands], chunks(), { fs, cwd: '/archives' });
        assert.equal(result.exitCode, 1);
        assert.equal(result.stderr, `xz: ${operand}: ${reason}\n`);
        if (!args.includes('-lvv')) assert.deepEqual(result.stdout, expected.stdout);
        else assert.ok(result.stdout.toString().includes('good.xz'));
      }
    }
  }
  assert.deepEqual(Buffer.from(await fs.readFile('/archives/good.xz')), bytes);
});

test('listing read failures retain the operand and filesystem reason', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/data.xz', Buffer.from(fixtures[0]!.hex, 'hex'));
  fs.openReadFile = async () => { throw new FsError('EACCES', { syscall: 'open', path: '/data.xz' }); };
  const result = await run('xz', ['-l', './data.xz'], chunks(), { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, 'xz: ./data.xz: Permission denied\n');
});
