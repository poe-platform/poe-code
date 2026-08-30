import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { workers, metrics, retired, vector, lateErrors } from './observe.mjs';

const [packageRoot, baselineRoot] = process.argv.slice(2);
const entry = import.meta.resolve('virtual-bash');
assert.equal(entry, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
const candidate = await import(entry);
const baseline = await import(pathToFileURL(resolve(baselineRoot, 'dist/index.js')));
process.send({ kind: 'ready' });
await new Promise(resolveRun => process.once('message', message => { assert.deepEqual(message, { kind: 'run' }); resolveRun(); }));
const expected = Array.from({ length: 32 }, (unused, index) => index).filter(index => index < 10 || index === 12 || index >= 30).map(index => './file' + String(index).padStart(2, '0') + '.txt:hit ' + String(index).padStart(2, '0') + '\n').join('');
const pairs = [];
for (let repeat = 0; repeat < 3; repeat++) {
  const pair = { repeat, order: repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'] };
  for (const variant of pair.order) {
    const api = variant === 'baseline' ? baseline : candidate;
    const fs = new api.MemoryFileSystem();
    await fs.mkdir('/tree');
    for (let index = 0; index < 32; index++) {
      const number = String(index).padStart(2, '0');
      await fs.writeFile('/tree/file' + number + '.txt', Buffer.from('hit ' + number + '\nmiss ' + number + '\n'));
    }
    await fs.writeFile('/tree/.ignore', Buffer.from('file1?.txt\n!file12.txt\n'));
    const first = workers.length;
    const started = performance.now();
    const shell = new api.Shell({ fs, cwd: '/tree' }).use(api.agentCommands());
    let result;
    let publicSettlement;
    try { result = await shell.exec("rg -g '!file2?.txt' hit ."); publicSettlement = metrics(first); }
    finally { await shell.dispose(); }
    const elapsedMs = performance.now() - started;
    const afterDispose = metrics(first);
    retired(afterDispose);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
    pair[variant] = { elapsedMs, output: vector(result), startupMs: afterDispose.map(worker => worker.startupMs), publicSettlement, afterDispose };
  }
  assert.deepEqual(pair.baseline.output, pair.candidate.output);
  pairs.push(pair);
}
await new Promise(resolveLate => setTimeout(resolveLate, 50));
retired(metrics());
assert.deepEqual(lateErrors, []);
process.send({ kind: 'result', pass: true, pairs, lateErrors, riskConsumed: 0, commands: 6, filesPerCommand: 32, expectedOutputBytes: Buffer.byteLength(expected), method: 'Three alternating pairs; complete Shell/plugin creation, startup, traversal, exact output and awaited disposal included; imports and VFS setup excluded. Same-host load uncontrolled. No superiority inference.' }, () => process.disconnect());
