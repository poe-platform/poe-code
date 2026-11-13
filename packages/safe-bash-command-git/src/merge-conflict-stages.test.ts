import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

for (const kind of ['modify/modify', 'add/add']) {
  test(`${kind} merge replaces stage zero and staging a resolution clears every conflict stage`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/repo', { recursive: true });
    const run = runner(fs);
    const ok = async (args: string[]) => {
      const result = await run(args);
      assert.equal(result.exitCode, 0, result.stderr);
      return result.stdout.trimEnd();
    };
    const write = (path: string, text: string) => fs.writeFile(`/repo/${path}`, new TextEncoder().encode(text));
    await ok(['init', '-b', 'main']);
    await write('keep', 'unchanged\n');
    if (kind === 'modify/modify') await write('f', 'row\n');
    await ok(['add', '.']);
    await ok(['commit', '-m', 'base']);
    const base = kind === 'modify/modify' ? await ok(['rev-parse', 'HEAD:f']) : undefined;
    const keep = await ok(['ls-files', '--stage', 'keep']);
    await ok(['checkout', '-b', 'topic']);
    await write('f', 'their\n');
    await ok(['add', 'f']);
    await ok(['commit', '-m', 'theirs']);
    const theirs = await ok(['rev-parse', 'HEAD:f']);
    await ok(['checkout', 'main']);
    await write('f', 'our\n');
    await ok(['add', 'f']);
    await ok(['commit', '-m', 'ours']);
    const ours = await ok(['rev-parse', 'HEAD:f']);
    const head = await ok(['rev-parse', 'HEAD']);

    const result = await run(['merge', 'topic']);
    assert.equal(result.exitCode, 1, result.stdout);
    const stages = [
      ...(base ? [`100644 ${base} 1\tf`] : []),
      `100644 ${ours} 2\tf`,
      `100644 ${theirs} 3\tf`,
    ];
    assert.equal(await ok(['ls-files', '--stage']), [...stages, keep].join('\n'));
    // Check the serialized index too: no hidden stage-zero entry may survive export.
    assert.equal(Buffer.from(await fs.readFile('/repo/.git/index')).readUInt32BE(8), stages.length + 1);
    assert.equal(await ok(['rev-parse', 'HEAD']), head);
    assert.notEqual((await run(['commit', '-m', 'unresolved'])).exitCode, 0);

    await write('f', 'resolved\n');
    await ok(['add', 'f']);
    const resolved = await ok(['hash-object', 'f']);
    assert.equal(await ok(['ls-files', '--stage']), `100644 ${resolved} 0\tf\n${keep}`);
    assert.equal(Buffer.from(await fs.readFile('/repo/.git/index')).readUInt32BE(8), 2);
    assert.equal(await ok(['status', '--porcelain']), 'M  f');
    await ok(['commit', '-m', 'resolved']);
    assert.equal(await ok(['status', '--porcelain']), '');
    assert.equal(await ok(['show', 'HEAD:f']), 'resolved');
  });
}
