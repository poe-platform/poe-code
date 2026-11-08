import assert from 'node:assert/strict';
import { artifact, snapshot } from './common.mjs';

const [mode, label] = process.argv.slice(2);
assert.ok(['source', 'compiled'].includes(mode));
assert.match(label ?? '', /^[a-z0-9-]+$/u);
const before = snapshot();
const built = mode === 'compiled' ? await (await import('./build.mjs')).build() : undefined;
const { createStructuredCommands, MemoryFileSystem, FsError, writeBytes } = built?.api ?? await import('../../../../src/index.ts');
const { JqError } = await import(built ? new URL('memory-only/commands/structured/limits.js', import.meta.url).href : '../../../../src/commands/structured/limits.ts');
const rows = [];
for (const failure of [new Error('host sink generic'), new FsError('EPIPE'), new FsError('EIO'), new JqError('host sink failure')]) {
  await assert.rejects(writeBytes({ async write() { throw failure; } }, Buffer.from('x')), error => error === failure);
  for (const configuration of [
    { cohort: 'original-host8', input: '1\n2\n', filter: '.', sink: 'stdout' },
    { cohort: 'original-host8', input: 'NaN\nInfinity\n', filter: '.', sink: 'stdout' },
    { cohort: 'stderr8', input: 'null\nnull\n', filter: '1/0', sink: 'stderr' },
    { cohort: 'stderr8', input: 'null\nnull\n', filter: 'isfinite(.)', sink: 'stderr', preflight: true },
  ]) {
    let reads = 0;
    let acquired = 0;
    let closed = 0;
    const attempted = { stdout: [], stderr: [] };
    const committed = { stdout: [], stderr: [] };
    const fs = new MemoryFileSystem();
    const stdin = { [Symbol.asyncIterator]() {
      acquired++;
      return (async function* () {
        try { for (const record of configuration.input.trimEnd().split('\n')) { reads++; yield Buffer.from(`${record}\n`); } }
        finally { closed++; }
      })();
    } };
    const sinks = Object.fromEntries(['stdout', 'stderr'].map(sink => [sink, { async write(bytes) {
      attempted[sink].push(Buffer.from(bytes).toString('hex'));
      if (sink === configuration.sink) throw failure;
      committed[sink].push(Buffer.from(bytes).toString('hex'));
    } }]));
    const command = createStructuredCommands().find(definition => definition.name === 'jq');
    let outcome;
    try {
      const result = await command.execute({ command: 'jq', args: ['-c', configuration.filter], fs, cwd: '/', env: {}, stdin, stdinIsDefault: false, ...sinks, signal: AbortSignal.timeout(1000) });
      outcome = { kind: 'resolved', exitCode: result.exitCode };
    } catch (error) { outcome = { kind: 'rejected', identity: error === failure, constructor: error.constructor.name, message: error.message, code: error.code }; }
    const row = { ...configuration, failureClass: failure.constructor.name, failureCode: failure.code, helperIdentity: true, outcome, acquired, reads, closed, attempted, committed, namespace: await fs.readdir('/') };
    rows.push(row);
    assert.equal(outcome.kind, 'rejected');
    assert.equal(outcome.identity, true);
    assert.equal(reads, configuration.preflight ? 0 : 1);
    assert.equal(acquired, configuration.preflight ? 0 : 1);
    assert.equal(closed, configuration.preflight ? 0 : 1);
    assert.equal(attempted[configuration.sink].length, 1);
    assert.equal(attempted[configuration.sink === 'stdout' ? 'stderr' : 'stdout'].length, 0);
    assert.deepEqual(committed, { stdout: [], stderr: [] });
    assert.deepEqual(row.namespace, []);
  }
}
const after = snapshot();
artifact(`${label}.json`, { before, after, stableProduct: before.productSha256 === after.productSha256, build: built?.record, rows,
  classification: 'Root-approved origin-based host stdout/stderr identity policy. Original stdout8 plus stderr8, not native parity. Typed JqError/EIO behavior changed in the earlier grammar handoff; old canonical assertion stays unchanged for separately reviewed test-only reconciliation.' });
built?.hooks.deregister();
console.log(mode, rows.length, 'host identity/cleanup/no-extra-I/O checks passed');
