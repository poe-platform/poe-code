import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, '../../../../..');
const prefix = relative(repository, root);
const [sourceCommit, presealSha256] = process.argv.slice(2);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 16777216 });
assert(/^[0-9a-f]{40}$/.test(sourceCommit ?? '') && /^[0-9a-f]{64}$/.test(presealSha256 ?? ''), 'Supply exact committed source SHA and independently routed preseal SHA-256');
const presealBytes = readFileSync(join(root, 'SOURCE-PRESEAL.json'));
assert.equal(hash(presealBytes), presealSha256);
assert.equal(hash(git('show', `${sourceCommit}:${prefix}/SOURCE-PRESEAL.json`)), presealSha256);
const preseal = JSON.parse(presealBytes);
function verifySources() {
  for (const entry of preseal.files) {
    const filename = join(root, entry.path);
    assert.equal(realpathSync(filename), filename);
    assert(lstatSync(filename).isFile());
    assert.equal(lstatSync(filename).mode & 0o7777, entry.mode);
    assert.equal(hash(readFileSync(filename)), entry.sha256, `Live source: ${entry.path}`);
    assert.equal(hash(git('show', `${sourceCommit}:${prefix}/${entry.path}`)), entry.sha256, `Committed source: ${entry.path}`);
  }
}
verifySources();
const { authenticateFrozen, jsonHash } = await import('./frozen.mjs');
const { materializeRecipe, verifyRecipe } = await import('./recipe.mjs');
const frozen = authenticateFrozen();
const controls = JSON.parse(readFileSync(join(root, 'controls.json'), 'utf8'));
mkdirSync(join(root, 'work'), { recursive: true });
mkdirSync(join(root, 'evidence'), { recursive: true });
const work = mkdtempSync(join(root, 'work', 'synthetic-'));
const evidence = mkdtempSync(join(root, 'evidence', 'replay-'));
const folder = (path) => { mkdirSync(path, { mode: 0o755 }); chmodSync(path, 0o755); return path; };
const file = (path, bytes) => { mkdirSync(dirname(path), { recursive: true, mode: 0o755 }); writeFileSync(path, bytes, { flag: 'wx', mode: 0o644 }); chmodSync(path, 0o644); return path; };
const jsonFile = (path, value) => file(path, `${JSON.stringify(value, null, 2)}\n`);
const prepared = materializeRecipe(join(work, 'recipe-v2'));
const recipe = prepared.recipeRoot;
const legacy = folder(join(work, 'recipe-v1'));
for (const [name, bytes] of frozen.original) file(join(legacy, name), bytes);
const dataRoot = folder(join(work, 'frozen-data'));
for (const entry of frozen.bindings.entries.filter((entry) => entry.id.startsWith('data:') || entry.id.startsWith('scope:'))) file(join(dataRoot, entry.path), frozen.bytes.get(entry.id));
const integrity = await import(pathToFileURL(join(recipe, 'integrity.mjs')));
const host = await import(pathToFileURL(join(recipe, 'host.mjs')));
const assertions = await import(pathToFileURL(join(recipe, 'assert-capture.mjs')));
const oldAssertions = await import(pathToFileURL(join(legacy, 'assert-capture.mjs')));
const fixtures = await import(pathToFileURL(join(recipe, 'fixtures.mjs')));
const data = fixtures.loadData(recipe, dataRoot);
const command = fixtures.materializeJobs(data, ['CMD-01'])[0];
const catalogue = data.sources.get('final').diagnostics.catalogue;
const bounds = { deadlineMs: 2000, termGraceMs: 50, reapMs: 1000, captureBytes: 262144, maximumJobs: 8 };
const guard = (path) => ({ kind: 'tree', path, sha256: jsonHash(integrity.treeSnapshot(path)) });
const recipeGuards = [guard(recipe), guard(legacy), guard(dataRoot), { kind: 'file', path: join(root, 'synthetic-child.mjs'), mode: 0o644, sha256: hash(readFileSync(join(root, 'synthetic-child.mjs'))) }];
const hostEvidence = folder(join(evidence, 'host'));
const observations = [];
jsonFile(join(evidence, 'AUTHENTICATION.json'), {
  classification: 'SYNTHETIC_FRAMEWORK_ONLY', sourceCommit, presealSha256,
  recipeVersion: prepared.seal.version, recipeTreeSha256: prepared.seal.treeSha256,
  recipeSealSha256: prepared.sealSha256, diffSha256: hash(readFileSync(join(root, 'V1-V2.diff'))),
  frozenBindingsSha256: hash(readFileSync(join(root, 'BINDINGS.json'))),
  originalFindingsCommit: frozen.bindings.findingsCommit, sourceFiles: preseal.files,
  node: { version: process.version, path: process.execPath, sha256: hash(readFileSync(process.execPath)) },
  work, recipeGuards, actualCandidateImported: false, grantsGO: false,
});

