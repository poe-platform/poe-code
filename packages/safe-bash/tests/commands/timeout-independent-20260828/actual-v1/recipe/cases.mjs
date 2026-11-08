import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as timeout from 'timeout-under-review';
import * as root from 'root-under-review';
import { families } from '../../families.mjs';
import { controlledClock } from '../../clock.mjs';
import { materialize, exactRationalDuration } from '../../oracle.mjs';
import { controlledLatch, observeSettlement, probeFactorySurface, probeFactoryContainers, assertCallerCollision, assertDirectRetirementCollision } from '../../review-preparation-v1/recipe/support.mjs';

const config = JSON.parse(fs.readFileSync(process.env.TIMEOUT_CONFIG));
const hash = value => createHash('sha256').update(value).digest('hex');
const decoder = new TextDecoder(), encoder = new TextEncoder();
const receipt = { profile: config.profile, candidate: config.candidate, cases: [], numeric: [], diagnostics: [], activations: [], status: 'RUNNING', sourceFallback: false };
const clocks = [], shells = [], tracked = [], latches = [];
const tick = () => new Promise(resolve => setImmediate(resolve));
const latch = () => { const value = controlledLatch(); latches.push(value); return value; };
const watch = promise => { const value = observeSettlement(promise); tracked.push(value); return value; };
const clock = options => { const value = controlledClock(options); clocks.push(value); return value; };
const encodeReason = value => ({ type: typeof value, text: String(value), name: value?.name, code: value?.code });
const waitFor = (promise, outcome, label) => Promise.race([promise, outcome.settled.then(value => assert.fail(`${label}: handler settled before required admission (${value.status})`))]);
function integrity() {
  for (const group of config.guardRoots) {
    const actual = [];
    const visit = prefix => { for (const name of fs.readdirSync(join(group.root, prefix)).sort()) {
      assert.notEqual(name, 'AGENTS.md'); const path = prefix ? `${prefix}/${name}` : name;
      const target = join(group.root, path), stat = fs.lstatSync(target); assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) visit(path); else { assert.equal(stat.isFile(), true); actual.push({ path, mode: stat.mode & 511, bytes: stat.size, sha256: hash(fs.readFileSync(target)) }); }
    } };
    visit(''); assert.deepEqual(actual, group.entries, 'FRESH_INPUT_INTEGRITY');
  }
  for (const [path, expected] of Object.entries(config.loads)) assert.equal(hash(fs.readFileSync(path)), expected, `LOAD_INPUT_INTEGRITY:${path}`);
}
function capture(args, additions = {}) {
  const stdout = [], stderr = [], cleanups = [];
  const sink = rows => ({ async write(bytes) { rows.push(Buffer.from(bytes)); } });
  const context = { command: 'timeout', args, stdin: { async *[Symbol.asyncIterator]() {} }, stdinIsDefault: true, stdout: sink(stdout), stderr: sink(stderr), cwd: '/', env: {}, fs: root.createMemoryFileSystem(), signal: new AbortController().signal, registerCleanup(callback) { cleanups.push(callback); }, ...additions };
  return { context, cleanups, stdout: () => Buffer.concat(stdout), stderr: () => Buffer.concat(stderr) };
}
async function execute(args, options = {}, additions = {}) {
  const captured = capture(args, additions); const outcome = await watch(timeout.createTimeoutCommand(options).execute(captured.context)).settled;
  const cleanup = await Promise.allSettled(captured.cleanups.map(callback => callback()));
  return { ...captured, outcome, cleanup };
}
function returned(run, status) { assert.equal(run.outcome.status, 'fulfilled'); assert.equal(run.outcome.value.exitCode, status); }
function rejected(run, reason) { assert.equal(run.outcome.status, 'rejected'); assert.ok(Object.is(run.outcome.reason, reason)); }
function diagnostic(run, label) {
  const expected = config.diagnostics.find(row => row.label === label); assert.ok(expected, label); returned(run, expected.status);
  const bytes = expected.stream === 'stdout' ? run.stdout() : run.stderr(); const other = expected.stream === 'stdout' ? run.stderr() : run.stdout();
  assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256); assert.equal(other.length, 0);
  receipt.diagnostics.push({ label, bytes: bytes.length, sha256: hash(bytes) });
}
async function blocked({ duration = '.001', maximum, scheduler, caller, result, failure, failureSet = false, noHook = false } = {}) {
  const timing = scheduler ?? clock(), gate = latch(), admitted = latch(); let signal, childClosed = false;
  const captured = capture([duration, 'fixture-block'], { ...(caller ? { signal: caller.signal } : {}), async invoke(command, args, options) {
    assert.equal(command, 'fixture-block'); signal = options.signal; admitted.resolve();
    try { await gate.promise; if (failureSet) throw failure; if (result !== undefined) return { exitCode: result }; signal.throwIfAborted(); return { exitCode: 0 }; }
    finally { childClosed = true; }
  } });
  if (noHook) delete captured.context.registerCleanup;
  const outcome = watch(timeout.createTimeoutCommand({ scheduler: timing.scheduler, ...(maximum === undefined ? {} : { maxTimerMilliseconds: maximum }) }).execute(captured.context));
  await waitFor(admitted.promise, outcome, 'blocked child');
  return { timing, captured, outcome, gate, get signal() { return signal; }, get childClosed() { return childClosed; }, async finish() { gate.resolve(); const value = await outcome.settled; const cleanup = await Promise.allSettled(captured.cleanups.map(callback => callback())); return { ...captured, outcome: value, cleanup }; } };
}
function shell(options = {}, scheduler) {
  const instance = new root.Shell({ fs: root.createMemoryFileSystem(), ...options }); shells.push(instance);
  instance.register(timeout.createTimeoutCommand(scheduler ? { scheduler: scheduler.scheduler } : {})); return instance;
}
async function numeric(group) {
  for (const vector of config.numeric.filter(row => row.group === group)) {
    const token = materialize(vector.input); assert.equal(hash(token), vector.sha256); assert.deepEqual(exactRationalDuration(token), vector.expected);
    const timing = clock(); let calls = 0;
    if (vector.expected.kind !== 'milliseconds') {
      for (const suffix of [['fixture-status', '7'], []]) { const run = await execute(['--', token, ...suffix], { scheduler: timing.scheduler }, { invoke: async () => { calls++; return { exitCode: 7 }; } }); diagnostic(run, vector.expected.kind); }
      assert.equal(calls, 0); assert.equal(timing.records.length, 0);
    } else {
      const milliseconds = Number(vector.expected.value);
      if (milliseconds === 0) { const run = await execute(['--', token, 'fixture-status', '7'], { scheduler: timing.scheduler }, { invoke: async (command, args, options) => { calls++; assert.equal(command, 'fixture-status'); assert.deepEqual(args, ['7']); assert.equal(Object.hasOwn(options, 'signal'), false); return { exitCode: 7 }; } }); returned(run, 7); assert.equal(calls, 1); assert.equal(timing.records.length, 0); }
      else {
        const gate = latch(); let local;
        const captured = capture(['--', token, 'fixture-status', '7'], { invoke: async (command, args, options) => { calls++; assert.equal(command, 'fixture-status'); assert.deepEqual(args, ['7']); local = options.signal; await gate.promise; local.throwIfAborted(); return { exitCode: 7 }; } });
        const outcome = watch(timeout.createTimeoutCommand({ scheduler: timing.scheduler }).execute(captured.context));
        assert.equal(calls, 1); assert.equal(timing.rows[0].milliseconds, Math.min(milliseconds, 2147483647));
        await timing.wake(0, milliseconds - 1); assert.equal(local.aborted, false); assert.equal(timing.rows.at(-1).milliseconds, 1);
        await timing.wake(1, milliseconds); assert.equal(local.aborted, true); assert.equal(outcome.snapshot().status, 'pending');
        gate.resolve(); const value = await outcome.settled; returned({ outcome: value }, 124); await Promise.all(captured.cleanups.map(callback => callback())); assert.equal(timing.live, 0);
      }
      const absent = await execute(['--', token], { scheduler: timing.scheduler }); diagnostic(absent, 'missing-command');
    }
    receipt.numeric.push({ id: vector.id, sha256: vector.sha256, expected: vector.expected, status: 'PASS' });
  }
}

