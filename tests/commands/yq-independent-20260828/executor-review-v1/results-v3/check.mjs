import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const save = (filename, value) => writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const errorData = (error) => ({ name: error.name, message: error.message, code: error.code ?? null, stack: error.stack });
function authenticate() {
  for (const entry of config.files) {
    const status = lstatSync(entry.copy);
    assert(status.isFile() && !status.isSymbolicLink());
    assert.equal(realpathSync(entry.copy), entry.copy);
    assert.equal(status.mode & 0o7777, entry.mode);
    assert.equal(sha256(readFileSync(entry.copy)), entry.sha256);
  }
}
authenticate();
assert.equal(process.execPath, config.node);
assert.equal(sha256(readFileSync(process.execPath)), config.nodeSha256);
const api = await import(pathToFileURL(join(config.runtime, 'recipe.mjs')).href);
const described = api.describeRecipe();
const materialized = api.materializeRecipe(join(config.scratch, 'recipe'));
assert.equal(materialized.sealSha256, config.recipeSealSha256);
assert.deepEqual(api.verifyRecipe(materialized.recipeRoot), described.seal);
save(join(config.output, 'MATERIALIZED.json'), materialized);
const recipe = materialized.recipeRoot;
const host = await import(pathToFileURL(join(recipe, 'host.mjs')).href);
const integrity = await import(pathToFileURL(join(recipe, 'integrity.mjs')).href);
const assertions = await import(pathToFileURL(join(recipe, 'assert-capture.mjs')).href);
const context = await import(pathToFileURL(join(recipe, 'context.mjs')).href);
const fixtures = await import(pathToFileURL(join(recipe, 'fixtures.mjs')).href);
const fence = await import(pathToFileURL(join(recipe, 'import-fence.mjs')).href);
const data = fixtures.loadData(recipe, config.mirror);
const cmdJob = fixtures.materializeJobs(data, ['CMD-01'])[0];
const bounds = { deadlineMs: 1000, termGraceMs: 100, reapMs: 300, captureBytes: 65536, maximumJobs: 2 };
const recipeGuard = { kind: 'tree', path: recipe, sha256: integrity.jsonHash(integrity.treeSnapshot(recipe)) };
assert.equal(recipeGuard.sha256, config.recipeTreeSha256);
const observations = [];
const started = Date.now();
const baseCapture = { schemaVersion: 1, jobId: 'job0', outcome: 'CAPTURED', capture: { stdoutHex: Buffer.from('raw-out').toString('hex'), stderrHex: Buffer.from('raw-err').toString('hex'), status: 7, rejected: false, rejection: null, cleanupErrors: [], effects: { before: [], after: [] }, events: [{ kind: 'synthetic-event', reason: { kind: 'null' } }] } };
const validCapture = () => ({ ...baseCapture, capture: { ...baseCapture.capture, stdoutHex: Buffer.from(cmdJob.expected.stdoutUtf8).toString('hex'), stderrHex: '', status: 0, events: [] } });
function directory(name) { const filename = join(config.scratch, name); mkdirSync(filename, { mode: 0o755 }); return filename; }
function treeBytes(root) {
  const files = {};
  function visit(folder) {
    for (const name of readdirSync(folder).sort()) {
      const filename = join(folder, name);
      if (lstatSync(filename).isDirectory()) visit(filename);
      else files[relative(root, filename)] = { base64: readFileSync(filename).toString('base64'), mode: lstatSync(filename).mode & 0o7777 };
    }
  }
  visit(root);
  return files;
}
async function observe(id, input, operation, predicate) {
  authenticate();
  integrity.verifyGuards([recipeGuard]);
  assert.deepEqual(host.activeChildren(), []);
  assert(Date.now() - started < 105000, 'Bounded review deadline');
  save(join(config.output, id + '-input.json'), input);
  let returned = null;
  let rejected = null;
  try { returned = await operation(); } catch (error) { rejected = errorData(error); }
  const raw = { returned, rejected, activeChildren: host.activeChildren() };
  save(join(config.output, id + '-raw.json'), raw);
  let failure = null;
  try { predicate(raw); } catch (error) { failure = errorData(error); }
  const result = { id, matched: failure === null, failure };
  save(join(config.output, id + '-verdict.json'), result);
  observations.push(result);
  authenticate();
  integrity.verifyGuards([recipeGuard]);
  assert.deepEqual(host.activeChildren(), [], 'Stop: known-owned child not reaped');
}
async function cohort(name, specifications, options = {}) {
  const root = directory(name);
  const guarded = directory(name + '-guarded');
  const input = join(guarded, 'input.txt');
  writeFileSync(input, 'original\n', { flag: 'wx', mode: 0o644 });
  const guard = { kind: 'tree', path: guarded, sha256: integrity.jsonHash(integrity.treeSnapshot(guarded)) };
  const jobs = specifications.map((specification, index) => {
    const id = `job${index}`;
    const value = { id, ...specification };
    if (value.mutate === true) value.mutate = input;
    if (index > 0) value.marker = join(root, 'second.txt');
    const filename = join(root, id + '.json');
    save(filename, value);
    return { id, args: [config.originalChild, filename], cwd: root };
  });
  const summary = await host.runJobs({ executable: process.execPath, jobs, guards: [recipeGuard, guard], evidenceParent: config.hostEvidence, bounds: { ...bounds, ...options.bounds }, withholdReapProof: options.withholdReapProof ?? false, assertReceipt: options.assertReceipt ?? (() => {}) });
  return { summary, files: treeBytes(summary.evidence), secondMarker: existsSync(join(root, 'second.txt')), effects: { input: readFileSync(input, 'utf8') } };
}
function succeeded(raw) { assert.equal(raw.rejected, null); }
function failedCohort(raw, admitted, stop) {
  succeeded(raw);
  assert.equal(raw.returned.summary.aggregate, 'FAIL');
  assert.equal(raw.returned.summary.admitted, admitted);
  if (stop !== undefined) assert.equal(raw.returned.summary.stop, stop);
  assert.deepEqual(raw.returned.summary.activeChildren, []);
  assert(raw.returned.summary.results.filter((entry) => entry.admitted).every((entry) => entry.metadata.reaped));
}
function fileJson(raw, name) { return JSON.parse(Buffer.from(raw.returned.files[name].base64, 'base64')); }
function assertCapturedBefore(receipt, job, folder) {
  const names = ['stdout.bin', 'stderr.bin', 'child.json', 'boundary.json', 'receipt.json'];
  save(join(folder, 'before-review-assertion.json'), names.map((name) => ({ name, exists: existsSync(join(folder, name)) })));
  assert(names.every((name) => existsSync(join(folder, name))));
  assertions.assertCapture(receipt, job, folder, []);
}
function directAssertion(name, job) {
  const folder = directory(name);
  let error = null;
  try { assertions.assertCapture(validCapture(), job, folder, []); } catch (caught) { error = errorData(caught); }
  return { error, files: treeBytes(folder) };
}
try {
  const originalF01 = JSON.parse(readFileSync(config.originalF01, 'utf8'));
  assert.deepEqual(originalF01.expected, { ...cmdJob.expected, assertions: ['UNBOUND_INDEPENDENT_ASSERTION_MUST_NOT_GREEN'] });
  await observe('R01-original-F01', originalF01, () => cohort('f01', [{ receipt: validCapture() }], { assertReceipt(receipt, job, folder) { assertCapturedBefore(receipt, { ...cmdJob, expected: originalF01.expected }, folder); } }), (raw) => {
    failedCohort(raw, 1);
    const obligations = fileJson(raw, 'job0/obligations.json');
    assert.equal(obligations.status, 'INCOMPLETE');
    assert(obligations.unfulfilled.some((entry) => entry.path === 'expected.assertions[0]'));
    assert(fileJson(raw, 'job0/before-review-assertion.json').every((entry) => entry.exists));
    assert.equal(Buffer.from(raw.returned.files['job0/command-stdout.bin'].base64, 'base64').toString(), cmdJob.expected.stdoutUtf8);
  });
  await observe('R02-original-F02', { sameObjectTwice: true, distinctEqualLookingObjects: true }, () => {
    const first = { name: 'same', message: 'same' };
    const second = { name: 'same', message: 'same' };
    return { primitives: [undefined, null, false].map(context.encodeRejection), first: context.encodeRejection(first), firstAgain: context.encodeRejection(first), second: context.encodeRejection(second) };
  }, (raw) => { succeeded(raw); assert.equal(new Set(raw.returned.primitives.map(JSON.stringify)).size, 3); assert.deepEqual(raw.returned.first, raw.returned.firstAgain); assert.notDeepEqual(raw.returned.first, raw.returned.second, 'Distinct reason objects lose observable identity'); });
  await observe('R03-primitive-scope', { values: ['undefined', 'null', false, true, 0, '-0', 'NaN', 'Infinity', '1n', '1', 'symbols'], separateScopes: true }, () => {
    const encode = context.createRejectionEncoder();
    const symbol = Symbol('equal');
    const object = {};
    return { values: [undefined, null, false, true, 0, -0, NaN, Infinity, 1n, '1'].map(encode), stable: [encode(symbol), encode(symbol)], distinct: encode(Symbol('equal')), scopes: [encode(object), context.createRejectionEncoder()(object)] };
  }, (raw) => { succeeded(raw); assert.equal(new Set(raw.returned.values.map(JSON.stringify)).size, 10); assert.deepEqual(raw.returned.stable[0], raw.returned.stable[1]); assert.notDeepEqual(raw.returned.stable[0], raw.returned.distinct); assert.notDeepEqual(raw.returned.scopes[0].identity.scope, raw.returned.scopes[1].identity.scope); });
  await observe('R04-shared-command-cleanup', { sameReasonThenDistinctEqualReason: true, productCommand: false }, async () => {
    const fixture = context.createFixtureContext(cmdJob);
    const reason = { name: 'same', message: 'same' };
    const other = { name: 'same', message: 'same' };
    const rejection = context.encodeRejection(reason);
    fixture.event('command-reject', { rejection });
    fixture.context.registerCleanup(() => { throw reason; });
    fixture.context.registerCleanup(() => { throw other; });
    return { rejection, cleanupErrors: await fixture.drain(), capture: fixture.capture() };
  }, (raw) => { succeeded(raw); assert.equal(raw.returned.cleanupErrors.length, 2); assert.deepEqual(raw.returned.rejection.identity, raw.returned.cleanupErrors[0].identity); assert.notDeepEqual(raw.returned.rejection.identity, raw.returned.cleanupErrors[1].identity); assert.deepEqual(raw.returned.capture.events.find((entry) => entry.kind === 'command-reject').rejection, raw.returned.rejection); });
  await observe('R05-projection-only', { id: 'CMD-01', semanticCredit: 0 }, () => directAssertion('projection', cmdJob), (raw) => { succeeded(raw); assert.equal(raw.returned.error, null); const obligations = fileJson(raw, 'obligations.json'); assert.equal(obligations.status, 'BOUND_PROJECTION_ONLY'); assert.equal(obligations.semanticFullRecordPass, false); });
  await observe('R06-original-partial', { id: 'PAR-12' }, () => directAssertion('partial', fixtures.materializeJobs(data, ['PAR-12'])[0]), (raw) => { succeeded(raw); assert(raw.returned.error); assert.equal(fileJson(raw, 'obligations.json').status, 'INCOMPLETE'); });
  await observe('R07-unknown-field', { expectedField: 'unboundIndependentField' }, () => directAssertion('unknown', { ...cmdJob, expected: { ...cmdJob.expected, unboundIndependentField: true } }), (raw) => { succeeded(raw); assert(raw.returned.error); assert(fileJson(raw, 'obligations.json').unfulfilled.some((entry) => entry.path === 'expected.unboundIndependentField')); });
  await observe('R08-pass-exit7', { receipt: 'PASS', exit: 7 }, () => cohort('exit7', [{ exitCode: 7 }]), (raw) => { failedCohort(raw, 1); assert.equal(fileJson(raw, 'job0/receipt.json').outcome, 'PASS'); assert.equal(raw.returned.summary.results[0].metadata.exitCode, 7); });
  await observe('R09-fail-then-pass', { integrity: true, knownReap: true }, () => cohort('continue', [{ mode: 'fail' }, {}]), (raw) => { failedCohort(raw, 2, null); assert(raw.returned.secondMarker); assert(raw.returned.summary.results.every((entry) => entry.integrity && entry.reapProof)); assert.equal(raw.returned.summary.results[1].outcome, 'PASS'); });
  await observe('R10-capture-before-assert', baseCapture, () => cohort('capture', [{ receipt: baseCapture, stderr: 'runner-stderr\n' }], { assertReceipt(receipt, job, folder) { assertCapturedBefore(receipt, { ...cmdJob, expected: { status: 0 } }, folder); } }), (raw) => { failedCohort(raw, 1); assert(fileJson(raw, 'job0/before-review-assertion.json').every((entry) => entry.exists)); for (const name of ['stdout.bin', 'stderr.bin', 'child.json', 'command-stdout.bin', 'command-stderr.bin']) assert(Object.hasOwn(raw.returned.files, 'job0/' + name)); });
  await observe('R11-integrity-stop', { mutateOwnedSyntheticInput: true }, () => cohort('integrity', [{ mutate: true }, {}]), (raw) => { failedCohort(raw, 1, 'integrity'); assert.equal(raw.returned.secondMarker, false); });
  await observe('R12-reap-stop', { withholdReapProof: true }, () => cohort('reap', [{}, {}], { withholdReapProof: true }), (raw) => { failedCohort(raw, 1, 'reap'); assert.equal(raw.returned.secondMarker, false); });
  await observe('R13-timeout-boundaries', { deadlineMs: 150, continuation: 'Only with both integrity and known reap' }, () => cohort('timeout', [{ mode: 'timeout' }, {}], { bounds: { deadlineMs: 150 } }), (raw) => { succeeded(raw); assert.equal(raw.returned.summary.aggregate, 'FAIL'); assert(raw.returned.summary.results[0].metadata.timedOut); if (raw.returned.secondMarker) assert(raw.returned.summary.results[0].integrity && raw.returned.summary.results[0].reapProof); assert.deepEqual(raw.returned.summary.activeChildren, []); });
  const compiled = directory('fake-compiled');
  const outside = join(config.scratch, 'outside.mjs');
  writeFileSync(outside, 'throw new Error("NEVER IMPORT");\n', { flag: 'wx' });
  symlinkSync(outside, join(compiled, 'escape.mjs'));
  fence.initialize({ compiledRoot: compiled });
  await observe('R14-only-added-timer', { added: 'node:timers/promises' }, async () => {
    const specifiers = ['node:path', 'node:util', 'node:buffer', 'node:stream', 'node:stream/web', 'node:timers/promises'];
    const results = [];
    for (const specifier of specifiers) results.push(await fence.resolve(specifier, {}, async (value) => ({ url: value })));
    return results;
  }, (raw) => { succeeded(raw); assert.deepEqual(raw.returned.map((entry) => entry.url), ['node:path', 'node:util', 'node:buffer', 'node:stream', 'node:stream/web', 'node:timers/promises']); });
  await observe('R15-fence-refusals', { noCodeImported: true }, async () => {
    const probes = [['node:fs', null], ['node:timers', null], ['node:http', null], ['https://example.invalid/test.mjs', null], ['unbound-package', null], ['../outside.mjs', pathToFileURL(outside).href], ['./escape.mjs', pathToFileURL(join(compiled, 'escape.mjs')).href]];
    const results = [];
    for (const [specifier, url] of probes) { let error = null; let calls = 0; try { await fence.resolve(specifier, {}, async () => { calls++; return { url }; }); } catch (caught) { error = errorData(caught); } results.push({ specifier, error, calls }); }
    return results;
  }, (raw) => { succeeded(raw); assert.equal(raw.returned.length, 7); assert(raw.returned.every((entry) => entry.error)); assert(raw.returned.slice(0, 5).every((entry) => entry.calls === 0)); });
  await observe('R16-added-recipe-entry', { mutation: 'Owned TMP only' }, () => { const filename = join(recipe, 'added.txt'); try { writeFileSync(filename, 'unbound\n', { flag: 'wx' }); return api.verifyRecipe(recipe); } finally { rmSync(filename); } }, (raw) => { assert(raw.rejected); });
  await observe('R17-recipe-mode', { mutation: 'Owned TMP only' }, () => { const filename = join(recipe, 'host.mjs'); try { chmodSync(filename, 0o600); return api.verifyRecipe(recipe); } finally { chmodSync(filename, 0o644); } }, (raw) => { assert(raw.rejected); });
  await observe('R18-roles-gaps', { inventoryIsNotSemanticEvidence: true }, () => {
    const rows = data.inventory.rows;
    const prepared = rows.filter((entry) => entry.runtimeProofRole);
    return { ids: rows.map((entry) => entry.id), roles: Object.fromEntries(Object.keys(data.inventory.roleCounts).map((role) => [role, rows.filter((entry) => entry.primaryRole === role).length])), overlays: data.inventory.overlays, projections: prepared.length, jobs: fixtures.materializeJobs(data, prepared.map((entry) => entry.id)).length, gaps: rows.filter((entry) => entry.missingBindings.length).length, unprepared: rows.length - prepared.length, partial: prepared.filter((entry) => !entry.fullRecordEligibleAfterProjection).length, completeSemantic: rows.filter((entry) => entry.primaryRole === 'command-semantic-runtime' && entry.fullRecordEligibleAfterProjection).length, semanticPartial: rows.filter((entry) => entry.primaryRole === 'command-semantic-runtime' && !entry.fullRecordEligibleAfterProjection).length, denominators: data.inventory.denominators };
  }, (raw) => { succeeded(raw); assert.deepEqual(raw.returned.ids, config.originalIds); assert.equal(new Set(raw.returned.ids).size, 194); assert.deepEqual(raw.returned.roles, config.roleCounts); assert.deepEqual(raw.returned.overlays, ['NUM-14', 'NUM-15', 'UTF-12', 'ENC-07', 'QUE-12', 'WRK-10', 'WRK-22', 'WRK-26']); assert.deepEqual([raw.returned.projections, raw.returned.jobs, raw.returned.gaps, raw.returned.unprepared, raw.returned.partial, raw.returned.completeSemantic, raw.returned.semanticPartial], [132, 149, 80, 62, 18, 94, 17]); assert.equal(raw.returned.denominators.semanticPasses, 0); });
  await observe('R19-pending-projection', { sourceOnlyId: 'WRK-26', unknownRecipe: 'unbound-independent-projection' }, () => {
    const errors = [];
    for (const operation of [() => fixtures.materializeJobs(data, ['WRK-26']), () => fixtures.materializeDataRecipe({ kind: 'unbound-independent-projection' })]) { try { operation(); errors.push(null); } catch (error) { errors.push(errorData(error)); } }
    return errors;
  }, (raw) => { succeeded(raw); assert(raw.returned.every((entry) => entry !== null)); });
  await observe('R20-untrusted-receipts', { forms: ['missing', 'duplicate', 'duplicate-key'] }, () => {
    const valid = JSON.stringify({ schemaVersion: 1, jobId: 'job0', outcome: 'PASS' }) + '\n';
    const errors = [];
    for (const bytes of ['', valid + valid, '{"schemaVersion":1,"jobId":"job0","outcome":"FAIL","outcome":"PASS"}\n']) { try { host.parseReceipt(Buffer.from(bytes), 'job0'); errors.push(null); } catch (error) { errors.push(errorData(error)); } }
    return errors;
  }, (raw) => { succeeded(raw); assert(raw.returned.every((entry) => entry !== null)); });
} catch (error) {
  save(join(config.output, 'STOP.json'), errorData(error));
  process.exitCode = 1;
} finally {
  save(join(config.output, 'SUMMARY.json'), { count: observations.length, matched: observations.filter((entry) => entry.matched).length, observations, activeChildren: host.activeChildren(), productImports: 0, productRuns: 0, builds: 0, compilerRuns: 0, semanticPasses: 0 });
  if (observations.length !== 20 || observations.some((entry) => !entry.matched) || host.activeChildren().length) process.exitCode = 1;
  console.log(JSON.stringify({ controls: observations.length, matched: observations.filter((entry) => entry.matched).length, activeChildren: host.activeChildren() }));
}