async function observe(id, operation, check) {
  assert(controls.cases.some((entry) => entry.id === id), `Unsealed control: ${id}`);
  assert(!observations.some((entry) => entry.id === id));
  let raw;
  try { raw = { returned: await operation(), error: null }; }
  catch (error) { raw = { returned: null, error: String(error) }; }
  integrity.atomicJson(join(evidence, `${id}-raw.json`), raw);
  let failure = null;
  try { check(raw); } catch (error) { failure = String(error); }
  const verdict = { id, classification: 'SYNTHETIC_FRAMEWORK_CONTROL', outcome: failure ? 'FAIL' : 'MATCH', failure, raw: `${id}-raw.json`, semanticPasses: 0 };
  integrity.atomicJson(join(evidence, `${id}-verdict.json`), verdict);
  observations.push(verdict);
}
function returned(raw) { assert.equal(raw.error, null); return raw.returned; }
function captured() {
  return { schemaVersion: 1, outcome: 'CAPTURED', capture: { stdoutHex: Buffer.from(command.expected.stdoutUtf8).toString('hex'), stderrHex: '', status: 0, rejected: false, rejection: null, cleanupErrors: [], effects: { before: [], after: [] }, events: [] } };
}
async function cohort(name, specifications, options = {}) {
  const scratch = folder(join(work, name));
  const fixture = folder(join(scratch, 'guarded'));
  file(join(fixture, 'input.bin'), 'original');
  const fixtureGuard = guard(fixture);
  const jobs = specifications.map((specification, index) => {
    const id = `${name}-${index}`;
    const payload = jsonFile(join(scratch, `${index}.json`), specification.payload ?? captured());
    return {
      ...command, ...specification.job, id, cwd: scratch,
      args: [join(root, 'synthetic-child.mjs'), specification.mode ?? 'capture', id, specification.recipe ?? recipe, payload, specification.target ?? fixture],
    };
  });
  const summary = await host.runJobs({
    executable: process.execPath, jobs, guards: [...recipeGuards, fixtureGuard], evidenceParent: hostEvidence,
    bounds: { ...bounds, ...options.bounds }, withholdReapProof: options.withholdReapProof ?? false,
    assertReceipt(receipt, job, destination) {
      for (const filename of ['stdout.bin', 'stderr.bin', 'child.json', 'boundary.json', 'receipt.json']) assert(existsSync(join(destination, filename)), `Raw before assertion: ${filename}`);
      return (options.assertReceipt ?? ((receipt, job, destination) => assertions.assertCapture(receipt, job, destination, catalogue)))(receipt, job, destination);
    },
  });
  return summary;
}
function settled(summary, aggregate, admitted, stop = null) {
  assert.equal(summary.aggregate, aggregate);
  assert.equal(summary.admitted, admitted);
  assert.equal(summary.stop, stop);
  assert.deepEqual(summary.activeChildren, []);
  assert(summary.results.filter((entry) => entry.admitted).every((entry) => entry.metadata.reaped));
}

await observe('inventory', () => {
  const counts = {};
  for (const row of data.inventory.rows) counts[row.primaryRole] = (counts[row.primaryRole] ?? 0) + 1;
  const ids = data.inventory.rows.filter((row) => row.runtimeProofRole).map((row) => row.id);
  const jobs = fixtures.materializeJobs(data, ids);
  return { counts, ids: ids.length, total: data.inventory.rows.length, jobs: jobs.length, jobsSha256: jsonHash(jobs), denominators: data.inventory.denominators };
}, (raw) => {
  const result = returned(raw);
  assert.deepEqual(result.counts, controls.roleCounts);
  assert.equal(result.ids, 132); assert.equal(result.total, 194);
  assert.equal(result.jobsSha256, frozen.seal.jobsSha256ForAll132PreparedIds);
  assert.equal(result.denominators.semanticPasses, 0);
});

