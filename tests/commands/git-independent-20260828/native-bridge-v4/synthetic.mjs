import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { posix } from 'node:path';
import vm from 'node:vm';
import { BASE, HASHES, TOOLS, IDS, OBSERVER_ENV, exact, need, ownedRoot, failureState, sha256 } from './finite.mjs';
import { renderFence, profileBinding, wrapperRequest, dispatchActual, historicalPairs } from './fence.mjs';
import { nativeRecipe, admitRecipe } from './recipe.mjs';
import { account, acceptH11 } from './account.mjs';
import { createNativeBridge } from './bridge.mjs';
import { loadWholeH11 } from './whole-h11.mjs';
import { collectSix, guardCensus, publication } from './collector.mjs';

export const CASES = Object.freeze([
  'S01-authoritative18-and-six-no-version', 'S02-wholeH11-six-mocked-wrapper-collector',
  'S03-crossrealm-own-data', 'S04-env-injection', 'S05-hook-injection', 'S06-pager-injection',
  'S07-readboundary-literal-no-globs', 'S08-execunknown-and-stdio', 'S09-path-alias-control-length',
  'S10-holes-accessors-extras-order', 'S11-source-guard-pre', 'S12-source-guard-post',
  'S13-fixture-addition-mode-hash', 'S14-workflow-15000-bound', 'S15-overall-reserve-and-deadline',
  'S16-target-observer-combined-output', 'S17-allchildren-before-receipt', 'S18-unknown-closure',
  'S19-collector-latePASS-nonzero', 'S20-undefined-primary-cleanup-secondary',
  'S21-null-false-zero-primary', 'S22-collector-durable-failure-stop', 'S23-ordinary-assertions-after-closure',
  'S24-import-product-native-fallback-preflight', 'S25-exclusive-publication', 'S26-actual-always-unavailable',
]);
const inertPacket = { schema: 'git-native-bridge-v4-synthetic' };
const rootFor = id => `${BASE}/owned/native-${id}-00000000-0000-0000-0000-000000000001`;
const identity = pid => ({ pid, pgid: pid, born: 'Fri Aug 28 00:00:00 2026' });
const handle = () => ({ kill() { return true; } });
const terminalMetadata = () => {
  const path = `${BASE}/owned/os-review-01/capture/terminal.json`;
  return { path, resolvedPath: path, exclusive: true, regular: true, nlink: 1, mode: 0o600, owned: true, closed: true, fsynced: true, noSymlinkAncestors: true };
};
function world(records, mutation = {}) {
  let now = 0, nextPid = 100, active, observerIndex = 0, streamIndex = 0;
  const ledger = account(() => now), captures = new Map(), saved = [], failures = [], spawns = [], observations = [], guards = [];
  const census = { source: [{ path: 'whole-H11', mode: 0o644, sha256: HASHES.h11 }], tools: [{ path: TOOLS.git, mode: 0o755, sha256: HASHES.git }], fixture: records.tree, completeEnumeration: true };
  const host = {
    mode: 'SYNTHETIC_ONLY',
    async guard(phase) { guards.push(phase); if (mutation.guard === phase) throw mutation.reason; },
    spawnOwned(request, onOwned) {
      spawns.push(request);
      exact(request.executable, TOOLS.sandbox); exact(request.args.slice(0, 1), ['-f']); exact(request.args[2], TOOLS.git);
      const child = new EventEmitter(); child.pid = nextPid++; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      for (const input of [child.stdout, child.stderr]) { input.pause = () => {}; input.resume = () => {}; input.destroy = () => {}; }
      child.kill = signal => { if (!child.closed) { child.closed = true; child.emit('exit', null, signal); child.emit('close', null, signal); } return true; };
      active = child; onOwned(identity(child.pid), child);
      queueMicrotask(() => {
        const id = request.options.cwd.match(/native-(A0[1-6])-/)[1];
        const row = records.workflows.find(item => item.id === id);
        child.stdout.emit('data', Buffer.from(row.stdoutBase64, 'base64'));
        child.closed = true; child.emit('exit', 0, null); child.emit('close', 0, null);
      });
      return child;
    },
    observeOwned(request, onOwned, onBytes, onClose) {
      observations.push(request); exact(request.options.env, OBSERVER_ENV);
      need(request.options.maxBuffer <= 65536, 'observer 8MiB request tightened');
      const observer = handle(); onOwned(identity(10000 + ++observerIndex), observer);
      const output = active && !active.closed ? `${active.pid} 10 ${active.pid} Fri Aug 28 00:00:00 2026 sandbox-exec\n` : '';
      onBytes(Buffer.from(output)); onBytes(Buffer.alloc(0)); onClose(0, null);
      return output;
    },
    h11Bindings(processBindings, recipe) {
      return {
        'node:assert/strict': { default: assert },
        'node:child_process': processBindings,
        'node:fs': {
          mkdirSync(path, options) { exact(path, `${recipe.cwd.slice(0, -5)}/capture`); exact(options, { recursive: true }); },
          existsSync() { throw new Error('unexpected setup sentinel'); },
          createWriteStream(path, options) {
            exact(path, streamIndex++ % 2 === 0 ? recipe.stdout : recipe.stderr); exact(options, { flags: 'wx' });
            need(!captures.has(path), 'exclusive capture');
            const chunks = []; captures.set(path, chunks);
            const stream = new EventEmitter(); stream.closed = false;
            stream.write = bytes => { chunks.push(Buffer.from(bytes)); return true; };
            stream.end = () => { stream.closed = true; stream.emit('close'); };
            stream.destroy = stream.end;
            return stream;
          },
        },
        'node:path': { dirname: posix.dirname },
        'node:timers/promises': { setTimeout: async milliseconds => { now += milliseconds; } },
      };
    },
    globals() {
      const mockProcess = new EventEmitter(); mockProcess.pid = 10; mockProcess.ppid = 11;
      mockProcess.kill = () => { throw new Error('no unowned signalling'); };
      return { Date: { now: () => now }, process: mockProcess, setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2, clearInterval: () => {} };
    },
    async expectedCensus() { return structuredClone(census); },
    async census(recipe, phase) { return structuredClone(census); },
    async capture(recipe) { return { stdoutBase64: Buffer.concat(captures.get(recipe.stdout)).toString('base64'), stderrBase64: Buffer.concat(captures.get(recipe.stderr)).toString('base64') }; },
    async cleanup() { if (Object.hasOwn(mutation, 'cleanup')) throw mutation.cleanup; },
    async persist(terminal) { saved.push(terminal); return terminalMetadata(); },
    failureReceipt(terminal) { failures.push(terminal); },
  };
  const adapter = createNativeBridge(records, host, ledger);
  return { host, adapter, ledger, saved, failures, spawns, observations, guards, tick(value) { now = value; } };
}
async function caught(action) {
  let thrown = false, value;
  try { await action(); } catch (reason) { thrown = true; value = reason; }
  assert.equal(thrown, true, 'expected rejection including falsy values'); return value;
}
export async function run(records, rendered, report) {
  const recipes = records.workflows.map(row => nativeRecipe(rootFor(row.id), row));
  const recipe = recipes[0], root = rootFor('A01');
  const tests = [
    async () => {
      exact(records.workflows.map(row => row.id), IDS); assert.equal(records.files.length, 18);
      assert.equal(records.files.filter(file => file.path.startsWith('.git/objects/')).length, 11);
      assert.equal(records.files.find(file => file.path === '.git/index').bytes, 184);
      for (const row of records.files) assert.equal(sha256(Buffer.from(row.base64, 'base64')), row.sha256);
      assert.equal(sha256(JSON.stringify(records.tree)), records.treeSha256);
      for (const item of recipes) admitRecipe(item, records);
      assert.throws(() => nativeRecipe(root, { id: 'A07', args: ['--version'] }));
    },
    async () => {
      const state = world(records), result = await collectSix(recipes, records, state.adapter, state.host, state.ledger);
      assert.equal(result.exitCode, 0); assert.equal(result.outcomes.length, 6); assert.equal(state.spawns.length, 6);
      assert.equal(state.observations.length, 18); assert.equal(result.resources.children.length, 24);
      assert.ok(result.resources.children.every(child => child.closed)); assert.equal(state.saved.length, 1);
      for (const outcome of result.outcomes) { exact(outcome.receipt.executable, TOOLS.git); exact(outcome.receipt.actualRole.executable, TOOLS.sandbox); }
    },
    async () => { exact(vm.runInNewContext('({env:{PATH:"/dev/null"},args:["x",1,false,null]})'), { env: { PATH: '/dev/null' }, args: ['x', 1, false, null] }); },
    async () => { for (const key of ['NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'GIT_DIR', 'GIT_CONFIG_PARAMETERS', 'SSH_ASKPASS']) { const changed = structuredClone(recipe); changed.env[key] = 'INERT'; assert.throws(() => admitRecipe(changed, records)); } },
    async () => { const changed = structuredClone(recipe); changed.args[2] = `core.hooksPath=${root}/foreign/hooks`; assert.throws(() => admitRecipe(changed, records)); },
    async () => { const changed = structuredClone(recipe); changed.env.GIT_PAGER = 'INERT_PAGER'; assert.throws(() => admitRecipe(changed, records)); },
    async () => {
      const profile = renderFence(root, records); exact(profile, rendered.nativeA01);
      assert.ok(profile.includes('(deny default)') && profile.includes('(deny network*)') && profile.includes('(deny file-write*)'));
      assert.ok(!/subpath|regex|\(literal "\/(Users|System|usr)"\)/.test(profile));
      assert.ok(!profile.includes(`${root}/foreign/canary`)); assert.equal(historicalPairs(records).length, 7);
    },
    async () => { for (const patch of [{ executable: TOOLS.node }, { stdio: ['ignore', 'pipe', 'pipe', 9] }, { shell: true }]) assert.throws(() => admitRecipe({ ...recipe, ...patch }, records)); },
    async () => { for (const value of [root + '/..', root.replace('/owned/', '/owned//'), root + '\n', root + '"', root + '\\', 'file://' + root, root + 'a'.repeat(512)]) assert.throws(() => ownedRoot(value)); assert.throws(() => wrapperRequest(recipe, { ...profileBinding(root, records), path: `${root}/../target.sb` })); },
    async () => {
      const sparse = ['x', , 'z']; assert.throws(() => exact(sparse, ['x', undefined, 'z']));
      let touched = false; const getter = { get value() { touched = true; return 1; } }; assert.throws(() => exact(getter, { value: 1 })); assert.equal(touched, false);
      assert.throws(() => exact(Object.assign(['x'], { extra: 1 }), ['x'])); assert.throws(() => exact(['b', 'a'], ['a', 'b']));
      assert.throws(() => exact({ value: 1, [Symbol('extra')]: true }, { value: 1 }));
    },
    async () => { const reason = {}, state = world(records, { guard: 'source-tool-pre', reason }); const actual = await caught(() => collectSix(recipes, records, state.adapter, state.host, state.ledger)); assert.equal(actual, reason); assert.equal(state.spawns.length, 0); },
    async () => { const reason = {}, state = world(records, { guard: 'source-tool-post', reason }); const actual = await caught(() => collectSix(recipes, records, state.adapter, state.host, state.ledger)); assert.equal(actual, reason); assert.equal(state.spawns.length, 1); },
    async () => { for (const changed of [[...records.tree, { path: 'extra', type: 'file' }], records.tree.map((entry, index) => index ? entry : { ...entry, mode: 0 }), records.tree.map((entry, index) => index ? entry : { ...entry, sha256: '0'.repeat(64) })]) assert.throws(() => guardCensus(changed, records.tree)); },
    async () => { const state = world(records); state.ledger.begin('A01'); state.tick(15001); assert.throws(() => state.ledger.check()); },
    async () => { const state = world(records); state.tick(105001); assert.throws(() => state.ledger.begin('A01')); state.tick(120001); assert.throws(() => state.ledger.check()); },
    async () => { const state = world(records); state.ledger.begin('A01'); const target = state.ledger.admit('target-wrapper', identity(1), handle()), observer = state.ledger.admit('observer', identity(2), handle()); state.ledger.charge(target, 65535); state.ledger.charge(observer, 1); assert.equal(state.ledger.remainingBytes(), 0); assert.throws(() => state.ledger.charge(observer, 1)); },
    async () => { const state = world(records); state.ledger.begin('A01'); assert.throws(() => state.ledger.admit('inspector', identity(1), handle())); assert.throws(() => state.ledger.admit('observer', { pid: 1, pgid: 1, born: '' }, handle())); assert.throws(() => state.ledger.charge(undefined, 1)); },
    async () => { const state = world(records); state.ledger.begin('A01'); state.ledger.admit('observer', identity(1), handle()); assert.throws(() => state.ledger.closure()); assert.throws(() => state.ledger.finish()); },
    async () => { assert.throws(() => acceptH11({ status: 7, stdout: 'PASS', clean: true, closed: true, captureClosed: true, survivorsKnown: true, teardownAttempted: true, timedOut: false, outputExceeded: false })); },
    async () => { const secondary = {}, state = world(records, { guard: 'source-tool-pre', reason: undefined, cleanup: secondary }); assert.equal(await caught(() => collectSix(recipes, records, state.adapter, state.host, state.ledger)), undefined); const terminal = state.failures[0]; assert.equal(terminal.hasFailure, true); assert.equal(terminal.primary, undefined); assert.ok(terminal.secondary.includes(secondary)); assert.equal(terminal.exitCode, 1); },
    async () => { for (const primary of [null, false, 0]) { const state = failureState(), secondary = {}; state.record(primary); state.record(secondary); assert.equal(await caught(() => state.throwIfFailed()), primary); assert.equal(state.secondary[0], secondary); } },
    async () => { const state = world(records); state.host.census = async (item, phase) => phase === 'post' ? {} : state.host.expectedCensus(); await caught(() => collectSix(recipes, records, state.adapter, state.host, state.ledger)); assert.equal(state.spawns.length, 1); assert.equal(state.saved[0].exitCode, 1); assert.ok(state.saved[0].resources.children.every(child => child.closed)); },
    async () => { const state = world(records); state.host.capture = async () => ({ stdoutBase64: '', stderrBase64: '' }); const result = await collectSix(recipes, records, state.adapter, state.host, state.ledger); assert.equal(result.exitCode, 1); assert.equal(result.assertions.length, 6); assert.equal(state.spawns.length, 6); },
    async () => { const source = Buffer.from(records.records.supervisor.base64, 'base64').toString(); let touched = false; await caught(() => loadWholeH11(source, { 'node:child_process': { spawn() { touched = true; } }, './product.js': {} }, {})); await caught(() => loadWholeH11(source + '\n', {}, {})); assert.equal(touched, false); },
    async () => { const metadata = terminalMetadata(); publication(metadata, `${BASE}/owned/os-review-01`, 'terminal.json'); for (const changed of [{ nlink: 2 }, { exclusive: false }, { noSymlinkAncestors: false }, { resolvedPath: `${BASE}/foreign` }, { fsynced: false }]) assert.throws(() => publication({ ...metadata, ...changed }, `${BASE}/owned/os-review-01`, 'terminal.json')); },
    async () => { assert.throws(() => dispatchActual({ action: 'ROOT_GIT_NATIVE_SIX_EXECUTE' }), /NOT_DISPATCH_READY/); assert.throws(() => createNativeBridge(records, { mode: 'ACTUAL' }, {})); },
  ];
  exact(tests.length, CASES.length);
  let failed = 0;
  for (let index = 0; index < CASES.length; index++) {
    try { await tests[index](); await report({ id: CASES[index], status: 'PASS', classification: 'INERT_SYNTHETIC_NO_OS_CHILDREN' }); }
    catch (reason) { failed++; await report({ id: CASES[index], status: 'FAIL', error: { type: typeof reason, message: reason?.message ?? String(reason), stack: reason?.stack } }); }
  }
  return { cases: CASES.length, passed: CASES.length - failed, failed, native: 'A01-A06_UNRUN', OS: 'UNEXECUTED' };
}
