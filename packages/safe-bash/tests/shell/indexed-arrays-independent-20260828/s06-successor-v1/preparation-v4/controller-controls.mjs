import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { controller } from './controller.mjs';
import { retired } from './supervisor.mjs';
import { deadline } from './deadline.mjs';
import { additiveHoldouts } from './holdouts.mjs';
import { authenticate, census, digest } from '../../candidate-v1/boundary-app.mjs';
import { put } from '../preparation-v3/staging.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const [sealHash, label] = process.argv.slice(2); assert.match(label ?? '', /^[A-Z0-9-]{1,40}$/u);
const seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), sealHash));
const sourcePolicy = JSON.parse(fs.readFileSync(path.join(here, '../preparation-v3/POLICY.json')));
const verify = () => { for (const role of seal.roles) authenticate(path.join(own, role.path), role.sha256); authenticate(seal.node.path, seal.node.sha256); };
verify(); assert.equal(process.execPath, seal.node.path);
const root = path.join(here, `CONTROLS-${label}`); assert.equal(fs.existsSync(root), false); fs.mkdirSync(root);
const started = performance.now(), results = [], budgets = []; let serial = 0, actualChildren = 0;
const tools = { node: seal.node, git: seal.git };
function make(options = {}) {
  assert.ok(performance.now() - started < 30000); assert.ok(++serial <= 64);
  const directory = path.join(root, `case-${serial}`); fs.mkdirSync(directory);
  const policy = { ...sourcePolicy, ...(options.policy ?? {}) };
  const clock = options.clock ?? deadline(sourcePolicy.totalElapsedMsIncludingCleanup, () => performance.now() - started, 0);
  const budget = controller(directory, policy, options.tools ?? tools, options.integrity ?? (() => {}), clock, options.dependencies ?? {});
  budgets.push(budget); return { budget, directory, clock };
}
async function child(budget, mode = 'quick', options = {}) {
  assert.ok(++actualChildren <= 32);
  return budget.child('product', seal.node.path, ['--permission', `--allow-fs-read=${here}`, path.join(here, 'controlled-child.mjs'), mode], { cwd: here, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 2000, maxBytes: 16384, ...options });
}
const check = async (id, action) => {
  assert.ok(performance.now() - started < 30000);
  try { const detail = await action(); results.push({ id, pass: true, detail }); }
  catch (reason) { results.push({ id, pass: false, error: String(reason?.stack ?? reason) }); }
  assert.ok(budgets.every(budget => budget.children.every(retired)), 'unsafe owner settlement stops dependent controls');
};
async function rejected(action, reason) {
  let caught = false;
  try { await action(); } catch (actual) { caught = true; assert.equal(actual, reason); }
  assert.equal(caught, true);
}
const phaseError = reason => reason?.code === 'REVIEW_DEADLINE';
const report = { complete: true, unsafeStop: false };
const childFacts = budget => budget.snapshot().children;
try {
  await check('C01-admission-expiry-before-effects', () => {
    let time = 0, effects = 0; const clock = deadline(6600000, () => time, 0), { budget } = make({ clock }); time = 6600000;
    assert.throws(() => budget.admission(() => effects++), phaseError); assert.equal(effects, 0); assert.equal(budget.children.length, 0);
  });
  await check('C02-no-reset-after-delayed-setup', () => {
    let time = 6599999; const clock = deadline(6600000, () => time, 0), { budget } = make({ clock });
    assert.throws(() => budget.admission(() => {}), phaseError); assert.equal(clock.elapsed(), time); assert.equal(budget.children.length, 0);
  });
  await check('C03-admission-expiry-after-check', () => {
    let time = 0; const clock = deadline(6600000, () => time, 0), { budget } = make({ clock });
    assert.throws(() => budget.admission(() => { time = 6600000; }), phaseError); assert.equal(budget.snapshot().halted, true);
  });
  await check('C04-normal-child-and-publication', async () => {
    const { budget } = make(); const run = await child(budget); assert.equal(run.code, 0);
    assert.equal(budget.children.length, 1); assert.equal(budget.children[0].run, run); assert.ok(budget.children[0].receipt); budget.cleanupReady();
    return childFacts(budget);
  });
  await check('C05-enrolled-before-afterspawn-throw', async () => {
    const reason = Object.freeze({ fault: 'after-spawn' }); let budget;
    ({ budget } = make({ dependencies: { supervisorHooks: { afterSpawn(owner) { assert.equal(budget.children[0], owner); assert.ok(owner.pid > 0); assert.equal(owner.spawnReturned, true); throw reason; } } } }));
    await rejected(() => child(budget, 'wait'), reason); budget.cleanupReady();
    assert.equal(budget.children[0].failureReason, reason); assert.equal(budget.children[0].receipt, undefined); assert.equal(budget.children[0].closeObserved, true);
    return childFacts(budget);
  });
  await check('C06-before-persistence-false-identity', async () => {
    const { budget } = make({ dependencies: { beforePersist(name, value, children) { assert.equal(children.length, 1); assert.equal(children[0].run.code, 0); assert.equal(children[0].closeObserved, true); throw false; } } });
    await rejected(() => child(budget), false); budget.cleanupReady(); assert.equal(budget.children[0].receipt, undefined); return childFacts(budget);
  });
  await check('C07-during-publication-partial-receipt', async () => {
    const reason = Object.freeze({ partial: true }); let written;
    const { budget } = make({ dependencies: { publish(filename) { written = filename; put(filename, 'partial'); throw reason; } } });
    await rejected(() => child(budget), reason); assert.equal(fs.readFileSync(written, 'utf8'), 'partial'); budget.cleanupReady(); assert.equal(budget.children[0].receipt, undefined); return childFacts(budget);
  });
  await check('C08-newest-child-after-first-success', async () => {
    const reason = Object.freeze({ newest: true }); let seen = 0, budget;
    ({ budget } = make({ dependencies: { supervisorHooks: { afterSpawn(owner) { if (++seen === 2) { assert.equal(budget.children[1], owner); throw reason; } } } } }));
    await child(budget); await rejected(() => child(budget, 'wait'), reason); budget.cleanupReady();
    assert.equal(budget.children.length, 2); assert.equal(budget.children[0].run.code, 0); assert.equal(budget.children[1].closeObserved, true); assert.equal(budget.children[1].receipt, undefined);
    return childFacts(budget);
  });
  await check('C09-newest-settled-before-writer-throws', async () => {
    const reason = Object.freeze({ newestPublication: true });
    const { budget } = make({ dependencies: { beforePersist(name, value, children) { if (children.length === 2) { assert.equal(children[1].closeObserved, true); assert.equal(children[1].groupAbsent, true); throw reason; } } } });
    await child(budget); await rejected(() => child(budget), reason); budget.cleanupReady(); assert.equal(budget.children.length, 2); return childFacts(budget);
  });
  await check('C10-active-child-not-retired', async () => {
    let enter; const entered = new Promise(resolve => { enter = resolve; });
    const { budget } = make({ dependencies: { supervisorHooks: { afterSpawn(owner) { enter(owner); } } } });
    const pending = child(budget, 'wait'); const owner = await entered;
    try {
      assert.equal(budget.children[0], owner); assert.equal(owner.closeObserved, false); assert.equal(owner.groupAbsent, null);
      assert.throws(() => budget.cleanupReady());
    } finally { await pending; }
    budget.cleanupReady(); return childFacts(budget);
  });
  await check('C11-spawn-throw-does-not-fake-close', async () => {
    const { budget } = make({ dependencies: { supervisorHooks: { spawn() { throw undefined; } } } });
    await rejected(() => child(budget), undefined); const owner = budget.children[0];
    assert.equal(owner.spawnAttempted, true); assert.equal(owner.spawnThrew, true); assert.equal(owner.spawnReturned, false); assert.equal(owner.pid, null); assert.equal(owner.closeObserved, false); assert.equal(owner.groupAbsent, null); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C12-real-spawn-error-no-invented-pid', async () => {
    const absent = path.join(root, 'missing-runtime'), { budget } = make({ tools: { ...tools, node: { path: absent } } });
    await assert.rejects(budget.child('product', absent, [], { cwd: here, env: {}, timeoutMs: 100, maxBytes: 1024 }), reason => reason?.code === 'ENOENT');
    const owner = budget.children[0]; assert.equal(owner.pid, null); assert.equal(owner.spawnEvent, false); assert.equal(owner.closeObserved, true); assert.equal(owner.groupAbsent, null); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C13-prechild-integrity-failure', async () => {
    const reason = Object.freeze({ integrity: 'before' }), { budget } = make({ integrity() { throw reason; } });
    await rejected(() => child(budget), reason); assert.equal(budget.children.length, 0);
  });
  await check('C14-postchild-integrity-failure', async () => {
    const reason = Object.freeze({ integrity: 'after' }); let calls = 0;
    const { budget } = make({ integrity() { if (++calls === 2) throw reason; } });
    await rejected(() => child(budget), reason); assert.ok(budget.children[0].receipt); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C15-final-census-expiry', async () => {
    let time = 0, announcements = 0; const { budget } = make({ clock: deadline(6600000, () => time, 0) });
    await assert.rejects(budget.finalize(report, () => { time = 6600000; return {}; }, () => { announcements++; }), phaseError);
    assert.equal(announcements, 0); assert.equal(budget.snapshot().records.length, 0);
  });
  await check('C16-final-publication-delay', async () => {
    let time = 0, announcements = 0, written;
    const { budget } = make({ clock: deadline(6600000, () => time, 0), dependencies: { publish(filename, bytes) { put(filename, bytes); written = filename; time = 6600000; } } });
    await assert.rejects(budget.finalize(report, () => ({}), () => { announcements++; }), phaseError);
    const raw = JSON.parse(fs.readFileSync(written)); assert.equal(raw.accepted, undefined); assert.match(raw.publication, /provisional/u); assert.equal(announcements, 0);
  });
  await check('C17-final-publication-throw', async () => {
    let announcements = 0; const { budget } = make({ dependencies: { publish() { throw false; } } });
    await rejected(() => budget.finalize(report, () => ({}), () => { announcements++; }), false); assert.equal(announcements, 0);
  });
  await check('C18-terminal-announcement-delay', async () => {
    let time = 0, announcements = 0; const { budget } = make({ clock: deadline(6600000, () => time, 0) });
    await assert.rejects(budget.finalize(report, () => ({}), value => { announcements++; assert.equal(value.requiresZeroCoordinatorExit, true); time = 6600000; }), phaseError);
    assert.equal(announcements, 1); assert.equal(budget.snapshot().halted, true);
  });
  await check('C19-after-publication-hook-throw', async () => {
    const reason = Object.freeze({ afterPublish: true }), { budget } = make({ dependencies: { afterPublish() { throw reason; } } });
    await rejected(() => child(budget), reason); assert.equal(budget.snapshot().records.length, 1); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C20-storage-scan-fault', async () => {
    const reason = Object.freeze({ scan: true }), { budget, directory } = make({ dependencies: { scan() { throw reason; } } });
    budget.registerStorage('bound', directory, 100); await rejected(() => child(budget), reason); assert.equal(budget.children.length, 0);
  });
  await check('C21-storage-cap-refusal', async () => {
    const { budget, directory } = make({ dependencies: { scan() { return { payload: { bytes: 101 } }; } } });
    budget.registerStorage('bound', directory, 100); await assert.rejects(child(budget), /storage ceiling/u); assert.equal(budget.children.length, 0);
  });
  await check('C22-output-ceiling-keeps-actual-facts', async () => {
    const { budget } = make(); await assert.rejects(child(budget, 'output', { maxBytes: 32 }), /unsafe child lifecycle/u);
    assert.equal(budget.children[0].run.fault, 'output-ceiling'); assert.ok(budget.children[0].run.bytes >= 4096); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C23-timeout-retires-real-child', async () => {
    const { budget } = make(); await assert.rejects(child(budget, 'wait', { timeoutMs: 10 }), /unsafe child lifecycle/u);
    assert.equal(budget.children[0].run.fault, 'deadline'); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C24-unsettled-publication-deadline', async () => {
    let rejectLate; const pending = new Promise((resolve, reject) => { rejectLate = reject; });
    const origin = performance.now(), clock = deadline(100, () => performance.now() - origin, 0), { budget } = make({ clock, dependencies: { publish() { return pending; } } });
    const unhandled = []; const listener = reason => unhandled.push(reason); process.on('unhandledRejection', listener);
    try { await assert.rejects(budget.finalize(report, () => ({}), () => assert.fail('must not announce')), phaseError); rejectLate(false); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []); }
    finally { rejectLate(false); process.off('unhandledRejection', listener); }
  });
  await check('C25-finalization-while-newest-active', async () => {
    let enter; const entered = new Promise(resolve => { enter = resolve; }); const { budget } = make({ dependencies: { supervisorHooks: { afterSpawn() { enter(); } } } });
    const pending = child(budget, 'wait'); await entered;
    try { await assert.rejects(budget.finalize(report, () => ({}), () => assert.fail('unretired child')), /Expected values/u); }
    finally { await pending; }
    budget.cleanupReady(); assert.equal(budget.children[0].closeObserved, true); return childFacts(budget);
  });
  await check('C26-ordinary-nonzero-continues-after-reap', async () => {
    const { budget } = make(); const failing = await child(budget, 'exit-one'); assert.equal(failing.code, 1); budget.ordinary('ordinary', false);
    assert.equal((await child(budget)).code, 0); const terminal = await budget.finalize(report, () => ({}), () => {});
    assert.equal(terminal.accepted, false); assert.equal(terminal.unsafeStop, false); return childFacts(budget);
  });
  await check('C27-normal-finalization', async () => {
    const { budget, directory } = make(); let announced;
    const terminal = await budget.finalize(report, () => ({ census: census(directory) }), value => { announced = value; });
    assert.equal(terminal.accepted, true); assert.equal(announced.requiresZeroCoordinatorExit, true); assert.ok(terminal.elapsedMs < 60000);
    assert.equal(JSON.parse(fs.readFileSync(terminal.receipt.path)).accepted, undefined);
  });
  await check('C28-role-accessor-not-invoked', () => {
    let calls = 0; assert.throws(() => make({ dependencies: { get publish() { calls++; return put; } } }), /role getters/u); assert.equal(calls, 0);
  });
  await check('C29-role-extra-order-refusal', () => {
    assert.throws(() => make({ dependencies: { unknown: () => {} } }), /keys\/order/u);
    assert.throws(() => make({ dependencies: { afterPublish: () => {}, publish: put } }), /keys\/order/u);
  });
  await check('C30-cross-realm-role-data', () => {
    const roles = vm.runInNewContext('({ beforePersist() {} })'); const { budget } = make({ dependencies: roles }); assert.equal(budget.snapshot().children.length, 0);
  });
  await check('C31-final-announcement-throw-identity', async () => {
    const { budget } = make(); await rejected(() => budget.finalize(report, () => ({}), () => { throw 0; }), 0);
    assert.equal(budget.snapshot().halted, true);
  });
  await check('C32-final-integrity-throw', async () => {
    const reason = Object.freeze({ finalIntegrity: true }), { budget } = make({ integrity() { throw reason; } }); let collected = 0;
    await rejected(() => budget.finalize(report, () => { collected++; }, () => assert.fail()), reason); assert.equal(collected, 0);
  });
  await check('C33-final-collector-throw', async () => {
    const reason = Object.freeze({ collector: true }), { budget } = make();
    await rejected(() => budget.finalize(report, () => { throw reason; }, () => assert.fail()), reason); assert.equal(budget.snapshot().records.length, 0);
  });
  await check('C34-record-cap-still-retains-newest', async () => {
    const { budget } = make({ policy: { maxRecordBytes: 1 } }); await assert.rejects(child(budget));
    assert.equal(budget.children.length, 1); assert.equal(budget.children[0].run.code, 0); budget.cleanupReady(); return childFacts(budget);
  });
  await check('C35-postwrite-physical-storage-cap', async () => {
    const { budget, directory } = make(); budget.registerStorage('actual-receipt-directory', directory, 0);
    await assert.rejects(child(budget), /storage ceiling/u); assert.ok(Object.keys(census(directory)).some(name => name.endsWith('.json')));
    budget.cleanupReady(); return childFacts(budget);
  });
  await check('C36-no-dependent-spawn-after-persistence-fault', async () => {
    const { budget } = make({ dependencies: { publish() { throw false; } } }); await rejected(() => child(budget), false);
    const count = budget.children.length; await assert.rejects(child(budget), /dependent work stopped/u); assert.equal(budget.children.length, count); budget.cleanupReady();
  });
  await check('C37-afterspawn-deadline-preserves-child-facts', async () => {
    let time = 0; const { budget } = make({ clock: deadline(6600000, () => time, 0), dependencies: { supervisorHooks: { afterSpawn() { time = 6600000; } } } });
    await assert.rejects(child(budget, 'wait'), phaseError); assert.equal(budget.children.length, 1);
    const owner = budget.children[0]; assert.equal(owner.spawnReturned, true); assert.ok(owner.pid > 0); assert.equal(owner.closeObserved, true); assert.equal(owner.groupAbsent, true);
    assert.throws(() => budget.cleanupReady(), phaseError); return childFacts(budget);
  });
  const original = JSON.parse(fs.readFileSync(path.join(own, 'executor-v1/HOLDOUTS.json'))), overlay = JSON.parse(fs.readFileSync(path.join(here, 'H12-OVERLAY.json')));
  await check('H01-original-held-preserved', () => { const copy = JSON.stringify(original); assert.equal(additiveHoldouts(original, overlay).length, 16); assert.equal(JSON.stringify(original), copy); assert.equal(original.semantic.find(row => row.id === 'H12').stdout, undefined); });
  await check('H02-default-ifs-exact-expected', () => { const row = additiveHoldouts(original, overlay).find(row => row.id === 'H12-v2'); assert.deepEqual(row, { id: 'H12-v2', script: original.semantic.find(row => row.id === 'H12').script, stdout: 'v w:v w\n', stderr: 'empty', exitCode: 0 }); });
  await check('H03-other-fifteen-byte-values-unchanged', () => assert.equal(JSON.stringify(additiveHoldouts(original, overlay).filter(row => row.id !== 'H12-v2')), JSON.stringify(original.semantic.filter(row => !row.status))));
  await check('H04-nondefault-ifs-not-admitted', () => assert.throws(() => additiveHoldouts(original, { ...overlay, profile: 'any IFS' })));
  await check('H05-wrong-output-refused', () => assert.throws(() => additiveHoldouts(original, { ...overlay, expected: { ...overlay.expected, stdout: 'v:w\n' } })));
  await check('H06-accessor-does-not-execute', () => { let calls = 0; const changed = { ...overlay }; Object.defineProperty(changed, 'script', { get() { calls++; return overlay.script; } }); assert.throws(() => additiveHoldouts(original, changed)); assert.equal(calls, 0); });
  verify(); assert.equal(results.length, 43);
} finally {
  const owners = budgets.flatMap(budget => budget.children), allRetired = owners.every(retired);
  const evidence = { sealHash, sourcePreparationOnly: true, actualProductExecutions: 0, nativeCalls: 0, results, observations: results.length, passed: results.filter(row => row.pass).length, attemptedChildCalls: actualChildren, ownedLaunchAttempts: owners.length, actualPids: owners.filter(owner => owner.pid !== null).map(owner => owner.pid), allRetired, elapsedMs: performance.now() - started, finalCensus: census(root), remainingRoles: budgets.map(budget => budget.snapshot()) };
  assert.ok(evidence.elapsedMs < 30000); assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 2 * 1024 * 1024);
  if (allRetired) { assert.equal(fs.realpathSync(root), root); fs.rmSync(root, { recursive: true }); evidence.ownedScratchRetired = !fs.existsSync(root); }
  const bytes = Buffer.from(JSON.stringify(evidence) + '\n'); put(path.join(here, `CONTROL-CAPTURE-${label}.json`), bytes);
  console.log(JSON.stringify({ observations: results.length, passed: evidence.passed, allRetired, ownedScratchRetired: evidence.ownedScratchRetired, actualProductExecutions: 0, captureSha256: digest(bytes), failures: results.filter(row => !row.pass) }));
  process.exitCode = allRetired && evidence.ownedScratchRetired && results.length === 43 && results.every(row => row.pass) ? 0 : 78;
}