const originalMutation = JSON.parse(frozen.bytes.get('review:capture-y9zvw316/ER-16-unknown-assertion-input.json')).expected;
await observe('F01-original-reproduced', () => cohort('old-F01', [{ job: { expected: originalMutation } }], { assertReceipt(receipt, job, destination) { oldAssertions.assertCapture(receipt, job, destination, catalogue); } }), (raw) => settled(returned(raw), 'PASS', 1));
await observe('F01-corrected-continuation', () => cohort('new-F01', [{ job: { expected: originalMutation } }, {}]), (raw) => {
  const summary = returned(raw); settled(summary, 'FAIL', 2);
  assert(summary.results[0].failures.some((message) => message.includes('UNFULFILLED_OBLIGATIONS')));
  assert.equal(summary.results[1].outcome, 'PASS');
  const obligations = JSON.parse(readFileSync(join(summary.evidence, summary.results[0].jobId, 'obligations.json')));
  assert.equal(obligations.status, 'INCOMPLETE');
  assert.equal(obligations.unfulfilled[0].value, originalMutation.assertions[0]);
});

for (const testCase of controls.obligationCases) await observe(testCase.id, () => cohort(testCase.id, [{ job: { expected: { ...command.expected, ...testCase.expected }, ...testCase.job } }]), (raw) => settled(returned(raw), testCase.aggregate, 1));
await observe('raw-before-assertion', () => cohort('raw-before', [{}], { assertReceipt() { throw new Error('intentional assertion after raw persistence'); } }), (raw) => {
  const summary = returned(raw); settled(summary, 'FAIL', 1);
  assert(summary.results[0].failures.some((message) => message.includes('intentional assertion')));
});

for (const revision of ['v1', 'v2']) await observe(`F02-identities-${revision}`, () => cohort(`identities-${revision}`, [{ mode: 'identities', recipe: revision === 'v1' ? legacy : recipe, payload: { ...command, hostile: revision === 'v2' } }], {
  assertReceipt(receipt) { assert.equal(receipt.outcome, 'CAPTURED'); },
}), (raw) => {
  const summary = returned(raw); settled(summary, 'PASS', 1);
  const receipt = JSON.parse(readFileSync(join(summary.evidence, summary.results[0].jobId, 'receipt.json')));
  const values = receipt.captured;
  assert.deepEqual(values.first, values.firstAgain);
  assert.deepEqual(values.primitives.slice(0, 3), [{ kind: 'undefined' }, { kind: 'null' }, { kind: 'boolean', value: 'false' }]);
  if (revision === 'v1') assert.deepEqual(values.first, values.second);
  else {
    assert.notDeepEqual(values.first.identity, values.second.identity);
    assert.deepEqual(values.first.identity, values.cleanup[0].identity);
    assert.deepEqual(values.second.identity, values.cleanup[1].identity);
    assert.equal(new Set(values.primitives.map((entry) => JSON.stringify(entry))).size, values.primitives.length);
    for (const entries of [values.symbols, values.functions]) { assert.deepEqual(entries[0].identity, entries[1].identity); assert.notDeepEqual(entries[0].identity, entries[2].identity); }
    assert.equal(values.hostile.message, '<unprintable>');
    assert(values.hostile.identity.scope);
  }
});
await observe('identity-scope-boundary', async () => {
  const { createRejectionEncoder } = await import(pathToFileURL(join(recipe, 'context.mjs')));
  const reason = {};
  return [createRejectionEncoder()(reason), createRejectionEncoder()(reason)];
}, (raw) => { const values = returned(raw); assert.notEqual(values[0].identity.scope, values[1].identity.scope); });