const cases = {
  async F01() { probeFactorySurface(timeout); assert.equal(root.createAgentCommands().length, 77); assert.equal(root.createAgentCommands().some(command => command.name === 'timeout'), false); for (const name of Object.keys(timeout)) assert.equal(Object.hasOwn(root, name), false); assert.equal(config.typeProof.status, 'PASS'); },
  async F02() { probeFactoryContainers(timeout); },
  async F03() {
    for (const factory of [timeout.createTimeoutCommand, timeout.createTimeoutCommands, timeout.timeoutCommands]) {
      for (const value of [null, 0, {}]) assert.throws(() => factory({ invoke: value }), TypeError);
      for (const value of [null, [], () => {}]) assert.throws(() => factory({ scheduler: value }), TypeError);
      for (const name of ['now', 'setTimeout', 'clearTimeout']) for (const value of [undefined, null, 1]) { const scheduler = { now() {}, setTimeout() {}, clearTimeout() {}, [name]: value }; assert.throws(() => factory({ scheduler }), TypeError); }
      for (const value of [null, '1', false, 1n, {}]) assert.throws(() => factory({ maxTimerMilliseconds: value }), TypeError);
      for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5, 2147483648]) assert.throws(() => factory({ maxTimerMilliseconds: value }), RangeError);
      for (const value of [1, 2, 2147483647]) factory({ maxTimerMilliseconds: value });
    }
    for (const factory of [timeout.createTimeoutCommands, timeout.timeoutCommands]) { for (const value of [undefined, false, true]) factory({ replace: value }); for (const value of [null, 0, 'x', {}]) assert.throws(() => factory({ replace: value }), TypeError); }
    timeout.createTimeoutCommand({ get replace() { throw new Error('single factory read replace'); } });
  },
  async F04() {
    for (const [name, factory] of Object.entries(timeout)) {
      const order = ['invoke', 'scheduler', 'now', 'setTimeout', 'clearTimeout', 'maxTimerMilliseconds', ...(name === 'createTimeoutCommand' ? [] : ['replace'])];
      for (const access of ['getter', 'proxy']) for (const throwAt of [-1, ...order.keys()]) for (const reason of [Object.freeze({ failure: true }), undefined, 0, 'sentinel']) {
        const reads = []; let provider = {}, options = {};
        const getter = key => () => { reads.push(key); if (access === 'getter' && order.indexOf(key) === throwAt) throw reason; if (key === 'scheduler') return provider; if (['now', 'setTimeout', 'clearTimeout'].includes(key)) return () => { throw new Error('provider called at construction'); }; return undefined; };
        for (const key of order) Object.defineProperty(['now', 'setTimeout', 'clearTimeout'].includes(key) ? provider : options, key, { get: getter(key) });
        if (access === 'proxy') { const traps = { get(target, key, receiver) { if (order.indexOf(key) === throwAt) { reads.push(key); throw reason; } return Reflect.get(target, key, receiver); } }; provider = new Proxy(provider, traps); options = new Proxy(options, traps); }
        let failed = false, caught; try { factory(options); } catch (error) { failed = true; caught = error; }
        assert.equal(failed, throwAt >= 0); if (failed) assert.ok(Object.is(caught, reason)); assert.deepEqual(reads, throwAt < 0 ? order : order.slice(0, throwAt + 1));
      }
    }
  },
  async F05() {
    const timing = clock(); let calls = 0; const invoke = function() { assert.equal(this, undefined); calls++; return Promise.resolve({ exitCode: 7 }); };
    const options = { invoke, scheduler: timing.scheduler, maxTimerMilliseconds: 7 }; const definition = timeout.createTimeoutCommand(options);
    for (const key of ['now', 'setTimeout', 'clearTimeout']) timing.scheduler[key] = () => { throw new Error('uncaptured provider'); };
    options.invoke = () => { throw new Error('uncaptured invoke'); }; options.maxTimerMilliseconds = 1;
    const captured = capture(['.020', 'child']); const result = await watch(definition.execute(captured.context)).settled; returned({ outcome: result }, 7); assert.equal(calls, 1); assert.equal(timing.rows[0].milliseconds, 7); assert.equal(timing.live, 0);
  },
  async F06() {
    const argv = ['0', 'literal-command', 'one', '--signal=TERM', '$(not-shell)', 'a b'];
    for (const kind of ['own', 'inherited', 'absent-fallback', 'absent-none', 'undefined', 'null', 'false', 'object']) {
      let fallbackCalls = 0, contextCalls = 0, reads = 0; const captured = capture(argv);
      const invoke = function(command, args) { assert.equal(this, captured.context); assert.equal(command, 'literal-command'); assert.deepEqual(args, argv.slice(2)); contextCalls++; return Promise.resolve({ exitCode: 7 }); };
      if (kind === 'own') Object.defineProperty(captured.context, 'invoke', { get() { reads++; return invoke; } });
      else if (kind === 'inherited') Object.setPrototypeOf(captured.context, { invoke });
      else if (!kind.startsWith('absent')) captured.context.invoke = ({ undefined: undefined, null: null, false: false, object: {} })[kind];
      const options = kind === 'absent-none' ? {} : { invoke: function(command, args) { assert.equal(this, undefined); assert.equal(command, 'literal-command'); assert.deepEqual(args, argv.slice(2)); fallbackCalls++; return Promise.resolve({ exitCode: 7 }); } };
      const run = { ...captured, outcome: await watch(timeout.createTimeoutCommand(options).execute(captured.context)).settled };
      if (['own', 'inherited', 'absent-fallback'].includes(kind)) returned(run, 7); else diagnostic(run, 'invoke-unavailable');
      assert.equal(contextCalls, ['own', 'inherited'].includes(kind) ? 1 : 0); assert.equal(fallbackCalls, kind === 'absent-fallback' ? 1 : 0); if (kind === 'own') assert.equal(reads, 1);
    }
    for (const trap of ['has', 'get']) { const reason = {}; const captured = capture(argv); captured.context.invoke = undefined; const proxy = new Proxy(captured.context, { [trap](target, property, receiver) { if (property === 'invoke') throw reason; return trap === 'has' ? Reflect.has(target, property) : Reflect.get(target, property, receiver); } }); const outcome = await watch(timeout.createTimeoutCommand({ invoke: async () => { throw new Error('fallback'); } }).execute(proxy)).settled; rejected({ outcome }, reason); }
  },
  async F07() {
    for (const args of [['--help'], ['--version'], ['--help', 'ignored']]) {
      const gate = latch(), entered = latch(), timing = clock(); const captured = capture(args); const sink = captured.context.stdout;
      captured.context.stdout = { async write(bytes) { entered.resolve(); await gate.promise; await sink.write(bytes); } };
      for (const name of ['invoke', 'registerCleanup']) Object.defineProperty(captured.context, name, { get() { throw new Error(`information read ${name}`); } });
      captured.context.stdin = { [Symbol.asyncIterator]() { throw new Error('information read stdin'); } };
      const outcome = watch(timeout.createTimeoutCommand({ scheduler: timing.scheduler }).execute(captured.context)); await waitFor(entered.promise, outcome, 'information sink'); assert.equal(outcome.snapshot().status, 'pending'); gate.resolve(); diagnostic({ ...captured, outcome: await outcome.settled }, args[0].slice(2)); assert.equal(timing.records.length, 0);
      const reason = {}; const failed = await execute(args, {}, { stdout: { async write() { throw reason; } } }); rejected(failed, reason);
    }
  },
  async F08() {
    const spec = families.find(row => row.id === 'F08').vectors;
    for (const args of spec.missing) diagnostic(await execute(args), args.includes('1') ? 'missing-command' : 'missing-duration');
    for (const args of spec.invalid) diagnostic(await execute(args), 'invalid-option');
    for (const flag of spec.unsupported) {
      const key = flag.startsWith('--') ? flag.slice(2).split('=')[0] : ({ p: 'preserve-status', s: 'signal', k: 'kill-after', f: 'foreground', v: 'verbose' })[flag[1]];
      diagnostic(await execute([flag, '1', 'child']), `unsupported-${key}`);
      const reason = {}; rejected(await execute([flag], {}, { stderr: { async write() { throw reason; } } }), reason);
    }
    for (const args of spec.literal) { const timing = clock(); let calls = 0; const stripped = args[0] === '--' ? args.slice(1) : args; returned(await execute(args, { scheduler: timing.scheduler }, { invoke: async (command, operands) => { calls++; assert.equal(command, stripped[1]); assert.deepEqual(operands, stripped.slice(2)); return { exitCode: 7 }; } }), 7); assert.equal(calls, 1); }
  },
  async F09() { await numeric('grammar'); },
  async F10() {
    for (const token of families.find(row => row.id === 'F10').vectors.tokens.map(materialize)) for (const status of [0, 7, 124, 126, 127]) { const timing = clock(); let calls = 0; const run = await execute([token, 'child'], { scheduler: timing.scheduler }, { invoke: async (command, args, options) => { calls++; assert.equal(Object.hasOwn(options, 'signal'), false); return { exitCode: status }; } }); returned(run, status); assert.equal(calls, 1); assert.equal(run.cleanups.length, 0); assert.equal(timing.records.length, 0); }
  },
  async F11() { for (const group of [...new Set(config.numeric.map(row => row.group))].filter(group => !['grammar', 'maximum', 'long'].includes(group))) await numeric(group); },
  async F12() { await numeric('maximum'); },
  async F13() { await numeric('long'); },
  async F14() { assert.equal(config.staticProof.status, 'PASS'); assert.equal(config.staticProof.parserSha256, '870a3800f9ba46a1d38ed831d0b6e7da804d4d34c6f5d3ebe86ada535d90b835'); receipt.activations.push({ id: 'F14', staticBinding: config.staticProof, runtimeInstrumentation: false }); },
  async F15() {
    const rows = [
      ['maxSourceBytes', 128, `timeout ${'0'.repeat(129)} child`, {}, 'ok'],
      ['maxExpansionBytes', 64, 'timeout $LONG child', { LONG: '0'.repeat(65) }, 'ok'],
      ['maxExpansionFields', 4, 'timeout 0 child $FIELDS', { FIELDS: 'a b c d e' }, 'ok'],
      ['maxCommands', 1, 'timeout 0 child', {}, 'ok'],
      ['maxSubstitutionDepth', 1, 'timeout 0 child recursive', {}, 'recursive'],
      ['maxOutputBytes', 3, 'timeout 0 child output', {}, 'output'],
    ];
    for (const [limit, maximum, source, env] of rows) {
      const instance = shell({ env }); instance.register({ name: 'child', async execute(context) { if (context.args[0] === 'recursive') return context.invoke('leaf', []); if (context.args[0] === 'output') await context.stdout.write(encoder.encode('four')); return { exitCode: 0 }; } }); instance.register({ name: 'leaf', execute: () => ({ exitCode: 0 }) });
      const baseline = await instance.exec(source); assert.equal(baseline.exitCode, 0);
      const outcome = await watch(instance.exec(source, { limits: { [limit]: maximum } })).settled; assert.equal(outcome.status, 'rejected'); assert.equal(outcome.reason.name, 'ShellLimitError'); assert.equal(outcome.reason.limit, limit); receipt.activations.push({ id: 'F15', limit, baseline: 0, activated: outcome.reason.limit }); await instance.dispose();
    }
  },
  async F16() {
    const timing = clock(); const order = []; const now = timing.scheduler.now, arm = timing.scheduler.setTimeout;
    timing.scheduler.now = function() { order.push('now'); return now.call(this); }; timing.scheduler.setTimeout = function(...args) { order.push('arm'); return arm.apply(this, args); };
    const run = await execute(['.001', 'child'], { scheduler: timing.scheduler }, { registerCleanup() { order.push('register'); }, invoke: async () => { order.push('invoke'); return { exitCode: 0 }; } }); returned(run, 0); assert.deepEqual(order, ['register', 'now', 'arm', 'invoke']);
    for (const reason of [{}, undefined, 0]) { const local = clock(); const failed = await execute(['.001', 'child'], { scheduler: local.scheduler }, { registerCleanup() { throw reason; }, invoke: async () => { throw new Error('admitted'); } }); rejected(failed, reason); assert.equal(local.records.length, 0); }
    const noHook = await blocked({ noHook: true, result: 7 }); returned(await noHook.finish(), 7); assert.equal(noHook.timing.live, 0);
  },
  async F17() {
    for (const maximum of [1, 7, 2147483647]) { const pending = await blocked({ duration: '.020', maximum }); for (const sample of [3, 10, 20]) { const ordinal = pending.timing.rows.length - 1; await pending.timing.wake(ordinal, sample); } assert.equal(pending.signal.aborted, true); returned(await pending.finish(), 124); assert.ok(pending.timing.rows.every(row => Number.isInteger(row.milliseconds) && row.milliseconds >= 1 && row.milliseconds <= maximum)); assert.equal(pending.timing.peak, 1); }
    for (const samples of [[0, .25, 1], [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [0, 0, 0, 0]]) { const timing = clock({ initial: samples[0] }); const pending = await blocked({ scheduler: timing, result: samples.every(sample => sample === 0) ? 7 : undefined }); for (const sample of samples.slice(1)) await timing.wake(timing.rows.length - 1, sample); const run = await pending.finish(); returned(run, samples.every(sample => sample === 0) ? 7 : 124); assert.equal(timing.live, 0); }
  },
  async F18() { for (const handle of [undefined, null, 0, false, '']) { const timing = clock({ handles: [handle] }); const pending = await blocked({ scheduler: timing, result: 7 }); returned(await pending.finish(), 7); assert.equal(timing.records.filter(row => row.event === 'clear').length, 1); assert.ok(Object.is(timing.rows[0].handle, handle)); const count = timing.records.length; await timing.wake(0, 1); assert.equal(timing.records.length, count + 1); assert.equal(timing.live, 0); } },
  async F19() {
    for (const mode of ['queued-during-clear', 'queued-after-clear', 'cleanup-reentry']) {
      const boundTiming = clock(); const originalClear = boundTiming.scheduler.clearTimeout; let nested, saved;
      boundTiming.scheduler.clearTimeout = function(handle) { originalClear.call(this, handle); if (mode === 'queued-during-clear') { const row = boundTiming.rows[0]; assert.equal(row.offered, false); row.offered = true; row.callback(); } if (mode === 'cleanup-reentry') nested = saved(); };
      const second = await blocked({ scheduler: boundTiming, result: 7 }); saved = second.captured.cleanups[0]; const run = await second.finish(); returned(run, 7); if (nested) await nested;
      if (mode === 'queued-after-clear') await boundTiming.wake(0, 1);
      assert.equal(boundTiming.rows.length, 1); assert.equal(boundTiming.records.filter(row => row.event === 'now').length, 1); assert.equal(boundTiming.records.filter(row => row.event === 'clear').length, 1); assert.equal(second.signal.aborted, false);
    }
  },
  async F20() {
    for (const sample of [undefined, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1, 'x']) { const timing = clock(); timing.scheduler.now = () => sample; const run = await execute(['.001', 'child'], { scheduler: timing.scheduler }, { invoke: async () => { throw new Error('unexpected admission'); } }); diagnostic(run, 'timer-setup-failed'); assert.equal(timing.rows.length, 0); }
    for (const name of ['now', 'setTimeout']) { const timing = clock(); timing.scheduler[name] = () => { throw {}; }; diagnostic(await execute(['.001', 'child'], { scheduler: timing.scheduler }, { invoke: async () => { throw new Error('unexpected admission'); } }), 'timer-setup-failed'); }
    for (const sample of [-1, .25]) { const timing = clock({ initial: sample }); returned(await execute(['.001', 'child'], { scheduler: timing.scheduler }, { invoke: async () => ({ exitCode: 7 }) }), 7); }
    const reason = {}; const timing = clock(); timing.scheduler.now = () => { throw {}; }; rejected(await execute(['.001', 'child'], { scheduler: timing.scheduler }, { invoke: async () => { throw new Error('unexpected admission'); }, stderr: { async write() { throw reason; } } }), reason);
  },
  async F21() {
    for (const kind of ['throw', 'rollback', 'nonfinite', 'rearm']) {
      const timing = clock(), originalNow = timing.scheduler.now, originalArm = timing.scheduler.setTimeout; let nowCalls = 0, arms = 0;
      timing.scheduler.now = function() { nowCalls++; if (nowCalls > 1) { if (kind === 'throw') throw {}; if (kind === 'rollback') return -1; if (kind === 'nonfinite') return Infinity; } return originalNow.call(this); };
      timing.scheduler.setTimeout = function(...args) { if (++arms > 1 && kind === 'rearm') throw {}; return originalArm.apply(this, args); };
      const pending = await blocked({ duration: '.020', scheduler: timing }); await timing.wake(0, 1); assert.equal(pending.signal.aborted, true); assert.equal(pending.outcome.snapshot().status, 'pending'); diagnostic(await pending.finish(), 'timer-setup-failed');
    }
  },
  async F22() {
    for (const status of [0, 7, 124, 125, 126, 127, 255]) { const timing = clock(); returned(await execute(['1', 'child'], { scheduler: timing.scheduler }, { invoke: async () => ({ exitCode: status }) }), status); assert.equal(timing.live, 0); }
    const before = process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
    returned(await execute(['1', 'child'], {}, { invoke: async () => ({ exitCode: 7 }) }), 7);
    await tick(); const after = process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
    assert.equal(after, before); receipt.activations.push({ id: 'F22', route: 'default-captured-Node-scheduler-early-status7', timeoutResourcesBefore: before, timeoutResourcesAfter: after });
    const filesystem = root.createMemoryFileSystem(); await filesystem.mkdir('/unsupported-directory'); const other = shell({ fs: filesystem });
    for (const [source, expected] of [['unknown-fixture-command', 127], ['/unsupported-directory', 126]]) { const baseline = await other.exec(source), wrapped = await other.exec(`timeout 0 ${source}`); assert.equal(baseline.exitCode, expected); assert.equal(wrapped.exitCode, expected); assert.equal(wrapped.stderr, baseline.stderr); assert.equal(wrapped.stdout, baseline.stdout); } await other.dispose();
  },
  async F23() { const pending = await blocked(); await pending.timing.wake(0, 1); assert.equal(pending.outcome.snapshot().status, 'pending'); assert.equal(pending.childClosed, false); returned(await pending.finish(), 124); assert.equal(pending.childClosed, true); },
  async F24() { for (const reason of [{}, { name: 'AbortError' }, new Error('foreign'), undefined, null, false, 0, 'foreign']) { const pending = await blocked({ failure: reason, failureSet: true }); await pending.timing.wake(0, 1); rejected(await pending.finish(), reason); } },
  async F25() {
    const first = await blocked(), second = await blocked(); await first.timing.wake(0, 1); await second.timing.wake(0, 1); assert.notEqual(first.signal.reason, second.signal.reason); returned(await first.finish(), 124); returned(await second.finish(), 124);
    const foreign = first.signal.reason; const sibling = await blocked({ failure: foreign, failureSet: true }); await sibling.timing.wake(0, 1); rejected(await sibling.finish(), foreign);
    const timing = clock(); let calls = 0; const old = timing.scheduler.now; timing.scheduler.now = function() { if (++calls > 1) throw {}; return old.call(this); }; const broken = await blocked({ scheduler: timing }); await timing.wake(0, 0); assert.notEqual(broken.signal.reason, foreign); diagnostic(await broken.finish(), 'timer-setup-failed');
  },
  async F26() {
    for (const kind of ['child0-clear', 'deadline-child-cleanup', 'escaping-clear', 'no-hook-clear']) {
      const reason = {}, foreign = {}, timing = clock(); const original = timing.scheduler.clearTimeout;
      if (kind !== 'deadline-child-cleanup') timing.scheduler.clearTimeout = function(handle) { original.call(this, handle); throw reason; };
      const pending = await blocked({ scheduler: timing, result: kind === 'child0-clear' || kind === 'no-hook-clear' ? 0 : undefined, failureSet: kind === 'escaping-clear' || kind === 'deadline-child-cleanup', failure: kind === 'escaping-clear' ? foreign : reason, noHook: kind === 'no-hook-clear' });
      if (kind === 'deadline-child-cleanup') await timing.wake(0, 1);
      rejected(await pending.finish(), kind === 'escaping-clear' ? foreign : reason); assert.equal(timing.live, 0);
    }
    await shellRetirementCollision(false);
  },
  async F27() { for (const reason of [{}, undefined, null, false, 0, 'caller']) await callerCase(reason, false); const controller = new AbortController(); controller.abort({}); const timing = clock(); const run = await execute(['.001', 'child'], { scheduler: timing.scheduler }, { signal: controller.signal, invoke: async () => { throw new Error('preaborted admission'); } }); rejected(run, controller.signal.reason); assert.equal(timing.records.length, 0); },
  async F28() { await callerCase(Object.freeze({ overlapping: true }), false, true); },
  async F29() {
    const outerClock = clock(), innerClock = clock(), rootGate = latch(), rootClosing = latch(), childGate = latch(), admitted = latch();
    const instance = shell({}, outerClock), inner = timeout.createTimeoutCommand({ scheduler: innerClock.scheduler });
    instance.register({ name: 'inner', execute: context => inner.execute(context) });
    instance.register({ name: 'leaf', execute(context) { context.registerCleanup(() => childGate.promise); admitted.resolve(); return { exitCode: 0 }; } });
    instance.use(async (context, next) => { if (context.command === 'timeout') context.registerCleanup(async () => { rootClosing.resolve(); await rootGate.promise; }); return next(); });
    const result = watch(instance.exec('timeout 1 inner .001 leaf')); await waitFor(admitted.promise, result, 'nested child'); await innerClock.wake(0, 1); childGate.resolve(); await waitFor(rootClosing.promise, result, 'root-only cleanup');
    assert.equal(outerClock.live, 0); assert.equal(innerClock.live, 0); assert.equal(result.snapshot().status, 'pending'); rootGate.resolve(); returned({ outcome: await result.settled }, 124); await instance.dispose();
  },
  async F30() {
    const chunks = ['00ff0a', '616200', 'fe80'].map(value => Buffer.from(value, 'hex'));
    for (const flag of ['absent', false, true]) { const captured = capture(['0', 'child', '--literal', 'a b', '$(x)']); if (flag === 'absent') delete captured.context.stdinIsDefault; else captured.context.stdinIsDefault = flag;
      captured.context.invoke = async (command, args, options) => { assert.deepEqual(args, ['--literal', 'a b', '$(x)']); for (const key of ['stdin', 'stdout', 'stderr']) assert.equal(options[key], captured.context[key]); assert.equal(Object.hasOwn(options, 'stdinIsDefault'), flag !== 'absent'); if (flag !== 'absent') assert.equal(options.stdinIsDefault, flag); for (const key of ['cwd', 'env', 'replaceEnv']) assert.equal(Object.hasOwn(options, key), false); return { exitCode: 0 }; };
      returned({ outcome: await watch(timeout.createTimeoutCommand().execute(captured.context)).settled }, 0);
    }
    const instance = shell(); const gate = latch(), entered = latch(); let writes = 0;
    instance.register({ name: 'child', async execute(context) { for await (const bytes of context.stdin) { await context.stdout.write(bytes); await context.stderr.write(bytes); writes++; } return { exitCode: 0 }; } });
    const stdin = { async *[Symbol.asyncIterator]() { const buffer = new Uint8Array(3); for (const bytes of chunks) { buffer.fill(0); buffer.set(bytes); yield buffer.subarray(0, bytes.length); } } }; const stdout = [];
    const outcome = watch(instance.exec('timeout 0 child', { stdin, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); entered.resolve(); await gate.promise; } } })); await waitFor(entered.promise, outcome, 'stream sink'); assert.equal(writes, 0); gate.resolve(); const result = await outcome.settled; returned({ outcome: result }, 0); assert.deepEqual(Buffer.concat(stdout), Buffer.concat(chunks)); assert.deepEqual(Buffer.from(result.value.stderrBytes), Buffer.concat(chunks)); await instance.dispose();
  },
  async F31() {
    for (const replace of [undefined, false, true]) { const registry = new root.CommandRegistry([{ name: 'timeout', execute: () => ({ exitCode: 42 }) }]); const before = registry.get('timeout'); const plugin = timeout.timeoutCommands({ replace }); if (replace) { plugin.setup({ commands: registry }); assert.notEqual(registry.get('timeout'), before); } else { assert.throws(() => plugin.setup({ commands: registry })); assert.equal(registry.get('timeout'), before); } assert.equal(registry.list().length, 1); }
    const timing = clock(); const options = { scheduler: timing.scheduler, maxTimerMilliseconds: 7, replace: false }; const plugin = timeout.timeoutCommands(options); options.replace = true; options.maxTimerMilliseconds = 1; const registry = new root.CommandRegistry(); plugin.setup({ commands: registry }); const captured = capture(['.020', 'child'], { invoke: async () => ({ exitCode: 7 }) }); returned({ outcome: await watch(registry.get('timeout').execute(captured.context)).settled }, 7); assert.equal(timing.rows[0].milliseconds, 7);
  },
  async F32() { const pending = await blocked({ result: 7 }); await pending.timing.wake(0, 1); assert.equal(pending.outcome.snapshot().status, 'pending'); returned(await pending.finish(), 7); },
  async PC01() { await callerCase(undefined, true); await callerCase(undefined, true, false, true); },
  async PC02() {
    const timing = clock(); const original = timing.scheduler.clearTimeout; let observed, entered = false, thrown = false;
    timing.scheduler.clearTimeout = function(handle) { entered = true; original.call(this, handle); thrown = true; throw observed; };
    const pending = await blocked({ scheduler: timing }); await timing.wake(0, 1); observed = pending.signal.reason; const before = pending.outcome.snapshot(); const run = await pending.finish();
    assertDirectRetirementCollision({ localSignal: pending.signal, observedOwnReason: observed, beforeRelease: { handler: before }, handler: run.outcome, retirement: { origin: 'product-owned-scheduler-retirement', entered, threw: thrown, reason: observed }, selectedChildClosed: pending.childClosed, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
    receipt.activations.push({ id: 'PC02', actualProductRetirementEntered: entered, actualRetirementThrew: thrown, sameSentinel: true, handler: run.outcome.status, registeredCleanupRejections: run.cleanup.filter(row => row.status === 'rejected').length, resources: timing.live });
    await shellRetirementCollision(true);
  },
};

async function shellRetirementCollision(sameSentinel) {
  const timing = clock(), clear = timing.scheduler.clearTimeout, gate = latch(), admitted = latch();
  let thrown = {}, observed, childSignal, handlerObservation, childClosed = false, retirementEntered = 0;
  timing.scheduler.clearTimeout = function(handle) { retirementEntered++; clear.call(this, handle); throw thrown; };
  const instance = shell({}, timing), actual = timeout.createTimeoutCommand({ scheduler: timing.scheduler });
  instance.register({ name: 'timeout', execute(context) { const pending = actual.execute(context); handlerObservation = watch(pending); return pending; } }, { replace: true });
  instance.register({ name: 'child', execute(context) { childSignal = context.signal; context.registerCleanup(async () => { await gate.promise; childClosed = true; }); admitted.resolve(); return { exitCode: 0 }; } });
  const outer = watch(instance.exec('timeout .001 child')); await waitFor(admitted.promise, outer, 'retirement child'); await timing.wake(0, 1); observed = childSignal.reason;
  if (sameSentinel) thrown = observed;
  const before = handlerObservation.snapshot(); assert.equal(before.status, 'pending'); gate.resolve();
  const handler = await handlerObservation.settled, outcome = await outer.settled;
  rejected({ outcome: handler }, thrown); assert.equal(outcome.status, 'rejected');
  assert.ok(Object.is(outcome.reason, thrown) || (outcome.reason instanceof AggregateError && outcome.reason.errors.length > 0 && outcome.reason.errors.every(error => Object.is(error, thrown))), 'UNEXPECTED_ROOT_CLEANUP_AGGREGATION');
  assert.equal(retirementEntered, 1); assert.equal(childClosed, true); assert.equal(timing.live, 0);
  if (sameSentinel) assertDirectRetirementCollision({ localSignal: childSignal, observedOwnReason: observed, beforeRelease: { handler: before }, handler, retirement: { origin: 'product-owned-scheduler-retirement', entered: true, threw: true, reason: thrown }, selectedChildClosed: childClosed, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
  const disposal = await watch(instance.dispose()).settled;
  if (disposal.status === 'rejected') assert.ok(Object.is(disposal.reason, thrown) || (disposal.reason instanceof AggregateError && disposal.reason.errors.every(error => Object.is(error, thrown))));
  receipt.activations.push({ id: sameSentinel ? 'PC02' : 'F26', route: 'actual-Shell-cleanup-barrier', retirementEntered, actualRetirementThrew: true, sameSentinel: Object.is(thrown, observed), rawHandler: handler.status, outer: outcome.status, rootAggregation: outcome.reason instanceof AggregateError, childClosed, resources: timing.live, disposal: disposal.status });
}

async function callerCase(reason, collision, disposal = false, outerContext = false) {
  const timing = clock(), controller = new AbortController(), childGate = latch(), childEntered = latch(); let childSignal, handlerObservation, childClosed = false;
  const instance = shell({}, timing); const actual = timeout.createTimeoutCommand({ scheduler: timing.scheduler });
  instance.register({ name: 'timeout', execute(context) { handlerObservation = watch(actual.execute(context)); return handlerObservation.settled.then(row => { if (row.status === 'rejected') throw row.reason; return row.value; }); } }, { replace: true });
  instance.register({ name: 'child', execute(context) { childSignal = context.signal; context.registerCleanup(async () => { await childGate.promise; childClosed = true; }); childEntered.resolve(); return { exitCode: 0 }; } });
  if (outerContext) instance.register({ name: 'outer', execute: context => context.invoke('timeout', ['.001', 'child'], { signal: controller.signal }) });
  const outer = watch(instance.exec(outerContext ? 'outer' : 'timeout .001 child', outerContext ? {} : { signal: controller.signal })); await waitFor(childEntered.promise, outer, 'caller child'); await timing.wake(0, 1); const observed = childSignal.reason;
  controller.abort(collision ? observed : reason); await tick(); const beforeRelease = { handler: handlerObservation.snapshot(), outer: outer.snapshot() }; assert.equal(beforeRelease.handler.status, 'pending'); assert.equal(beforeRelease.outer.status, 'pending');
  const disposing = disposal ? watch(instance.dispose()) : null; if (disposing) { await tick(); assert.equal(disposing.snapshot().status, 'pending'); }
  childGate.resolve(); const handler = await handlerObservation.settled, outerResult = await outer.settled; assert.equal(childClosed, true);
  if (collision) assertCallerCollision({ localSignal: childSignal, callerSignal: controller.signal, observedOwnReason: observed, beforeRelease, handler, outer: outerResult, selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
  rejected({ outcome: handler }, controller.signal.reason); rejected({ outcome: outerResult }, controller.signal.reason);
  if (disposing) assert.equal((await disposing.settled).status, 'fulfilled'); else await instance.dispose();
  receipt.activations.push({ id: collision ? 'PC01' : disposal ? 'F28' : 'F27', route: outerContext ? 'outer-context' : 'root-caller', sameSentinel: Object.is(observed, controller.signal.reason), rawHandler: handler.status, outer: outerResult.status, childClosed, resources: timing.live });
}

const allIds = [...families.map(row => row.id), 'PC01', 'PC02'];
const ids = config.caseIds ?? allIds;
assert.ok(ids.every(id => allIds.includes(id)));
const unhandled = []; process.on('unhandledRejection', reason => unhandled.push(encodeReason(reason)));
try {
  for (const id of ids) {
    integrity();
    const before = receipt.numeric.length, firstClock = clocks.length, firstLatch = latches.length, firstTracked = tracked.length, firstShell = shells.length; const startedAt = new Date().toISOString();
    fs.appendFileSync(`${config.output}/CASE-ORDER.jsonl`, `${JSON.stringify({ id, startedAt })}\n`);
    const clockRecords = () => clocks.slice(firstClock).map(timing => ({ live: timing.live, peak: timing.peak, records: timing.records, rows: timing.rows.map(({ ordinal, handle, milliseconds, offered, cleared }) => ({ ordinal, handleType: typeof handle, handleIsNull: handle === null, handleValue: typeof handle === 'object' ? undefined : handle, milliseconds, offered, cleared })) }));
    const row = { id, status: 'PASS', startedAt };
    try { await cases[id](); await tick(); for (const timing of clocks.slice(firstClock)) assert.equal(timing.live, 0, `${id}:scheduler resources remain`); for (const observation of tracked.slice(firstTracked)) assert.notEqual(observation.snapshot().status, 'pending', `${id}:tracked work remains`); }
    catch (error) { row.status = error?.code === 'HOLD_UNACTIVATED' ? 'HOLD_UNACTIVATED' : 'FAIL'; row.error = { ...encodeReason(error), stack: error?.stack }; }
    receipt.cases.push(row);
    fs.writeFileSync(`${config.output}/${id}-assertions.json`, `${JSON.stringify({ ...row, numericAdded: receipt.numeric.length - before, clocks: clockRecords() }, null, 2)}\n`, { flag: 'wx' });
    for (const gate of latches.slice(firstLatch)) gate.resolve();
    await Promise.all(tracked.slice(firstTracked).map(value => value.settled));
    const disposal = await Promise.allSettled(shells.slice(firstShell).map(instance => instance.dispose()));
    await tick(); integrity();
    row.cleanup = { pending: tracked.slice(firstTracked).filter(value => value.snapshot().status === 'pending').length, schedulerLive: clocks.slice(firstClock).reduce((sum, timing) => sum + timing.live, 0), shells: disposal.length, disposalRejections: disposal.filter(value => value.status === 'rejected').map(value => encodeReason(value.reason)), unhandled: [...unhandled] };
    row.finishedAt = new Date().toISOString(); row.numericAdded = receipt.numeric.length - before; row.clocks = clockRecords(); row.integrity = 'UNCHANGED';
    fs.writeFileSync(`${config.output}/${id}.json`, `${JSON.stringify(row, null, 2)}\n`, { flag: 'wx' });
    assert.equal(row.cleanup.pending, 0); assert.equal(row.cleanup.schedulerLive, 0); assert.deepEqual(unhandled, []);
  }
  receipt.coverage = { numeric: receipt.numeric.length, diagnosticLabels: new Set(receipt.diagnostics.map(row => row.label)).size, expectedNumeric: config.caseIds ? null : 70, expectedDiagnosticLabels: config.caseIds ? null : 14 };
  const passed = receipt.cases.every(row => row.status === 'PASS') && (config.caseIds || (receipt.numeric.length === 70 && receipt.coverage.diagnosticLabels === 14));
  receipt.status = config.caseIds ? (passed ? 'MUTANT_SURVIVED' : 'MUTANT_REJECTED') : (passed ? 'FROZEN_RUNTIME_ASSERTIONS_PASSED' : 'FROZEN_RUNTIME_ASSERTIONS_FAILED');
  if (!passed) process.exitCode = 1;
} catch (error) { receipt.status = 'STOP_NO_RETRY'; receipt.failure = { ...encodeReason(error), stack: error?.stack }; process.exitCode = 1; }
finally {
  for (const gate of latches) gate.resolve();
  const settlements = await Promise.all(tracked.map(row => row.settled));
  const disposed = await Promise.allSettled(shells.map(instance => instance.dispose()));
  await tick(); receipt.cleanup = { tracked: settlements.length, pending: tracked.filter(row => row.snapshot().status === 'pending').length, schedulerLive: clocks.reduce((sum, timing) => sum + timing.live, 0), shells: disposed.length, disposalRejections: disposed.filter(row => row.status === 'rejected').map(row => encodeReason(row.reason)), unhandled };
  receipt.unexecuted = ids.filter(id => !receipt.cases.some(row => row.id === id)); receipt.finishedAt = new Date().toISOString();
  fs.writeFileSync(`${config.output}/RESULT.json`, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' }); console.log(JSON.stringify({ profile: config.profile, status: receipt.status, passed: receipt.cases.filter(row => row.status === 'PASS').length, failed: receipt.cases.filter(row => row.status === 'FAIL').map(row => row.id), unexecuted: receipt.unexecuted, numeric: receipt.numeric.length, diagnostics: new Set(receipt.diagnostics.map(row => row.label)).size, cleanup: receipt.cleanup }));
}
