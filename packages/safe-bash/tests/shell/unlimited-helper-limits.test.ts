import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';
import { resolveLimits } from '../../src/shell/runtime.js';
test('shell accepts explicit Infinity for resource ceilings', () => {
  assert.equal(resolveLimits({ maxGlobstarDepth: Infinity, maxCdWork: Infinity }).maxGlobstarDepth, Infinity);
  assert.throws(() => resolveLimits({ pipeHighWaterMark: Infinity }), RangeError);
});
test('cd admits more than 4096 CDPATH components and obeys explicit helper ceilings', async () => {
  const { shell, fs } = setup({ cwd: '/work' });
  await fs.mkdir('/work/a', { recursive: true });
  try {
    const env = { CDPATH: ':'.repeat(4097) };
    const result = await shell.exec('cd a', { env });
    assert.equal(result.exitCode, 0, result.stderr);
    const limited = await shell.exec('cd a', { env, limits: { maxCdPathComponents: 4096 } });
    assert.equal(limited.exitCode, 1);
    assert.match(limited.stderr, /component limit/);
    const noWork = await shell.exec('cd /', { limits: { maxCdWork: 0 } });
    assert.equal(noWork.exitCode, 1);
    assert.match(noWork.stderr, /work limit/);
  } finally { await shell.dispose(); }
});

test('directory diagnostics and retained stack bytes have optional ceilings', async () => {
  const { shell, fs } = setup();
  const { FsError } = await import('../../src/contracts/index.js');
  const diagnostic = 'x'.repeat(65793);
  fs.stat = async () => { throw new FsError('EIO', { message: diagnostic }); };
  try {
    const unlimited = await shell.exec('cd /missing');
    assert.ok(unlimited.stderr.includes(diagnostic));
    const bounded = await shell.exec('cd /missing', { limits: { maxDirectoryDiagnosticBytes: 64 } });
    assert.ok(bounded.stderr.includes('[truncated]'));
    assert.equal(resolveLimits({}).maxDirectoryStackBytes, Infinity);
    assert.equal((await shell.exec('pushd -n abc')).exitCode, 0);
    const stack = await shell.exec('pushd -n def', { limits: { maxDirectoryStackBytes: 1 } });
    assert.equal(stack.exitCode, 1);
    assert.match(stack.stderr, /directory stack byte limit/);
  } finally { await shell.dispose(); }
});
