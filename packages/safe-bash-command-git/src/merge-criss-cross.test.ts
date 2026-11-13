import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

async function repository() {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', { recursive: true });
  const run = runner(fs);
  const ok = async (args: string[]) => {
    const result = await run(args);
    assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = async (path: string, text: string) => {
    await fs.writeFile(`/repo/${path}`, new TextEncoder().encode(text));
    await ok(['add', path]);
  };
  const commitTree = async (message: string, parents: string[]) => {
    const tree = await ok(['write-tree']);
    return ok(['commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', message]);
  };

  await ok(['init', '-b', 'main']);
  return { fs, run, ok, write, commitTree };
}

test('recursive merge bases preserve deletions and changes through nested criss-cross history', async () => {
  const { fs, ok, write, commitTree } = await repository();
  await write('shared', 'base\n');
  await ok(['commit', '-m', 'root']);
  const root = await ok(['rev-parse', 'HEAD']);
  const bases: string[] = [];
  for (const path of ['x', 'y', 'z']) {
    await ok(['reset', '--hard', root]);
    await write(path, `${path}\n`);
    bases.push(await commitTree(path, [root]));
  }
  for (const path of ['x', 'y']) await write(path, `${path}\n`);
  const union = await ok(['write-tree']);
  await write('u', 'u\n');
  const u = await commitTree('U', bases);
  await ok(['reset', '--hard', root]);
  await ok(['read-tree', union]);
  await write('v', 'v\n');
  const v = await commitTree('V', [...bases].reverse());
  assert.deepEqual((await ok(['merge-base', '--all', u, v])).split('\n').sort(), bases.sort());

  await write('u', 'u\n');
  const nestedUnion = await ok(['write-tree']);
  await write('x', 'changed x\n');
  const a = await commitTree('A', [u, v]);
  await ok(['read-tree', nestedUnion]);
  await ok(['rm', 'y']);
  const b = await commitTree('B', [v, u]);
  await ok(['reset', '--hard', a]);
  await ok(['merge', b]);
  assert.equal(await ok(['show', 'HEAD:x']), 'changed x');
  assert.equal(await ok(['ls-tree', '-r', '--name-only', 'HEAD']), 'shared\nu\nv\nx\nz');
  await assert.rejects(fs.stat('/repo/y'), { code: 'ENOENT' });
  assert.equal(await ok(['status', '--porcelain']), '');
});

for (const resolution of ['same', 'different']) {
  test(`conflicts between merge bases allow ${resolution} resolutions at the tips`, async () => {
    const { fs, run, ok, write, commitTree } = await repository();
    await write('shared', 'base\n');
    await ok(['commit', '-m', 'root']);
    const root = await ok(['rev-parse', 'HEAD']);
    await write('shared', 'x\n');
    const x = await commitTree('X', [root]);
    await write('shared', 'y\n');
    const y = await commitTree('Y', [root]);
    await write('shared', 'resolved\n');
    await write('u', 'u\n');
    const u = await commitTree('U', [x, y]);
    await ok(['reset', '--hard', root]);
    await write('shared', resolution === 'same' ? 'resolved\n' : 'other\n');
    await write('v', 'v\n');
    const v = await commitTree('V', [y, x]);
    await ok(['reset', '--hard', u]);
    const result = await run(['merge', v]);
    assert.equal(result.exitCode, resolution === 'same' ? 0 : 1, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/u')), 'u\n');
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/v')), 'v\n');
    if (resolution === 'same') {
      assert.equal(await ok(['show', 'HEAD:shared']), 'resolved');
      assert.equal(await ok(['status', '--porcelain']), '');
    } else {
      const stages = await ok(['ls-files', '--stage']);
      for (const stage of [1, 2, 3]) assert.ok(stages.includes(` ${stage}\tshared`), stages);
      assert.ok(!stages.includes(' 0\tshared'), stages);
      const shared = new TextDecoder().decode(await fs.readFile('/repo/shared'));
      for (const marker of ['<<<<<<<', 'resolved\n', '=======', 'other\n', '>>>>>>>']) {
        assert.ok(shared.includes(marker), shared);
      }
      await write('shared', 'final\n');
      await ok(['commit', '-m', 'Resolve merge']);
      assert.equal(await ok(['show', '-s', '--format=%P', 'HEAD']), `${u} ${v}`);
      assert.equal(await ok(['status', '--porcelain']), '');
    }
  });
}

for (const reverse of [false, true]) {
  for (const conflict of [false, true]) {
    test(`criss-cross merge preserves ${conflict ? 'resolvable conflicts' : 'the clean union'} with ${reverse ? 'reversed' : 'forward'} parents`, async () => {
      const { fs, run, ok, write, commitTree } = await repository();
      await write('shared', 'base\n');
      await ok(['commit', '-m', 'root']);
      const root = await ok(['rev-parse', 'HEAD']);
      await write('x', 'x\n');
      const x = await commitTree('X', [root]);
      await ok(['reset', '--hard', root]);
      await write('y', 'y\n');
      const y = await commitTree('Y', [root]);
      await write('x', 'x\n');
      const union = await ok(['write-tree']);
      const parents = reverse ? [y, x] : [x, y];
      await write('u', 'u\n');
      if (conflict) await write('shared', 'ours\n');
      const u = await commitTree('U', parents);
      await ok(['reset', '--hard', root]);
      await ok(['read-tree', union]);
      await write('v', 'v\n');
      if (conflict) await write('shared', 'theirs\n');
      const v = await commitTree('V', [...parents].reverse());
      await ok(['reset', '--hard', u]);
      assert.deepEqual((await ok(['merge-base', '--all', u, v])).split('\n').sort(), [x, y].sort());

      const result = await run(['merge', v]);
      assert.equal(result.exitCode, conflict ? 1 : 0, result.stderr);
      for (const path of ['x', 'y', 'u', 'v']) {
        assert.equal(new TextDecoder().decode(await fs.readFile(`/repo/${path}`)), `${path}\n`);
      }
      if (conflict) {
        assert.equal(await ok(['rev-parse', 'HEAD']), u);
        assert.equal(new TextDecoder().decode(await fs.readFile('/repo/.git/MERGE_HEAD')).trim(), v);
        const shared = new TextDecoder().decode(await fs.readFile('/repo/shared'));
        for (const marker of ['<<<<<<<', 'ours\n', '=======', 'theirs\n', '>>>>>>>']) {
          assert.ok(shared.includes(marker), shared);
        }
        const stages = await ok(['ls-files', '--stage']);
        for (const stage of [1, 2, 3]) assert.ok(stages.includes(` ${stage}\tshared`), stages);
        assert.ok(!stages.includes(' 0\tshared'), stages);
        if (reverse) {
          await ok(['merge', '--abort']);
          assert.equal(await ok(['rev-parse', 'HEAD']), u);
          assert.equal(new TextDecoder().decode(await fs.readFile('/repo/shared')), 'ours\n');
          assert.equal(await ok(['status', '--porcelain']), '');
          return;
        }
        await write('shared', 'resolved\n');
        await ok(['commit', '-m', 'Resolve merge']);
      }
      assert.equal(await ok(['show', 'HEAD:shared']), conflict ? 'resolved' : 'base');
      assert.equal(await ok(['ls-tree', '-r', '--name-only', 'HEAD']), 'shared\nu\nv\nx\ny');
      assert.equal(await ok(['show', '-s', '--format=%P', 'HEAD']), `${u} ${v}`);
      assert.equal(await ok(['status', '--porcelain']), '');
    });
  }
}
