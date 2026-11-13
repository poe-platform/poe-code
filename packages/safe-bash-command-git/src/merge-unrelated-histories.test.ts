import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

test('unrelated histories require explicit opt-in through the public Git command', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', { recursive: true });
  const run = runner(fs);
  const ok = async (args: string[]) => {
    const result = await run(args);
    assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await ok(['init', '-b', 'main']);
  await fs.writeFile('/repo/x', new TextEncoder().encode('main\n'));
  await ok(['add', 'x']);
  await ok(['commit', '-m', 'main root']);
  const main = await ok(['rev-parse', 'HEAD']);
  await ok(['rm', 'x']);
  await fs.writeFile('/repo/new', new TextEncoder().encode('topic\n'));
  await ok(['add', 'new']);
  const tree = await ok(['write-tree']);
  const topic = await ok(['commit-tree', tree, '-m', 'topic root']);
  await ok(['update-ref', 'refs/heads/topic', topic]);
  await ok(['reset', '--hard', 'HEAD']);
  const index = await fs.readFile('/repo/.git/index');

  const rejected = await run(['merge', 'topic']);
  assert.equal(rejected.exitCode, 128, rejected.stdout);
  assert.equal(rejected.stderr, 'fatal: refusing to merge unrelated histories\n');
  assert.equal(await ok(['rev-parse', 'HEAD']), main);
  assert.equal(await ok(['show', '-s', '--format=%P', 'HEAD']), '');
  assert.deepEqual(await fs.readFile('/repo/.git/index'), index);
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/x')), 'main\n');
  await assert.rejects(fs.stat('/repo/new'), { code: 'ENOENT' });
  await assert.rejects(fs.stat('/repo/.git/MERGE_HEAD'), { code: 'ENOENT' });
  assert.equal(await ok(['status', '--porcelain']), '');

  await ok(['merge', '--allow-unrelated-histories', 'topic']);
  assert.equal(await ok(['show', '-s', '--format=%P', 'HEAD']), `${main} ${topic}`);
  assert.equal(await ok(['ls-tree', '--name-only', 'HEAD']), 'new\nx');
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/x')), 'main\n');
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/new')), 'topic\n');
  assert.equal(await ok(['status', '--porcelain']), '');
});
