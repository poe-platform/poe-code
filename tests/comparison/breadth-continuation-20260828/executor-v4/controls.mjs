import strictAssert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hash, requireThat, settle, serial, settled, identity, candidate, pack, relativeName } from './safety.mjs';
import { inspectTree, writeView, boundFile } from '../executor-v3/projection.mjs';
import { assessWorkflow, validateTelemetry } from './predicates.mjs';
import { byteInput, telemetryOutcome } from '../executor-overlay-v2/telemetry.mjs';
import { assessWhich, instrumentFilesystem } from '../executor-v3/w07.mjs';
import { parseTransport } from '../executor-v3/transport.mjs';
import { assessLoadedNoop } from './loaded-outcome.mjs';

const ownedAssertion = Symbol('owned verifier assertion');
const asserting = operation => (...args) => {
  try { return operation(...args); }
  catch (error) { if (error.code === 'ERR_ASSERTION') error[ownedAssertion] = true; throw error; }
};
const assert = new Proxy(asserting(strictAssert), { get(_target, name) { return typeof strictAssert[name] === 'function' ? asserting(strictAssert[name].bind(strictAssert)) : strictAssert[name]; } });

export function syntheticReport(specimen) {
  const initial = [{ path: '/fixture', type: 'directory', mode: 0o777 }];
  for (const directory of specimen.directories) initial.push({ path: `/fixture/${directory}`, type: 'directory', mode: 0o777 });
  for (const [name, file] of Object.entries(specimen.files)) initial.push({ path: `/fixture/${name}`, type: 'file', ...file });
  const after = structuredClone(initial);
  for (const [name, file] of Object.entries(specimen.expected.addedFiles)) after.push({ path: `/fixture/${name}`, type: 'file', ...file });
  return { captureErrors: [], before: { complete: true, entries: initial }, after: { complete: true, entries: after.filter(entry => !specimen.expected.absent.includes(entry.path.slice(9))) }, result: { ...specimen.expected }, additionalObservations: Object.fromEntries((specimen.additionalObservations ?? []).map(name => [name, true])) };
}
export async function controls({ root, work, workflows, child: launchChild, integrity, actualC11, only = null }) {
  let family;
  const child = config => launchChild({ ...config, family });
  const families = Array.from({ length: 12 }, (_, index) => ({ id: `C${String(index + 1).padStart(2, '0')}` })).filter(row => !only || only.includes(row.id));
  requireThat(only === null || ['["C03","C04","C05"]', '["C03","C04"]'].includes(JSON.stringify(only)), 'CONTROL_SELECTION', only);
  const fixtures = ['loaded.mjs', 'loaded.cjs', 'require-consumer.mjs'].map(name => { const bytes = fs.readFileSync(path.join(root, '../executor-v3/fixtures', name)); return { path: name, mode: 0o644, bytes: bytes.length, sha256: hash(bytes) }; });
  const view = { root: path.join(work, 'synthetic-view'), files: fixtures };
  writeView(view.root, fixtures, entry => fs.readFileSync(path.join(root, '../executor-v3/fixtures', entry.path)));
  const guarded = async () => { await integrity(); inspectTree(view.root, fixtures); };
  const caught = (action, code) => assert.throws(action, error => error.code === code);
  const negativeChild = receipt => {
    requireThat(receipt.reaped && receipt.close && receipt.exit, 'CONTROL_UNREAPED', receipt);
    return receipt.records.at(-1)?.report;
  };
  const actions = {
    C01() { identity({ candidate, packSha256: pack }); caught(() => identity({ candidate: 'wrong', packSha256: pack }), 'CANDIDATE'); caught(() => identity({ candidate, packSha256: 'wrong' }), 'PACK'); return { bindingRejects: 2 }; },
    C02() { caught(() => boundFile(path.join(view.root, 'loaded.mjs'), { ...fixtures[0], sha256: '0'.repeat(64) }), 'FILE_HASH'); return { wrongHash: true }; },
    async C03() {
      const positive = await child({ mode: 'load', view }); assert(settled(positive)); assert(positive.records.some(row => row.kind === 'nextLoad' && row.format === 'module'));
      const cjs = await child({ mode: 'load', entry: 'loaded.cjs', view }); assert(settled(cjs)); assert(cjs.records.some(row => row.kind === 'nextLoad' && row.format === 'commonjs')); assert.equal(cjs.records.at(-1).report.observation.value, 19);
      const required = await child({ mode: 'require', entry: 'require-consumer.mjs', view }); assert(settled(required)); assert(required.records.some(row => row.kind === 'nextLoad' && row.format === 'commonjs')); assert.equal(required.records.at(-1).report.observation.value, 19);
      const wrong = await child({ mode: 'load', view: { ...view, files: [{ ...fixtures[0], sha256: '0'.repeat(64) }] } }); assert(settled(wrong)); assert.equal(negativeChild(wrong).caught.code, 'LOAD_HASH'); return { actualESM: true, actualCJS: true, wrongReturnedSourceDenied: true };
    },
    async C04() {
      const wrong = await child({ mode: 'load', view: { ...view, files: [] } }); assert(settled(wrong)); assert.equal(negativeChild(wrong).caught.code, 'UNBOUND_MODULE');
      const offline = await child({ mode: 'offline', view }); assert(settled(offline)); assert.equal(negativeChild(offline).caught.code, 'OFFLINE_DENIED'); assert.equal(negativeChild(offline).denials.length, 6); return { unboundModule: true, noNetworkOperation: true, operationDenials: 7 };
    },
    C05() {
      inspectTree(view.root, fixtures);
      const extra = path.join(view.root, 'unexpected'); fs.writeFileSync(extra, ''); try { caught(() => inspectTree(view.root, fixtures), 'UNLISTED_ENTRY'); } finally { fs.unlinkSync(extra); }
      const listed = path.join(view.root, 'loaded.mjs');
      fs.chmodSync(listed, 0o600); try { caught(() => inspectTree(view.root, fixtures), 'FILE_METADATA'); } finally { fs.chmodSync(listed, 0o644); }
      const held = path.join(work, 'held-synthetic-file'); fs.renameSync(listed, held);
      try { fs.symlinkSync(held, listed); caught(() => inspectTree(view.root, fixtures), 'SYMLINK'); } finally { fs.unlinkSync(listed); fs.renameSync(held, listed); }
      caught(() => relativeName('nested/AGENTS.md'), 'INSTRUCTION');
      return { realFreshTreeNegatives: 3, instructionPlaintextNeitherCreatedNorRead: true };
    },
    async C06() {
      const row = workflows.find(row => row.id === 'W03'); const report = syntheticReport(row);
      const input = byteInput(row, 'virtual-bash'); for await (const bytes of input.stdin) assert(bytes.length > 0);
      report.telemetry = telemetryOutcome(row, 'virtual-bash', input.receipt, [{ command: 'cat' }], true);
      assert.equal(assessWorkflow(row, report, 'virtual-bash').pass, null);
      const bad = structuredClone(report); bad.result.stdoutBase64 = '77+9'; bad.after.entries.find(entry => entry.path === '/fixture/copied').base64 = '77+9'; assert.equal(assessWorkflow(row, bad, 'virtual-bash').pass, false);
      return { exactBytes: true, unsupportedUnqualified: true };
    },
    C07() { const row = workflows[0], report = syntheticReport(row); assert(assessWorkflow(row, report).pass); for (const change of [{ exitCode: 7 }, { stderrBase64: 'eA==' }]) assert(!assessWorkflow(row, { ...report, result: { ...report.result, ...change } }).pass); return { wrongStatus: true, wrongDiagnostic: true }; },
    C08() { const row = workflows.find(row => row.id === 'W09'), report = syntheticReport(row); assert(assessWorkflow(row, report).pass); report.after.entries.push({ path: '/fixture/unlisted', type: 'file', base64: '' }); assert(!assessWorkflow(row, report).pass); return { extraFilesystemEffect: true }; },
    async C09() {
      const wrongExit = await child({ mode: 'nonzero', view }); negativeChild(wrongExit); assert(!settled(wrongExit)); assert.equal(wrongExit.exit.code, 7);
      const leaked = await child({ mode: 'leak', view }); const report = negativeChild(leaked); assert(leaked.signals.includes('SIGTERM')); assert(leaked.failures.some(error => error.code === 'NATURAL_DEADLINE')); assert(report.timerRetired); assert(!settled(leaked));
      return { intentionalNegativeChildren: 2, timerRetired: true, allReaped: true };
    },
    async C10() { const receipt = await serial([{ id: 'failure' }, { id: 'tail' }], async () => ({ safe: true, pass: false }), async () => {}); assert.equal(receipt.rows.length, 2); assert(!receipt.unsafe); return { ordinaryAssertionsContinueOnlyWhenSafe: true }; },
    async C11() {
      if (!actualC11) return { status: 'MODEL_ONLY_ACTUAL_HELD', actualExecCalls: 0 };
      const positive = await actualC11(false); const negative = await actualC11(true);
      requireThat(settled(positive) && settled(negative), 'C11_UNSAFE', { positive, negative });
      assert(positive.records.at(-1).report.pass && negative.records.at(-1).report.pass);
      return { actualSetupExecCalls: 2, positiveAndRejectedPlugin: true };
    },
    async C12() {
      const receipt = await child({ mode: 'load', view }); assert(settled(receipt));
      const observed = receipt.records.at(-1).report;
      const row = workflows.find(row => row.id === 'W02');
      const result = assessLoadedNoop(row, syntheticReport(row).before, observed, receipt.records.filter(record => record.kind === 'nextLoad'));
      assert(result.pass);
      return { actualNoopLoad: observed, assessedLoadedOutcome: result };
    },
  };
  const result = await serial(families, async item => {
    family = item.id;
    let observation;
    try { observation = await actions[item.id](); }
    catch (error) { if (error[ownedAssertion] !== true) throw error; await guarded(); return { safe: true, pass: false, assertion: { message: error.message, stack: error.stack } }; }
      return { safe: true, pass: true, observation };
  }, guarded);
  for (const row of result.rows) if (row.observation?.status === 'MODEL_ONLY_ACTUAL_HELD') { row.status = 'HELD_ACTUAL_C11'; row.pass = null; }
  return result;
}
export async function defectControls() {
  const rows = [];
  let disposed = 0;
  const primary = new Error('primary'); const disposeFailure = new Error('dispose-failure');
  const outcome = await settle({ body: async () => { throw primary; }, dispose: async () => { disposed++; throw disposeFailure; }, emit: async phase => { throw new Error(`emitter:${phase}`); } });
  assert.equal(disposed, 1); assert.equal(outcome.primary, primary); assert.deepEqual(outcome.errors.map(row => row.phase), ['body', 'emit:dispose-start', 'dispose', 'emit:dispose-settled']); assert(!outcome.safe);
  rows.push({ id: 'F1', pass: true, retained: outcome.errors });
  for (const phase of ['dispose', 'supervision', 'integrity', 'control']) {
    let calls = 0;
    const result = await serial([{ id: 'first' }, { id: 'tail' }], async () => { calls++; if (phase !== 'integrity') throw new Error(phase); return { safe: true, pass: true }; }, async () => { if (phase === 'integrity') throw new Error(phase); });
    assert(result.unsafe); assert.equal(result.rows[1].status, 'UNRUN_UNSAFE_TAIL'); assert.equal(calls, phase === 'integrity' ? 0 : 1);
    rows.push({ id: `F2:${phase}`, pass: true, calls });
  }
  for (const engine of ['virtual-bash', 'just-bash']) for (const telemetry of [undefined, {}, { inputAdmission: { status: 'QUALIFIED' } }, Object.fromEntries(['inputAdmission', 'chunks', 'dispatch', 'timers', 'iteratorCleanup'].map(name => [name, { status: 'QUALIFIED' }]))]) { assert(validateTelemetry(engine, telemetry).length); rows.push({ id: `F3:${engine}:${rows.length}`, pass: true }); }
  const events = []; const target = { async stat() { assert.equal(this, target); return {}; }, async access() { assert.equal(this, target); } };
  const wrapped = instrumentFilesystem(target, events, () => 'semantic'); await wrapped.stat('/fixture/bin/tool'); await wrapped.access('/fixture/bin/tool', 1);
  const snapshot = { entries: [{ path: '/fixture/bin/tool', mode: 0o755 }] };
  const observation = assessWhich(events, [{ command: 'which' }], snapshot, snapshot, 'virtual-bash'); assert(Object.values(observation.observations).every(Boolean));
  for (const [name, alteredEvents, dispatches, final] of [['missing-access', events.slice(0, 1), [], snapshot], ['fixture-executed', events, [{ command: 'tool' }], snapshot], ['mode-changed', events, [], { entries: [{ path: '/fixture/bin/tool', mode: 0o644 }] }]]) { assert(Object.values(assessWhich(alteredEvents, dispatches, snapshot, final, 'virtual-bash').observations).some(value => !value)); rows.push({ id: `W07:${name}`, pass: true }); }
  for (const text of ['', '{}', '{"sequence":0,"kind":"phase"}\n', '{"sequence":1,"kind":"final"}\n']) { assert.throws(() => parseTransport(Buffer.from(text))); rows.push({ id: 'transport-negative', pass: true }); }
  return rows;
}