for (const mode of ['nonzero', 'signal', 'timeout', 'overflow', 'malformed', 'wrong-job']) await observe(`host-${mode}`, () => cohort(`host-${mode}`, [{ mode }, {}], mode === 'timeout' ? { bounds: { deadlineMs: 200 } } : mode === 'overflow' ? { bounds: { captureBytes: 1024 } } : {}), (raw) => {
  const summary = returned(raw); settled(summary, 'FAIL', 2);
  assert.equal(summary.results[1].outcome, 'PASS');
  const metadata = summary.results[0].metadata;
  if (mode === 'nonzero') assert.equal(metadata.exitCode, 7);
  if (mode === 'signal') assert.equal(metadata.signal, 'SIGTERM');
  if (mode === 'timeout') { assert.equal(metadata.timedOut, true); assert(metadata.kills.includes('SIGKILL')); }
  if (mode === 'overflow') assert.equal(metadata.overflow, true);
});
for (const kind of ['content', 'mode', 'file', 'directory']) await observe(`integrity-${kind}`, () => cohort(`integrity-${kind}`, [{ mode: `mutate-${kind}` }, {}]), (raw) => settled(returned(raw), 'FAIL', 1, 'integrity'));
await observe('reap-proof-stop', () => cohort('reap-stop', [{}, {}], { withholdReapProof: true }), (raw) => settled(returned(raw), 'FAIL', 1, 'reap'));
await observe('integrity-and-reap-stop', () => cohort('both-stop', [{ mode: 'mutate-file' }, {}], { withholdReapProof: true }), (raw) => {
  const summary = returned(raw); settled(summary, 'FAIL', 1, 'integrity');
  assert(summary.results[0].failures.includes('integrity')); assert(summary.results[0].failures.includes('reap'));
});

const fenceTarget = folder(join(work, 'fence-target'));
file(join(fenceTarget, 'timer-fixture.mjs'), 'import { setImmediate } from "node:timers/promises";\nawait setImmediate();\nexport const available = true;\n');
for (const revision of ['v1', 'v2']) await observe(`fence-static-${revision}`, () => cohort(`fence-static-${revision}`, [{ mode: 'fence', recipe: revision === 'v1' ? legacy : recipe, target: fenceTarget, payload: {} }], { assertReceipt() {} }), (raw) => {
  const summary = returned(raw); settled(summary, 'PASS', 1);
  const receipt = JSON.parse(readFileSync(join(summary.evidence, summary.results[0].jobId, 'receipt.json')));
  assert.equal(receipt.result.accepted, revision === 'v2');
  if (revision === 'v1') assert.match(receipt.result.message, /Unbound candidate builtin: node:timers\/promises/);
  else assert.equal(receipt.result.available, true);
});
await observe('fence-denials', async () => {
  const results = [];
  const outside = file(join(work, 'outside.mjs'), 'export {};\n');
  const alias = join(fenceTarget, 'alias.mjs'); symlinkSync(outside, alias);
  for (const recipeRoot of [legacy, recipe]) {
    const fence = await import(pathToFileURL(join(recipeRoot, 'import-fence.mjs')));
    fence.initialize({ compiledRoot: fenceTarget });
    for (const specifier of controls.deniedImports) {
      let rejected = false;
      try { await fence.resolve(specifier, {}, async () => ({ url: specifier })); } catch { rejected = true; }
      results.push({ recipe: recipeRoot === legacy ? 'v1' : 'v2', specifier, rejected });
    }
    for (const filename of [outside, alias]) {
      let rejected = false;
      try { await fence.resolve(pathToFileURL(filename).href, {}, async () => ({ url: pathToFileURL(filename).href })); } catch { rejected = true; }
      results.push({ recipe: recipeRoot === legacy ? 'v1' : 'v2', specifier: filename, rejected });
    }
    for (const specifier of controls.originalBuiltins) assert.equal((await fence.resolve(specifier, {}, async () => ({ url: specifier }))).url, specifier);
    assert.equal((await fence.resolve('./timer-fixture.mjs', {}, async () => ({ url: pathToFileURL(join(fenceTarget, 'timer-fixture.mjs')).href }))).url, pathToFileURL(join(fenceTarget, 'timer-fixture.mjs')).href);
  }
  return results;
}, (raw) => assert(returned(raw).every((entry) => entry.rejected)));

