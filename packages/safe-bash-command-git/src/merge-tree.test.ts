import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

for (const conflict of ['text', 'binary', 'modify/delete', 'delete/modify', 'none']) {
  for (const dirty of [false, true]) {
    test(`merge-tree returns a usable ${conflict} tree and preserves ${dirty ? 'dirty' : 'clean'} repository state`, async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('/repo', { recursive: true });
      const run = runner(fs);
      const ok = async (args: string[]) => {
        const result = await run(args);
        assert.equal(result.exitCode, 0, result.stderr);
        return result.stdout;
      };
      const write = (path: string, content: string) => fs.writeFile(`/repo/${path}`, new TextEncoder().encode(content));
      const ours = conflict === 'binary' ? 'our\0\n' : 'our\n';
      const theirs = conflict === 'binary' ? 'their\0\n' : 'their\n';
      await ok(['init', '-b', 'main']);
      await write('f', 'row\n');
      await write('keep', 'kept\n');
      await ok(['add', '.']);
      await ok(['commit', '-m', 'base']);
      await ok(['switch', '-c', 'topic']);
      if (conflict === 'modify/delete') await ok(['rm', 'f']);
      else await write('f', theirs);
      await fs.mkdir('/repo/nested');
      await write('nested/incoming', 'incoming\n');
      await ok(['add', '.']);
      await ok(['commit', '-m', 'topic']);
      await ok(['switch', 'main']);
      if (conflict === 'delete/modify') await ok(['rm', 'f']);
      else if (conflict !== 'none') await write('f', ours);
      await write('main-only', 'main\n');
      await ok(['add', '.']);
      await ok(['commit', '-m', 'main']);

      if (dirty) {
        await write('keep', 'staged\n');
        await ok(['add', 'keep']);
        await write('keep', 'unstaged\n');
        await write('untracked', 'local\n');
      }
      const index = await fs.readFile('/repo/.git/index');
      const head = await ok(['rev-parse', 'HEAD']);
      const stages = await ok(['ls-files', '--stage']);
      const status = await ok(['status', '--porcelain']);
      const statePaths = ['f', 'keep', 'main-only', 'nested/incoming', 'untracked',
        '.git/HEAD', '.git/refs/heads/main', '.git/refs/heads/topic',
        '.git/ORIG_HEAD', '.git/MERGE_HEAD', '.git/MERGE_MSG', '.git/MERGE_MODE'];
      const readState = (path: string) => fs.readFile(`/repo/${path}`).catch((error: { code: string }) => {
        assert.equal(error.code, 'ENOENT');
        return null;
      });
      const state = await Promise.all(statePaths.map(readState));

      const result = await run(['merge-tree', '--write-tree', 'main', 'topic']);
      assert.equal(result.exitCode, conflict === 'none' ? 0 : 1, result.stderr);
      assert.deepEqual(await fs.readFile('/repo/.git/index'), index, 'index bytes changed');
      assert.equal(await ok(['rev-parse', 'HEAD']), head);
      assert.equal(await ok(['ls-files', '--stage']), stages);
      assert.equal(await ok(['status', '--porcelain']), status);
      for (const [i, path] of statePaths.entries()) {
        assert.deepEqual(await readState(path), state[i], `${path} changed`);
      }

      const tree = result.stdout.split('\n')[0];
      assert.equal(await ok(['ls-tree', '-r', '--name-only', tree]), 'f\nkeep\nmain-only\nnested/incoming\n');
      assert.equal(await ok(['show', `${tree}:keep`]), 'kept\n');
      assert.equal(await ok(['show', `${tree}:main-only`]), 'main\n');
      assert.equal(await ok(['show', `${tree}:nested/incoming`]), 'incoming\n');
      assert.equal(await ok(['show', `${tree}:f`]), conflict === 'text'
        ? '<<<<<<< main\nour\n=======\ntheir\n>>>>>>> topic\n'
        : conflict === 'delete/modify' || conflict === 'none' ? theirs : ours);
    });
  }
}
