import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { isCleanDiff } from './clean-diff.js';
import { createGitCommand } from './index.js';
import { runner } from '../tests/support.js';

test('clean diff does not read object storage or walk untracked directories', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo');
  const run = runner(fs);
  for (const args of [['init'], ['config', 'user.name', 'Test'], ['config', 'user.email', 'test@example.com']]) {
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  await fs.writeFile('/repo/tracked', new TextEncoder().encode('original\n'));
  assert.equal((await run(['add', 'tracked'])).exitCode, 0);
  await fs.mkdir('/repo/node_modules');
  await fs.writeFile('/repo/node_modules/unrelated', new Uint8Array([1]));
  const reads: string[] = [];
  const listings: string[] = [];
  const read = fs.readFile.bind(fs), readdir = fs.readdir.bind(fs);
  fs.readFile = async (path, options) => { reads.push(path); return read(path, options); };
  fs.readdir = async (path, options) => { listings.push(path); return readdir(path, options); };
  const result = await run(['diff', '--stat']);
  assert.deepEqual(result, { exitCode: 0, stdout: '', stderr: '' });
  assert.ok(!reads.some(path => path.startsWith('/repo/.git/objects/')), 'clean diff must not load Git object storage');
  assert.ok(!listings.includes('/repo/node_modules'), 'clean diff must not traverse untracked directories');
  await fs.writeFile('/repo/tracked', new TextEncoder().encode('modified\n'));
  const changed = await run(['diff', '--stat']);
  assert.equal(changed.exitCode, 0, changed.stderr);
  assert.ok(changed.stdout.includes('tracked'), changed.stdout);
});

for (const change of ['same-size edit', 'delete', 'mode', 'symlink target'] as const) {
  test(`clean diff preserves ${change} detection`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/repo');
    const run = runner(fs);
    assert.equal((await run(['init'])).exitCode, 0);
    if (change === 'symlink target') {
      await fs.writeFile('/repo/before', new TextEncoder().encode('target'));
      await fs.writeFile('/repo/after', new TextEncoder().encode('other'));
      await fs.symlink('before', '/repo/tracked');
    }
    else await fs.writeFile('/repo/tracked', new TextEncoder().encode('before'));
    assert.equal((await run(['add', 'tracked'])).exitCode, 0);
    assert.equal(await isCleanDiff(fs, '/repo', ['diff'], new AbortController().signal), true);
    if (change === 'delete') await fs.rm('/repo/tracked');
    else if (change === 'mode') await fs.chmod('/repo/tracked', 0o755);
    else if (change === 'symlink target') {
      await fs.rm('/repo/tracked');
      await fs.symlink('after', '/repo/tracked');
    } else await fs.writeFile('/repo/tracked', new TextEncoder().encode('edited'));
    const result = await run(['diff', '--exit-code']);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(result.stdout.includes('tracked'), result.stdout);
  });
}

test('clean diff declines revision comparisons, damaged indexes and explicit resource limits', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo');
  const run = runner(fs);
  assert.equal((await run(['init'])).exitCode, 0);
  await fs.writeFile('/repo/tracked', new TextEncoder().encode('original'));
  assert.equal((await run(['add', 'tracked'])).exitCode, 0);
  for (const args of [['diff', '--cached'], ['diff', 'HEAD'], ['diff', '--no-index'], ['diff', '--', 'tracked']]) {
    assert.equal(await isCleanDiff(fs, '/repo', args, new AbortController().signal), false);
  }
  const limited = await runner(fs, createGitCommand({ limits: { maxEntries: 1 } }))(['diff', '--stat']);
  assert.equal(limited.exitCode, 128);
  const index = await fs.readFile('/repo/.git/index');
  index[40] = index[40]! ^ 1;
  await fs.writeFile('/repo/.git/index', index);
  assert.equal(await isCleanDiff(fs, '/repo', ['diff'], new AbortController().signal), false);
});

test('clean diff ignores non-executable permission differences like native Git', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo');
  const run = runner(fs);
  assert.equal((await run(['init'])).exitCode, 0);
  await fs.writeFile('/repo/tracked', new TextEncoder().encode('private'));
  assert.equal((await run(['add', 'tracked'])).exitCode, 0);
  await fs.chmod('/repo/tracked', 0o600);
  assert.equal(await isCleanDiff(fs, '/repo', ['diff'], new AbortController().signal), true);
});
