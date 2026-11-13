import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

async function setup(divergent: boolean, incoming = 'modify') {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', { recursive: true });
  const run = runner(fs);
  const ok = async (args: string[]) => {
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout;
  };
  const write = (path: string, text: string) => fs.writeFile(`/repo/${path}`, new TextEncoder().encode(text));
  await ok(['init', '-b', 'main']);
  await write('f', 'row\n');
  await write('keep', 'base\n');
  await ok(['add', '.']);
  await ok(['commit', '-m', 'base']);
  await ok(['switch', '-c', 'topic']);
  if (incoming === 'delete') await ok(['rm', 'f']);
  else await write(incoming === 'add' ? 'new' : 'f', 'their\n');
  await ok(['add', '.']);
  await ok(['commit', '-m', 'topic']);
  await ok(['switch', 'main']);
  if (divergent) {
    await write('ours', 'ours\n');
    await ok(['add', 'ours']);
    await ok(['commit', '-m', 'ours']);
  }
  return { fs, run, ok, write };
}

for (const divergent of [false, true]) {
  const kind = divergent ? 'divergent' : 'fast-forward';
  for (const collision of ['unstaged', 'staged', 'deleted', 'untracked', 'incoming deletion']) {
    test(`${kind} merge preserves all state when ${collision} work would be overwritten`, async () => {
      const { fs, run, ok, write } = await setup(divergent,
        collision === 'untracked' ? 'add' : collision === 'incoming deletion' ? 'delete' : 'modify');
      const path = collision === 'untracked' ? 'new' : 'f';
      if (collision === 'deleted') await fs.unlink(`/repo/${path}`);
      else await write(path, 'local only\n');
      if (collision === 'staged') await ok(['add', path]);
      const head = await ok(['rev-parse', 'HEAD']);
      const index = await fs.readFile('/repo/.git/index');
      const result = await run(['merge', 'topic']);
      assert.notEqual(result.exitCode, 0, result.stdout);
      assert.ok(result.stderr.includes(path), result.stderr);
      assert.equal(await ok(['rev-parse', 'HEAD']), head);
      assert.deepEqual(await fs.readFile('/repo/.git/index'), index);
      if (collision === 'deleted') await assert.rejects(fs.stat(`/repo/${path}`));
      else assert.equal(new TextDecoder().decode(await fs.readFile(`/repo/${path}`)), 'local only\n');
      await assert.rejects(fs.stat('/repo/.git/MERGE_HEAD'));
    });
  }
  test(`${kind} merge preserves unrelated staged, unstaged, deleted, and untracked work`, async () => {
    const { fs, ok, write } = await setup(divergent);
    await write('keep', 'staged\n');
    await ok(['add', 'keep']);
    await write('keep', 'unstaged\n');
    await write('untracked', 'local\n');
    if (divergent) await fs.unlink('/repo/ours');
    const staged = await ok(['show', ':keep']);
    await ok(['merge', 'topic']);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/f')), 'their\n');
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/keep')), 'unstaged\n');
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/untracked')), 'local\n');
    assert.equal(await ok(['show', ':keep']), staged);
    if (divergent) await assert.rejects(fs.stat('/repo/ours'));
  });
}

for (const option of ['--no-ff', '--squash', '--no-commit']) {
  test(`merge ${option} refuses overwriting local work`, async () => {
    const { fs, run, ok, write } = await setup(false);
    await write('f', 'local\n');
    const head = await ok(['rev-parse', 'HEAD']);
    const index = await fs.readFile('/repo/.git/index');
    assert.notEqual((await run(['merge', option, 'topic'])).exitCode, 0);
    assert.equal(await ok(['rev-parse', 'HEAD']), head);
    assert.deepEqual(await fs.readFile('/repo/.git/index'), index);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/f')), 'local\n');
  });
}

test('merge checks all collisions before publishing any conflict markers', async () => {
  const { fs, run, ok, write } = await setup(false);
  await write('f', 'ours\n');
  await ok(['add', 'f']);
  await ok(['commit', '-m', 'ours']);
  await ok(['switch', 'topic']);
  await write('z', 'incoming\n');
  await ok(['add', 'z']);
  await ok(['commit', '-m', 'incoming file']);
  await ok(['switch', 'main']);
  await write('z', 'untracked\n');
  const index = await fs.readFile('/repo/.git/index');
  assert.notEqual((await run(['merge', 'topic'])).exitCode, 0);
  assert.deepEqual(await fs.readFile('/repo/.git/index'), index);
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/f')), 'ours\n');
  await assert.rejects(fs.stat('/repo/.git/MERGE_HEAD'));
});

test('a merge with conflicts preserves unrelated local edits', async () => {
  const { fs, run, ok, write } = await setup(false);
  await write('f', 'ours\n');
  await ok(['add', 'f']);
  await ok(['commit', '-m', 'ours']);
  await write('keep', 'local\n');
  assert.notEqual((await run(['merge', 'topic'])).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/keep')), 'local\n');
  assert.ok(new TextDecoder().decode(await fs.readFile('/repo/f')).includes('<<<<<<<'));
  assert.equal((await fs.stat('/repo/.git/MERGE_HEAD')).type, 'file');
});

test('fast-forward merge checks out symlinks', async () => {
  const { fs, ok } = await setup(false);
  await ok(['switch', 'topic']);
  await fs.symlink('f', '/repo/link');
  await ok(['add', 'link']);
  await ok(['commit', '-m', 'links']);
  await ok(['switch', 'main']);
  await ok(['merge', 'topic']);
  assert.equal(await fs.readlink('/repo/link'), 'f');
});
