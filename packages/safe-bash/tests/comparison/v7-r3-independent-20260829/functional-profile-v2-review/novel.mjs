import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-functional-profile-v2-20260829/adapter.mjs';
import { createInvocationRecorder, invocationContext, receiptInvocations, aggregateInvocations } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-functional-profile-v2-20260829/invocations.mjs';
import { assessSemanticTerminal, supervisorData } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-functional-profile-v2-20260829/semantic-assessor.mjs';
import { compose, receipt, changedTerminal } from './generated/fixtures.mjs';
const home = path.dirname(fileURLToPath(import.meta.url));
const context = (layout = 'baseline-installed', ordinal = 1) => invocationContext({ operationId: 'case-' + ordinal, operationOrdinal: ordinal, launchOrdinal: ordinal, specimenSha256: 'a'.repeat(64), layout });
const rejectIdentity = async (action, expected) => { let caught = false, actual; try { await action(); } catch (error) { caught = true; actual = error; } assert.equal(caught, true); assert.equal(actual, expected); };
export async function run(author) {
  const rows = [];
  const observation = fs.openSync(path.join(home, 'work/NOVEL-OBSERVATIONS.ndjson'), 'wx', 0o600);
  const capture = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert(bytes.length <= 1048576); fs.writeSync(observation, bytes); fs.fsyncSync(observation); };
  const test = async (id, body) => { try { rows.push({ id, pass: true, detail: await body() ?? null }); } catch (error) { rows.push({ id, pass: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 2048) }); } };
  try {
    for (const engine of ['just-bash', 'virtual-bash']) await test(engine === 'just-bash' ? 'N01-real-adapter-stub-comparator-constructor' : 'N02-real-adapter-stub-target-constructor', async () => {
      const sentinel = Object.assign(new Error('STOP_AT_STUB_CONSTRUCTOR'), { code: 'STUB_CONSTRUCTOR' }); let config, constructors = 0, executions = 0;
      class EmptyFilesystem {}
      class ConstructorOnly { constructor(value) { config = value; constructors++; throw sentinel; } exec() { executions++; } }
      const library = { InMemoryFs: EmptyFilesystem, Bash: ConstructorOnly, Shell: ConstructorOnly, createMemoryFileSystem: () => new EmptyFilesystem() };
      const specimen = { id: 'W-CONSTRUCTOR-ONLY', cwd: '/fixture', env: { DECLARED: 'one' } };
      const report = await observe({ library, engine, specimen, bindings: {}, namespaces: {}, emit() {}, invocation: null, authorization: { rootGo: true, differentFreeze: 'synthetic-only', candidate: '67eab12e315054907ef4ef435c6bbca2f59e0c36' } });
      capture({ id: engine, constructors, executions, config, report }); assert.equal(constructors, 1); assert.equal(executions, 0); assert.equal(config.cwd, '/fixture'); assert.equal(config.env, specimen.env); assert.equal(report.safety.hasPrimary, true);
      if (engine === 'just-bash') { assert.equal(config.defenseInDepth, false); assert.equal(config.executionLimitProfile, 'normal'); assert.equal(config.executionLimits.maxExecutionTimeMs, 30000); }
      else { assert.equal(Object.hasOwn(config, 'defenseInDepth'), false); assert.equal(config.limits.maxOutputBytes, 65536); }
      return { actualAdapterInvokedWithOwnedStub: true, realConstructorOrSecurityEffectProved: false };
    });
    await test('N03-pending-attempt-before-callee-and-settlement', async () => {
      const events = []; let release; const pending = new Promise(resolve => { release = resolve; }); const receiver = { marker: 3 }; const record = createInvocationRecorder(context(), event => events.push(event));
      const work = record.invoke('semantic', receiver, function(value) { assert.equal(this, receiver); assert.equal(value, 19); assert.equal(events[0].event, 'attempted'); return pending; }, [19]);
      assert.deepEqual(record.snapshot().semantic, { attempted: 1, fulfilled: 0, rejected: 0, unresolved: 1 }); release(23); assert.equal(await work, 23); assert.deepEqual(record.snapshot().semantic, { attempted: 1, fulfilled: 1, rejected: 0, unresolved: 0 });
    });
    await test('N04-fulfillment-precedes-fallible-conversion', async () => {
      const record = createInvocationRecorder(context(), () => {}); const result = await record.invoke('semantic', null, () => ({ get stdout() { throw undefined; } }), []);
      await rejectIdentity(() => result.stdout, undefined); assert.equal(record.snapshot().semantic.fulfilled, 1); assert.equal(record.snapshot().semantic.rejected, 0); assert.equal(record.snapshot().semanticCredit, false);
    });
    await test('N05-false-primary-with-undefined-outcome-publication', async () => {
      const record = createInvocationRecorder(context(), event => { if (event.event === 'rejected') throw undefined; });
      await rejectIdentity(() => record.invoke('semantic', null, () => { throw false; }, []), false);
      const snapshot = record.snapshot(); assert.deepEqual(snapshot.semantic, { attempted: 1, fulfilled: 0, rejected: 0, unresolved: 1 }); assert.equal(snapshot.failures[0].phase, 'outcome-publication'); assert.equal(snapshot.failures[0].reason.type, 'undefined');
    });
    await test('N06-attempt-publication-false-prevents-call', async () => {
      let calls = 0; const record = createInvocationRecorder(context(), () => { throw false; });
      await rejectIdentity(() => record.invoke('semantic', null, () => { calls++; }, []), false); assert.equal(calls, 0); assert.equal(record.snapshot().semantic.attempted, 0); assert.equal(record.snapshot().failures[0].reason.value, false);
    });
    await test('N07-two-attempts-are-not-one-legacy-completion', async () => {
      const firstEvents = [], secondEvents = []; const firstContext = context('target-installed', 1), secondContext = context('baseline-installed', 2);
      const first = createInvocationRecorder(firstContext, event => firstEvents.push(event)); await first.invoke('empty-setup', null, () => 0, []); await first.invoke('semantic', null, () => 0, []);
      const second = createInvocationRecorder(secondContext, event => secondEvents.push(event)); await rejectIdentity(() => second.invoke('semantic', null, () => Promise.reject(false), []), false);
      const counts = aggregateInvocations([{ operationId: 'case-1', operationOrdinal: 1, counts: receiptInvocations(receipt(firstEvents), firstContext) }, { operationId: 'case-2', operationOrdinal: 2, counts: receiptInvocations(receipt(secondEvents), secondContext) }]);
      capture({ id: 'N07', counts, syntheticLegacyCompleted: { semantic: 1, emptySetup: 1 }, historicalReconstruction: false }); assert.deepEqual(counts.semantic, { attempted: 2, fulfilled: 1, rejected: 1, unresolved: 0 }); assert.equal(counts.emptySetup.attempted, 1); assert.equal(counts.totalAttempted, 3); assert.equal(counts.dispatchAttemptIsCalleeEntry, false);
    });
    await test('N08-observation-before-receipt-persistence-failure', async () => {
      const value = await compose('independent-persistence-false', { tweak(drivers) { const checkpoint = drivers.checkpoint; drivers.checkpoint = async (...args) => { if (args[0] === 'receipt-persistence') throw false; return checkpoint(...args); }; } });
      capture({ id: 'N08', output: value.result.output, publication: value.result.publication, ledger: value.result.ledger, receipt: value.receipt });
      assert.equal(value.result.output.unsafe, true); assert.equal(value.result.output.invocationRows.length, 1); assert.equal(value.result.output.invocationRows[0].counts.semantic.attempted, 1); assert.equal(value.result.output.invocationRows[0].counts.emptySetup.attempted, 1); assert.equal(value.result.output.productCohortCalls, 0); assert.equal(value.result.ledger[0].persisted, false); assert.equal(value.result.ledger[0].reaped, true); assert.equal(value.result.publication.exitCode, 1);
    });
    await test('N09-worker-disposition-precedes-bad-telemetry', async () => {
      const value = await compose('independent-invalid-raw-unsafe', { unsafeFirst: true, tweak(drivers) { const supervise = drivers.supervise; drivers.supervise = async (...args) => { const observed = await supervise(...args); observed.rawRecords = 'AAAA'; observed.captureBytes.records = 3; return observed; }; } });
      capture({ id: 'N09', output: value.result.output, publication: value.result.publication, ledger: value.result.ledger, receipt: value.receipt });
      assert.equal(value.result.output.invocationAccountingErrors.length, 1); assert.equal(value.result.output.cohort.rows[0].error.code, 'CHILD_UNSAFE'); assert.equal(value.result.ledger.length, 1); assert.equal(value.result.ledger[0].reaped, true); assert.equal(value.result.publication.exitCode, 1);
    });
    await test('N10-no-synthetic-authority-or-fulfilled-pass-credit', () => {
      assert(author.positive); assert.equal(author.positive.assess().caseCounts.unqualified, 1); assert.equal(author.ordinary.assess().caseCounts.failed, 1); assert.equal(author.ordinary.assess().protocolQualified, true);
      assert.equal(assessSemanticTerminal(author.positive.receipt, author.positive.root).protocolQualified, false);
      const bad = changedTerminal(author.positive.receipt, terminal => { terminal.invocationAccounting.counts.semantic.rejected = 1; }); assert.equal(assessSemanticTerminal(bad, author.positive.root, { syntheticOnly: true }).protocolQualified, false);
    });
    await test('N11-unknown-retirement-and-raw-getter-refuse', () => {
      const bad = structuredClone(author.positive.receipt); bad.reaped = false; assert.throws(() => supervisorData(bad));
      let reads = 0; const raw = receipt([]); Object.defineProperty(raw, 'records', { enumerable: true, get() { reads++; return []; } }); assert.throws(() => receiptInvocations(raw, context())); assert.equal(reads, 0);
    });
    await test('N12-composed-cap-before-any-call', async () => {
      const value = await compose('independent-cap', { tweak(drivers) { drivers.evidenceLimit = 1; } }); capture({ id: 'N12', output: value.result.output, publication: value.result.publication });
      assert.equal(value.result.output.unsafe, true); assert.equal(value.result.output.invocationRows.length, 0); assert.equal(value.result.ledger.length, 0); assert.equal(value.result.publication.exitCode, 1); return { oneByteHelperProfileOnly: true, full248MiBProof: false };
    });
  } finally { fs.fsyncSync(observation); fs.closeSync(observation); }
  return rows;
}
