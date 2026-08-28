import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activationReceipt, capture, deferred, failure, loadProduct, readAdmission, turn } from './support.mjs';

const manifest = readAdmission(process.argv[2], process.argv[3]);
const { api, runtime, arithmetic } = await loadProduct(manifest, specifier => import.meta.resolve(specifier));
const { Shell, MemoryFileSystem, agentCommands, ShellLimitError, ShellSyntaxError, FsError } = api;
const { Runtime } = runtime;
const frozen = JSON.parse(readFileSync(join(manifest.harnessRoot, 'synthetic.json')));
const id = process.argv[4];
assert.ok(frozen.some(row => row.id === id));
const shells = [], releases = [], restorers = [], pending = [], details = [];
const observe = promise => { const result = capture(promise); pending.push(result); return result; };
const make = (options = {}) => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: 'C', TZ: 'UTC' }, limits: { maxCommands: 64, maxSourceBytes: 32768, maxExpansionFields: 512, maxExpansionBytes: 4096, maxOutputBytes: 16384 }, ...options }).use(agentCommands());
  shells.push(shell); return shell;
};
const gate = () => { const value = deferred(); releases.push(() => value.resolve()); return value; };
const equalReason = (outcome, reason) => { assert.equal(outcome.kind, 'throw'); assert.ok(Object.is(outcome.reason, reason)); };
const limit = (outcome, name) => { assert.equal(outcome.kind, 'throw'); assert.ok(outcome.reason instanceof ShellLimitError); assert.equal(outcome.reason.limit, name); };
const successful = (outcome, code = 0) => { assert.equal(outcome.kind, 'return'); assert.equal(outcome.value.exitCode, code); };
const waitEntry = async (entered, done) => { assert.equal(await Promise.race([entered.promise.then(() => 'entered'), done.then(() => 'settled')]), 'entered'); };
const stillPending = async done => { let settled = false; void done.then(() => { settled = true; }); await turn(); await turn(); assert.equal(settled, false); };
function replace(target, key, replacement) {
  const original = target[key]; target[key] = replacement(original); restorers.push(() => { target[key] = original; }); return original;
}
function watchBuiltin(observer) {
  replace(Runtime.prototype, 'builtin', original => async function (...args) { observer(this, args[0], args[1]); return original.apply(this, args); });
}
const procedures = {
  async S01() {
    const shell = make(); await shell.exec(':');
    const defaultNames = shell.commands.list().map(row => row.name);
    assert.equal(defaultNames.includes('let'), false); assert.equal(defaultNames.length, 77);
    let calls = 0; shell.register({ name: 'let', execute() { calls++; return { exitCode: 9 }; } });
    const before = shell.commands.list().map(row => row.name);
    const result = await shell.exec('type let; let 1');
    assert.equal(result.stdout, 'let is a shell builtin\n'); assert.equal(result.stderr, ''); assert.equal(result.exitCode, 0);
    assert.equal(calls, 0); assert.deepEqual(shell.commands.list().map(row => row.name), before);
    details.push({ defaultCount: defaultNames.length, competingPluginCalls: calls });
  },
  async S02() {
    const shell = make(); const statuses = [], args = ['value=7'];
    shell.register({ name: 'relay', async execute(context) {
      const literal = Object.freeze(['value=$(printf 9)']);
      statuses.push((await context.invoke('let', literal)).exitCode); assert.equal(literal[0], 'value=$(printf 9)');
      statuses.push((await context.invoke('let', args)).exitCode); assert.deepEqual(args, ['value=7']);
      args[0] = 'value=8'; statuses.push((await context.invoke('let', args)).exitCode); assert.deepEqual(args, ['value=8']);
      return { exitCode: 0 };
    } });
    const result = await shell.exec('value=2; relay; printf "%s\\n" "$value"');
    assert.deepEqual(statuses, [1, 0, 0]); assert.equal(result.stdout, '2\n'); assert.match(result.stderr, /let: value=\$\(printf 9\):/u); assert.equal(result.exitCode, 0);
    const forwarded = Object.freeze(['--', 'value=7']), direct = make();
    direct.use((context, next) => { if (context.command === 'seed') Object.assign(context, { command: 'let', args: forwarded }); return next(); });
    const forwardedResult = await direct.exec('seed'); assert.equal(forwardedResult.exitCode, 0); assert.equal(forwardedResult.stderr, ''); assert.deepEqual(forwarded, ['--', 'value=7']);
    details.push({ statuses, literalNotExpanded: true, callerArraysUnmodified: true });
  },
  async S03() {
    const writes = []; let active = false;
    replace(Runtime.prototype, 'builtin', original => async function (...args) { if (args[0].command !== 'let') return original.apply(this, args); active = true; try { return await original.apply(this, args); } finally { active = false; } });
    replace(Runtime.prototype, 'writeVariable', original => function (...args) { if (active) writes.push({ name: args[1], value: args[2], origin: args[3] }); return original.apply(this, args); });
    const result = await make({ env: { n: '0' } }).exec("let 'n=2' 'old=n++' 'n+=3'");
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
    assert.deepEqual(writes, [['n', '2'], ['n', '3'], ['old', '2'], ['n', '6']].map(([name, value]) => ({ name, value, origin: 'arithmetic' })));
    details.push({ writes });
  },
  async S04() {
    let state, before;
    watchBuiltin((_runtime, context, value) => { if (context.command === 'let') { state = value; before = structuredClone(value.getopts); } });
    const result = await make().exec("set -- -ab; getopts ab option; readonly OPTIND; let 'OPTIND=1'");
    assert.equal(result.exitCode, 1); assert.ok(state); assert.equal(state.variables.OPTIND, '1'); assert.ok(state.readonlyVariables.has('OPTIND'));
    assert.deepEqual(state.getopts, before); assert.match(result.stderr, /OPTIND: readonly variable/u);
    details.push({ cursorBefore: before, cursorAfter: state.getopts, readonlyRetained: true });
  },
  async S05() {
    const shell = make(), observed = [];
    shell.register({ name: 'probe', execute(context) { observed.push(context.env.value); return { exitCode: 0 }; } });
    shell.register({ name: 'relay', async execute(context) { assert.equal((await context.invoke('let', ['value=9'])).exitCode, 0); await context.invoke('probe', []); return { exitCode: 0 }; } });
    const result = await shell.exec('export value=2; relay; printf "%s\\n" "$value"');
    assert.deepEqual(observed, ['2']); assert.equal(result.stdout, '2\n'); assert.equal(result.stderr, ''); assert.equal(result.exitCode, 0);
    details.push({ observed, parent: result.stdout });
  },
  async S06() {
    const shell = make(); let entered = 0, failures = 0;
    watchBuiltin((_runtime, context) => { if (context.command === 'let') entered++; });
    shell.register({ name: 'relay', async execute(context) { for (const args of [[1], ['1\0'], {}]) { const result = await capture(context.invoke('let', args)); assert.equal(result.kind, 'throw'); assert.ok(result.reason instanceof TypeError); failures++; } return { exitCode: 0 }; } });
    assert.equal((await shell.exec('relay')).exitCode, 0); assert.equal(entered, 0); assert.equal(failures, 3); details.push({ entered, failures });
  },
  async S07() {
    limit(await capture(make().exec('let 1; let 1', { limits: { maxCommands: 1 } })), 'maxCommands');
    limit(await capture(make().exec('let 1', { limits: { maxSourceBytes: 4 } })), 'maxSourceBytes');
    details.push({ exactLimits: ['maxCommands', 'maxSourceBytes'] });
  },
  async S08() {
    const shell = make(); let first, second;
    shell.register({ name: 'relay', async execute(context) { first = await capture(context.invoke('let', ['1'])); second = await capture(context.invoke('let', ['1'])); return { exitCode: 0 }; } });
    const root = await capture(shell.exec('relay', { limits: { maxCommands: 2 } }));
    successful(first); limit(second, 'maxCommands'); equalReason(root, second.reason); details.push({ first: first.value, sharedReason: true });
  },
  async S09() {
    const shell = make(); let child;
    shell.register({ name: 'nested', async execute(context) { child = await capture(context.invoke('let', ['1'])); if (child.kind === 'throw') throw child.reason; return child.value; } });
    shell.register({ name: 'relay', execute(context) { return context.invoke('nested', []); } });
    limit(await capture(shell.exec('relay', { limits: { maxSubstitutionDepth: 1 } })), 'maxSubstitutionDepth'); limit(child, 'maxSubstitutionDepth');
    limit(await capture(make().exec("eval 'let 1'", { limits: { maxSourceBytes: 12 } })), 'maxSourceBytes'); details.push({ limits: ['maxSubstitutionDepth', 'maxSourceBytes'] });
  },
  async S10() {
    successful(await capture(make().exec('let 1', { limits: { maxOutputBytes: 0 } })));
    limit(await capture(make().exec("let '1/0'", { limits: { maxOutputBytes: 0 } })), 'maxOutputBytes');
    const release = gate(), entered = gate(); let writes = 0;
    const done = observe(make().exec("let '1/0'", { stderr: { async write() { writes++; entered.resolve(); await release.promise; } } }));
    await waitEntry(entered, done); await stillPending(done); release.resolve(); successful(await done, 1); assert.equal(writes, 1); details.push({ diagnosticWrites: writes, awaited: true });
  },
  async S11() { limit(await capture(make().exec('let 1 1', { limits: { maxExpansionFields: 2 } })), 'maxExpansionFields'); },
  async S12() {
    for (const [args, fields] of [[['n=1', '1'], 2], [{}, 8], [[9], 8], [['1\0'], 8]]) {
      const shell = make(); let state, activated = false;
      watchBuiltin((_runtime, context, value) => { if (context.command === 'let') state = value; });
      shell.use((context, next) => { if (context.command === 'seed') { activated = true; Object.assign(context, { command: 'let', args }); } return next(); });
      const result = await capture(shell.exec('seed', { limits: { maxExpansionFields: fields } }));
      details.push({ forwarded: Array.isArray(args) ? args : 'not-array', fields, invoked: activated, storedN: state?.variables.n, outcome: result.kind }); assert.equal(activated, true);
      if (fields === 2) limit(result, 'maxExpansionFields'); else { successful(result, 2); assert.equal(result.value.stdout, ''); assert.match(result.value.stderr, /let:/u); }
      assert.equal(state?.variables.n, undefined);
    }
  },
  async S13() {
    for (const [args, bytes, rejected] of [[['\u00a0\u00a01'], 4, true], [['1+2', '1+2'], 3, false]]) {
      const shell = make(); let active = false;
      shell.use((context, next) => { if (context.command === 'x') { active = true; Object.assign(context, { command: 'let', args }); } return next(); });
      const result = await capture(shell.exec('x', { limits: { maxExpansionBytes: bytes } })); assert.equal(active, true);
      if (rejected) limit(result, 'maxExpansionBytes'); else successful(result);
      details.push({ active, bytes, operandBytes: args.map(value => Buffer.byteLength(value)), rejected });
    }
  },
  async S14() {
    limit(await capture(make({ env: { v: 'w', w: '1+1+1' } }).exec('let v', { limits: { maxExpansionBytes: 4 } })), 'maxExpansionBytes');
    successful(await capture(make({ env: { v: 'w', w: '1+1' } }).exec('let v', { limits: { maxExpansionBytes: 4 } })));
  },
  async S15() {
    for (const count of [64, 65]) {
      const env = Object.fromEntries(Array.from({ length: count }, (_, index) => [`n${index}`, index === count - 1 ? '1' : `n${index + 1}`]));
      const result = await make({ env }).exec('let n0'); assert.equal(result.exitCode, count === 64 ? 0 : 1);
      assert.equal(result.stderr, count === 64 ? '' : 'shell: line 1: let: Arithmetic variable recursion\n'); details.push({ names: count, status: result.exitCode });
    }
  },
  async S16() {
    const env = { a0: '1' }; for (let index = 1; index <= 12; index++) env[`a${index}`] = `a${index - 1}+a${index - 1}`;
    const positive = await make({ env }).exec('let a11 a11'); assert.equal(positive.exitCode, 0); assert.equal(positive.stderr, '');
    const negative = await make({ env }).exec('let a12'); assert.equal(negative.exitCode, 1); assert.equal(negative.stderr, 'shell: line 1: let: Arithmetic operation limit exceeded\n');
    details.push({ positiveArguments: 2, visitsPerPositive: 8190, negativeStatus: 1 });
  },
  async S17() {
    const below = '('.repeat(63) + '1' + ')'.repeat(63), above = '('.repeat(64) + '1' + ')'.repeat(64);
    assert.throws(() => arithmetic.prepareArithmetic(above), error => error instanceof ShellSyntaxError && error.reason === 'Arithmetic nesting exceeds 64');
    const positive = await make().exec(`let '${below}'; printf ok`); assert.equal(positive.exitCode, 0); assert.equal(positive.stdout, 'ok');
    const negative = await make().exec(`let '${above}'; printf decoy`); assert.equal(negative.exitCode, 2); assert.equal(negative.stdout, ''); assert.match(negative.stderr, /Arithmetic nesting exceeds 64/u);
    details.push({ positivePairs: 63, structuralPairs: 64, noDecoy: true });
  },
  async S18() {
    let writes = 0; replace(Runtime.prototype, 'writeVariable', original => function (...args) { if (args[1] === 'n') writes++; return original.apply(this, args); });
    for (const reason of [{ kind: 'caller' }, new FsError('ECANCELED'), null, false, 0, '', Symbol('caller')]) {
      const controller = new AbortController(); controller.abort(reason);
      equalReason(await capture(make({ env: { n: '0' } }).exec("let 'n=1'", { signal: controller.signal })), reason);
      details.push({ reasonType: typeof reason, identity: true });
    }
    assert.equal(writes, 0); details.push({ writes });
  },
  async S19() { await checkpointCase(false); },
  async S20() { await checkpointCase(true); },
  async S21() {
    const shell = make(), caller = new Error('caller'), execution = new Error('execution'), cleanup = new Error('cleanup');
    const controller = new AbortController(), events = [];
    shell.use((context, next) => { if (context.command !== 'let') return next(); context.registerCleanup(() => { events.push('cleanup'); throw cleanup; }); events.push('abort'); controller.abort(caller); events.push('throw-execution'); throw execution; });
    equalReason(await capture(shell.exec('let 1', { signal: controller.signal })), caller); assert.deepEqual(events, ['abort', 'throw-execution', 'cleanup']); details.push({ events, exactCaller: true });
  },
  async S22() {
    const outcomes = [];
    for (const command of [':', 'let']) for (const throwHandler of [false, true]) {
      const shell = make(), marker = new Error('same-marker'), local = new AbortController(); local.abort(marker); let raw, parentLive;
      shell.register({ name: 'relay', async execute(context) { raw = await capture(context.invoke(command, command === 'let' ? ['1'] : [], { signal: local.signal })); parentLive = !context.signal.aborted; if (throwHandler) throw marker; return { exitCode: 0 }; } });
      const outer = await capture(shell.exec('relay')); equalReason(raw, marker); assert.equal(parentLive, true); successful(outer, throwHandler ? 1 : 0);
      assert.equal(outer.value.stderr, throwHandler ? 'shell: line 1: same-marker\n' : '');
      outcomes.push({ command, throwHandler, rawIdentity: true, parentLive, exitCode: outer.value.exitCode });
    }
    details.push({ outcomes });
  },
  async S23() {
    const shell = make(); let child;
    shell.register({ name: 'relay', async execute(context) { child = await capture(context.invoke('let', ['1', '1'])); return { exitCode: 0 }; } });
    const outer = await capture(shell.exec('relay', { limits: { maxExpansionFields: 2 } })); limit(child, 'maxExpansionFields'); equalReason(outer, child.reason);
    const aborted = make(), controller = new AbortController(), marker = new Error('caller-after-child'); let childResult;
    aborted.register({ name: 'relay', async execute(context) { childResult = await capture(context.invoke('let', ['1'])); controller.abort(marker); throw new Error('later-handler'); } });
    equalReason(await capture(aborted.exec('relay', { signal: controller.signal })), marker); successful(childResult); details.push({ retainedBudget: true, callerOverLaterHandler: true });
  },
  async S24() {
    const counters = [];
    for (const source of [':', 'let 1', "let '1/0'"]) {
      const count = { acquire: 0, next: 0, returned: 0 };
      const input = { [Symbol.asyncIterator]() { count.acquire++; return { async next() { count.next++; return { value: new Uint8Array([65]), done: false }; }, async return() { count.returned++; return { done: true }; } }; } };
      const shell = make(); await shell.exec(source, { stdin: input }); await shell.dispose(); assert.equal(count.next, 0); assert.ok(count.returned <= 1); counters.push(count);
    }
    assert.deepEqual(counters[1], counters[0]); assert.deepEqual(counters[2], counters[0]);
    const pipe = await make().exec('printf data | let 1'); assert.equal(pipe.exitCode, 0); assert.equal(pipe.stdout, ''); assert.equal(pipe.stderr, ''); details.push({ counters, pipelineSettled: true });
  },
  async S25() {
    for (const disposeDuring of [false, true]) {
      const shell = make(), entered = gate(), release = gate();
      shell.use((context, next) => { if (context.command === 'let') context.registerCleanup(async () => { entered.resolve(); await release.promise; }); return next(); });
      const done = observe(shell.exec('let 1')); await waitEntry(entered, done); await stillPending(done);
      const disposed = disposeDuring ? observe(shell.dispose()) : null; if (disposed) await stillPending(disposed);
      release.resolve(); const outcome = await done; if (!disposeDuring) successful(outcome); if (disposed) await disposed;
      details.push({ disposeDuring, rootKind: outcome.kind, cleanupDelayedSettlement: true });
    }
    for (const withExecution of [false, true]) {
      const shell = make(), cleanup = new Error('owned-cleanup'), execution = new ShellLimitError('maxCommands');
      shell.use((context, next) => { if (context.command === 'let') { context.registerCleanup(() => { throw cleanup; }); if (withExecution) throw execution; } return next(); });
      equalReason(await capture(shell.exec('let 1')), withExecution ? execution : cleanup); details.push({ withExecution, identity: true });
    }
    const childShell = make(), marker = new Error('child-owned-cleanup'); let raw;
    childShell.use((context, next) => { if (context.command === 'let') context.registerCleanup(() => { throw marker; }); return next(); });
    childShell.register({ name: 'relay', async execute(context) { raw = await capture(context.invoke('let', ['1'])); return { exitCode: 0 }; } });
    const root = await capture(childShell.exec('relay')); successful(raw); equalReason(root, marker); details.push({ rawChildStatus: raw.value.exitCode, rootCleanupIdentity: true });
  },
  async S26() {
    for (const command of [':', 'let']) {
      const shell = make(), entered = gate(), release = gate(); let child;
      shell.use((context, next) => { if (context.command === command) context.registerCleanup(async () => { entered.resolve(); await release.promise; }); return next(); });
      shell.register({ name: 'relay', execute(context) { child = observe(context.invoke(command, command === 'let' ? ['1'] : [])); return { exitCode: 0 }; } });
      const root = observe(shell.exec('relay')); await waitEntry(entered, root); await stillPending(root); await stillPending(child); release.resolve(); successful(await child); successful(await root); await shell.dispose();
      details.push({ command, childAndRootDrained: true });
    }
  },
};

