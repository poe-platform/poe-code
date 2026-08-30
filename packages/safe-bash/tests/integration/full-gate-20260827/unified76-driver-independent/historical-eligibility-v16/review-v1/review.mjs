import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, lstatSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {registerHooks} from 'node:module';

const [stage, scratch, own] = process.argv.slice(2);
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const bindings = JSON.parse(readFileSync(join(own, 'BINDINGS.json')));
const contract = JSON.parse(readFileSync(join(stage, 'FREEZE.json')));
const expectedModuleNames = bindings.runtimeModules;
const actualLoads = [];
const loadedModules = [];
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    assert.ok(resolved.url.startsWith('node:') || resolved.url.startsWith(pathToFileURL(stage + '/').href), 'unbound module origin: ' + resolved.url);
    return resolved;
  },
  load(url, context, next) {
    const result = next(url, context);
    if (url.startsWith('file:')) {
      const name = new URL(url).pathname.split('/').at(-1);
      assert.ok(expectedModuleNames.includes(name), 'unbound executable module: ' + url);
      loadedModules.push({url, name, sha256: sha(readFileSync(new URL(url)))});
    }
    return result;
  },
});
for (const name of [...expectedModuleNames, ...bindings.runtimeData]) {
  const file = join(stage, name), expected = bindings.files.find(row => row.path.endsWith('/' + name));
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  assert.equal(sha(readFileSync(file)), expected.sha256);
}
const load = async name => {
  const url = pathToFileURL(join(stage, name)).href;
  actualLoads.push({name, url, sha256: sha(readFileSync(join(stage, name)))});
  return import(url);
};
const history = await load('historical-eligibility.mjs');
const setup = await load('maintained-prerequisites.mjs');
const policy = await load('policy.mjs');
const tap = await load('tap.mjs');
const admission = await load('admission.mjs');
const runner = await load('phase-runner.mjs');
const historicalPolicy = JSON.parse(readFileSync(join(stage, 'ELIGIBILITY.json')));
const eligibility = history.decodeEligibility(historicalPolicy);
const strictProfile = JSON.parse(gunzipSync(Buffer.from(readFileSync(join(stage, 'PROFILE.json.gz.base64'), 'utf8').trim(), 'base64')));
const profile = {...strictProfile, historicalEligibility: eligibility};
const seal = JSON.parse(readFileSync(join(stage, 'seal-data.json')));
const consumedRelease = JSON.parse(readFileSync(join(stage, 'consumed-release.json')));
const results = [];
const caseDefinitions = contract.families.flatMap(family => family.cases);
const staticResults = JSON.parse(readFileSync(join(own, 'STATIC.json')));
const limit = setTimeout(() => {
  process.stderr.write('coordinator watchdog expired\n');
  process.exit(124);
}, 120000);
limit.unref();
const errorRecord = error => ({name: error.name, message: error.message, code: error.code ?? null, stack: error.stack});
const rejected = callback => {
  let failure;
  try { callback(); } catch (error) { failure = errorRecord(error); }
  assert.ok(failure, 'mutant was accepted');
  return failure;
};
const rejectedAsync = async callback => {
  let failure;
  try { await callback(); } catch (error) { failure = errorRecord(error); }
  assert.ok(failure, 'mutant was accepted');
  return failure;
};
const cleanPhase = ([label, status]) => ({label, status, signal: null, clean: true, closed: true, signals: [], survivors: [], outputBytes: 0, observed: []});
const goodReport = () => ({candidate: policy.PRODUCT, bindingComplete: true, guardsPassed: true, driverProductionBuilds: 1, cleanupComplete: true, phases: policy.PHASES.map(cleanPhase), canonical: {reconciled: true, counts: {pass: 5, fail: 0, skipped: 0, todo: 0, cancelled: 0}}, canonicalMissingPaths: [], historicalEligibility: clone(eligibility)});
const identity = (path, gid = 20) => ({path, uid: 501, gid, mode: '700', directory: true, symlink: false});
const group = temporary => ({profile: 'owned-group-only-v1', uid: 501, gid: 20, groups: [20], umask: '22', parent: identity(temporary), before: identity(join(temporary, 'native-tmp')), after: identity(join(temporary, 'native-tmp')), normalized: false, issues: [], probesExecuted: 0, acl: {command: ['/bin/ls', '-lde', temporary, join(temporary, 'native-tmp')], status: 0, signal: null, stdout: 'synthetic ACL receipt', stderr: ''}, TMPDIR: join(temporary, 'native-tmp')});
function stageFixture(overrides = {}) {
  const temporary = join(scratch, 'synthetic-uncreated-setup'), events = [], environment = {};
  const input = {temporary, environment, historicalEligibility: clone(eligibility)};
  const values = {authorities: [{path: 'synthetic-authority', sha256: 'bound-token'}], metadata: {issues: [], assets: []}, stageMetadata: [], archive: {issues: []}, group: group(temporary), bytes: [{name: 'synthetic-byte-tool', sha256: 'bound-token'}], privateBefore: {token: 'synthetic-private-token'}, privateCopy: {files: [], copiedRoot: join(temporary, 'synthetic-engine')}, privateAfter: {token: 'synthetic-private-token'}};
  const callbacks = Object.fromEntries(setup.SETUP_STAGES.map(name => [name, async (...args) => {
    events.push({name, entered: true});
    const value = Object.hasOwn(overrides, name) ? await overrides[name](...args) : clone(values[name]);
    events.push({name, returned: true});
    return value;
  }]));
  const receipt = setup.createPrerequisiteReceipt();
  return {input, callbacks, receipt, events, values, run: () => setup.runPrerequisiteStages(input, callbacks, receipt)};
}
const stopped = async (name, error) => {
  const fixture = stageFixture({[name]: async () => { throw error; }});
  const failure = await rejectedAsync(fixture.run);
  assert.deepEqual(fixture.events.filter(row => row.entered).map(row => row.name), setup.SETUP_STAGES.slice(0, setup.SETUP_STAGES.indexOf(name) + 1));
  return {failure, events: fixture.events, completed: fixture.receipt.completedStages, receipt: fixture.receipt};
};
const cases = new Map();
cases.set('H01.1', () => {
  assert.equal(sha(JSON.stringify(eligibility)), bindings.eligibilityReceiptSha256);
  assert.equal(sha(JSON.stringify(profile)), bindings.effectiveProfileSha256);
  assert.deepEqual(eligibility.obligations.map(row => row.id), ['NA-2755', 'NA-6755']);
  assert.deepEqual(eligibility.original, JSON.parse(gunzipSync(Buffer.from(historicalPolicy.captureBase64, 'base64'))));
  assert.equal(eligibility.binding.observationDate, '2026-08-28');
  return {obligations: eligibility.obligations, binding: eligibility.binding};
});
cases.set('H01.2', () => { const value = clone(eligibility.original); value.probes[0].mode = '2775'; return rejected(() => history.validateAuthorityRecord(value)); });
cases.set('H01.3', () => { const value = clone(eligibility.original); value.probes[0].execution.status = 0; return rejected(() => history.validateAuthorityRecord(value)); });
cases.set('H01.4', () => { const value = clone(historicalPolicy); value.binding.decodedSha256 = '0' + value.binding.decodedSha256.slice(1); return rejected(() => history.decodeEligibility(value)); });
cases.set('H01.5', () => { const value = clone(eligibility.original); value.probes.push(clone(value.probes[0])); return rejected(() => history.validateAuthorityRecord(value)); });
cases.set('H01.6', () => { const value = clone(eligibility.original); value.probes.pop(); return rejected(() => history.validateAuthorityRecord(value)); });
cases.set('H01.7', () => {
  const value = clone(eligibility.original); value.probes[1] = clone(value.probes[0]);
  const failure = rejected(() => history.validateAuthorityRecord(value));
  const report = goodReport(); report.historicalEligibility.obligations[1] = clone(report.historicalEligibility.obligations[0]);
  assert.equal(history.historicalVerdict(report).valid, false);
  return {failure, verdict: history.historicalVerdict(report)};
});
cases.set('H01.8', () => { const value = clone(eligibility.original); value.issues[0].kind = 'unknown-issue'; return rejected(() => history.validateAuthorityRecord(value)); });
cases.set('H01.9', () => { const value = clone(historicalPolicy); value.binding.renderedFenceSha256 = 'f'.repeat(64); return rejected(() => history.decodeEligibility(value)); });
cases.set('H02.1', () => { const report = goodReport(), before = JSON.stringify(report), verdict = policy.gateVerdict(report); assert.equal(JSON.stringify(report), before); assert.equal(verdict.exitCode, 1); assert.equal(verdict.historicalObligations.length, 2); return verdict; });
cases.set('H02.2', () => { const report = goodReport(); report.historicalEligibility.freshCapabilityClaim = true; report.historicalEligibility.obligations[0].scope = 'all Node, directory and symbolic operations'; const verdict = history.historicalVerdict(report); assert.equal(verdict.valid, false); return verdict; });
cases.set('H03.2', async () => {
  const fixture = stageFixture(), result = await fixture.run();
  assert.deepEqual(result.completedStages, ['authorities', 'metadata', 'stageMetadata', 'archive', 'group', 'bytes', 'privateBefore', 'privateCopy', 'privateAfter']);
  assert.deepEqual(fixture.events.filter(row => row.entered).map(row => row.name), result.completedStages);
  assert.deepEqual(result.safejs.before, result.safejs.after);
  assert.equal(result.native.group.probesExecuted, 0);
  return {receipt: result, events: fixture.events, environment: fixture.input.environment, syntheticOnly: true};
});
cases.set('H04.1', async () => {
  const fixture = stageFixture({metadata: async () => ({issues: [{kind: 'tool-identity-mismatch', expected: 'verified', actual: 'stale'}]})});
  const failure = await rejectedAsync(fixture.run); assert.deepEqual(fixture.receipt.completedStages, ['authorities']); return {failure, events: fixture.events};
});
cases.set('H04.2', async () => {
  const fixture = stageFixture(); fixture.callbacks.group = async () => ({...group(fixture.input.temporary), issues: [{kind: 'fresh-group-denied'}]});
  const failure = await rejectedAsync(fixture.run); assert.equal(fixture.receipt.completedStages.includes('bytes'), false); return {failure, completed: fixture.receipt.completedStages};
});
cases.set('H04.3', () => stopped('authorities', new Error('source-projection-authority-mismatch')));
cases.set('H05.1', () => stopped('authorities', new Error('first-mandatory-stage-failure')));
cases.set('H05.2', async () => {
  const output = join(scratch, 'synthetic-phases'), auditRoot = join(scratch, 'synthetic-audit'); mkdirSync(output); mkdirSync(auditRoot);
  const preload = join(stage, 'policy.mjs');
  const audit = {root: auditRoot, preload, preloadSha256: sha(readFileSync(preload)), environment: {}};
  const report = {phases: []}, completed = [], events = [];
  const phase = runner.createPhaseRunner({completed, report, source: scratch, output, environment: {}, guard: join(stage, 'policy.mjs'), audit, requireOrdered: admission.requireOrdered, verify: async () => {events.push('source-guard');}, extraGuards: [{check: async () => ({changes: []})}], supervision: async (executable, args, options) => {
    events.push({syntheticSupervision: true, executable, args, env: options.env});
    return {...cleanPhase(['synthetic', 0]), status: completed.length === 0 ? 7 : 78};
  }});
  await phase('safejs-availability', ['synthetic-first-only']);
  await phase('cold-typecheck', ['synthetic-second-only'], scratch, 78);
  assert.deepEqual(report.phases.map(row => row.status), [7, 78]);
  let dispatches = 0;
  const blocked = runner.createPhaseRunner({completed: [], report: {phases: []}, source: scratch, output, environment: {}, guard: preload, audit, requireOrdered: admission.requireOrdered, verify: async () => {throw new Error('fresh-guard-failure');}, supervision: async () => {dispatches++;}});
  const refusal = await rejectedAsync(() => blocked('safejs-availability', []));
  assert.equal(dispatches, 0);
  return {report, completed, events, refusal, dispatches, qualification: 'Actual phase runner with synthetic supervisor; no process/build/private execution and no production-build audit proof'};
});
cases.set('H05.3', () => { const report = goodReport(); report.phases = []; const verdict = policy.gateVerdict(report); assert.equal(verdict.phaseOutcomes.filter(row => row.execution === 'NOT_EXECUTED').length, 14); assert.equal(verdict.status, 'HOLD_OR_QUALIFIED_RED'); return verdict; });
cases.set('H06.2', async () => {
  const fixture = stageFixture({privateAfter: async () => ({token: 'changed-synthetic-token'})});
  const failure = await rejectedAsync(fixture.run); assert.match(failure.message, /private state changed/); assert.equal(fixture.receipt.completedStages.includes('privateAfter'), false); return {failure, receipt: fixture.receipt, qualification: 'Comparison failure only; actual outer private/finally guard not invoked'};
});
cases.set('H06.3', () => ({unexecuted: true, reason: 'No independent injectable outer execute/finally cleanup seam. runPrerequisiteStages exposes setup only; exercising dual outer cleanup errors would invoke forbidden execute or simulate reviewer logic. Source route recorded separately.'}));
cases.set('H07.1', async () => {
  const raw = 'TAP version 13\nok 1 - ordinary pass\nnot ok 2 - ordinary raw failure\n  ---\n  error: preserved raw error\n  ...\nok 3 - untouched skip # SKIP unavailable\nnot ok 4 - untouched todo # TODO pending\nnot ok 5 - cancelled child\n  ---\n  failureType: testAborted\n  ...\n1..5\n# tests 5\n# pass 1\n# fail 1\n# skipped 1\n# todo 1\n# cancelled 1\n';
  const path = join(scratch, 'mixed.tap'); writeFileSync(path, raw, {flag: 'wx'});
  const accounting = await tap.accountFile(path);
  assert.equal(accounting.reconciled, true); assert.deepEqual(accounting.counts, {pass: 1, fail: 1, skipped: 1, todo: 1, cancelled: 1});
  const report = goodReport(); report.canonical = accounting; report.phases[5].status = 1; report.phases[5].stdout = raw; report.phases[5].stderr = 'independent stderr bytes';
  const before = JSON.stringify(report), verdict = policy.gateVerdict(report); assert.equal(JSON.stringify(report), before); assert.equal(verdict.status, 'HOLD_OR_QUALIFIED_RED');
  return {raw, rawSha256: sha(raw), accounting, verdict, stderr: report.phases[5].stderr, status: report.phases[5].status, signal: report.phases[5].signal};
});
cases.set('H07.2', () => { const report = goodReport(); report.canonical.counts.fail = 1; report.canonical.cases = [{name: 'Node22.22.2 characterization under24.11.1', status: 'fail', qualification: 'synthetic fixture, not measured product failure'}]; const before = JSON.stringify(report), verdict = policy.gateVerdict(report); assert.equal(JSON.stringify(report), before); assert.equal(verdict.historicalObligations.length, 2); assert.equal(report.historicalEligibility.automaticTestAttribution, false); return {canonical: report.canonical, verdict}; });
cases.set('H07.3', () => { const report = goodReport(); report.historicalEligibility.nativeSemanticPassCount = 49; const verdict = history.historicalVerdict(report); assert.equal(verdict.valid, false); assert.equal(strictProfile.native.length, 51); return {verdict, identityAssetCount: 51, staticAttribution: [48, 384, 4], measuredCaseCount: null}; });
cases.set('H08.1', async () => {
  const fixture = stageFixture({archive: async () => ({issues: [{kind: 'unrecognized-mandatory-issue'}]})});
  const failure = await rejectedAsync(fixture.run); assert.equal(fixture.receipt.completedStages.includes('group'), false); return {failure, events: fixture.events};
});
cases.set('H08.2', () => {
  const mutated = clone(profile); mutated.historicalEligibility.profile = 'original-strict-profile';
  const failure = rejected(() => history.validateEligibilityProfile(mutated));
  const report = goodReport(); delete report.historicalEligibility; const verdict = policy.gateVerdict(report); assert.equal(verdict.status, 'HOLD_OR_QUALIFIED_RED'); return {failure, verdict};
});
cases.set('H09.1', () => { const verdict = policy.gateVerdict(goodReport()); assert.equal(verdict.runtimeQualified, true); assert.equal(verdict.status, 'QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE'); assert.equal(verdict.exitCode, 1); return verdict; });
cases.set('H09.2', () => { const report = goodReport(), verdict = policy.gateVerdict(report); assert.equal(verdict.runtimeQualified, true); assert.deepEqual(verdict.phaseOutcomes.filter(row => row.expectedStatus !== 0).map(row => [row.label, row.actualStatus]), [['cold-typecheck', 78], ['negative-types', 2], ['missing-root', 1], ['missing-contracts', 1]]); return verdict; });
cases.set('H09.3', () => { const report = goodReport(); report.cleanupComplete = false; report.phases[5].status = 9; report.verdict = {status: 'allPASS', exitCode: 0}; const verdict = policy.gateVerdict(report); assert.equal(verdict.exitCode, 1); assert.equal(verdict.status, 'HOLD_OR_QUALIFIED_RED'); assert.ok(verdict.problems.includes('cleanup incomplete')); return verdict; });
cases.set('H10.1', () => {
  const changed = clone(profile); changed.canonicalFiles[0] = 'tests/independent-synthetic-replacement.test.ts'; assert.equal(changed.canonicalFiles.length, 632);
  const authorityRefusal = rejected(() => history.validateEligibilityProfile(changed));
  const args = admission.canonicalArguments(profile); args[5] = 'tests/independent-synthetic-replacement.test.ts';
  return {authorityRefusal, argvRefusal: rejected(() => admission.requireCanonicalArguments(args, profile))};
});
cases.set('H10.3', () => ({failure: rejected(() => admission.requireRelease(consumedRelease, seal, profile)), qualification: 'Old receipt rejected by new profile/binding fields, not a cryptographic one-shot-token proof; author GO is not a root receipt'}));
cases.set('H11.1', async () => {
  const controller = new AbortController(); let entered, settled = false;
  const ready = new Promise(resolve => {entered = resolve;});
  const fixture = stageFixture({bytes: () => new Promise((resolve, reject) => {controller.signal.addEventListener('abort', () => {settled = true; reject(controller.signal.reason);}, {once: true}); entered();})});
  const pending = rejectedAsync(fixture.run); await ready; controller.abort(new Error('controlled-cooperative-cancel'));
  const failure = await pending; assert.equal(settled, true); assert.equal(fixture.receipt.completedStages.includes('privateBefore'), false);
  return {failure, settled, events: fixture.events, qualification: 'Cooperative synthetic callback rejection only, not shipping timeout/preemption or real process cleanup'};
});
cases.set('H11.2', () => ({unexecuted: true, reason: 'Setup seam has no timeout/signal/owned-background lifecycle API. A reviewer Promise.race would test its own deadline, not shipping timeout/cleanup. Full execute/supervisor execution excluded; no false closure proof substituted.'}));
cases.set('H12.2', () => { const report = goodReport(); report.canonical.counts.fail = 1; report.coordinator = {exit: 1, summary: 'all controls PASS'}; report.verdict = {exitCode: 0}; const before = JSON.stringify(report), verdict = policy.gateVerdict(report); assert.equal(verdict.exitCode, 1); assert.equal(verdict.status, 'HOLD_OR_QUALIFIED_RED'); assert.equal(JSON.stringify(report), before); return {coordinator: report.coordinator, verdict}; });

