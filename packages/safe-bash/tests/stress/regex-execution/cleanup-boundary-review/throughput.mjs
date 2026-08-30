import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NativeWorker = workerThreads.Worker;
const workers = [];
workerThreads.Worker = class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    const started = performance.now();
    super(url, options);
    const record = { url: String(url), exited: false, terminationCalls: 0 };
    workers.push(record);
    this.once('message', message => { if (message?.ready === true) record.startupMs = performance.now() - started; });
    this.once('exit', () => { record.exited = true; });
    const terminate = this.terminate.bind(this);
    this.terminate = async () => { record.terminationCalls++; return terminate(); };
  }
};
syncBuiltinESMExports();
const baseline = await import(pathToFileURL(resolve('tests/stress/regex-execution/cleanup-boundary-review/.temporary/baseline/dist/index.js')));
const candidate = await import(pathToFileURL(resolve(process.argv[2], 'dist/index.js')));
const expected = Array.from({ length: 32 }, (unused, index) => index).filter(index => index < 10 || index === 12 || index >= 30).map(index => './file' + String(index).padStart(2, '0') + '.txt:hit ' + String(index).padStart(2, '0') + '\n').join('');
const vector = result => ({ exitCode: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') });
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
    try { result = await shell.exec("rg -g '!file2?.txt' hit ."); }
    finally { await shell.dispose(); }
    const milliseconds = performance.now() - started;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
    const owned = workers.slice(first);
    assert.ok(owned.every(worker => worker.exited && worker.terminationCalls <= 1));
    pair[variant] = { milliseconds, output: vector(result), startupMs: owned.map(worker => worker.startupMs), workers: owned.length };
  }
  assert.deepEqual(pair.baseline.output, pair.candidate.output);
  pairs.push(pair);
}
const median = values => [...values].sort((left, right) => left - right)[1];
process.send({ kind: 'result', pass: true, counts: { pairs: pairs.length, commands: pairs.length * 2, filesPerCommand: 32, expectedOutputBytes: Buffer.byteLength(expected) }, workload: "rg -g '!file2?.txt' hit .", method: 'Reuse frozen prior32file fixture; three alternating-order pairs. Imports/VFS fixture setup excluded; Shell/plugin creation, real worker startup, traversal, exact output and awaited disposal included. Shared host load uncontrolled; no superiority or universal regression threshold inferred.', node: process.version, baselineMedianMs: median(pairs.map(pair => pair.baseline.milliseconds)), candidateMedianMs: median(pairs.map(pair => pair.candidate.milliseconds)), pairs, workers, riskConsumed: 0 }, () => process.disconnect());
