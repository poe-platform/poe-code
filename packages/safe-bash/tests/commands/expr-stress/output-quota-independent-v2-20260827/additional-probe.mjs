import assert from 'node:assert/strict';
import threads from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { cases, emergency } from './additional-cases.mjs';
import { save } from './old47/common.mjs';

const [candidate, destination] = process.argv.slice(2);
const base = pathToFileURL(`${candidate}/`).href;
const NativeWorker = threads.Worker;
const nativeEncode = TextEncoder.prototype.encode;
const active = new Set(), imports = [], violations = [], unhandled = [], uncaught = [], rows = [];
let current;
process.on('unhandledRejection', reason => unhandled.push(String(reason)));
process.on('uncaughtExceptionMonitor', reason => uncaught.push(String(reason)));
const hooks = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (context.parentURL?.startsWith(base)) {
    assert(result.url.startsWith(base) || result.url.startsWith('node:'));
    imports.push({ parent: context.parentURL.slice(base.length), resolved: result.url.replace(base, '') });
    if (result.url.endsWith('/bre-worker.js') || result.url.endsWith('/matching.js')) {
      violations.push(result.url);
      throw new Error('Main-thread matcher import forbidden');
    }
  }
  return result;
} });
threads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert.equal(url.href, `${base}dist/commands/regex-execution/worker.js`);
    super(url, options);
    this.owner = current;
    active.add(this);
    this.owner.events.push('worker-start');
    this.on('exit', () => { active.delete(this); this.owner.events.push('worker-exit'); });
  }
  postMessage(message, ...rest) {
    this.owner.jobs.push(message.descriptor?.kind);
    super.postMessage(message, ...rest);
    if (this.owner.input.mode === 'abort-post') this.owner.controller.abort(this.owner.reason);
  }
  terminate() { this.owner.events.push('worker-terminate'); return super.terminate(); }
};
syncBuiltinESMExports();
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let safetyTerminations = 0;
try {
  const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
  const { ExprError } = await import(`${base}dist/commands/expr/internal.js`);
  const { RegexSession, RegexExecutor } = await import(`${base}dist/commands/regex-execution/client.js`);
  const originalClose = RegexSession.prototype.close, originalOpen = RegexExecutor.prototype.open;
  RegexExecutor.prototype.open = function (...args) { current.events.push('session-open'); return originalOpen.apply(this, args); };
  RegexSession.prototype.close = async function (...args) {
    const owner = current;
    owner.events.push('session-close');
    await originalClose.apply(this, args);
    if (owner.input.mode === 'held-close') { owner.entered.resolve(); await owner.gate.promise; }
    if (owner.input.closeReject) throw owner.closeReason;
  };
  for (const input of cases) {
    const events = [], jobs = [], attempts = [], accepted = [], encodings = [], cleanups = [], checks = [];
    const controller = new AbortController(), entered = deferred(), gate = deferred();
    const closeReason = new Error('INDEPENDENT_CLOSE_REASON');
    const reasons = { zero: 0, false: false, null: null, undefined: undefined, empty: '', error: new Error('UNTRUSTED_SINK'), 'quota-error': new ExprError('output bytes limit exceeded', 3) };
    const reason = reasons[input.reason];
    current = { input, events, jobs, controller, entered, gate, reason, closeReason };
    const check = (name, condition) => checks.push({ name, passed: Boolean(condition) });
    TextEncoder.prototype.encode = function (text = '') {
      if (input.mode === 'allocation') encodings.push({ bytes: Buffer.byteLength(text), diagnostic: text.startsWith('expr: '), emergency: text === emergency });
      return nativeEncode.call(this, text);
    };
    const sinks = Object.fromEntries(['stdout', 'stderr'].map(channel => [channel, { async write(bytes) {
      const copy = Buffer.from(bytes);
      assert(copy.length <= 8192);
      attempts.push({ channel, bytes: copy.length, text: copy.toString(), hex: copy.toString('hex') });
      if (input.mode === `reject-${channel}`) throw reason;
      if (input.mode === `abort-${channel}`) { entered.resolve(); await gate.promise; }
      accepted.push({ channel, text: copy.toString() });
    } }]));
    let settled = false;
    const command = createExprCommand({ limits: { maxOutputBytes: input.cap } });
    const completion = Promise.resolve(command.execute({ command: 'UNTRUSTED_COMMAND', args: input.args, env: { LC_ALL: 'C' }, cwd: '/', signal: controller.signal,
      stdinIsDefault: true, get stdin() { throw new Error('stdin forbidden'); }, fs: new Proxy({}, { get() { throw new Error('filesystem forbidden'); } }),
      invoke() { throw new Error('invoke forbidden'); }, ...sinks,
      registerCleanup(cleanup) { events.push('register-cleanup'); cleanups.push(cleanup); },
    })).then(value => { settled = true; return { rejected: false, value }; }, error => { settled = true; return { rejected: true, error }; });
    if (input.mode === 'abort-stderr' || input.mode === 'held-close') {
      await entered.promise;
      await tick();
      check('invocation remains pending at controlled gate', !settled);
      if (input.mode === 'held-close') {
        const first = cleanups[0](), second = cleanups[0]();
        check('overlapping cleanup shares completion', first === second);
        let cleanupSettled = false;
        first.then(() => { cleanupSettled = true; }, () => { cleanupSettled = true; });
        await tick();
        check('registered cleanup awaits delayed session close', !cleanupSettled && !settled);
        gate.resolve();
      } else controller.abort(reason);
    }
    const outcome = await completion;
    const activeAtSettlement = active.size;
    if (input.mode === 'abort-stderr') gate.reject(new Error('observed late sink rejection'));
    for (const cleanup of cleanups) {
      const first = cleanup(), second = cleanup();
      check('cleanup remains idempotent', first === second);
      const results = await Promise.allSettled([first, second]);
      check('cleanup result retains exact close identity', results.every(result => input.closeReject ? result.status === 'rejected' && result.reason === closeReason : result.status === 'fulfilled'));
    }
    await tick(); await tick();
    TextEncoder.prototype.encode = nativeEncode;
    const actual = { rejected: outcome.rejected, status: outcome.value?.exitCode ?? null,
      rejectionIdentity: outcome.rejected ? Object.is(outcome.error, reason) ? input.rejection === 'caller' ? 'caller' : 'sink' : outcome.error === closeReason ? 'close' : 'other' : null,
      rejectionType: outcome.rejected ? typeof outcome.error : null,
      stdout: accepted.filter(entry => entry.channel === 'stdout').map(entry => entry.text).join(''),
      stderr: accepted.filter(entry => entry.channel === 'stderr').map(entry => entry.text).join('') };
    check('exact result and falsy rejection identity', input.rejection ? outcome.rejected && Object.is(outcome.error, input.rejection === 'close' ? closeReason : reason) : !outcome.rejected && actual.status === input.status);
    check('exact accepted stdout and stderr', actual.stdout === '' && actual.stderr === (input.stderr ?? ''));
    check('exact sink admission counts', attempts.filter(entry => entry.channel === 'stdout').length === input.stdoutAttempts && attempts.filter(entry => entry.channel === 'stderr').length === input.stderrAttempts);
    const emergencies = attempts.filter(entry => entry.channel === 'stderr' && entry.text === emergency);
    check('one fixed emergency maximum', emergencies.length <= 1 && emergencies.every(entry => entry.bytes === 34));
    check('normal output admission budget', attempts.filter(entry => !emergencies.includes(entry)).reduce((total, entry) => total + entry.bytes, 0) <= input.cap);
    check('no overbudget diagnostic encoding', encodings.every(entry => !entry.diagnostic || entry.emergency || entry.bytes <= input.cap));
    check('real worker job count', jobs.length === (input.jobs ?? 0));
    check('registration precedes acquisition', events.indexOf('register-cleanup') < events.indexOf('session-open'));
    check('one registration and one session close', cleanups.length === 1 && events.filter(event => event === 'session-close').length === 1);
    check('workers awaited and not duplicated', activeAtSettlement === 0 && active.size === 0 && events.filter(event => event === 'worker-start').length === (input.jobs ?? 0) && events.filter(event => event === 'worker-terminate').length <= (input.jobs ?? 0));
    rows.push({ input, actual, attempts, encodings, events, jobs, activeAtSettlement, activeAfterCleanup: active.size, checks, passed: checks.every(check => check.passed) });
  }
  RegexSession.prototype.close = originalClose;
  RegexExecutor.prototype.open = originalOpen;
} finally {
  safetyTerminations = active.size;
  for (const worker of active) await worker.terminate();
  threads.Worker = NativeWorker;
  TextEncoder.prototype.encode = nativeEncode;
  syncBuiltinESMExports();
  hooks.deregister();
  save(destination, { rows, passed: rows.filter(row => row.passed).length, total: rows.length, imports, mainThreadMatcherViolations: violations,
    unhandledRejections: unhandled, uncaughtExceptions: uncaught, safetyTerminations, activeAfterSafety: active.size });
}