async function actualChild(name, factorySource) {
  const scratch = folder(join(work, name));
  const syntheticSource = folder(join(scratch, 'synthetic-source'));
  const syntheticCompiled = folder(join(scratch, 'synthetic-compiled'));
  file(join(syntheticSource, 'synthetic.data'), 'CANNED FRAMEWORK FIXTURE; NOT CANDIDATE SOURCE OR BUILD ATTESTATION\n');
  const entryPath = file(join(syntheticCompiled, 'factory.mjs'), factorySource);
  const sourceTreeSha256 = guard(syntheticSource).sha256;
  const compiledTreeSha256 = guard(syntheticCompiled).sha256;
  const provenancePath = jsonFile(join(scratch, 'SYNTHETIC-composition.json'), {
    candidateCommit: frozen.bindings.candidateCommit, baselineCommit: '5137a74ec855a32d8a8860eb66b62eb44d11e290',
    acceptedLengthCommit: '74361026502d76b8c2b696f9c60e410ac9b78d95', sourceTreeSha256, compiledTreeSha256,
    rootAcceptedComposition: true, buildReceiptSha256: hash('SYNTHETIC NOT A BUILD RECEIPT'), newPaths: ['src/commands/yq/synthetic.data'],
    qualification: 'Canned host-trust fixture only. Selected identity string is NOT actual candidate/source/build acceptance or root authority.',
  });
  const authorization = {
    schemaVersion: 1, purpose: 'YQ_CANDIDATE_EXECUTION_EXPLICIT_HANDOFF', rootApproval: 'SYNTHETIC FRAMEWORK ONLY; NOT ROOT AUTHORITY',
    candidateCommit: frozen.bindings.candidateCommit, baselineCommit: '5137a74ec855a32d8a8860eb66b62eb44d11e290', acceptedLengthCommit: '74361026502d76b8c2b696f9c60e410ac9b78d95',
    contractCommit: frozen.bindings.contractCommit, independentReviewCommit: 'de89e478d8ddce62eac955708f1b87d7be1bd137',
    recipe: { root: recipe, treeSha256: prepared.seal.treeSha256, sealSha256: prepared.sealSha256 },
    source: { root: syntheticSource, treeSha256: sourceTreeSha256, provenance: { path: provenancePath, sha256: hash(readFileSync(provenancePath)) } },
    compiled: { root: syntheticCompiled, treeSha256: compiledTreeSha256, entry: { path: 'factory.mjs', sha256: hash(readFileSync(entryPath)), exportName: 'createYqCommand', proofRole: 'direct-compiled-factory-handler-not-public-package' } },
    node: { path: process.execPath, sha256: hash(readFileSync(process.execPath)), mode: lstatSync(process.execPath).mode & 0o7777 },
    bounds, frozenRepository: dataRoot, selection: { ids: ['CMD-01'], jobsSha256: jsonHash([command]) }, evidenceParent: hostEvidence,
  };
  const authorizationPath = jsonFile(join(scratch, 'SYNTHETIC-authorization.json'), authorization);
  const authorizationSha256 = hash(readFileSync(authorizationPath));
  const { authorize } = await import(pathToFileURL(join(recipe, 'authorization.mjs')));
  const binding = authorize({ authorizationPath, authorizationSha256, sealPath: prepared.sealPath, sealSha256: prepared.sealSha256 });
  const job = { ...command, cwd: syntheticCompiled, args: [join(recipe, 'child.mjs'), authorizationPath, authorizationSha256, prepared.sealPath, prepared.sealSha256, command.id] };
  return host.runJobs({ executable: process.execPath, jobs: [job], guards: binding.guards, evidenceParent: hostEvidence, bounds,
    assertReceipt(receipt, job, destination) {
      assert.deepEqual(receipt.binding, { authorizationSha256, sealSha256: prepared.sealSha256, candidateCommit: frozen.bindings.candidateCommit, sourceTreeSha256, compiledEntrySha256: authorization.compiled.entry.sha256, jobsSha256: authorization.selection.jobsSha256 });
      assertions.assertCapture(receipt, job, destination, catalogue);
    },
  });
}
await observe('actual-child-timers', () => actualChild('actual-timers', `import { setImmediate } from 'node:timers/promises';\nexport function createYqCommand() { return { name: 'yq', async execute(context) { await setImmediate(); await context.stdout.write(new TextEncoder().encode(${JSON.stringify(command.expected.stdoutUtf8)})); return { exitCode: 0 }; } }; }\n`), (raw) => settled(returned(raw), 'PASS', 1));
await observe('actual-child-rejection-cleanup', () => actualChild('actual-identities', `export function createYqCommand() { return { name: 'yq', async execute(context) { const same = { name: 'same', message: 'same' }; context.registerCleanup(() => { throw same; }); context.registerCleanup(() => { throw { name: 'same', message: 'same' }; }); throw same; } }; }\n`), (raw) => {
  const summary = returned(raw); settled(summary, 'FAIL', 1);
  const receipt = JSON.parse(readFileSync(join(summary.evidence, command.id, 'receipt.json')));
  assert.equal(receipt.capture.rejected, true);
  assert.deepEqual(receipt.capture.rejection.identity, receipt.capture.cleanupErrors[0].identity);
  assert.notDeepEqual(receipt.capture.rejection.identity, receipt.capture.cleanupErrors[1].identity);
});

