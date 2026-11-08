import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import threads from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';

const base = pathToFileURL(`${resolve(process.argv[2])}/`).href;
const frozen = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const workers = new Set();
let state;
const imports = new Set();
const hooks = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (context.parentURL?.startsWith(base)) {
    assert(result.url.startsWith(base) || result.url.startsWith('node:'), `unexpected product dependency ${result.url}`);
    imports.add(result.url);
  }
  return result;
} });
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert(url.href.startsWith(base), 'worker must come from immutable build');
    super(url, options);
    workers.add(this);
    const record = state;
    record.events.push({ kind: 'worker-start' });
    this.on('exit', code => { workers.delete(this); record.events.push({ kind: 'worker-exit', code }); });
  }
  postMessage(message, transfer) {
    state.events.push({ kind: 'worker-post', operation: message.descriptor?.kind });
    return super.postMessage(message, transfer);
  }
};
syncBuiltinESMExports();
const { createExprCommand, exprCommands } = await import(`${base}dist/commands/expr/index.js`);
const { Budget } = await import(`${base}dist/commands/expr/internal.js`);
const { RegexSession } = await import(`${base}dist/commands/regex-execution/client.js`);
const { Shell } = await import(`${base}dist/shell/shell.js`);
const { createMemoryFileSystem } = await import(`${base}dist/fs/memory/index.js`);
const original = { match: RegexSession.prototype.matchExpr, close: RegexSession.prototype.close, charge: Budget.prototype.charge, encode: Budget.prototype.encode, yield: Budget.prototype.yield };
Budget.prototype.yield = async function () {
  state.checkpoints++;
  if (state.abort === 'checkpoint' && state.checkpoints === 3) state.controller.abort(state.reason);
  return original.yield.call(this);
};
Budget.prototype.charge = function (amount = 1) {
  state.budgets.add(this);
  const before = this.remaining();
  const previous = state.remaining.get(this);
  if (previous !== undefined && before > previous) state.budgetIncreases++;
  try { return original.charge.call(this, amount); }
  finally { state.remaining.set(this, this.remaining()); }
};
Budget.prototype.encode = function (text) {
  state.encodes.push(text);
  return original.encode.call(this, text);
};
RegexSession.prototype.matchExpr = async function (descriptor, subject) {
  const record = state;
  record.jobs.push({ pattern: Buffer.from(descriptor.pattern).toString(), subject: Buffer.from(subject).toString(), allowance: descriptor.limits.maxSteps });
  record.events.push({ kind: 'match-enter', index: record.jobs.length });
  const pending = original.match.call(this, descriptor, subject);
  if (record.abort === 'admitted') record.controller.abort(record.reason);
  try {
    const result = await pending;
    record.jobs.at(-1).steps = result.steps;
    record.events.push({ kind: 'match-result', index: record.jobs.length });
    if (record.abort === 'after-result' && record.jobs.length === 1) record.controller.abort(record.reason);
    return result;
  } finally { record.events.push({ kind: 'match-settled' }); }
};
RegexSession.prototype.close = async function () {
  const record = state;
  record.events.push({ kind: 'session-close-start' });
  try { return await original.close.call(this); }
  finally { record.events.push({ kind: 'session-close-end' }); }
};

async function run(specimen, shellMode = false) {
  const controller = new AbortController();
  const reason = Object.assign(new Error('frozen sequencing cancellation'), { code: 'ENOENT' });
  state = { controller, reason, abort: specimen.abort, checkpoints: 0, events: [], jobs: [], encodes: [], budgets: new Set(), remaining: new Map(), budgetIncreases: 0 };
  const cleanups = [], stdout = [], stderr = [];
  let observed, shell;
  if (specimen.abort === 'before') controller.abort(reason);
  try {
    if (shellMode) {
      shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: 'C' } }).use(exprCommands());
      const source = ['expr', ...specimen.args].map(token => `'${token.replaceAll("'", "'\\''")}'`).join(' ');
      const result = await shell.exec(source);
      observed = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } else {
      const result = await createExprCommand({ limits: specimen.limits, regex: { startupTimeoutMs: 10000, requestTimeoutMs: 3000 } }).execute({
        command: 'expr', args: specimen.args, cwd: '/', env: specimen.env ?? { LC_ALL: 'C' }, signal: controller.signal,
        get stdin() { throw new Error('unexpected stdin acquisition'); },
        get fs() { throw new Error('unexpected filesystem acquisition'); },
        get invoke() { throw new Error('unexpected nested invocation'); },
        registerCleanup(cleanup) { state.events.push({ kind: 'cleanup-registered' }); cleanups.push(cleanup); },
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
      });
      observed = { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
    }
  } catch (error) {
    observed = { rejected: true, sameReason: error === reason, message: error?.message, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  } finally {
    state.events.push({ kind: 'execute-settled', activeWorkers: workers.size });
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    await shell?.dispose();
  }
  const failures = [];
  if (specimen.expected.rejected) {
    if (!observed.rejected || !observed.sameReason || observed.stdout || observed.stderr) failures.push('cancellation identity/output');
  } else for (const key of ['exitCode', 'stdout', 'stderr']) if (observed[key] !== specimen.expected[key]) failures.push(key);
  if (state.jobs.length !== specimen.jobs) failures.push('submission count');
  if (state.budgets.size > 1 || state.budgetIncreases) failures.push('budget reset/identity');
  if (workers.size || state.events.find(event => event.kind === 'execute-settled').activeWorkers) failures.push('worker cleanup before settlement');
  if ((specimen.noEncode ?? []).some(text => state.encodes.includes(text))) failures.push('inactive operand evaluated');
  if (specimen.sharedBudget && !(state.jobs.length === 2 && state.jobs[1].allowance < state.jobs[0].allowance - state.jobs[0].steps)) failures.push('shared worker allowance');
  if (state.jobs.length === 2 && state.jobs.map(job => job.subject).join(',') !== 'a,b') failures.push('job order');
  let pendingJobs = 0;
  for (const event of state.events) {
    if (event.kind === 'match-enter' && ++pendingJobs > 1) failures.push('concurrent/repeated evaluation');
    if (event.kind === 'match-settled') pendingJobs--;
  }
  if (!shellMode && state.jobs.length && state.events[0]?.kind !== 'cleanup-registered') failures.push('cleanup registration ordering');
  return { id: specimen.id, mode: shellMode ? 'actual-shell' : 'direct', observed, expected: specimen.expected, jobs: state.jobs, encodes: state.encodes, budgetCount: state.budgets.size, budgetIncreases: state.budgetIncreases, events: state.events, failures, passed: failures.length === 0 };
}
try {
  const cases = [];
  for (const specimen of frozen.cases) cases.push(await run(specimen));
  const shell = [];
  for (const id of ['root-counterexample', 'regex-success-before-trailing', 'regex-two-once-in-order', 'skip-or-invalid-regex', 'rhs-group-syntax-before-division']) shell.push(await run(frozen.cases.find(specimen => specimen.id === id), true));
  const oldCap = await run(frozen.oldCap);
  console.log(JSON.stringify({ cases, shell, oldCap, imports: [...imports].sort(), activeWorkers: workers.size }));
} finally {
  RegexSession.prototype.matchExpr = original.match;
  RegexSession.prototype.close = original.close;
  Budget.prototype.charge = original.charge;
  Budget.prototype.encode = original.encode;
  Budget.prototype.yield = original.yield;
  await Promise.all([...workers].map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  hooks.deregister();
}
