import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

test('Git round trips binary files without consulting ambient Buffer', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo');
  const original = Uint8Array.from({ length: 17000 }, (_, index) => index % 256);
  await fs.writeFile('/repo/binary', original);
  const run = runner(fs);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, get() { throw new Error('ambient Buffer is forbidden'); } });
  try {
    for (const args of [['init'], ['add', '.'], ['commit', '-m', 'binary']]) {
      const result = await run(args);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    await fs.writeFile('/repo/binary', Uint8Array.of(1, 2, 3));
    const reset = await run(['reset', '--hard']);
    assert.equal(reset.exitCode, 0, reset.stderr);
    assert.deepEqual(await fs.readFile('/repo/binary'), original);
  } finally {
    Object.defineProperty(globalThis, 'Buffer', descriptor);
  }
});
