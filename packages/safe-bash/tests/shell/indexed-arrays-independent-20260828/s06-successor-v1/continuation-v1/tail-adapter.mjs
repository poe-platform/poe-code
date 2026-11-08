import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as original from './complete-adapter-original.mjs';
import { Runtime } from './node_modules/virtual-bash/dist/shell/runtime.js';
import { ArrayOwner } from './node_modules/virtual-bash/dist/shell/arrays/ledger.js';
import { StateMonitor, stateMonitor, arrayStore } from './node_modules/virtual-bash/dist/shell/arrays/state.js';
import { installTerminalObserver } from './observer-v2.mjs';
import { gate, patches } from './instrumentation.mjs';

export const candidate = original.candidate;
export const supportedIds = [...original.supportedIds, 'P11-U11'];
export const observeTerminalState = original.observeTerminalState;
const loads = ['runtime','arrays/ledger','arrays/state'].map(name => {
  const filename = fileURLToPath(new URL(`./node_modules/virtual-bash/dist/shell/${name}.js`, import.meta.url));
  return { path: filename, sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex') };
});
const valueOf = state => [...(arrayStore(state)?.get('a')?.values ?? [])].map(([index, item]) => [index, item.text.value]).sort((left, right) => left[0] - right[0]);
function unsafe(reason, facts) {
  const error = new Error(`tail observer/cleanup failure: ${String(reason)}`);
  error.unsafe = true; error.phaseDetails = facts; return error;
}
function failure(phases) {
  const error = new assert.AssertionError({ message: 'versioned affected-tail assertions failed', actual: phases.filter(row => !row.pass).map(row => row.phase), expected: [] });
  error.phaseDetails = phases; return error;
}
async function runtimeCapture(api, phase, action, aborted = false) {
  const changes = patches(), controller = new AbortController();
  const facts = { phase, script: 'a=([0]=first [2147483647]=last); __drive', entered: 0, registered: 0, cleanupCalls: 0, primary: 'unobserved', publicCallerIdentity: false, observerClosed: false };
  let frame, callback, primary, execution, terminal, shell, cleanupFailure;
  changes.replace(Runtime.prototype, 'script', old => function (script, state, io) { frame ??= { runtime: this, state, io }; return Reflect.apply(old, this, [script, state, io]); });
  try {
    terminal = installTerminalObserver({ monitorPrototype: StateMonitor.prototype, ownerPrototype: ArrayOwner.prototype, ownerFor: monitor => monitor.session.owner, isRoot: owner => owner.parent === undefined, capture: monitor => ({ monitor, ledger: monitor.session.ledger }), terminal: observation => observation });
    shell = new api.Shell({ fs: new api.MemoryFileSystem() });
    shell.register({ name: '__drive', async execute(context) {
      facts.entered++; const finished = gate();
      context.registerCleanup(async () => { facts.cleanupCalls++; await finished.promise; }); facts.registered++;
      try { callback = { value: await action({ ...frame, context, controller, shell }) }; }
      catch (reason) { callback = { reason }; }
      finally { finished.release(); }
      return { exitCode: 0 };
    } });
    shell.register({ name: '__noop', execute() { return { exitCode: 0 }; } });
    execution = shell.exec(facts.script, { signal: controller.signal });
    primary = await execution.then(value => ({ value }), reason => ({ reason }));
    facts.primary = Object.hasOwn(primary, 'value') ? 'fulfilled' : 'rejected';
    facts.publicCallerIdentity = Object.hasOwn(primary, 'reason') && primary.reason === controller.signal.reason;
    if (primary.value) facts.result = { exitCode: primary.value.exitCode, stdout: primary.value.stdout, stderr: primary.value.stderr };
    facts.action = callback?.value ?? { unexpectedFailure: true };
  } finally {
    if (execution) await execution.catch(() => undefined);
    try {
      await shell?.dispose();
      const snapshot = await terminal?.after();
      if (snapshot) {
        facts.roots = snapshot.roots.length; facts.monitors = snapshot.monitors.length;
        facts.live = snapshot.roots.map(root => root.ledger.snapshot().used.slice(0, 4));
        facts.stores = snapshot.monitors.map(monitor => ({ bindings: monitor.store.bindings.size, watches: monitor.store.watches.size }));
        assert.ok(facts.roots > 0 && facts.monitors > 0);
        for (const live of facts.live) assert.deepEqual(live, [0,0,0,0]);
        for (const store of facts.stores) assert.deepEqual(store, { bindings: 0, watches: 0 });
      }
    } catch (reason) { cleanupFailure = reason; }
    finally {
      try { changes.restore(); }
      catch (reason) { cleanupFailure ??= reason; }
      finally {
        try { await terminal?.close(); facts.observerClosed = true; }
        catch (reason) { cleanupFailure ??= reason; }
      }
    }
  }
  if (cleanupFailure) throw unsafe(cleanupFailure, facts);
  try {
    assert.equal(facts.entered, 1); assert.equal(facts.registered, 1); assert.equal(facts.cleanupCalls, 1);
    assert.ok(callback && Object.hasOwn(callback, 'value'), 'action must finish without observer/assertion failure');
    if (aborted) assert.equal(facts.publicCallerIdentity, true);
    else assert.deepEqual(facts.result, { exitCode: 0, stdout: phase === 'writers' ? '/next /\n/\n' : '', stderr: '' });
    return facts;
  } catch (reason) { reason.phaseDetails = facts; throw reason; }
}
async function precedence(api) {
  const phases = [];
  for (const mode of ['readonly','caller','escaping']) {
    let facts;
    try {
      const reason = Object.freeze({ kind: mode === 'caller' ? 'array-publication-caller' : 'array-expansion-escape' });
      facts = await runtimeCapture(api, mode, async ({ runtime, state, context, io, controller }) => {
        const detail = { effects: 0 };
        const outcome = await runtime.arrayZero(state, 'a', async () => {
          detail.effects++;
          await runtime.arrayZero(state, 'a', async () => 'newer');
          detail.readonlyStatus = await runtime.builtin({ ...context, ...io, command: 'readonly', args: ['a'] }, state, new Map());
          detail.beforeControl = valueOf(state);
          if (mode === 'caller') controller.abort(reason);
          if (mode === 'escaping') throw reason;
          return 'outer';
        }).then(value => ({ value }), error => ({ error }));
        detail.rejected = Object.hasOwn(outcome, 'error');
        detail.privateIdentity = outcome.error === reason;
        detail.privateMessage = outcome.error instanceof Error ? outcome.error.message : null;
        detail.afterPrivate = valueOf(state);
        return detail;
      }, mode === 'caller');
      assert.equal(facts.action.effects, 1); assert.equal(facts.action.readonlyStatus, 0);
      assert.equal(facts.action.rejected, true);
      assert.deepEqual(facts.action.beforeControl, [[0,'newer'],[2147483647,'last']]);
      if (mode === 'readonly') assert.equal(facts.action.privateMessage, 'indexed array: readonly binding');
      else assert.equal(facts.action.privateIdentity, true);
      if (mode !== 'caller') assert.deepEqual(facts.action.afterPrivate, [[0,'newer'],[2147483647,'last']]);
      phases.push({ ...facts, pass: true });
    } catch (reason) {
      if (reason?.unsafe) throw reason;
      phases.push({ ...(facts ?? reason.phaseDetails ?? { phase: mode }), pass: false, assertion: String(reason?.stack ?? reason) });
    }
  }
  if (phases.some(row => !row.pass)) throw failure(phases);
  return phases;
}
async function output(api) {
  const phases = [];
  for (const mode of ['cap4','cap3','backpressure','sink-error','abort','cleanup-error']) {
    const controller = new AbortController(), reason = Object.freeze({ mode }), entered = gate(), resume = gate();
    const shell = new api.Shell({ fs: new api.MemoryFileSystem(), ...(/^cap/.test(mode) ? { limits: { maxOutputBytes: mode === 'cap4' ? 4 : 3 } } : {}) });
    const facts = { phase: mode, script: 'a=([0]=😀); __emit "${a[@]}"', offers: [], after: 0, cleaned: 0, primary: 'unobserved' };
    let execution, outcome, settled = false, cleanupFailure;
    shell.register({ name: '__emit', async execute(context) {
      if (!/^cap/.test(mode)) context.registerCleanup(() => { facts.cleaned++; resume.release(); if (mode === 'cleanup-error') throw reason; });
      await context.stdout.write(new TextEncoder().encode(context.args[0])); facts.after++; return { exitCode: 0 };
    } });
    try {
      execution = shell.exec(facts.script, { signal: controller.signal, stdout: { async write(chunk) {
        facts.offers.push([...chunk]); entered.release();
        if (!/^cap/.test(mode)) await resume.promise;
        if (mode === 'sink-error') throw reason;
      } } }).then(value => ({ value }), error => ({ error }));
      execution.then(() => { settled = true; });
      if (!/^cap/.test(mode)) { await entered.promise; facts.settledBeforeRelease = settled; if (mode === 'abort') controller.abort(reason); else resume.release(); }
      outcome = await execution;
      facts.primary = Object.hasOwn(outcome, 'value') ? 'fulfilled' : 'rejected';
      facts.reasonIdentity = Object.hasOwn(outcome, 'error') && outcome.error === reason;
      facts.limit = outcome.error?.limit ?? null;
      if (outcome.value) facts.result = { exitCode: outcome.value.exitCode, stdout: outcome.value.stdout, stderr: outcome.value.stderr, stdoutBytes: [...outcome.value.stdoutBytes] };
    } finally {
      resume.release(); if (execution) await execution;
      try { await shell.dispose(); facts.disposed = true; } catch (reason) { cleanupFailure = reason; }
    }
    if (cleanupFailure) throw unsafe(cleanupFailure, facts);
    try {
      assert.deepEqual(facts.offers, mode === 'cap3' ? [] : [[240,159,152,128]]);
      assert.equal(facts.cleaned, /^cap/.test(mode) ? 0 : 1);
      if (!/^cap/.test(mode)) assert.equal(facts.settledBeforeRelease, false);
      if (['abort','cleanup-error'].includes(mode)) assert.equal(facts.reasonIdentity, true);
      else if (mode === 'cap3') assert.equal(facts.limit, 'maxOutputBytes');
      else assert.deepEqual(facts.result, { exitCode: mode === 'sink-error' ? 1 : 0, stdout: '😀', stderr: mode === 'sink-error' ? 'shell: line 1: [object Object]\n' : '', stdoutBytes: [240,159,152,128] });
      assert.equal(facts.after, ['cap3','sink-error','abort'].includes(mode) ? 0 : 1);
      phases.push({ ...facts, pass: true });
    } catch (reason) { phases.push({ ...facts, pass: false, assertion: String(reason?.stack ?? reason) }); }
  }
  if (phases.some(row => !row.pass)) throw failure(phases);
  return phases;
}
async function writers(api) {
  const facts = await runtimeCapture(api, 'writers', async ({ runtime, state, context, io }) => {
    await context.fs.mkdir('/next'); const monitor = stateMonitor(state), events = [];
    for (const [command, args] of [['getopts',['a','flag','-a']],['let',['counter=2']],['shopt',['-s','dotglob']],['pushd',['/next']],['popd',[]],['cd',['/next']]]) {
      const epoch = monitor.epoch, marker = state.directoryStackCwdPublication;
      const status = await runtime.builtin({ ...context, ...io, command, args }, state, new Map());
      events.push({ command, status, epochChanged: monitor.epoch !== epoch, markerChanged: state.directoryStackCwdPublication !== marker, cwd: state.cwd });
    }
    const invoked = await context.invoke('__noop', []);
    return { events, flag: state.variables.flag, counter: state.variables.counter, dotglob: state.dotglob, cwd: state.cwd, pwd: state.variables.PWD, oldpwd: state.variables.OLDPWD, invoked: invoked.exitCode };
  });
  try {
    for (const row of facts.action.events) { assert.equal(row.status, 0); assert.equal(row.epochChanged, true); assert.equal(row.markerChanged, ['pushd','popd'].includes(row.command)); }
    assert.deepEqual(facts.action.events.map(row => row.cwd), ['/','/','/','/next','/','/next']);
    assert.deepEqual({ ...facts.action, events: undefined }, { events: undefined, flag: 'a', counter: '2', dotglob: true, cwd: '/next', pwd: '/next', oldpwd: '/', invoked: 0 });
  } catch (reason) { reason.phaseDetails = [facts]; throw reason; }
  return facts;
}
async function mixedOverlay(api) {
  const phases = [];
  for (const value of ['B','C']) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }); const calls = [];
    const facts = { phase: `mixed-${value}`, overlays: 0, cleaned: 0, script: `a=A; b=([7]=tail); __overlay() { a=${value}; }; __overlay; __capture "$a" "\${#b[@]}" "\${b[7]}"` };
    let result, execution;
    shell.use(async (context, next) => { if (context.command === '__overlay') { context.env.a = 'B'; context.env.b = 'overlay-b'; facts.overlays++; } return next(); });
    shell.register({ name: '__capture', execute(context) { context.registerCleanup(() => { facts.cleaned++; }); calls.push([...context.args]); return { exitCode: 0 }; } });
    try { execution = shell.exec(facts.script); result = await execution.then(value => ({ value }), reason => ({ reason })); }
    finally { if (execution) await execution.catch(() => undefined); try { await shell.dispose(); facts.disposed = true; } catch (reason) { throw unsafe(reason, facts); } }
    facts.calls = calls; if (result.value) facts.result = { exitCode: result.value.exitCode, stdout: result.value.stdout, stderr: result.value.stderr };
    try { assert.deepEqual(facts.result, { exitCode: 0, stdout: '', stderr: '' }); assert.equal(facts.overlays, 1); assert.equal(facts.cleaned, 1); assert.deepEqual(calls, [[value === 'B' ? 'A' : 'C','1','tail']]); phases.push({ ...facts, pass: true }); }
    catch (reason) { phases.push({ ...facts, pass: false, assertion: String(reason?.stack ?? reason) }); }
  }
  if (phases.some(row => !row.pass)) throw failure(phases);
  return phases;
}
export async function execute(options) {
  const { id, api } = options;
  if (!['M22','P04','P09','P10','P11-U11'].includes(id)) return original.execute(options);
  const detail = ['M22','P04'].includes(id) ? await precedence(api) : id === 'P09' ? await output(api) : id === 'P10' ? await writers(api) : await mixedOverlay(api);
  return { category: 'actual-candidate-mechanism', requiredLoads: loads, assertionsCompleted: true, disposed: true, version: 'affected-tail-v2', detail };
}
