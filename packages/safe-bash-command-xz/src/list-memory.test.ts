import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import fixtures from '../tests/list-fixtures.json' with { type: 'json' };
import { chunks, run } from '../tests/helpers.js';

test('listing memory failures report the rounded requirement and configured limit', async () => {
  const fs = createMemoryFileSystem();
  const bytes = Buffer.from(fixtures.find(value => value.name === 'blocks')!.hex, 'hex');
  await fs.writeFile('/one.xz', bytes);
  for (const command of ['xz', 'unxz', 'xzcat']) {
    for (const args of [[], ['-q'], ['--robot'], ['-vv']]) {
      for (const [limit, display] of [['1', '1 B'], ['1025', '1025 B'], ['8KiB', '8192 B']]) {
        const result = await run(command, ['-l', `--memlimit=${limit}`, ...args, 'one.xz'], chunks(), { fs });
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.split('\n')[0]!.endsWith('Memory usage limit reached'));
        assert.equal(result.stderr.split('\n').slice(1).join('\n'), `${command}: 1 MiB of memory is required. The limit is ${display}.\n`);
      }
    }
  }
  const quiet = await run('xz', ['-lqq', '--memlimit=1', 'one.xz'], chunks(), { fs });
  assert.equal(quiet.exitCode, 1);
  assert.equal(quiet.stderr, '');
  const unlimited = await run('xz', ['-l', 'one.xz'], chunks(), { fs });
  for (const limit of ['16KiB', '32KiB', '1MiB']) {
    const result = await run('xz', ['-l', `--memlimit=${limit}`, 'one.xz'], chunks(), { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.stdout, unlimited.stdout);
  }
  assert.deepEqual(Buffer.from(await fs.readFile('/one.xz')), bytes);
});
