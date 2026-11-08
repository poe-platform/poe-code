import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import threads from 'node:worker_threads';

const installed = resolve(process.argv[2]);
const base = pathToFileURL(`${installed}/`).href;
const manifest = JSON.parse(readFileSync(`${installed}/package.json`));
assert.equal(manifest.name, 'virtual-bash');
assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
assert(!manifest.exports['./commands/expr']);
assert(!existsSync(`${installed}/src`));
const imports = new Set(), active = new Set(), rows = [], uncaught = [];
let state;
process.on('unhandledRejection', reason => uncaught.push(String(reason)));
const hooks = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (context.parentURL?.startsWith(base)) {
    assert(result.url.startsWith(base) || result.url.startsWith('node:'), 'runtime import escaped installed package');
    assert(!result.url.endsWith('/bre-worker.js') && !result.url.endsWith('/matching.js'), 'main-thread matcher import');
    imports.add(result.url);
  }
  return result;
} });
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert.equal(url.href, `${base}dist/commands/regex-execution/worker.js`);
    assert(state.events.includes('cleanup-registered'));
    super(url, options);
    const record = state;
    active.add(this);
    record.events.push('worker-start');
    this.on('exit', () => { active.delete(this); record.events.push('worker-exit'); });
  }
};
syncBuiltinESMExports();
const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
const specimens = [
  { id: 'encounter-runtime-before-trailing', args: ['1', '/', '0', 'x'], code: 2, stdout: '', stderr: 'expr: division by zero\n' },
  { id: 'worker-before-trailing', args: ['a', ':', '[', 'x'], code: 2, stdout: '', stderr: 'expr: Invalid regular expression\n', worker: true },
  { id: 'worker-capture', args: ['abc', ':', '\\(ab\\)'], code: 0, stdout: 'ab\n', stderr: '', worker: true },
  { id: 'inactive-worker-not-acquired', args: ['1', '|', 'match', 'a', '['], code: 0, stdout: '1\n', stderr: '' },
  { id: 'inactive-syntax-validated', args: ['1', '|', '('], code: 2, stdout: '', stderr: "expr: syntax error: missing argument after '('\n" },
  { id: 'three-ordered-workers', args: ['(', 'a', ':', 'a', ')', '+', '(', 'b', ':', 'b', ')', '+', '(', 'c', ':', 'c', ')'], code: 0, stdout: '3\n', stderr: '', worker: true },
  { id: 'output-quota', args: ['abc'], options: { limits: { maxOutputBytes: 3 } }, code: 3, stdout: '', stderr: 'expr: output bytes limit exceeded\n' },
];
for (const [name, reason] of [['null', null], ['false', false], ['zero', 0], ['empty', ''], ['undefined', undefined], ['errno', Object.assign(new Error('caller'), { code: 'ENOENT' })]]) {
  specimens.push({ id: `sink-identity-${name}`, args: ['a', ':', 'a'], reason, mode: 'sink', worker: true });
  specimens.push({ id: `caller-identity-${name}`, args: ['a', ':', 'a'], reason, mode: 'abort', worker: false });
}
try {
  for (const specimen of specimens) {
    const controller = new AbortController();
    const stdout = [], stderr = [], cleanups = [];
    state = { id: specimen.id, events: [] };
    let result, rejected = false, observedReason;
    if (specimen.mode === 'abort') controller.abort(specimen.reason);
    try {
      result = await createExprCommand(specimen.options).execute({
        command: 'expr', args: specimen.args, cwd: '/', env: { LC_ALL: 'C' }, signal: controller.signal,
        get stdin() { throw new Error('unexpected stdin'); },
        get fs() { throw new Error('unexpected filesystem'); },
        get invoke() { throw new Error('unexpected invocation'); },
        registerCleanup(cleanup) { state.events.push('cleanup-registered'); cleanups.push(cleanup); },
        stdout: { async write(bytes) { if (specimen.mode === 'sink') throw specimen.reason; stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
      });
    } catch (reason) { rejected = true; observedReason = reason; }
    assert.equal(active.size, 0, 'worker survives execute settlement');
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup(), cleanup()]));
    assert.equal(active.size, 0, 'worker survives repeated cleanup');
    if (specimen.mode) {
      assert(rejected);
      assert.equal(observedReason, specimen.mode === 'abort' ? controller.signal.reason : specimen.reason);
      assert.equal(stdout.length + stderr.length, 0);
    } else {
      assert(!rejected);
      assert.equal(result.exitCode, specimen.code);
      assert.equal(Buffer.concat(stdout).toString(), specimen.stdout);
      assert.equal(Buffer.concat(stderr).toString(), specimen.stderr);
    }
    assert.equal(state.events.includes('worker-start'), specimen.worker ?? false);
    rows.push({ ...state, passed: true, exactIdentity: specimen.mode ? true : undefined });
  }
  assert.deepEqual(uncaught, []);
  console.log(JSON.stringify({ passed: rows.length, total: specimens.length, rows, imports: [...imports].sort(), activeWorkers: active.size, unhandledRejections: uncaught, physicalDistOnly: true, publicExprExportClaim: false, runtimeDependencies: 0 }));
} finally {
  await Promise.all([...active].map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  hooks.deregister();
}