await observe('authorization-selected-pin', async () => {
  const { authorize } = await import(pathToFileURL(join(recipe, 'authorization.mjs')));
  const partial = { schemaVersion: 1, purpose: 'YQ_CANDIDATE_EXECUTION_EXPLICIT_HANDOFF', rootApproval: 'SYNTHETIC ONLY NOT AUTHORITY', candidateCommit: 'b'.repeat(40), baselineCommit: '5137a74ec855a32d8a8860eb66b62eb44d11e290', acceptedLengthCommit: '74361026502d76b8c2b696f9c60e410ac9b78d95' };
  const authorizationPath = jsonFile(join(work, 'wrong-candidate.json'), partial);
  authorize({ authorizationPath, authorizationSha256: hash(readFileSync(authorizationPath)), sealPath: prepared.sealPath, sealSha256: prepared.sealSha256 });
}, (raw) => assert.match(raw.error, /Runtime v2 is bound only to the selected candidate/));
await observe('authorization-missing', async () => (await import(pathToFileURL(join(recipe, 'authorization.mjs')))).authorize({}), (raw) => assert.match(raw.error, /Missing explicit candidate authorization/));
await observe('recipe-no-clobber', () => materializeRecipe(recipe), (raw) => assert.match(raw.error, /EEXIST/));
await observe('recipe-new-entry-refusal', () => {
  const scratch = folder(join(work, 'recipe-tamper'));
  for (const entry of prepared.seal.entries.filter((entry) => entry.kind === 'file')) file(join(scratch, entry.path), readFileSync(join(recipe, entry.path)));
  file(join(scratch, 'unbound.mjs'), 'export {};\n');
  integrity.verifyGuards([{ kind: 'tree', path: scratch, sha256: prepared.seal.treeSha256 }]);
}, (raw) => assert.match(raw.error, /Tree membership\/hash\/modes/));

assert.deepEqual(observations.map((entry) => entry.id), controls.cases.map((entry) => entry.id), 'Exact presealed observation order/count');
verifySources();
authenticateFrozen();
verifyRecipe(recipe);
integrity.verifyGuards(recipeGuards);
assert.deepEqual(host.activeChildren(), []);
const summary = {
  schemaVersion: 2, classification: 'SYNTHETIC_FRAMEWORK_ONLY', sourceCommit, presealSha256,
  recipeTreeSha256: prepared.seal.treeSha256, recipeSealSha256: prepared.sealSha256,
  observations: observations.length, matched: observations.filter((entry) => entry.outcome === 'MATCH').length,
  failures: observations.filter((entry) => entry.outcome === 'FAIL'), controls: observations,
  roleCounts: controls.roleCounts, originalFindingsPreserved: true,
  activeChildren: host.activeChildren(), originalInputsAuthenticatedBeforeAfter: true,
  recipeMembershipIncludingAdditionsChecked: true, wholeRepositoryAppendProof: false,
  productImports: 0, productExecutions: 0, builds: 0, typeCompiles: 0, nativeYaml: 0, privateImports: 0, semanticPasses: 0, grantsGO: false,
  work, evidence,
};
integrity.atomicJson(join(evidence, 'SUMMARY.json'), summary);
process.stdout.write(`${JSON.stringify({ evidence, observations: summary.observations, matched: summary.matched, failures: summary.failures, semanticPasses: 0, grantsGO: false })}\n`);
process.exitCode = summary.failures.length ? 1 : 0;