process.stdout.write('TAP version 13\n');
for (const definition of caseDefinitions) {
  const started = Date.now();
  let result;
  try {
    if (definition.method === 'static') {
      assert.equal(staticResults[definition.id].status, 'PASS');
      result = {status: 'PASS', method: 'static', evidence: staticResults[definition.id]};
    } else {
      assert.ok(cases.has(definition.id), 'missing case mapping');
      const evidence = await cases.get(definition.id)();
      result = {status: evidence?.unexecuted ? 'UNEXECUTED' : 'PASS', method: definition.method, evidence};
    }
  } catch (error) {
    result = {status: 'FAIL', method: definition.method, error: errorRecord(error)};
  }
  assert.ok(Date.now() - started < 60000, 'case exceeded frozen ceiling');
  results.push({id: definition.id, expected: definition.expected, input: definition.input, elapsedMs: Date.now() - started, ...result});
  process.stdout.write(`${result.status === 'PASS' ? 'ok' : 'not ok'} ${results.length} - ${definition.id} ${result.status}\n`);
}
for (const name of [...expectedModuleNames, ...bindings.runtimeData]) assert.equal(sha(readFileSync(join(stage, name))), bindings.files.find(row => row.path.endsWith('/' + name)).sha256, 'post-import stage integrity');
const counts = Object.fromEntries(['PASS', 'FAIL', 'UNEXECUTED'].map(status => [status, results.filter(row => row.status === status).length]));
const report = {source: bindings.source, evidence: bindings.evidence, freeze: '17b9249a06c5d768409fea932ea7f44e36b63720', pid: process.pid, parent: process.ppid, node: {path: process.execPath, version: process.version, platform: process.platform, arch: process.arch, argv: process.execArgv}, environment: {...process.env}, actualDirectImports: actualLoads, loadedModules, transitiveModuleClosure: expectedModuleNames, counts, results, helperOrPrivateOperations: 0, productionPhases: 0, nativeChildDispatches: 0, qualification: 'Pure-data/source/synthetic review. Static cases are source proofs, not runtime passes. Synthetic callbacks and supervision are not actual native/private/setup/cleanup evidence.'};
writeFileSync(join(scratch, 'RESULTS.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
process.stdout.write(`1..40\n# tests 40\n# pass ${counts.PASS}\n# fail ${counts.FAIL + counts.UNEXECUTED}\n# skipped 0\n# todo 0\n# cancelled 0\n# independent_unexecuted ${counts.UNEXECUTED}\n`);
clearTimeout(limit);
process.exitCode = counts.FAIL || counts.UNEXECUTED ? 1 : 0;
