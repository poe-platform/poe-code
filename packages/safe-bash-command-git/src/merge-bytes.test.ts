import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

// Byte-for-byte results verified with native Git, including the committed blob.
const cases = [
  { name: 'untouched invalid UTF-8', base: '610aff0a620a', ours: '6f0aff0a620a',
    theirs: '610aff0a740a', merged: '6f0aff0a740a' },
  { name: 'edited invalid UTF-8', base: '610a6d0a620a', ours: 'ff0a6d0a620a',
    theirs: '610a6d0afe0a', merged: 'ff0a6d0afe0a' },
  { name: 'CRLF and unterminated final line', base: '610d0aff800d0a62', ours: '6f0d0aff800d0a62',
    theirs: '610d0aff800d0a74', merged: '6f0d0aff800d0a74' },
];

for (const fixture of cases) {
  test(`merge preserves ${fixture.name} in the worktree and committed blob`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/repo');
    const run = runner(fs);
    const ok = async (args: string[]) => {
      const result = await run(args);
      assert.equal(result.exitCode, 0, result.stderr);
      return result.stdout;
    };
    const commit = async (hex: string, message: string) => {
      await fs.writeFile('/repo/f', Buffer.from(hex, 'hex'));
      await ok(['add', 'f']);
      await ok(['commit', '-m', message]);
    };
    await ok(['init', '-b', 'main']);
    await commit(fixture.base, 'base');
    await ok(['checkout', '-b', 'topic']);
    await commit(fixture.theirs, 'theirs');
    const topic = (await ok(['rev-parse', 'HEAD'])).trim();
    await ok(['checkout', 'main']);
    await commit(fixture.ours, 'ours');
    const ours = (await ok(['rev-parse', 'HEAD'])).trim();
    assert.equal(await ok(['status', '--porcelain']), '');
    await ok(['merge', 'topic']);
    assert.equal((await ok(['rev-parse', 'HEAD^1'])).trim(), ours);
    assert.equal((await ok(['rev-parse', 'HEAD^2'])).trim(), topic);
    assert.equal(Buffer.from(await fs.readFile('/repo/f')).toString('hex'), fixture.merged);
    const oid = (await ok(['rev-parse', 'HEAD:f'])).trim();
    const object = inflateSync(await fs.readFile(`/repo/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`));
    const expected = Buffer.from(fixture.merged, 'hex');
    assert.deepEqual(object, Buffer.concat([Buffer.from(`blob ${expected.length}\0`), expected]));
    assert.equal(await ok(['status', '--porcelain']), '');
  });
}

test('merge keeps distinct invalid bytes conflicting and preserves the original versions', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo');
  const run = runner(fs);
  const ok = async (args: string[]) => {
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout;
  };
  const commit = async (hex: string, message: string) => {
    await fs.writeFile('/repo/f', Buffer.from(hex, 'hex'));
    await ok(['add', 'f']);
    await ok(['commit', '-m', message]);
  };
  await ok(['init', '-b', 'main']);
  await commit('610a', 'base');
  await ok(['checkout', '-b', 'topic']);
  await commit('fe0a', 'theirs');
  const topic = (await ok(['rev-parse', 'HEAD'])).trim();
  await ok(['checkout', 'main']);
  await commit('ff0a', 'ours');
  const head = await ok(['rev-parse', 'HEAD']);
  const result = await run(['merge', topic]);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await ok(['rev-parse', 'HEAD']), head);
  assert.deepEqual(Buffer.from(await fs.readFile('/repo/f')), Buffer.concat([
    Buffer.from('<<<<<<< main\n'), Buffer.from('ff0a', 'hex'),
    Buffer.from('=======\n'), Buffer.from('fe0a', 'hex'), Buffer.from(`>>>>>>> ${topic}\n`),
  ]));
  await ok(['merge', '--abort']);
  assert.equal(Buffer.from(await fs.readFile('/repo/f')).toString('hex'), 'ff0a');
  assert.equal(await ok(['status', '--porcelain']), '');
});
