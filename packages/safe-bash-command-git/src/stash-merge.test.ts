import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

test('stash pop persists both conflicting edits, all index stages, and the saved stash', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', { recursive: true });
  const run = runner(fs);
  const ok = async (args: string[]) => {
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout;
  };
  const write = (text: string) => fs.writeFile('/repo/a', new TextEncoder().encode(text));
  await ok(['init', '-b', 'main']);
  await ok(['config', 'user.name', 'Audit']);
  await ok(['config', 'user.email', 'audit@example.invalid']);
  await write('base\n');
  await ok(['add', 'a']);
  await ok(['commit', '-m', 'base']);
  const base = (await ok(['rev-parse', 'HEAD:a'])).trim();
  await write('saved\n');
  await ok(['stash', 'push']);
  const saved = (await ok(['rev-parse', 'refs/stash:a'])).trim();
  const stash = await ok(['stash', 'list']);
  await write('other\n');
  await ok(['commit', '-am', 'other']);
  const current = (await ok(['rev-parse', 'HEAD:a'])).trim();
  const head = await ok(['rev-parse', 'HEAD']);

  const result = await run(['stash', 'pop']);

  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/a')),
    '<<<<<<< Updated upstream\nother\n=======\nsaved\n>>>>>>> Stashed changes\n');
  assert.equal(await ok(['ls-files', '--unmerged']),
    `100644 ${base} 1\ta\n100644 ${current} 2\ta\n100644 ${saved} 3\ta\n`);
  assert.equal(await ok(['stash', 'list']), stash);
  assert.equal(await ok(['rev-parse', 'HEAD']), head);
});
