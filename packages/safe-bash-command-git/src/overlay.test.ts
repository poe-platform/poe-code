import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem, OverlayFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

test('Git publishes repository changes through an overlay without mutating its lower layer', async () => {
  const lower = new MemoryFileSystem();
  await lower.mkdir('/repo');
  const original = new TextEncoder().encode('original\n');
  await lower.writeFile('/repo/tracked', original);
  const upper = new MemoryFileSystem();
  const fs = new OverlayFileSystem({ lower, upper });
  const run = runner(fs);
  for (const args of [['init', '-b', 'main'], ['add', '.'], ['commit', '-m', 'initial']]) {
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  await fs.writeFile('/repo/tracked', new TextEncoder().encode('changed\n'));
  const diff = await run(['diff']);
  assert.equal(diff.exitCode, 0, diff.stderr);
  assert.ok(diff.stdout.includes('-original\n+changed\n'), diff.stdout);
  const reset = await run(['reset', '--hard']);
  assert.equal(reset.exitCode, 0, reset.stderr);
  assert.deepEqual(await fs.readFile('/repo/tracked'), original);
  const removed = await run(['rm', 'tracked']);
  assert.equal(removed.exitCode, 0, removed.stderr);
  await assert.rejects(fs.stat('/repo/tracked'));
  const status = await run(['status', '--porcelain']);
  assert.equal(status.exitCode, 0, status.stderr);
  assert.ok(status.stdout.includes('D  tracked'), status.stdout);
  const log = await run(['log', '-1', '--format=%s']);
  assert.equal(log.exitCode, 0, log.stderr);
  assert.equal(log.stdout.trim(), 'initial');
  assert.deepEqual(await lower.readFile('/repo/tracked'), original);
  await assert.rejects(lower.stat('/repo/.git'));
  assert.equal((await upper.stat('/repo/.git')).type, 'directory');
});
