import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import threads from 'node:worker_threads';

const [installed, freezePath] = process.argv.slice(2);
const freeze = JSON.parse(readFileSync(freezePath));
const base = pathToFileURL(`${installed}/`).href;
const imports = [];
const hooks = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (context.parentURL?.startsWith(base)) {
    assert(result.url.startsWith(base) || result.url.startsWith('node:'));
    imports.push({ parent: context.parentURL, resolved: result.url });
  }
  return result;
} });
const NativeWorker = threads.Worker;
const workers = [];
threads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert(url.href.startsWith(`${base}dist/`));
    super(url, options);
    const entry = { worker: this, url: url.href, closed: false };
    workers.push(entry);
    this.once('exit', () => { entry.closed = true; });
  }
};
syncBuiltinESMExports();
const rows = [];
let forcedCleanup = 0;
try {
  const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
  for (const input of freeze.cases) {
    const output = [], errors = [], cleanups = [];
    const workerStart = workers.length;
    const context = {
      command: 'expr', args: input.argv, env: input.env, cwd: '/', signal: new AbortController().signal,
      stdinIsDefault: true,
      get stdin() { throw new Error('unexpected stdin'); },
      fs: new Proxy({}, { get() { throw new Error('unexpected filesystem'); } }),
      stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes) { errors.push(Buffer.from(bytes)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); },
    };
    const NativeRegExp = globalThis.RegExp;
    const originalExec = NativeRegExp.prototype.exec;
    const dynamicCalls = [];
    globalThis.RegExp = new Proxy(NativeRegExp, {
      construct(target, args) { dynamicCalls.push(String(args[0])); throw new Error('main-thread RegExp construction'); },
      apply(target, receiver, args) { dynamicCalls.push(String(args[0])); throw new Error('main-thread RegExp invocation'); },
    });
    NativeRegExp.prototype.exec = function (text) {
      if (input.id === 'named-worker-only-match' && this.source === input.argv[2]) {
        dynamicCalls.push(this.source);
        throw new Error('main-thread user pattern execution');
      }
      return originalExec.call(this, text);
    };
    let result;
    try { result = await createExprCommand({ limits: input.limits }).execute(context); }
    finally { globalThis.RegExp = NativeRegExp; NativeRegExp.prototype.exec = originalExec; }
    const activeAtSettlement = workers.filter(entry => !entry.closed).length;
    for (const cleanup of cleanups) await cleanup();
    const row = { id: input.id, status: result.exitCode, stdout: Buffer.concat(output).toString(),
      stdoutHex: Buffer.concat(output).toString('hex'), stderr: Buffer.concat(errors).toString(),
      stderrHex: Buffer.concat(errors).toString('hex'), workers: workers.length - workerStart,
      activeAtSettlement, activeAfterCleanup: workers.filter(entry => !entry.closed).length, dynamicCalls };
    rows.push(row);
    assert.equal(row.status, input.status, input.id);
    assert.equal(row.stdout, input.stdout, input.id);
    if (input.stderrNonempty) assert.notEqual(row.stderr, '', input.id);
    else assert.equal(row.stderr, input.stderr, input.id);
    assert.equal(row.workers, input.workers, input.id);
    assert.equal(activeAtSettlement, 0, input.id);
    assert.equal(row.activeAfterCleanup, 0, input.id);
    assert.deepEqual(dynamicCalls, [], input.id);
  }
} finally {
  for (const entry of workers.filter(entry => !entry.closed)) { forcedCleanup++; await entry.worker.terminate(); }
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  hooks.deregister();
  console.log(JSON.stringify({ rows, imports, forcedCleanup, activeAfterSafetyCleanup: workers.filter(entry => !entry.closed).length }));
}
assert.equal(forcedCleanup, 0);
