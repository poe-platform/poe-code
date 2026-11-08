import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkIdentity, candidate, pack, hash, checkRecipe, checkInventory, continuation, errorRecord } from '../executor-preparation-v1/core.mjs';
import { assessWorkflow } from './predicates.mjs';
import { namespaceCountercontrols, actualAdmissionCountercontrol } from './control-extensions.mjs';
import { supervise } from '../executor-preparation-v1/supervisor.mjs';

function caughtCode(action, code) {
  try { action(); }
  catch (error) { assert.equal(error.code, code); return errorRecord(error); }
  assert.fail(`Expected ${code}`);
}
function syntheticReport(specimen) {
  const entries = [{ path: '/fixture', type: 'directory', mode: 493 }];
  for (const [name, file] of Object.entries(specimen.files)) {
    for (const directory of name.split('/').slice(0, -1)) {
      const filename = `/fixture/${directory}`;
      if (!entries.some(entry => entry.path === filename)) entries.push({ path: filename, type: 'directory', mode: 493 });
    }
    entries.push({ path: `/fixture/${name}`, type: 'file', mode: file.mode, base64: file.base64 });
  }
  const after = structuredClone(entries);
  for (const [name, file] of Object.entries(specimen.expected.addedFiles)) after.push({ path: `/fixture/${name}`, type: 'file', mode: 438, base64: file.base64 });
  return { synthetic: true, before: { complete: true, entries }, after: { complete: true, entries: after }, result: { exitCode: specimen.expected.exitCode, stdoutBase64: specimen.expected.stdoutBase64, stderrBase64: specimen.expected.stderrBase64 }, additionalObservations: Object.fromEntries((specimen.additionalObservations ?? []).map(value => [value, true])) };
}
function failsAt(specimen, report, id) {
  const result = assessWorkflow(specimen, report);
  assert.equal(result.pass, false);
  assert(result.checks.some(check => check.id === id && !check.pass), id);
  return result;
}
export async function controlsV2(directory, root, node, guard, namespaces, library, authorization) {
  if (authorization?.rootGo !== true || !authorization?.differentFreeze || authorization.loadedCandidate !== '67eab12e315054907ef4ef435c6bbca2f59e0c36') throw Object.assign(new Error('ROOT_GO_REQUIRED: controls-v2 not authorized'), { code: 'ROOT_GO_REQUIRED' });
  const harnessDirectory = resolve(directory, '../executor-preparation-v1');
  const workflows = JSON.parse(readFileSync(resolve(root, 'WORKFLOWS.json'))).rows;
  const results = [];
  const children = [];
  let unsafe = false;
  const child = async mode => {
    try { guard(); } catch (error) { unsafe = true; throw error; }
    const receipt = await supervise(node, ['--max-old-space-size=256', resolve(harnessDirectory, 'synthetic-child.mjs'), mode], harnessDirectory);
    children.push({ mode, ...receipt });
    try { guard(); } catch (error) { unsafe = true; throw error; }
    if (!receipt.reaped || (!receipt.natural && mode !== 'leak')) { unsafe = true; throw new Error('UNSAFE_SYNTHETIC_LIFECYCLE'); }
    return receipt;
  };
  const control = async (id, run) => {
    if (unsafe) { results.push({ id, status: 'UNRUN_UNSAFE_TEARDOWN' }); return; }
    try { results.push({ id, status: 'SYNTHETIC_MECHANISM_QUALIFIED', evidence: await run() }); }
    catch (error) { results.push({ id, status: 'SYNTHETIC_MECHANISM_FAILED', error: errorRecord(error) }); }
  };
  await control('C01', () => {
    checkIdentity({ candidate, pack });
    return [caughtCode(() => checkIdentity({ candidate: '0'.repeat(40), pack }), 'CANDIDATE_BINDING'), caughtCode(() => checkIdentity({ candidate, pack: '0'.repeat(64) }), 'CANDIDATE_BINDING')];
  });
  await control('C02', () => {
    const row = workflows.find(value => value.id === 'W06');
    const digest = hash(JSON.stringify(row)); checkRecipe(row, digest);
    const wrong = structuredClone(row); wrong.expected.stdoutBase64 = Buffer.from('5\ta.txt\n6\tb.txt\n').toString('base64');
    return caughtCode(() => checkRecipe(wrong, digest), 'RECIPE_HASH');
  });
  await control('C03', async () => {
    const positive = await child('positive');
    assert(positive.natural && positive.exit.code === 0);
    assert(positive.records.some(record => record.kind === 'nextLoad'));
    assert(positive.records.some(record => record.kind === 'evaluated-export-call' && record.observation.evaluated === 'expected'));
    const negative = await child('fallback');
    assert(negative.natural && negative.exit.code === 0);
    assert(negative.records.some(record => record.kind === 'caught' && record.code === 'SOURCE_FALLBACK' && record.message.includes('forbidden-source.mjs')));
    assert(!negative.records.some(record => record.kind === 'evaluated-export-call'));
    return { children: [positive.pid, negative.pid], expectedReject: 'SOURCE_FALLBACK', forbiddenEvaluations: 0 };
  });
  await control('C04', async () => {
    const before = hash(readFileSync(resolve(harnessDirectory, 'fixtures/expected.mjs')));
    const positive = await child('positive');
    assert(positive.natural && positive.records.some(record => record.kind === 'nextLoad'));
    const negative = await child('wrong-load');
    assert(negative.natural);
    assert(negative.records.some(record => record.kind === 'load-attempt' && record.url.endsWith('/wrong.mjs')));
    assert(negative.records.some(record => record.kind === 'caught' && record.code === 'FILE_HASH'));
    assert(!negative.records.some(record => record.kind === 'evaluated-export-call'));
    assert.equal(hash(readFileSync(resolve(harnessDirectory, 'fixtures/expected.mjs'))), before);
    return { children: [positive.pid, negative.pid], wrongLoadedBytesRejected: true, expectedFileUnchanged: true };
  });
  await control('C05', () => {
    const expected = [{ path: 'input', mode: 420, bytes: 1, sha256: hash('x') }];
    const actual = expected.map(entry => ({ ...entry, type: 'file' })); checkInventory(expected, actual);
    return [
      caughtCode(() => checkInventory(expected, [...actual, { ...actual[0], path: 'extra' }]), 'UNLISTED_ENTRY'),
      caughtCode(() => checkInventory(expected, [{ ...actual[0], mode: 493 }]), 'ENTRY_MODE'),
      caughtCode(() => checkInventory(expected, [{ ...actual[0], type: 'symlink' }]), 'ENTRY_TYPE'),
      ...namespaceCountercontrols(namespaces['just-bash']),
      ...namespaceCountercontrols(namespaces['virtual-bash']),
    ];
  });
  await control('C06', () => {
    const row = workflows.find(value => value.id === 'W03'); const report = syntheticReport(row);
    assert(assessWorkflow(row, report).sharedSemanticsPass);
    assert.equal(assessWorkflow(row, report).pass, null);
    const wrong = Buffer.from([0, 239, 191, 189, 65, 10, 13, 128, 0]).toString('base64');
    report.result.stdoutBase64 = wrong; report.after.entries.find(entry => entry.path === '/fixture/copied').base64 = wrong;
    const checks = failsAt(row, report, 'STDOUT_BYTES'); assert(checks.checks.some(check => check.id === 'ADDED:copied' && !check.pass)); return checks;
  });
  await control('C07', () => {
    const row = workflows[0], positive = syntheticReport(row); assert(assessWorkflow(row, positive).pass);
    const status = structuredClone(positive); status.result.exitCode = 7;
    const diagnostic = structuredClone(positive); diagnostic.result.stderrBase64 = 'eA==';
    return [failsAt(row, status, 'STATUS'), failsAt(row, diagnostic, 'STDERR_BYTES')];
  });
  await control('C08', () => {
    const row = workflows.find(value => value.id === 'W09'), positive = syntheticReport(row); assert(assessWorkflow(row, positive).pass);
    const altered = structuredClone(positive); altered.after.entries.find(entry => entry.path === '/fixture/input').base64 = 'eA==';
    const extra = structuredClone(positive); extra.after.entries.push({ path: '/fixture/extra', type: 'file', base64: '' });
    const retained = structuredClone(positive); retained.after.entries.push({ path: '/fixture/stage', type: 'directory' });
    return [failsAt(row, altered, 'PRESERVE:input'), failsAt(row, extra, 'EXACT_NAMESPACE'), failsAt(row, retained, 'ABSENT:stage')];
  });
  await control('C09', async () => {
    const positive = await child('clean'); assert(positive.natural && positive.exit.code === 0);
    const negative = await child('leak');
    assert(negative.reaped && !negative.natural);
    assert(negative.failures.some(error => error.code === 'NATURAL_DEADLINE'));
    assert(negative.records.some(record => record.kind === 'cleanup' && record.timerRetired));
    assert(negative.signals.includes('SIGTERM'));
    return { children: [positive.pid, negative.pid], naturalDeadlineMilliseconds: 30000, expectedLifecycleRejection: true, timerRetired: true, allReaped: true };
  });
  await control('C10', () => {
    assert.equal(continuation({ bindingsIntact: true, reaped: true, natural: true, assertionPass: false }), 'CONTINUE');
    assert.equal(continuation({ bindingsIntact: false, reaped: true, natural: true }), 'STOP');
    assert.equal(continuation({ bindingsIntact: true, reaped: false, natural: false }), 'STOP');
    assert.equal(continuation({ bindingsIntact: true, reaped: true, natural: false }), 'STOP');
    assert.equal(continuation({ bindingsIntact: true, reaped: true, natural: false }, true), 'CONTINUE');
    return { ordinaryFailureContinues: true, unsafeHalts: true, reapedIntentionalNegativeContinues: true };
  });
  await control('C11', async () => actualAdmissionCountercontrol(library, authorization));
  await control('C12', async () => {
    const row = workflows.find(value => value.id === 'W02'), report = syntheticReport(row); assert(assessWorkflow(row, report).pass);
    const receipt = await child('noop'); assert(receipt.natural && receipt.exit.code === 0);
    assert(receipt.records.some(record => record.kind === 'nextLoad'));
    const observation = receipt.records.find(record => record.kind === 'evaluated-export-call');
    assert.equal(observation.observation.exitCode, 0); assert.deepEqual(observation.observation.files, {});
    report.after.entries = structuredClone(report.before.entries);
    const assessment = failsAt(row, report, 'ADDED:part-aa');
    return { child: receipt.pid, assessment, evaluatedStub: observation };
  });
  return { kind: 'versioned-twelve-controls-requires-separate-root-control-go', results, children, counts: { qualified: results.filter(row => row.status === 'SYNTHETIC_MECHANISM_QUALIFIED').length, failed: results.filter(row => row.status === 'SYNTHETIC_MECHANISM_FAILED').length, unrun: results.filter(row => row.status.startsWith('UNRUN')).length, children: children.length, childrenReaped: children.filter(row => row.reaped).length }, originalSemanticControlsQualified: 0, productLibraryInjectedForC11: true, actualComparatorImports: 0, unsafe };
}
