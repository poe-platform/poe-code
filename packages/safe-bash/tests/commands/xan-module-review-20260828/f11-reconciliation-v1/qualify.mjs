import assert from 'node:assert/strict';
import { readFile, readdir, lstat, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { durable } from '../actual-review-v1/a01.mjs';
import { supervise, IntegrityFailure } from '../preparation-v2/supervisor.mjs';
import { tree, verifyTree } from '../actual-review-v2/common.mjs';
import { aggregateExit } from './parent-gate.mjs';
import { parentSection } from './parent-section.mjs';
import { parentSection as extractSection, transformParent, transformAdapter } from './overlay.mjs';
import { hash, assertConditional, assertAdequateDiagnostic, fixtureReceipt } from './conditional.mjs';
import { forwardInvocation, forwardMiddleware } from './future-direct.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const presealCommit = process.argv[2];
assert.match(presealCommit ?? '', /^[a-f0-9]{40}$/);
const sealBytes = await readFile(path.join(root, 'PRE-SEAL.json'));
const seal = JSON.parse(sealBytes);
const profile = JSON.parse(await readFile(path.join(root, 'PROFILE.json')));
const controls = JSON.parse(await readFile(path.join(root, 'CONTROLS.json')));
const bindings = JSON.parse(await readFile(path.join(root, 'BINDINGS.json')));
const evidence = path.join(root, 'evidence');
await mkdir(evidence);
await durable(path.join(evidence, 'ATTEMPT.json'), { presealCommit, presealSha256: hash(sealBytes), started: new Date().toISOString(),
  classification: 'SINGLE_SYNTHETIC_QUALIFICATION_NO_PRODUCT', productImports: 0, productInvocations: 0, native: 0, retry: false });
const results = []; const children = []; const parentResults = [];
let stopped;
async function names(directory, prefix = '') {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix + name;
    if (!prefix && ['evidence', 'RESULT-SEAL.json', 'HANDOFF.md'].includes(name)) continue;
    const stat = await lstat(path.join(directory, name));
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) entries.push(...await names(path.join(directory, name), `${relative}/`));
    else entries.push(relative);
  }
  return entries;
}
async function verify() {
  try {
    assert.equal(hash(await readFile(path.join(root, 'PRE-SEAL.json'))), hash(sealBytes));
    assert.deepEqual((await names(root)).sort(), [...seal.inputs.map(entry => entry.path), 'PRE-SEAL.json'].sort());
    for (const entry of seal.inputs) {
      const bytes = await readFile(path.join(root, entry.path));
      assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
    }
    for (const entry of seal.external) {
      const bytes = await readFile(path.join(root, '..', entry.path));
      assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
    }
  } catch (error) { throw new IntegrityFailure(`SYNTHETIC_INPUT_INTEGRITY_STOP: ${error.message}`); }
}
async function outcome(id, polarity, raw, check) {
  await durable(path.join(evidence, `${id}-RAW.json`), raw);
  try {
    await check();
    results.push({ id, polarity, passed: true });
  } catch (error) {
    results.push({ id, polarity, passed: false, error: { name: error.name, message: error.message, stack: error.stack } });
    await durable(path.join(evidence, `${id}-FIRST-FAILURE.json`), results.at(-1));
    if (error instanceof IntegrityFailure) throw error;
  }
  await durable(path.join(evidence, `${id}-RESULT.json`), results.at(-1));
}
const emptyLayout = { fail: 0, blocked: 0, missing: [] };
const aggregate = phases => aggregateExit({ phases, requiredPhases: ['build', 'child:test'], perLayout: { SOURCE: emptyLayout } });
try {
  await verify();
  assert.equal(hash(await readFile(process.execPath)), seal.node.sha256);
  assert.equal(process.execPath, seal.node.path);
  for (const control of controls.parent) {
    const id = `parent-${control.mode}`;
    const job = { job: id, phase: 'SYNTHETIC_RECEIPT_ONLY', nonce: randomUUID(), manifest: hash(sealBytes), requiredIds: ['required-a', 'required-b'], rawBound: controls.rawBytes };
    const receipt = await supervise({ executable: process.execPath,
      args: ['--permission', '--disallow-code-generation-from-strings', '--disable-proto=throw', `--allow-fs-read=${path.join(root, 'synthetic-child.mjs')}`,
        path.join(root, 'synthetic-child.mjs'), control.mode === 'replay' ? 'zero-pass' : control.mode, JSON.stringify(job)],
      cwd: root, directory: path.join(evidence, id), timeoutMs: control.mode === 'timeout' ? controls.deadlines.intentionalTimeoutMs : controls.deadlines.ordinaryMs,
      rawBytes: controls.rawBytes, kind: 'ORDINARY_SMALL_FIXTURE_NO_PRODUCT' });
    children.push({ id, ...receipt });
    if (!receipt.reaped || receipt.overflow || receipt.spawnError) throw new IntegrityFailure('ACTUAL_SYNTHETIC_CHILD_RESOURCE_FAILURE_STOP');
    if (control.mode !== 'timeout' && (receipt.timeout || receipt.signal)) throw new IntegrityFailure('UNEXPECTED_TIMEOUT_STOP');
    await verify();
    const phases = [{ id: 'build', status: 'PASS' }]; const seen = new Set();
    if (control.mode === 'replay') seen.add(`${job.nonce}:${job.job}:${job.phase}:${job.manifest}`);
    let admitted; let error;
    try { admitted = await parentSection({ job, receipt, evidence, id, seen, verify, durable, phases }); }
    catch (failure) { error = failure; }
    const exitCode = aggregateExit({ stopped: error, phases, perLayout: { SOURCE: emptyLayout }, requiredPhases: ['build', `child:${id}`] });
    const state = error ? 'HOLD' : exitCode ? 'FAIL' : 'PASS';
    parentResults.push({ id, state, exitCode, phases, admitted, error: error ? { name: error.name, message: error.message } : null });
    await outcome(id, control.expected === 'PASS' ? 'positive' : 'negative', parentResults.at(-1), () => {
      assert.equal(state, control.expected);
      if (control.expected === 'HOLD') assert.ok(error instanceof IntegrityFailure);
      if (control.expected !== 'PASS') assert.equal(exitCode, 1);
      assert.equal(receipt.reaped, true);
    });
  }
  for (const control of controls.predicates) {
    const spec = profile.cases.find(item => item.id === control.case);
    const receipt = structuredClone(fixtureReceipt(profile, spec));
    switch (control.mutation) {
      case null: break;
      case 'candidate': receipt.binding.candidate = 'wrong'; break;
      case 'input': receipt.binding.inputHex = '620a'; break;
      case 'args': receipt.binding.argv = ['headers']; break;
      case 'caps': receipt.binding.caps.maxWork++; break;
      case 'factory': receipt.binding.factory.limits.maxOutputBytes = 1; break;
      case 'primary': receipt.staticPath.primary = 'unrelated'; break;
      case 'diagnosticPath': receipt.staticPath.diagnosticPath = 'unrelated failure'; break;
      case 'status': receipt.observation.result.exitCode = 0; break;
      case 'reason': receipt.observation.reason = { token: 'sink', exactIdentity: true }; break;
      case 'caller': receipt.observation.callerAborted = true; break;
      case 'cleanup': receipt.observation.cleanupFailures = [{ token: 'cleanup', exactIdentity: true }]; break;
      case 'partial': receipt.observation.stderrHex = '78'; break;
      case 'overbudget': receipt.observation.stderrHex = '787878'; break;
      case 'reservation': receipt.staticPath.ledger.reservedOutput = 0; break;
      case 'uncharged': receipt.staticPath.ledger.finalWork = 0; break;
      case 'missingStdout': delete receipt.observation.stdoutHex; break;
      case 'missingStderr': delete receipt.observation.stderrHex; break;
      case 'invocations': receipt.invocations = 2; break;
      case 'admission': receipt.admissionBeforeAcquisition = false; break;
      case 'intact': receipt.intact = false; break;
      case 'closed': receipt.closed = false; break;
      case 'omitDiagnostic': receipt.observation.stderrHex = ''; receipt.observation.counts.stderrWrites = 0; break;
      case 'wrongReasonIdentity': receipt.observation.reason.exactIdentity = false; break;
      case 'maskReason': receipt.observation.settlement = 'fulfilled'; receipt.observation.result = { exitCode: 1 }; receipt.observation.reason = null; break;
      default: throw new IntegrityFailure(`UNSEALED_MUTATION:${control.mutation}`);
    }
    await outcome(control.id, control.accept ? 'positive' : 'negative', { classification: 'COUNTERFEIT_FIXTURE_NOT_PRODUCT', receipt }, () => {
      if (control.accept) assertConditional(profile, spec, receipt);
      else assert.throws(() => assertConditional(profile, spec, receipt));
    });
  }
  await outcome('failed-required-phase', 'negative', { build: 'FAIL', child: 'PASS' }, () => assert.equal(aggregate([{ id: 'build', status: 'FAIL' }, { id: 'child:test', status: 'PASS' }]), 1));
  await outcome('missing-required-phase', 'negative', { build: 'ABSENT', child: 'PASS' }, () => assert.equal(aggregate([{ id: 'child:test', status: 'PASS' }]), 1));
  await outcome('ordinary-failure-continues', 'positive', { states: parentResults.slice(0, 4) }, () => {
    assert.deepEqual(parentResults.slice(0, 4).map(item => item.state), ['PASS', 'FAIL', 'FAIL', 'FAIL']);
    assert.ok(children.slice(0, 4).every(child => child.reaped && !child.timeout));
    assert.equal(aggregateExit({ phases: parentResults.slice(0, 4).flatMap(item => item.phases), perLayout: { SOURCE: emptyLayout }, requiredPhases: [] }), 1);
  });
  await outcome('unsafe-receipt-stops', 'negative', { control: parentResults.find(item => item.id === 'parent-cleanup-false') }, () => {
    const control = parentResults.find(item => item.id === 'parent-cleanup-false');
    assert.equal(control.state, 'HOLD');
    assert.deepEqual(control.phases, [{ id: 'build', status: 'PASS' }]);
    assert.equal(control.admitted, undefined);
  });
  for (const name of ['source', 'package']) {
    const directory = path.join(evidence, `fixture-${name}`); await mkdir(directory);
    await durable(path.join(directory, 'original.json'), { fixture: name });
    const baseline = await tree(directory); await verifyTree(directory, baseline);
    await durable(path.join(directory, 'appended.json'), { syntheticUnauthorizedAppend: true });
    await outcome(`append-aware-${name}`, 'negative', { baseline, after: await tree(directory), actualProductTree: false }, async () => {
      await assert.rejects(verifyTree(directory, baseline));
    });
  }
  let release; let settled = false;
  const actualPromise = new Promise(resolve => { release = resolve; });
  const context = { invoke() { return actualPromise; } };
  const invocation = forwardInvocation(context, ['count'], { replaceEnv: true });
  const middleware = forwardMiddleware({}, () => actualPromise);
  actualPromise.then(() => { settled = true; });
  await outcome('actual-promise-identity', 'positive', { invocationSame: invocation === actualPromise, middlewareSame: middleware === actualPromise }, () => {
    assert.equal(invocation, actualPromise); assert.equal(middleware, actualPromise);
  });
  await Promise.resolve(); const before = settled;
  release({ exitCode: 17 }); const returned = await middleware;
  await outcome('middleware-readiness-results', 'positive', { before, returned, after: settled }, () => {
    assert.equal(before, false); assert.deepEqual(returned, { exitCode: 17 }); assert.equal(settled, true);
  });
  const parentSource = await readFile(path.join(root, 'overlay/actual-review-v2/runner.mjs'), 'utf8');
  const section = extractSection(parentSource);
  await outcome('overlay-mechanical-byte-proof', 'positive', { parentHash: hash(parentSource), sectionHash: section.sha256, adapter: bindings.overlays.adapter }, async () => {
    assert.equal(section.sha256, bindings.overlays.parentSectionSha256);
    assert.equal(await readFile(path.join(root, 'parent-section.mjs'), 'utf8'), section.module);
    assert.equal(hash(parentSource), bindings.overlays.parent.afterSha256);
    const original = await readFile(path.join(root, '../actual-review-v2/runner.mjs'), 'utf8');
    assert.equal(hash(original), bindings.overlays.parent.beforeSha256);
    assert.equal(transformParent(original).source, parentSource);
    const adapter = await readFile(path.join(root, '../actual-review-v2/adapter.mjs'), 'utf8');
    const mechanical = bindings.inheritedMechanical.changes['tests/commands/xan-module-review-20260828/actual-review-v2/adapter.mjs'];
    assert.equal(transformAdapter(adapter, mechanical).source, await readFile(path.join(root, 'overlay/actual-review-v2/adapter.mjs'), 'utf8'));
    assert.ok(parentSource.includes('phases.push(final.requiredChildPhase)'));
    assert.ok(parentSource.includes('aggregateExit({ stopped, phases, perLayout, requiredPhases })'));
    assert.ok(parentSource.includes('await verifyTree(source, admission.source); await verifyTree(tools, admission.tools); await verifyTree(installed, admission.installed);'));
  });
  for (const limit of ['maxWork', 'maxRetainedBytes']) {
    const text = profile.diagnosticWhenFit[limit];
    await outcome(`full-when-fit-${limit}`, 'positive', { text, assumption: 'SYNTHETIC adequate caps, NOT raised original case caps' }, () => assertAdequateDiagnostic(text, Buffer.from(text).toString('hex')));
    await outcome(`omission-when-fit-${limit}`, 'negative', { text, actualHex: '' }, () => assert.throws(() => assertAdequateDiagnostic(text, '')));
  }
  await verify();
} catch (error) {
  stopped = { name: error.name, message: error.message, stack: error.stack };
  await durable(path.join(evidence, 'STOP.json'), stopped);
}
await durable(path.join(evidence, 'CHILDREN.json'), children);
await durable(path.join(evidence, 'CONTROLS-RESULT.json'), results);
const expectedCount = controls.parent.length + controls.predicates.length + controls.other.length;
const result = { classification: 'SYNTHETIC_ONLY_NOT_PRODUCT_PASSES', presealCommit, presealSha256: hash(sealBytes),
  attempted: results.length, expected: expectedCount, passed: results.filter(item => item.passed).length,
  failed: results.filter(item => !item.passed).length, positive: results.filter(item => item.polarity === 'positive').length,
  negative: results.filter(item => item.polarity === 'negative').length,
  childrenStarted: children.length, childrenClosed: children.filter(child => child.reaped).length,
  sourceExecution: 0, candidateImports: 0, candidateInvocations: 0, compilation: 0, typechecks: 0, native: 0,
  attempts: 1, retries: 0, futureCases: profile.cases.length, futureMaximumInvocations: 22,
  futureStatus: 'HELD_PENDING_ROOT_EXACT_DENIAL_REVIEW_AND_MATERIALIZED_GRAPH', stopped: stopped ?? null,
  helperQualification: 'counterfeit receipt predicate only',
  parentIntegrationQualification: 'exact extracted overlay callsite with real ordinary children and unchanged A01; full product parent NOT run',
  ended: new Date().toISOString() };
result.exitCode = stopped || result.failed || result.attempted !== expectedCount || result.childrenStarted !== result.childrenClosed ? 1 : 0;
await durable(path.join(evidence, 'RESULT.json'), result);
console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
