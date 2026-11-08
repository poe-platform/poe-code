import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { authenticatePacket } from '../../breadth-continuation-20260828/executor-v5/authorization.mjs';
import { viewProjection } from '../../breadth-continuation-20260828/executor-v5/projection.mjs';
import { phasePlan, bindGrantPlan, authorizeOperation } from '../../breadth-continuation-20260828/executor-v4/operations.mjs';
import { settle, serial, hash, errorRecord } from '../../breadth-continuation-20260828/executor-v4/safety.mjs';
import { createLedger, launchTracked } from '../../breadth-continuation-20260828/executor-v4/launch-ledger.mjs';
import { transport } from '../../breadth-continuation-20260828/executor-v3/transport.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const candidate = path.resolve(own, '../../breadth-continuation-20260828/executor-v5');
const writer = transport();
const plan = JSON.parse(fs.readFileSync(path.join(candidate, 'OPERATION-PLAN.json')));
const projection = JSON.parse(fs.readFileSync(path.join(candidate, '../executor-v3/PROJECTION.json')));
const rows = [];
async function check(id, action) {
  try { rows.push({ id, pass: true, observation: await action() }); }
  catch (error) { rows.push({ id, pass: false, error: errorRecord(error) }); }
}
await check('candidate-packet-authentication', () => {
  const actual = authenticatePacket(candidate);
  assert.equal(actual, 'afb0a451dba689d0337211892c73fcee2d84ffa83567ca8eb1ae1e8e73568986');
  return { actual, appendDetection: 'candidate and inherited recipe namespaces; designated runs excluded by candidate policy' };
});
await check('metadata-projection-closure', () => {
  assert.equal(projection.candidate, '67eab12e315054907ef4ef435c6bbca2f59e0c36');
  assert.equal(projection.target.pack.sha256, '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06');
  assert.equal(projection.target.files.length, 858);
  assert.equal(projection.baseline.closure.files.length, 3844);
  assert.equal(projection.baseline.excluded.length, 1);
  const views = ['target-installed', 'target-moved', 'baseline-installed'].map(name => ({ name, ...viewProjection(projection, name) }));
  assert.deepEqual(views.map(view => view.files.length), [860, 860, 3845]);
  assert.deepEqual(views.map(view => view.consumerPath), ['consumer-v5/consumer.mjs', 'consumer-v5/consumer.mjs', 'benchmarks/consumer-v5/consumer.mjs']);
  assert(views.every(view => !view.files.some(entry => entry.path.split('/').some(part => part.toUpperCase() === 'AGENTS.MD'))));
  return { candidate: projection.candidate, targetPack: projection.target.pack, baselineArchive: projection.baseline.archive, baselineOriginalCount: 3844, comparatorRetained: 3843, excludedMetadata: projection.baseline.excluded, views: views.map(({ files, ...view }) => ({ ...view, count: files.length, sha256: hash(JSON.stringify(files)) })), actualArchiveRead: false };
});
await check('unchanged-inherited-identities', () => {
  const seal = JSON.parse(fs.readFileSync(path.join(candidate, 'SEAL.json')));
  const prior = JSON.parse(fs.readFileSync(path.join(candidate, '../executor-v4/SEAL.json')));
  const names = ['safety.mjs', 'operations.mjs', 'launch-ledger.mjs', 'loaded-outcome.mjs', 'supervisor.mjs', 'controls.mjs', 'adapter.mjs', 'predicates.mjs'];
  const identities = names.map(name => {
    const before = prior.files.find(entry => entry.path === name);
    const after = seal.files.find(entry => entry.path === `../executor-v4/${name}`);
    assert.equal(before.sha256, after.sha256);
    assert.equal(hash(fs.readFileSync(path.join(candidate, '../executor-v4', name))), before.sha256);
    return { name, sha256: before.sha256 };
  });
  return identities;
});
const context = { root: candidate, phase: 'admission', runId: 'data-only-not-a-grant', outputRoot: path.join(candidate, 'runs/data-only-not-a-grant') };
const model = { documentKind: 'DATA_ONLY_NO_AUTHORITY_ROLE_OR_CANDIDATE_OR_REVIEW', phase: context.phase, runId: context.runId, outputRoot: context.outputRoot, planSha256: hash(JSON.stringify(phasePlan(plan, context.phase))), command: { entry: 'coordinator.mjs', phase: context.phase, runId: context.runId, nodeArgs: plan.command.nodeArgs } };
await check('phase-plan-positive', () => { const bound = bindGrantPlan(model, context, plan); assert.equal(bound.operations.length, 14); assert.equal(plan.cohort.length, 99); return { planSha256: model.planSha256, limits: plan.limits }; });
for (const [id, mutation, code] of [
  ['old-output-root-denied', { outputRoot: context.outputRoot.replace('executor-v5', 'executor-v4') }, 'GRANT_RUN_BINDING'],
  ['wrong-run-denied', { runId: 'other' }, 'GRANT_RUN_BINDING'],
  ['wrong-plan-denied', { planSha256: '0'.repeat(64) }, 'GRANT_PLAN_BINDING'],
  ['wrong-command-denied', { command: { ...model.command, phase: 'cohort' } }, 'GRANT_COMMAND_BINDING'],
]) await check(id, () => { assert.throws(() => bindGrantPlan({ ...model, ...mutation }, context, plan), error => error.code === code); return { code }; });
await check('case-in-admission-denied', () => { assert.throws(() => authorizeOperation(model, { kind: 'case' }, plan, context, 'engine'), error => error.code === 'OPERATION_PHASE'); return { engineWork: 0 }; });
await check('probe-in-cohort-denied', () => {
  const next = { ...context, phase: 'cohort' };
  const data = { ...model, phase: 'cohort', planSha256: hash(JSON.stringify(phasePlan(plan, 'cohort'))), command: { ...model.command, phase: 'cohort' } };
  assert.throws(() => authorizeOperation(data, { kind: 'probe' }, plan, next, 'engine'), error => error.code === 'OPERATION_PHASE');
  return { engineWork: 0 };
});
for (const [id, primary] of [['null-primary-retained', null], ['undefined-primary-retained', undefined]]) await check(id, async () => {
  let disposals = 0;
  const result = await settle({ body: async () => { throw primary; }, dispose: async () => { disposals++; throw Error('dispose'); }, emit: async phase => { throw Error(phase); } });
  assert.equal(result.hasPrimary, true); assert.equal(result.primary, primary); assert.equal(disposals, 1);
  assert.deepEqual(result.errors.map(error => error.phase), ['body', 'emit:dispose-start', 'dispose', 'emit:dispose-settled']);
  return { hasPrimary: result.hasPrimary, primaryType: primary === null ? 'null' : typeof primary, disposals, phases: result.errors.map(error => error.phase), safe: result.safe };
});
await check('enrollment-before-EEXIST', async () => {
  const ledger = createLedger(1);
  const collision = path.join(own, 'capture-01/collision.json');
  fs.writeFileSync(collision, 'owned collision\n', { flag: 'wx' });
  let launched = false;
  await assert.rejects(launchTracked({ ledger, kind: 'DATA', prepare: async () => { assert.equal(ledger.entries.length, 1); fs.writeFileSync(collision, '', { flag: 'wx' }); }, supervise: async () => { launched = true; }, persist: async () => 'unused' }), error => error.code === 'LAUNCH_UNSAFE' && error.original.code === 'EEXIST');
  assert.equal(launched, false); assert.equal(ledger.entries[0].state, 'UNSAFE_STOP');
  assert.throws(() => ledger.enroll('tail'), error => error.code === 'LAUNCH_LEDGER_BOUND');
  return { summary: ledger.summary(), entries: ledger.entries, actualChildren: 0, boundary: 'prepare-time persistence collision; post-child persist collision remains historical independently authenticated coverage' };
});
await check('unsafe-tail-preserved', async () => {
  let calls = 0;
  const result = await serial([{ id: 'first' }, { id: 'tail' }], async () => { calls++; throw Error('owned failure'); }, async () => {});
  assert.equal(calls, 1); assert.equal(result.rows[0].status, 'UNSAFE_STOP'); assert.equal(result.rows[1].status, 'UNRUN_UNSAFE_TAIL');
  return result;
});
assert.deepEqual(rows.map(row => row.id), JSON.parse(fs.readFileSync(path.join(own, 'EXPECTATIONS.json'))).dataControls);
writer.emit({ kind: 'final', report: { id: 'data', rows, pass: rows.every(row => row.pass) } });
