import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Runtime } from './node_modules/virtual-bash/dist/shell/runtime.js';
import { ArrayLedger, ArrayOwner, ArrayFailure } from './node_modules/virtual-bash/dist/shell/arrays/ledger.js';
import { IndexedBinding, BindingStore, textToken } from './node_modules/virtual-bash/dist/shell/arrays/bindings.js';
import { StateMonitor, stateMonitor, arrayStore } from './node_modules/virtual-bash/dist/shell/arrays/state.js';
import { installTerminalObserver } from './observer-v2.mjs';
import { gate, patches } from './instrumentation.mjs';
import * as baseline from './mechanism-adapter-v1.mjs';
export { observeTerminalState } from './terminal-adapter-v2.mjs';

export const candidate = 'c0adae539c736db0e4023d401562ce958d9ebb00';
export const supportedIds = ['O11', ...Array.from({ length: 22 }, (_, index) => `M${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 10 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`)];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requiredLoads = ['runtime', 'arrays/ledger', 'arrays/bindings', 'arrays/state'].map(name => {
  const filename = fileURLToPath(new URL(`./node_modules/virtual-bash/dist/shell/${name}.js`, import.meta.url));
  return { path: filename, sha256: hash(fs.readFileSync(filename)) };
});
function bindingValue(state, name = 'a') {
  const binding = arrayStore(state)?.get(name);
  return binding ? [...binding.values].map(([index, item]) => [index, item.text.value]).sort((left, right) => left[0] - right[0]) : [];
}
async function actualRuntime(api, action, options = {}) {
  const changes = patches(), controller = new AbortController(), observed = [], release = [];
  let frame, callback, reached = 0, execution, primary;
  changes.replace(Runtime.prototype, 'script', original => function (script, state, io) {
    frame ??= { runtime: this, state, io };
    return Reflect.apply(original, this, [script, state, io]);
  });
  const terminal = installTerminalObserver({ monitorPrototype: StateMonitor.prototype, ownerPrototype: ArrayOwner.prototype, ownerFor: monitor => monitor.session.owner, isRoot: owner => owner.parent === undefined, capture: monitor => ({ monitor, ledger: monitor.session.ledger }), terminal: observation => observation });
  const shell = new api.Shell({ fs: new api.MemoryFileSystem(), ...(options.limits ? { limits: options.limits } : {}) });
  shell.register({ name: '__drive', async execute(context) {
    assert.equal(++reached, 1); assert.ok(frame);
    const finished = gate();
    context.registerCleanup(async () => { for (const current of release) current(); await finished.promise; });
    try { callback = { value: await action({ ...frame, context, shell, controller, changes, release, observed }) }; }
    catch (reason) { callback = { reason }; if (options.phaseFailure) throw reason; }
    finally { finished.release(); }
    return { exitCode: 0 };
  } });
  shell.register({ name: '__noop', execute() { return { exitCode: 0 }; } });
  try {
    execution = shell.exec(options.script ?? 'a=([0]=first [2147483647]=last); __drive', { signal: controller.signal });
    primary = await execution.then(value => ({ value }), reason => ({ reason }));
    assert.equal(reached, 1); assert.ok(callback);
    if (options.phaseFailure) {
      assert.ok(callback.reason instanceof ArrayFailure);
      assert.equal(primary.value?.exitCode, 1);
      assert.match(primary.value.stderr, /stale state snapshot/u);
      return { observed, phaseLocalStatus: 1, stderr: primary.value.stderr };
    }
    if (Object.hasOwn(callback, 'reason')) throw callback.reason;
    if (options.aborted) assert.equal(primary.reason, controller.signal.reason);
    else { assert.ok(Object.hasOwn(primary, 'value')); assert.equal(primary.value.exitCode, 0); assert.equal(primary.value.stderr, ''); }
    return { result: callback.value, primary: Object.hasOwn(primary, 'value') ? { exitCode: primary.value.exitCode } : { callerIdentity: true }, observed };
  } finally {
    for (const current of release) current();
    if (execution) await execution.catch(() => undefined);
    try {
      await shell.dispose(); const snapshot = await terminal.after();
      assert.ok(snapshot.roots.length > 0 && snapshot.monitors.length > 0, 'actual enrolled root must be observed');
      for (const root of snapshot.roots) assert.deepEqual(root.ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
      for (const monitor of snapshot.monitors) { assert.equal(monitor.store.bindings.size, 0); assert.equal(monitor.store.watches.size, 0); }
    } catch (reason) { throw Object.assign(new Error(`actual terminal cleanup failed: ${String(reason)}`), { unsafe: true }); }
    finally {
      try { changes.restore(); await terminal.close(); }
      catch (reason) { throw Object.assign(new Error(`observer retirement failed: ${String(reason)}`), { unsafe: true }); }
    }
  }
}
async function maximumScan(api) {
  return actualRuntime(api, async ({ runtime, state, changes }) => {
    let copied, scanHit = 0, atFailure; const reason = new ArrayFailure('private work limit exceeded');
    changes.replace(IndexedBinding.prototype, 'copy', original => function (...args) {
      const promise = Reflect.apply(original, this, args);
      void promise.then(value => { copied = value; }, () => undefined); return promise;
    });
    changes.replace(ArrayOwner.prototype, 'reserve', original => function (charge) {
      if (copied && Object.keys(charge).length === 1 && charge.work === 2) {
        scanHit++; atFailure = [...copied.values.keys()]; throw reason;
      }
      return Reflect.apply(original, this, [charge]);
    });
    await assert.rejects(runtime.unsetIndexed(state, 'a', 2147483647), error => error === reason);
    assert.equal(scanHit, 1); assert.deepEqual(atFailure, [0, 2147483647]);
    assert.deepEqual(bindingValue(state), [[0, 'first'], [2147483647, 'last']]);
    assert.equal(arrayStore(state).get('a').maximum, 2147483647);
    return { scanHit, atFailure, publicCapacityProof: false, instrumentation: 'exact scan admission throws before mutation; no numeric-range scan' };
  });
}
async function snapshotConflict(api) {
  return actualRuntime(api, async ({ runtime, state, io, context, shell, changes, release, observed }) => {
    const paused = gate(), resume = gate(); release.push(resume.release);
    const ledger = stateMonitor(state).session.ledger; let armed = true, hits = 0, childCalls = 0;
    shell.register({ name: '__snapshot_target', execute() { childCalls++; return { exitCode: 0 }; } });
    const before = ledger.snapshot();
    changes.replace(ArrayLedger.prototype, 'checkpoint', original => function (...args) {
      const pending = Reflect.apply(original, this, args);
      if (armed && this === ledger) { armed = false; hits++; paused.release(); return Promise.resolve(pending).then(() => resume.promise); }
      return pending;
    });
    const pending = context.invoke('__snapshot_target', []).then(value => ({ value }), reason => ({ reason }));
    try {
      await paused.promise;
      const old = stateMonitor(state).epoch;
      assert.equal(await runtime.builtin({ ...context, ...io, command: 'shopt', args: ['-s', 'dotglob'] }, state, new Map()), 0);
      assert.equal(state.dotglob, true); assert.notEqual(stateMonitor(state).epoch, old);
    } finally { resume.release(); }
    const outcome = await pending;
    assert.ok(Object.hasOwn(outcome, 'reason')); assert.match(String(outcome.reason), /stale state snapshot/u);
    assert.equal(hits, 1); assert.equal(childCalls, 0);
    assert.deepEqual(bindingValue(state), [[0, 'first'], [2147483647, 'last']]);
    observed.push({ hits, privateRejection: String(outcome.reason), before, after: ledger.snapshot(), instrumentation: 'one awaited checkpoint gate; actual shopt writer, no injected state/ledger' });
    throw outcome.reason;
  }, { phaseFailure: true });
}
async function precedence(api, abort = false, escaping = false) {
  const reason = Object.freeze({ kind: abort ? 'array-publication-caller' : 'array-expansion-escape' });
  return actualRuntime(api, async ({ runtime, state, context, io, controller }) => {
    let effects = 0;
    const outcome = await runtime.arrayZero(state, 'a', async () => {
      effects++;
      await runtime.arrayZero(state, 'a', async () => 'newer');
      assert.equal(await runtime.builtin({ ...context, ...io, command: 'readonly', args: ['a'] }, state, new Map()), 0);
      if (abort) controller.abort(reason);
      if (escaping) throw reason;
      return 'outer';
    }).then(value => ({ value }), error => ({ error }));
    assert.equal(effects, 1); assert.ok(Object.hasOwn(outcome, 'error'));
    if (abort || escaping) assert.equal(outcome.error, reason);
    else assert.match(String(outcome.error), /readonly binding/u);
    assert.deepEqual(bindingValue(state), [[0, 'newer'], [2147483647, 'last']]);
    return { effects, selected: abort ? 'caller identity' : escaping ? 'escaping identity' : 'readonly before stale', retained: bindingValue(state) };
  }, { aborted: abort });
}
async function nestedRetirement(api) {
  let closing, afterRequest = false, root, admissionsAfterRequest = 0; const publications = [];
  let lastWatch, retainedBinding;
  const result = await actualRuntime(api, async ({ state, changes, controller }) => {
    root = stateMonitor(state).session.owner;
    const store = arrayStore(state), operation = ArrayOwner.create(root.ledger, root);
    const firstWatch = await store.watch('absent_witness', operation, controller.signal);
    lastWatch = await store.watch('absent_witness', operation, controller.signal);
    assert.equal(firstWatch.watch, lastWatch.watch); assert.equal(lastWatch.watch.observers, 2);
    firstWatch.close(); assert.equal(lastWatch.watch.observers, 1);
    retainedBinding = store.get('a').retain();
    operation.reserve().cleanup = () => retainedBinding.release();
    changes.replace(StateMonitor.prototype, 'publish', original => function (tickets, name, action) {
      const value = Reflect.apply(original, this, [tickets, name, action]);
      if (afterRequest && name === 'a') publications.push(this.store.get('a')?.get(0));
      return value;
    });
    changes.replace(ArrayLedger.prototype, 'reserve', original => function (...args) {
      if (afterRequest && this === root.ledger) admissionsAfterRequest++;
      return Reflect.apply(original, this, args);
    });
    afterRequest = true; closing = root.close(); assert.equal(root.close(), closing); assert.equal(root.close(), closing);
    return { request: 'actual array root close requested while both real function frames are live' };
  }, { script: 'a=([0]=outer [7]=shared); f() { local a; a=([0]=middle [7]=shared); g() { local a; a=([0]=inner [7]=shared); __drive; }; g; }; f' });
  await closing; assert.deepEqual(publications, ['middle', 'outer']); assert.equal(admissionsAfterRequest, 0);
  assert.equal(lastWatch.watch.observers, 0); assert.equal(lastWatch.store.watches.has('absent_witness'), false);
  assert.deepEqual(root.ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
  return { ...result, publications, admissionsAfterRequest, qualification: 'actual function restoration under premature private root-close request, not arbitrary Restoration.apply ordering' };
}
async function parentBudget(api) {
  const observations = [];
  for (const maxCommands of [2, 3]) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem(), limits: { maxCommands } }); let children = 0;
    shell.register({ name: '__walk', async execute(context) { await context.invoke('__leaf', []); return { exitCode: 0 }; } });
    shell.register({ name: '__leaf', execute() { children++; return { exitCode: 0 }; } });
    try {
      for (let count = 0; count < 2; count++) {
        const outcome = await shell.exec('a=([0]=x); __walk').then(value => ({ value }), error => ({ error }));
        if (maxCommands === 2) { assert.equal(outcome.error?.limit, 'maxCommands'); assert.equal(children, 0); }
        else { assert.equal(outcome.value?.exitCode, 0); assert.equal(children, count + 1); }
        observations.push({ maxCommands, run: count, childCalls: children, refused: maxCommands === 2 });
      }
    } finally { await shell.dispose(); }
  }
  return observations;
}
async function outputBoundaries(api) {
  const result = [];
  for (const maxOutputBytes of [4, 3]) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem(), limits: { maxOutputBytes } }); const writes = [];
    shell.register({ name: '__emit', async execute(context) { await context.stdout.write(new TextEncoder().encode(context.args[0])); return { exitCode: 0 }; } });
    try {
      const outcome = await shell.exec('a=([0]=😀); __emit "${a[@]}"', { stdout: { write(chunk) { writes.push([...chunk]); } } }).then(value => ({ value }), error => ({ error }));
      if (maxOutputBytes === 4) { assert.equal(outcome.value?.exitCode, 0); assert.deepEqual(writes, [[240,159,152,128]]); }
      else { assert.equal(outcome.error?.limit, 'maxOutputBytes'); assert.deepEqual(writes, []); }
      result.push({ maxOutputBytes, writes });
    } finally { await shell.dispose(); }
  }
  for (const mode of ['backpressure', 'sink-error', 'abort']) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }), entered = gate(), resume = gate(), controller = new AbortController(), reason = Object.freeze({ mode });
    let settled = false, writes = 0, after = 0, cleaned = 0, execution;
    shell.register({ name: '__emit', async execute(context) { context.registerCleanup(() => { cleaned++; resume.release(); }); await context.stdout.write(new TextEncoder().encode(context.args[0])); after++; return { exitCode: 0 }; } });
    try {
      execution = shell.exec('a=([0]=😀); __emit "${a[@]}"', { signal: controller.signal, stdout: { async write() { writes++; entered.release(); await resume.promise; if (mode === 'sink-error') throw reason; } } }).then(value => ({ value }), error => ({ error }));
      execution.then(() => { settled = true; }); await entered.promise; assert.equal(settled, false);
      if (mode === 'abort') controller.abort(reason); else resume.release();
      const outcome = await execution; assert.equal(writes, 1); assert.equal(cleaned, 1);
      if (mode === 'backpressure') { assert.equal(outcome.value?.exitCode, 0); assert.equal(after, 1); }
      else { assert.equal(outcome.error, reason); assert.equal(after, 0); }
      result.push({ mode, writes, after, cleaned, identity: mode !== 'backpressure' });
    } finally { resume.release(); if (execution) await execution; await shell.dispose(); }
  }
  return result;
}
async function acceptedWriters(api) {
  return actualRuntime(api, async ({ runtime, state, context, io }) => {
    await context.fs.mkdir('/next');
    const monitor = stateMonitor(state), events = [];
    for (const [command, args] of [['getopts',['a','flag','-a']], ['let',['counter=2']], ['shopt',['-s','dotglob']], ['pushd',['/next']], ['popd',[]]]) {
      const before = monitor.epoch;
      const status = await runtime.builtin({ ...context, ...io, command, args }, state, new Map());
      assert.equal(status, 0); assert.notEqual(monitor.epoch, before); events.push({ command, changed: true });
    }
    assert.equal(state.variables.flag, 'a'); assert.equal(state.variables.counter, '2'); assert.equal(state.dotglob, true); assert.equal(state.cwd, '/');
    const before = monitor.epoch, symbol = state.directoryStackCwdPublication;
    assert.equal(await runtime.builtin({ ...context, ...io, command: 'cd', args: ['/next'] }, state, new Map()), 0);
    assert.notEqual(monitor.epoch, before); assert.notEqual(state.directoryStackCwdPublication, symbol);
    const invoked = await context.invoke('__noop', []); assert.equal(invoked.exitCode, 0);
    assert.equal(state.cwd, '/next'); assert.equal(state.dotglob, true);
    return { events, cwd: state.cwd, dotglob: state.dotglob, qualification: 'selected supported CD/LET/getopts/dotglob/STACK writers only; old STACK C06/S13 qualifications remain' };
  });
}
async function scalarZeroBudget(api) {
  const changes = patches(); let reservations = 0, activations = 0;
  changes.replace(ArrayLedger.prototype, 'reserve', original => function (...args) { reservations++; return Reflect.apply(original, this, args); });
  changes.replace(StateMonitor.prototype, 'activate', original => function (...args) { activations++; return Reflect.apply(original, this, args); });
  const shell = new api.Shell({ fs: new api.MemoryFileSystem(), limits: { maxExpansionBytes: 0, maxExpansionFields: 64 } });
  try {
    const result = await shell.exec('a='); assert.equal(result.exitCode, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(reservations, 0); assert.equal(activations, 0);
    return { script: 'a=', reservations, activations, qualification: 'nonempty literal expansion may separately exhaust parent Budget; this zero-byte scalar assignment proves no blanket private zero-cap exec refusal' };
  } finally { try { await shell.dispose(); } finally { changes.restore(); } }
}
function sourceProof(manifest, ids) {
  const proofFile = path.join(manifest.harnessRoot, 'SOURCE-PROOFS.json'), proofs = JSON.parse(fs.readFileSync(proofFile));
  return ids.map(id => {
    const proof = proofs.find(row => row.id === id); assert.ok(proof);
    for (const premise of proof.premises) {
      const bound = manifest.sourceProjection.find(row => row.path === premise.path); assert.ok(bound);
      const bytes = fs.readFileSync(path.join(manifest.sourceRoot, premise.path)); assert.equal(hash(bytes), bound.sha256);
      assert.equal(bytes.toString().split(premise.literal).length, premise.occurrences + 1);
    }
    return { id, argument: proof.argument, limitation: proof.limitation, category: 'source-proof-not-dynamic-universal-claim' };
  });
}
export async function execute({ id, api, manifest }) {
  let dynamic, proofs = [];
  if (baseline.supportedIds.includes(id)) dynamic = await baseline.execute({ id, api });
  if (id === 'M10') dynamic.scalar = await scalarZeroBudget(api);
  if (id === 'M03') dynamic.restoration = await nestedRetirement(api);
  if (['M03','M07','M14','M15','M20','M21'].includes(id)) proofs = sourceProof(manifest, [id]);
  if (id === 'M08' || id === 'P05') dynamic = await nestedRetirement(api);
  if (id === 'M16') dynamic = await maximumScan(api);
  if (id === 'M17' || id === 'P03') dynamic = await snapshotConflict(api);
  if (id === 'M22' || id === 'P04') dynamic = { readonly: await precedence(api), caller: await precedence(api, true), escaping: await precedence(api, false, true) };
  if (id === 'P08') dynamic = { ledger: await baseline.execute({ id: 'M18', api }), parent: await parentBudget(api) };
  if (id === 'P09') dynamic = await outputBoundaries(api);
  if (id === 'P10') dynamic = await acceptedWriters(api);
  assert.ok(dynamic !== undefined || proofs.length > 0, 'no unimplemented adapter pass');
  return { category: dynamic === undefined ? 'candidate-source-proof' : 'actual-candidate-mechanism', requiredLoads, assertionsCompleted: true, disposed: true, dynamic, proofs, qualification: 'instrumented actual Runtime, loaded helpers and source argument categories remain explicit; no RSS/hard primitive preemption claim' };
}