async function checkpointCase(duringEvaluation) {
  const controller = new AbortController(), marker = { kind: 'checkpoint-caller' };
  let scheduled = 0, fired = 0, state, active = false; const writes = [];
  replace(Runtime.prototype, 'builtin', original => async function (...args) {
    if (args[0].command !== 'let') return original.apply(this, args);
    state = args[1]; active = true; try { return await original.apply(this, args); } finally { active = false; }
  });
  replace(Runtime.prototype, 'writeVariable', original => function (...args) { if (active && args[1] === 'count') writes.push(args[2]); return original.apply(this, args); });
  replace(globalThis, 'setImmediate', original => function (callback, ...args) {
    const ordinal = active ? ++scheduled : 0;
    return original(() => { if (ordinal) { fired++; if (ordinal === (duringEvaluation ? 2 : 1)) controller.abort(marker); } callback(...args); });
  });
  const operand = duringEvaluation ? 'count+=1' : 'count=1';
  const source = (duringEvaluation ? 'value=7 ' : '') + 'let ' + Array(130).fill(`'${operand}'`).join(' ');
  const shell = make({ env: { count: '0', value: '2' } }); const result = await capture(shell.exec(source, { signal: controller.signal }));
  details.push({ scheduled, fired, writes: writes.length, count: state?.variables.count, restoredPrefix: state?.variables.value, outcome: result.kind });
  equalReason(result, marker); assert.ok(fired >= (duringEvaluation ? 2 : 1)); assert.ok(state);
  assert.equal(state.variables.count, duringEvaluation ? '128' : '0'); assert.equal(writes.length, duringEvaluation ? 128 : 0);
  assert.equal(state.variables.value, '2');
}

const observation = { id, family: frozen.find(row => row.id === id).family, pass: false, settled: false, disposed: false, details };
try { await procedures[id](); observation.pass = true; }
catch (error) { observation.failure = failure(error); process.stdout.write(JSON.stringify({ diagnostic: { id, phase: 'before-dispose', failure: observation.failure } }) + '\n'); }
finally {
  for (const release of releases) release();
  for (const restore of restorers.reverse()) restore();
  const disposal = await Promise.all(shells.map(shell => capture(shell.dispose())));
  await Promise.all(pending);
  observation.settled = true; observation.disposed = true;
  observation.disposals = disposal.map(result => result.kind === 'throw' ? { kind: 'throw', error: failure(result.reason) } : { kind: 'return' });
  if (disposal.some(result => result.kind === 'throw')) { observation.pass = false; observation.disposalFailure = 'unexpected final dispose rejection'; }
  process.stdout.write(JSON.stringify({ observation }) + '\n');
  activationReceipt();
  process.stdout.write(JSON.stringify({ summary: { cases: 1, pass: observation.pass ? 1 : 0, failed: observation.pass ? [] : [id], complete: true } }) + '\n');
  if (!observation.pass) process.exitCode = 1;
}
