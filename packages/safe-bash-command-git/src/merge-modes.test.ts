import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

for (const incoming of [true, false]) {
  for (const executable of [true, false]) {
    for (const edit of ['unrelated', 'text', 'binary', 'both text']) {
      test(`divergent merge preserves ${incoming ? 'incoming' : 'outgoing'} executable-bit ${executable ? 'addition' : 'removal'} with ${edit} edits`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir('/repo', { recursive: true });
        const run = runner(fs);
        const ok = async (args: string[]) => {
          const result = await run(args);
          assert.equal(result.exitCode, 0, result.stderr);
          return result.stdout;
        };
        const write = (path: string, text: string) => fs.writeFile(`/repo/${path}`, new TextEncoder().encode(text));
        const base = edit === 'binary' ? 'base\0bytes' : 'first\nmiddle\nlast\n';
        const changed = edit === 'binary' ? 'changed\0bytes' : 'first\nmiddle\nchanged\n';
        const mode = executable ? 0o755 : 0o644;
        const treeMode = executable ? '100755' : '100644';
        await ok(['init', '-b', 'main']);
        await write('f', base);
        await fs.chmod('/repo/f', executable ? 0o644 : 0o755);
        await ok(['add', 'f']);
        await ok(['commit', '-m', 'base']);
        await ok(['branch', 'topic']);
        for (const branch of ['main', 'topic']) {
          await ok(['switch', branch]);
          if ((branch === 'topic') === incoming) {
            if (edit === 'both text') await write('f', 'changed\nmiddle\nlast\n');
            await fs.chmod('/repo/f', mode);
          } else if (edit === 'unrelated') {
            await write('other', 'other\n');
          } else {
            await write('f', changed);
          }
          await ok(['add', '.']);
          await ok(['commit', '-m', branch]);
        }
        await ok(['switch', 'main']);
        await ok(['merge', 'topic']);
        const expected = edit === 'unrelated' ? base : edit === 'both text' ? 'changed\nmiddle\nchanged\n' : changed;
        const blob = (await ok(['rev-parse', 'HEAD:f'])).trim();
        assert.equal((await ok(['ls-tree', 'HEAD'])).split('\n').find(line => line.endsWith('\tf')), `${treeMode} blob ${blob}\tf`);
        assert.equal((await ok(['ls-files', '--stage'])).split('\n').find(line => line.endsWith('\tf')), `${treeMode} ${blob} 0\tf`);
        assert.equal(await ok(['show', 'HEAD:f']), expected);
        assert.equal(new TextDecoder().decode(await fs.readFile('/repo/f')), expected);
        assert.equal((await fs.stat('/repo/f')).mode & 0o777, mode);
        assert.equal(await ok(['status', '--porcelain']), '');
      });
    }
  }
}
