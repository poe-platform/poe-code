import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

for (const mode of ['--keep', '--merge']) {
  test(`reset ${mode} refuses conflicting local edits without moving HEAD or index`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/repo');
    const run = runner(fs);
    const ok = async (args: string[]) => {
      const result = await run(args);
      assert.equal(result.exitCode, 0, result.stderr);
      return result.stdout;
    };
    await ok(['init', '-b', 'main']);
    await fs.writeFile('/repo/a', Buffer.from('base\n'));
    await ok(['add', 'a']);
    await ok(['commit', '-m', 'base']);
    const head = await ok(['rev-parse', 'HEAD']);
    await ok(['checkout', '-b', 'topic']);
    await fs.writeFile('/repo/a', Buffer.from('topic\n'));
    await ok(['commit', '-am', 'topic']);
    await ok(['checkout', 'main']);
    await fs.writeFile('/repo/a', Buffer.from('local'));
    const index = await fs.readFile('/repo/.git/index');
    assert.equal((await run(['reset', mode, 'topic'])).exitCode, 128);
    assert.equal(await ok(['rev-parse', 'HEAD']), head);
    assert.deepEqual(await fs.readFile('/repo/.git/index'), index);
    assert.equal(await ok(['show', 'HEAD:a']), 'base\n');
    assert.equal(await ok(['show', ':a']), 'base\n');
    assert.equal(Buffer.from(await fs.readFile('/repo/a')).toString('utf8'), 'local');
  });
}
