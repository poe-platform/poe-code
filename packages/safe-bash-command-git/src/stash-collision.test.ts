import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

for (const op of ['apply', 'pop']) {
  test(`stash ${op} preserves an untracked collision and keeps the stash`, async () => {
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
    await write('a', 'base\n');
    await write('b', 'second\n');
    await ok(['add', '.']);
    await ok(['commit', '-m', 'base']);
    await write('scratch.txt', 'saved\n');
    await ok(['stash', 'push', '-u']);
    await write('scratch.txt', 'independent\n');
    const index = await fs.readFile('/repo/.git/index');
    const stash = await ok(['stash', 'list']);
    const head = await ok(['rev-parse', 'HEAD']);

    const result = await run(['stash', op]);

    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/scratch.txt')), 'independent\n');
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('scratch.txt'), result.stderr);
    assert.deepEqual(await fs.readFile('/repo/.git/index'), index);
    assert.equal(await ok(['stash', 'list']), stash);
    assert.equal(await ok(['rev-parse', 'HEAD']), head);

    await fs.unlink('/repo/scratch.txt');
    await ok(['stash', 'pop']);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/scratch.txt')), 'saved\n');
    assert.equal(await ok(['stash', 'list']), '\n');
  });
}
