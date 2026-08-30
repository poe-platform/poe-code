import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const manifest = JSON.parse(readFileSync(process.env.LET_BINDING));
const root = manifest.root;
const target = manifest.layout === 'moved' ? import.meta.resolve('virtual-bash') : pathToFileURL(resolve(root, 'dist/index.js')).href;
assert.equal(target, pathToFileURL(resolve(root, 'dist/index.js')).href);
const { Shell, MemoryFileSystem, agentCommands, ShellLimitError, FsError } = await import(target);
const { Runtime } = await import(pathToFileURL(resolve(root, 'dist/shell/runtime.js')));
const { prepareArithmetic } = await import(pathToFileURL(resolve(root, 'dist/shell/arithmetic.js')));
const frozen = JSON.parse(readFileSync(process.env.LET_CASES));
const capture = promise => Promise.resolve(promise).then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
const deferred = () => { let release; const promise = new Promise(resolvePromise => { release = resolvePromise; }); return { promise, release }; };
const turn = () => new Promise(resolveTurn => setImmediate(resolveTurn));
const entries = [];
let resources;
let detail;
const make = options => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: 'C', TZ: 'UTC' }, ...options }).use(agentCommands());
  resources.push(shell);
  return shell;
};
const add = (id, execute) => entries.push({ id, execute });
const expectLimit = (outcome, limit) => {
  detail.outcome = { kind: outcome.kind, name: outcome.reason?.name, limit: outcome.reason?.limit };
  assert.equal(outcome.kind, 'throw');
  assert(outcome.reason instanceof ShellLimitError);
  assert.equal(outcome.reason.limit, limit);
};
for (const row of frozen) add(row.id, async () => {
  const shell = make({ limits: { maxCommands: 64, maxSourceBytes: 32768, maxOutputBytes: 16384, maxExpansionFields: 512, maxExpansionBytes: 4096, ...row.limits } });
  const result = await shell.exec(row.script);
  detail.result = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  assert.equal(result.stdout, row.stdout); assert.equal(result.stderr, row.stderr); assert.equal(result.exitCode, row.exitCode);
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(row.stdout));
  assert.deepEqual(result.stderrBytes, new TextEncoder().encode(row.stderr));
});
add('A01-registry', async () => {
  const shell = make();
  detail.setup = await shell.exec(':');
  assert.equal(detail.setup.exitCode, 0);
  const original = shell.commands.list().map(entry => entry.name).sort();
  let pluginCalls = 0;
  shell.register({ name: 'let', execute() { pluginCalls++; return { exitCode: 9 }; } });
  const registered = shell.commands.list().map(entry => entry.name).sort();
  const result = await shell.exec('type let; let 1');
  detail.result = result; detail.pluginCalls = pluginCalls; detail.defaultNames = original;
  assert.equal(result.stdout, 'let is a shell builtin\n'); assert.equal(result.exitCode, 0); assert.equal(pluginCalls, 0);
  assert.deepEqual(shell.commands.list().map(entry => entry.name).sort(), registered);
  assert(!original.includes('let'));
});
add('A02-stores', async () => {
  const shell = make(); const writes = [];
  const original = Runtime.prototype.writeVariable;
  Runtime.prototype.writeVariable = function(state, name, value, origin) { if (origin === 'arithmetic') writes.push([name, value, origin]); return original.call(this, state, name, value, origin); };
  try {
    const result = await shell.exec("let 'n=2' 'old=n++' 'n+=3'");
    detail.writes = writes; detail.result = result;
    assert.equal(result.exitCode, 0);
    assert.deepEqual(writes, [['n', '2', 'arithmetic'], ['n', '3', 'arithmetic'], ['old', '2', 'arithmetic'], ['n', '6', 'arithmetic']]);
  } finally { Runtime.prototype.writeVariable = original; }
});
add('A03-readonly-cursor', async () => {
  const shell = make(); const original = Runtime.prototype.builtin;
  Runtime.prototype.builtin = async function(context, state, ...rest) {
    if (context.command !== 'let') return original.call(this, context, state, ...rest);
    const before = structuredClone(state.getopts);
    try { return await original.call(this, context, state, ...rest); }
    finally { detail.before = before; detail.after = structuredClone(state.getopts); detail.readonly = state.readonlyVariables.has('OPTIND'); }
  };
  try {
    detail.result = await shell.exec("set -- -ab; getopts ab option; readonly OPTIND; let 'OPTIND=1'");
    assert.equal(detail.result.exitCode, 1); assert.equal(detail.readonly, true); assert.deepEqual(detail.after, detail.before);
  } finally { Runtime.prototype.builtin = original; }
});
add('A04-invoke-isolation', async () => {
  const shell = make({ env: { value: '2' } }); const calls = [];
  shell.register({ name: 'relay', async execute(context) {
    const args = ['value=9'];
    calls.push(await context.invoke('let', args)); assert.deepEqual(args, ['value=9']);
    calls.push(await context.invoke('let', ['value=$(printf 9)']));
    return { exitCode: 0 };
  } });
  const result = await shell.exec('relay; printf "%s\\n" "$value"');
  detail.calls = calls; detail.result = result;
  assert.deepEqual(calls, [{ exitCode: 0 }, { exitCode: 1 }]); assert.equal(result.stdout, '2\n');
});
for (const [label, args] of [['number', [1]], ['nul', ['1\0']], ['nonarray', {}]]) add(`A05-invoke-${label}`, async () => {
  const shell = make(); let outcome;
  shell.register({ name: 'relay', async execute(context) { outcome = await capture(context.invoke('let', args)); return { exitCode: 0 }; } });
  detail.result = await shell.exec('relay'); detail.raw = { kind: outcome.kind, name: outcome.reason?.name, message: outcome.reason?.message };
  assert.equal(detail.result.exitCode, 0); assert.equal(outcome.kind, 'throw'); assert(outcome.reason instanceof TypeError);
});
for (const [label, script, limits, limit] of [
  ['commands', 'let 1; let 1', { maxCommands: 1 }, 'maxCommands'],
  ['source', 'let 1', { maxSourceBytes: 4 }, 'maxSourceBytes'],
  ['fields', 'let 1 1', { maxExpansionFields: 2 }, 'maxExpansionFields'],
  ['diagnostic-output', 'let 1/0', { maxOutputBytes: 0 }, 'maxOutputBytes'],
]) add(`A06-${label}`, async () => { expectLimit(await capture(make({ limits }).exec(script)), limit); });
add('A07-shared-child-budget', async () => {
  const shell = make({ limits: { maxCommands: 2 } }); let first; let second;
  shell.register({ name: 'relay', async execute(context) { first = await context.invoke('let', ['1']); second = await capture(context.invoke('let', ['1'])); return { exitCode: 0 }; } });
  const outcome = await capture(shell.exec('relay')); detail.first = first;
  assert.deepEqual(first, { exitCode: 0 }); expectLimit(second, 'maxCommands'); expectLimit(outcome, 'maxCommands'); assert.equal(outcome.reason, second.reason);
});
const forwarded = (args, limits = {}) => {
  const shell = make({ limits });
  shell.use((context, next) => { if (context.command === 'x') { context.command = 'let'; context.args = args; } return next(); });
  return shell;
};
add('A08-forward-fields', async () => { expectLimit(await capture(forwarded(['n=1', '1'], { maxExpansionFields: 2 }).exec('x')), 'maxExpansionFields'); });
add('A09-forward-bytes', async () => { expectLimit(await capture(forwarded(['\u00a0\u00a01'], { maxExpansionBytes: 4 }).exec('x')), 'maxExpansionBytes'); });
add('A10-per-operand', async () => { detail.result = await forwarded(['1+2', '1+2'], { maxExpansionBytes: 3 }).exec('x'); assert.equal(detail.result.exitCode, 0); });
for (const [label, args] of [['number', [1]], ['nul', ['1\0']], ['nonarray', {}]]) add(`A11-forward-${label}`, async () => {
  detail.result = await forwarded(args).exec('x'); assert.equal(detail.result.exitCode, 2); assert.equal(detail.result.stdout, ''); assert.match(detail.result.stderr, /let: argument/u);
});
for (const [label, expression, rejects] of [['negative', '1+1+1', true], ['positive', '1+1', false]]) add(`A12-recursive-${label}`, async () => {
  const outcome = await capture(make({ env: { v: 'w', w: expression }, limits: { maxExpansionBytes: 4 } }).exec('let v'));
  if (rejects) expectLimit(outcome, 'maxExpansionBytes'); else { detail.result = outcome.value; assert.equal(outcome.kind, 'return'); assert.equal(outcome.value.exitCode, 0); }
});
for (const length of [64, 65]) add(`A13-recursion-${length}`, async () => {
  const env = Object.fromEntries(Array.from({ length }, (_, index) => [`n${index}`, index + 1 === length ? '1' : `n${index + 1}`]));
  detail.result = await make({ env }).exec('let n0');
  assert.equal(detail.result.exitCode, length === 64 ? 0 : 1);
  if (length === 65) assert.equal(detail.result.stderr, 'shell: line 1: let: Arithmetic variable recursion\n');
});
for (const level of [11, 12]) add(`A14-steps-${level}`, async () => {
  const env = { a0: '1' }; for (let index = 1; index <= level; index++) env[`a${index}`] = `a${index - 1}+a${index - 1}`;
  detail.result = await make({ env }).exec(level === 11 ? 'let a11 a11' : 'let a12');
  assert.equal(detail.result.exitCode, level === 11 ? 0 : 1);
  if (level === 12) assert.equal(detail.result.stderr, 'shell: line 1: let: Arithmetic operation limit exceeded\n');
});
for (const depth of [63, 64]) add(`A15-structural-${depth}`, async () => {
  const expression = '('.repeat(depth) + '1' + ')'.repeat(depth);
  if (depth === 64) assert.throws(() => prepareArithmetic(expression), error => error.name === 'ShellSyntaxError' && error.reason === 'Arithmetic nesting exceeds 64');
  detail.result = await make().exec(`let '${expression}'; printf decoy`);
  assert.equal(detail.result.exitCode, depth === 63 ? 0 : 2); assert.equal(detail.result.stdout, depth === 63 ? 'decoy' : '');
});
for (const [label, reason] of [['object', { caller: true }], ['fs', new FsError('ECANCELED')], ['null', null], ['false', false], ['zero', 0], ['empty', ''], ['symbol', Symbol('caller')]]) add(`A16-preabort-${label}`, async () => {
  const controller = new AbortController(); controller.abort(reason);
  const outcome = await capture(make().exec("let 'n=1'", { signal: controller.signal }));
  detail.kind = outcome.kind; detail.identity = Object.is(outcome.reason, reason);
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason);
});
for (const checkpoint of [1, 2]) add(`A17-checkpoint-${checkpoint}`, async () => {
  const controller = new AbortController(); const reason = { checkpoint };
  const shell = make({ env: { count: '0', value: '2' } });
  const originalBuiltin = Runtime.prototype.builtin; const originalImmediate = globalThis.setImmediate;
  let scheduled = 0; let stateSeen; let active = false;
  Runtime.prototype.builtin = async function(context, state, ...rest) {
    if (context.command !== 'let') return originalBuiltin.call(this, context, state, ...rest);
    stateSeen = state; active = true;
    try { return await originalBuiltin.call(this, context, state, ...rest); } finally { active = false; }
  };
  globalThis.setImmediate = (callback, ...args) => {
    const cancel = active && ++scheduled === checkpoint;
    return originalImmediate(() => { if (cancel) controller.abort(reason); callback(...args); });
  };
  try {
    const outcome = await capture(shell.exec(`value=7 let ${Array(130).fill("'count+=1'").join(' ')}`, { signal: controller.signal }));
    detail.scheduled = scheduled; detail.kind = outcome.kind; detail.identity = Object.is(outcome.reason, reason); detail.state = { count: stateSeen?.variables.count, value: stateSeen?.variables.value };
    assert.equal(scheduled, checkpoint, 'ACTUAL_CHECKPOINT'); assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason);
    assert.equal(stateSeen.variables.count, checkpoint === 1 ? '0' : '128'); assert.equal(stateSeen.variables.value, '2');
  } finally { Runtime.prototype.builtin = originalBuiltin; globalThis.setImmediate = originalImmediate; }
});
add('A18-caller-cleanup-priority', async () => {
  const controller = new AbortController(); const caller = {}; const execution = new Error('execution'); const cleanup = new Error('cleanup'); const events = [];
  const shell = make();
  shell.use(context => { context.registerCleanup(async () => { events.push('cleanup'); throw cleanup; }); events.push('abort'); controller.abort(caller); events.push('throw'); throw execution; });
  const outcome = await capture(shell.exec('let 1', { signal: controller.signal }));
  detail.events = events; detail.identity = Object.is(outcome.reason, caller);
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, caller); assert.deepEqual(events, ['abort', 'throw', 'cleanup']);
});
for (const throwHandler of [false, true]) add(`A19-raw-boundary-${throwHandler}`, async () => {
  const shell = make(); const reason = new Error('same-marker'); const controller = new AbortController(); controller.abort(reason); let raw;
  shell.register({ name: 'relay', async execute(context) { raw = await capture(context.invoke('let', ['1'], { signal: controller.signal })); if (throwHandler) throw reason; return { exitCode: 0 }; } });
  const result = await shell.exec('relay'); detail.rawIdentity = Object.is(raw.reason, reason); detail.result = result;
  assert.equal(raw.kind, 'throw'); assert.equal(raw.reason, reason); assert.equal(result.exitCode, throwHandler ? 1 : 0);
  assert.equal(result.stderr, throwHandler ? 'shell: line 1: same-marker\n' : '');
});
add('A20-diagnostic-backpressure', async () => {
  const shell = make(); const entered = deferred(); const release = deferred(); let settled = false;
  const pending = capture(shell.exec('let 1/0', { stderr: { async write() { entered.release(); await release.promise; } } })).then(result => { settled = true; return result; });
  try {
    await Promise.race([entered.promise, pending]); await turn(); detail.pendingBeforeRelease = !settled;
    assert.equal(settled, false); release.release(); const outcome = await pending;
    detail.result = outcome.value; assert.equal(outcome.value.exitCode, 1);
  } finally { release.release(); await pending; }
});
add('A21-owned-cleanup', async () => {
  const shell = make(); const entered = deferred(); const release = deferred(); let settled = false;
  shell.use((context, next) => { context.registerCleanup(async () => { entered.release(); await release.promise; }); return next(); });
  const pending = capture(shell.exec('let 1')).then(result => { settled = true; return result; });
  try { await Promise.race([entered.promise, pending]); await turn(); detail.pendingBeforeRelease = !settled; assert.equal(settled, false); release.release(); assert.equal((await pending).value.exitCode, 0); }
  finally { release.release(); await pending; }
});
add('A22-cleanup-rejection', async () => {
  const shell = make(); const reason = new Error('owned cleanup');
  shell.use((context, next) => { context.registerCleanup(async () => { throw reason; }); return next(); });
  const outcome = await capture(shell.exec('let 1')); detail.identity = Object.is(outcome.reason, reason); assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason);
});
add('A23-child-drain', async () => {
  const shell = make(); const entered = deferred(); const release = deferred(); let settled = false; let child;
  shell.use((context, next) => { if (context.command === 'let') context.registerCleanup(async () => { entered.release(); await release.promise; }); return next(); });
  shell.register({ name: 'relay', execute(context) { child = capture(context.invoke('let', ['1'])); return { exitCode: 0 }; } });
  const pending = capture(shell.exec('relay')).then(result => { settled = true; return result; });
  try { await Promise.race([entered.promise, pending]); await turn(); detail.pendingBeforeRelease = !settled; assert.equal(settled, false); release.release(); detail.child = await child; detail.root = await pending; assert.equal(detail.child.kind, 'return'); assert.equal(detail.root.value.exitCode, 0); }
  finally { release.release(); await child; await pending; }
});
for (const script of ['let 1', 'let 1/0']) add(`A24-stdin-${script}`, async () => {
  const shell = make(); const counts = { acquire: 0, next: 0, returned: 0 };
  const stdin = { [Symbol.asyncIterator]() { counts.acquire++; return { async next() { counts.next++; return { done: true }; }, async return() { counts.returned++; return { done: true }; } }; } };
  detail.result = await shell.exec(script, { stdin }); detail.counts = counts; assert.equal(counts.next, 0); assert.equal(counts.returned, counts.acquire);
});
add('A25-pipe', async () => { detail.result = await make().exec('printf data | let 1'); assert.equal(detail.result.exitCode, 0); assert.equal(detail.result.stdout, ''); });
const selected = process.env.LET_IDS?.split(',');
const observations = [];
for (const entry of entries) {
  if (selected && !selected.includes(entry.id)) continue;
  resources = []; detail = {};
  const observation = { id: entry.id, detail, pass: false, disposed: 0 };
  try { await entry.execute(); observation.pass = true; }
  catch (error) { observation.failure = { name: error?.name, message: error?.message ?? String(error), stack: error?.stack }; }
  finally {
    for (const shell of resources) {
      try { await shell.dispose(); observation.disposed++; }
      catch (error) { observation.pass = false; observation.disposalFailure = String(error); }
    }
  }
  observation.created = resources.length;
  observations.push(observation); console.log(JSON.stringify({ observation }));
  if (observation.disposalFailure) break;
}
if (selected) assert.equal(observations.length, selected.length);
for (const [filename, expected] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(resolve(root, filename))).digest('hex'), expected, `POST:${filename}`);
console.log(JSON.stringify({ summary: { layout: manifest.layout, loaded: target, cases: observations.length, pass: observations.filter(row => row.pass).length, failed: observations.filter(row => !row.pass).map(row => row.id), createdShells: observations.reduce((total, row) => total + row.created, 0), disposedShells: observations.reduce((total, row) => total + row.disposed, 0), nativeExecutions: 0 } }));
if (observations.some(row => !row.pass)) process.exitCode = 1;
