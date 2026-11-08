import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import threads from 'node:worker_threads';

const base = pathToFileURL(`${resolve(process.argv[2])}/`).href;
const frozen = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const workers = new Set(), imports = new Set();
let state;
const hooks = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (context.parentURL?.startsWith(base)) {
    assert(result.url.startsWith(base) || result.url.startsWith('node:'), result.url);
    imports.add(result.url);
  }
  return result;
} });
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert(url.href.startsWith(base), 'worker outside frozen source');
    super(url, options);
    const record = state;
    workers.add(this);
    record.events.push({ kind: 'worker-start', url: url.href });
    this.on('exit', code => { workers.delete(this); record.events.push({ kind: 'worker-exit', code }); });
  }
};
syncBuiltinESMExports();
const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
const { Budget } = await import(`${base}dist/commands/expr/internal.js`);
const { RegexSession } = await import(`${base}dist/commands/regex-execution/client.js`);
const original = { charge: Budget.prototype.charge, encode: Budget.prototype.encode, match: RegexSession.prototype.matchExpr, close: RegexSession.prototype.close };
Budget.prototype.charge = function (amount = 1) {
  state.budgets.add(this);
  const previous = state.remaining.get(this);
  if (previous !== undefined && this.remaining() > previous) state.increases++;
  try { return original.charge.call(this, amount); }
  finally { state.remaining.set(this, this.remaining()); }
};
Budget.prototype.encode = function (text) {
  state.encodes.push(text);
  return original.encode.call(this, text);
};
RegexSession.prototype.matchExpr = async function (descriptor, subject) {
  const record = state;
  record.sessions.add(this);
  const job = { subject: Buffer.from(subject).toString(), pattern: Buffer.from(descriptor.pattern).toString(), allowance: descriptor.limits.maxSteps };
  record.jobs.push(job);
  record.pending++;
  record.maxPending = Math.max(record.maxPending, record.pending);
  record.events.push({ kind: 'match-enter', index: record.jobs.length });
  try {
    const result = await original.match.call(this, descriptor, subject);
    job.steps = result.steps;
    record.events.push({ kind: 'match-result', index: record.jobs.length });
    if (record.abort === 'after-result') record.controller.abort(record.reason);
    return result;
  } finally {
    record.pending--;
    record.events.push({ kind: 'match-settled' });
  }
};
RegexSession.prototype.close = async function () {
  const record = state;
  record.events.push({ kind: 'close-start' });
  try { return await original.close.call(this); }
  finally { record.events.push({ kind: 'close-end', activeWorkers: workers.size }); }
};

async function run(specimen) {
  const controller = new AbortController();
  const reason = Object.assign(new Error('independent caller abort'), { code: 'ENOENT' });
  const sinkReason = new Error('independent sink failure');
  const record = state = { controller, reason, abort: specimen.abort, events: [], jobs: [], encodes: [], budgets: new Set(), sessions: new Set(), remaining: new Map(), increases: 0, pending: 0, maxPending: 0 };
  const cleanups = [], stdout = [], stderr = [];
  let observed, settled = false;
  const sink = destination => ({ async write(bytes) {
    record.events.push({ kind: `${destination}-start`, bytes: bytes.length });
    if (specimen.sink === `fail-${destination}`) throw sinkReason;
    if (specimen.sink === 'abort-stdout' && destination === 'stdout') {
      controller.abort(reason);
      throw reason;
    }
    if (specimen.sink === 'delayed-stdout' && destination === 'stdout') {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 15));
      record.events.push({ kind: 'delayed-sink-observation', executeSettled: settled });
    }
    (destination === 'stdout' ? stdout : stderr).push(Buffer.from(bytes));
    record.events.push({ kind: `${destination}-end` });
  } });
  try {
    const result = await createExprCommand({ limits: specimen.limits, regex: { startupTimeoutMs: 10000, requestTimeoutMs: 3000 } }).execute({
      command: 'expr', args: specimen.args, env: specimen.env, cwd: '/', signal: controller.signal,
      get stdin() { throw new Error('unexpected stdin acquisition'); },
      get fs() { throw new Error('unexpected filesystem acquisition'); },
      get invoke() { throw new Error('unexpected nested invocation'); },
      registerCleanup(cleanup) { record.events.push({ kind: 'cleanup-registered' }); cleanups.push(cleanup); },
      stdout: sink('stdout'), stderr: sink('stderr'),
    });
    observed = { exitCode: result.exitCode };
  } catch (error) {
    observed = { rejected: error === reason ? 'caller' : error === sinkReason ? 'sink' : 'other', message: error?.message };
  } finally {
    settled = true;
    record.events.push({ kind: 'execute-settled', activeWorkers: workers.size });
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup(), cleanup()]));
    record.events.push({ kind: 'overlapping-cleanups-awaited', activeWorkers: workers.size });
  }
  observed.stdout = Buffer.concat(stdout).toString();
  observed.stderr = Buffer.concat(stderr).toString();
  const failures = [];
  if (specimen.expected.rejected) {
    if (observed.rejected !== specimen.expected.rejected || observed.stdout || observed.stderr) failures.push('rejection identity/output');
  } else for (const key of ['exitCode', 'stdout', 'stderr']) if (observed[key] !== specimen.expected[key]) failures.push(key);
  if (JSON.stringify(record.jobs.map(job => job.subject)) !== JSON.stringify(specimen.subjects)) failures.push('exact encounter-order submissions');
  if (record.budgets.size !== 1 || record.increases || record.sessions.size > 1) failures.push('single budget/matcher without reset');
  if (record.maxPending > 1 || record.pending) failures.push('jobs not awaited sequentially');
  if ((specimen.noEncode ?? []).some(text => record.encodes.includes(text))) failures.push('inactive operand encoding');
  if (specimen.sharedBudget) for (let index = 1; index < record.jobs.length; index++) {
    if (!(record.jobs[index].allowance < record.jobs[index - 1].allowance - record.jobs[index - 1].steps)) failures.push('worker allowance not shared');
  }
  const acquisition = record.events.findIndex(event => event.kind === 'worker-start');
  const registration = record.events.findIndex(event => event.kind === 'cleanup-registered');
  if (acquisition >= 0 && !(registration >= 0 && registration < acquisition)) failures.push('cleanup registered after acquisition');
  if (record.events.some(event => event.activeWorkers > 0) || workers.size) failures.push('resource work survived settlement/cleanup');
  if (specimen.sink === 'delayed-stdout' && !record.events.some(event => event.kind === 'delayed-sink-observation' && !event.executeSettled)) failures.push('stdout not awaited');
  return { id: specimen.id, args: specimen.args, env: specimen.env, expected: specimen.expected, observed, jobs: record.jobs, encodes: record.encodes, budgetCount: record.budgets.size, sessionCount: record.sessions.size, events: record.events, failures, passed: failures.length === 0 };
}
try {
  const cases = [];
  for (const specimen of frozen.controls) cases.push(await run(specimen));
  console.log(JSON.stringify({ cases, imports: [...imports].sort(), activeWorkers: workers.size }));
} finally {
  Budget.prototype.charge = original.charge;
  Budget.prototype.encode = original.encode;
  RegexSession.prototype.matchExpr = original.match;
  RegexSession.prototype.close = original.close;
  await Promise.all([...workers].map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  hooks.deregister();
}
