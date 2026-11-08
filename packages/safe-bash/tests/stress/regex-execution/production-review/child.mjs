import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cohort.mjs';

const [snapshotName, job] = process.argv.slice(2);
const owned = resolve('tests/stress/regex-execution/production-review');
const snapshot = resolve(owned, 'snapshots', snapshotName);
const workers = [];
let active = 0;
let peak = 0;
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    const createdAt = performance.now();
    super(url, options);
    const record = { url: String(url), options, exited: false, terminationCalls: 0, refAtEnd: null, worker: this };
    workers.push(record);
    active++;
    peak = Math.max(peak, active);
    this.once('exit', code => { record.exited = true; record.exitCode = code; active--; });
    if (job === 'benchmark') this.once('message', message => { if (message?.ready === true) record.startupMs = performance.now() - createdAt; });
    const terminate = this.terminate.bind(this);
    this.terminate = async () => { record.terminationCalls++; const result = await terminate(); record.terminationAwaited = true; return result; };
  }
};
syncBuiltinESMExports();
const api = await import(pathToFileURL(resolve(snapshot, 'dist/index.js')));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const sleep = delay => new Promise(resolveSleep => setTimeout(resolveSleep, delay));
const deferred = () => { let resolveValue; let rejectValue; const promise = new Promise((resolvePromise, rejectPromise) => { resolveValue = resolvePromise; rejectValue = rejectPromise; }); return { promise, resolve: resolveValue, reject: rejectValue }; };
const checkWithin = async (promise, milliseconds) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`observation timeout ${milliseconds}ms`)), milliseconds); })]); } finally { clearTimeout(timer); } };
const makeShell = () => new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
const vector = result => ({ code: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') });
const observations = [];
let riskControl;
if (job.startsWith('risk-')) {
  const command = job.includes('-grep-') ? 'grep -E' : 'rg';
  const options = { regex: { requestTimeoutMs: 20, startupTimeoutMs: 1000 } };
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.standardCommands(options)).use(api.searchCommands(options));
  try { const result = await shell.exec(`${command} '^a+$'`, { stdin: 'aaaa\n' }); assert.equal(result.stdout, 'aaaa\n'); assert.equal(result.exitCode, 0); riskControl = { command, output: result.stdout, workers: workers.length }; }
  finally { await shell.dispose(); }
}
async function caseCheck(name, callback) {
  try { const details = await callback(); observations.push({ name, pass: true, details }); }
  catch (error) { observations.push({ name, pass: false, error: error.stack }); }
}
async function cohort() {
  const baseline = JSON.parse(await readFile(resolve(owned, 'evidence/baseline-commands.json')));
  for (const fixture of cases) await caseCheck(fixture.id, async () => {
    const shell = makeShell();
    try {
      const actual = vector(await shell.exec(fixture.script ?? [fixture.command, ...fixture.args].map(quote).join(' '), { stdin: fixture.input ?? '' }));
      const expected = baseline.results.find(item => item.id === fixture.id);
      if (fixture.approvedChange && actual.code === 2) {
        assert.equal(baseline.native.find(item => item.id === fixture.id).code, 2);
        assert.equal(actual.stdout, '');
        return { actual, approvedCompatibilityChange: fixture.approvedChange, original: expected };
      }
      assert.deepEqual(actual, { code: expected.code, stdout: expected.stdout, stderr: expected.stderr });
      return actual;
    } finally { await shell.dispose(); }
  });
}
async function lifecycle() {
  await caseCheck('preabort-before-construction-and-input', async () => {
    const shell = makeShell();
    const controller = new AbortController();
    const reason = new Error('independent preabort');
    controller.abort(reason);
    let pulled = false;
    const prior = workers.length;
    const input = { async *[Symbol.asyncIterator]() { pulled = true; yield Buffer.from('ab\n'); } };
    try { await assert.rejects(shell.exec("grep -E '['", { stdin: input, signal: controller.signal }), error => error === reason); }
    finally { await shell.dispose(); }
    assert.equal(pulled, false);
    assert.equal(workers.length, prior);
  });
  for (const command of ['grep -E', 'rg']) await caseCheck(`live-source-idle-and-cancel-${command}`, async () => {
    const shell = makeShell();
    const controller = new AbortController();
    const gate = deferred();
    const first = deferred();
    let output = '';
    let returned = false;
    const input = { async *[Symbol.asyncIterator]() { try { yield Buffer.from('ab\n'); await gate.promise; } finally { returned = true; } } };
    const running = shell.exec(`${command} '^a'`, { stdin: input, signal: controller.signal, stdout: { async write(bytes) { output += Buffer.from(bytes); if (output === 'ab\n') first.resolve(); } } });
    const settled = running.then(value => ({ value }), error => ({ error }));
    try {
      await checkWithin(first.promise, 1000);
      await sleep(180);
      assert.equal(active, 0, 'idle source must not pin workers');
      const reason = new Error('independent live-source abort');
      controller.abort(reason);
      gate.resolve();
      const outcome = await checkWithin(settled, 1000);
      assert.equal(outcome.error, reason);
      assert.equal(output, 'ab\n');
      assert.equal(returned, true);
      assert.equal(active, 0);
    } finally { gate.resolve(); controller.abort(); await settled; await shell.dispose(); }
  });
  await caseCheck('cross-shell-cancel-isolation', async () => {
    const first = makeShell();
    const second = makeShell();
    const controller = new AbortController();
    const gate = deferred();
    const pulled = deferred();
    const input = { async *[Symbol.asyncIterator]() { pulled.resolve(); await gate.promise; yield Buffer.from('ab\n'); } };
    const running = first.exec("rg '^a'", { stdin: input, signal: controller.signal }).catch(error => error);
    try {
      await checkWithin(pulled.promise, 1000);
      const unaffected = second.exec("grep -E 'b$'", { stdin: 'ab\n' });
      const reason = new Error('cancel first only');
      controller.abort(reason); gate.resolve();
      assert.equal(await running, reason);
      const result = await unaffected;
      assert.equal(result.stdout, 'ab\n'); assert.equal(result.exitCode, 0);
      assert.equal(active, 0);
    } finally { gate.resolve(); controller.abort(); await running; await first.dispose(); await second.dispose(); }
  });
  await caseCheck('six-concurrent-public-invocations', async () => {
    const shell = makeShell();
    try {
      const result = await Promise.all(Array.from({ length: 6 }, () => shell.exec("rg '^a'", { stdin: 'ab\ncd\n' })));
      for (const item of result) { assert.equal(item.exitCode, 0); assert.equal(item.stdout, 'ab\n'); }
      assert.equal(active, 0);
    } finally { await shell.dispose(); }
  });
  await caseCheck('early-downstream-zero-active', async () => {
    const shell = makeShell();
    try { const result = await shell.exec("grep -E '^a' | head -n 1", { stdin: 'ab\n'.repeat(200) }); assert.equal(result.stdout, 'ab\n'); assert.equal(result.exitCode, 0); assert.equal(active, 0); }
    finally { await shell.dispose(); }
  });
}
async function earlySelection() {
  for (const flag of ['-q', '-m1']) await caseCheck(`early-selection-before-later-line-budget-${flag}`, async () => {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands({ search: { maxLineBytes: 4 } }));
    try {
      const result = await shell.exec(`rg ${flag} '^a'`, { stdin: 'a\n12345\n' });
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.equal(result.stdout, flag === '-q' ? '' : 'a\n');
      return vector(result);
    } finally { await shell.dispose(); }
  });
}
async function benchmark() {
  const baselineApi = await import(pathToFileURL(resolve(owned, 'snapshots/baseline/dist/index.js')));
  for (const [size, input] of [['small', 'ab\ncd\n'.repeat(4)], ['medium', 'ab\ncd\n'.repeat(1000)]]) {
    for (const command of ["grep -E '^a'", "rg '^a'"]) {
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = {};
        for (const variant of repeat % 2 ? ['production', 'baseline'] : ['baseline', 'production']) {
          const selected = variant === 'baseline' ? baselineApi : api;
          const priorWorkers = workers.length;
          const start = performance.now();
          const shell = new selected.Shell({ fs: new selected.MemoryFileSystem() }).use(selected.agentCommands());
          const output = await shell.exec(command, { stdin: input });
          await shell.dispose();
          result[variant] = { milliseconds: performance.now() - start, output: vector(output), workerStartupMs: workers.slice(priorWorkers).map(worker => worker.startupMs) };
        }
        await caseCheck(`${size}-${command}-${repeat}`, async () => { assert.deepEqual(result.production.output, result.baseline.output); return result; });
      }
    }
  }
}
async function risk() {
  const command = job.includes('-grep-') ? 'grep -E' : 'rg';
  const cancel = job.endsWith('-abort');
  const options = { regex: { requestTimeoutMs: cancel ? 1000 : 20, startupTimeoutMs: 1000 } };
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.standardCommands(options)).use(api.searchCommands(options));
  const controller = new AbortController();
  const reason = new Error('independent active regex abort');
  let timer;
  let armed = false;
  const originalPost = NativeWorker.prototype.postMessage;
  if (cancel) NativeWorker.prototype.postMessage = function(message, ...rest) {
    if (!armed && message?.rows?.some(row => row.bytes?.length > 20)) { armed = true; timer = setTimeout(() => controller.abort(reason), 10); }
    return originalPost.call(this, message, ...rest);
  };
  const start = performance.now();
  try {
    const result = await shell.exec(`${command} '^(a+)+$'`, { stdin: 'a'.repeat(28) + '!\n', ...(cancel ? { signal: controller.signal } : {}) }).then(value => ({ value }), error => ({ error }));
    if (cancel) { assert.equal(armed, true); assert.equal(result.error, reason); }
    else { assert.equal(result.value?.exitCode, 2); assert.match(result.value.stderr, /active request.*20ms/u); }
    await shell.dispose();
    assert.equal(active, 0);
    return { elapsed: performance.now() - start, result: result.value ? vector(result.value) : { error: result.error.message, exactAbortReason: result.error === reason }, riskControl, configuredPolicy: options.regex, default1000Observed: false };
  } finally { clearTimeout(timer); NativeWorker.prototype.postMessage = originalPost; await shell.dispose(); }
}
process.send({ kind: 'ready' });
process.once('message', async message => {
  if (message.kind !== 'run') throw new Error('unexpected parent protocol');
  try {
    if (job === 'cohort') await cohort();
    else if (job === 'lifecycle') await lifecycle();
    else if (job === 'benchmark') await benchmark();
    else if (job === 'transport') await (await import('./transport.mjs')).runTransport(snapshot, caseCheck);
    else if (job === 'early-selection') await earlySelection();
    else if (job.startsWith('risk-')) await caseCheck(job, risk);
    else throw new Error(`unprepared job ${job}`);
    assert.equal(active, 0, 'zero live workers at final settlement');
  } catch (error) { observations.push({ name: 'job-final', pass: false, error: error.stack }); }
  const metrics = workers.map(({ worker, ...record }) => ({ ...record, listeners: Object.fromEntries(['message', 'messageerror', 'error', 'exit'].map(event => [event, worker.listenerCount(event)])) }));
  const pass = observations.every(item => item.pass);
  process.send({ kind: 'result', pass, summary: { passed: observations.filter(item => item.pass).length, total: observations.length, active, peak, workers: workers.length }, observations, metrics }, () => process.disconnect());
});
