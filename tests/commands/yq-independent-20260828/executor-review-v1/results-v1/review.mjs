import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const authentication = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ownRoot = dirname(fileURLToPath(import.meta.url));
const recipe = join(authentication.runtime, 'recipe');
const evidence = authentication.evidence;
const scratch = authentication.temporary;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
const errorData = (error) => ({ name: error.name, code: error.code ?? null, message: error.message, stack: error.stack });
function authenticateCopies() {
  for (const file of authentication.files) {
    assert.equal(hash(readFileSync(file.materialized)), file.sha256, file.path);
    const stat = lstatSync(file.materialized);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.mode & 0o7777, file.mode);
  }
}
authenticateCopies();
assert.equal(process.execPath, authentication.node);
assert.equal(hash(readFileSync(process.execPath)), authentication.nodeSha256);
const host = await import(pathToFileURL(join(recipe, 'host.mjs')).href);
const integrity = await import(pathToFileURL(join(recipe, 'integrity.mjs')).href);
const fixtures = await import(pathToFileURL(join(recipe, 'fixtures.mjs')).href);
const captureAssertions = await import(pathToFileURL(join(recipe, 'assert-capture.mjs')).href);
const context = await import(pathToFileURL(join(recipe, 'context.mjs')).href);
const authorization = await import(pathToFileURL(join(recipe, 'authorization.mjs')).href);
const guards = await import(pathToFileURL(join(authentication.consumers, 'guards.mjs')).href);
const typeWorker = await import(pathToFileURL(join(authentication.consumers, 'type-worker.mjs')).href);
const consumerRecipe = await import(pathToFileURL(join(authentication.consumers, 'verify-recipe.mjs')).href);
const consumerSealHash = '24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d';
consumerRecipe.verifyRecipe(consumerSealHash);
const bounds = { deadlineMs: 1000, termGraceMs: 100, reapMs: 300, captureBytes: 65536, maximumJobs: 4 };
const start = Date.now();
const observations = [];
const childPath = join(ownRoot, 'synthetic-child.mjs');
const hostEvidence = join(scratch, 'host-evidence');
mkdirSync(hostEvidence, { mode: 0o755 });
const recipeGuard = { kind: 'tree', path: recipe, sha256: integrity.jsonHash(integrity.treeSnapshot(recipe)) };
assert.equal(recipeGuard.sha256, 'e04229e35902d8dd34c91c0adfbb357120312ff743ecdc9434b0d239c152db78');

function rawTree(root) {
  const result = {};
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const filename = join(path, name);
      if (lstatSync(filename).isDirectory()) visit(filename);
      else result[relative(root, filename)] = { base64: readFileSync(filename).toString('base64'), mode: lstatSync(filename).mode & 0o7777 };
    }
  }
  visit(root);
  return result;
}

async function observe(family, name, input, operation, predicate, classification = 'RUNTIME_SYNTHETIC_FRAMEWORK') {
  assert(Date.now() - start < 120000, 'Presealed suite deadline exhausted');
  authenticateCopies();
  integrity.verifyGuards([recipeGuard]);
  consumerRecipe.verifyRecipe(consumerSealHash);
  assert.deepEqual(host.activeChildren(), [], 'Unsafe reviewer continuation');
  const prefix = join(evidence, `${family}-${name}`);
  save(prefix + '-input.json', input);
  let returned;
  let rejected = null;
  try { returned = await operation(); } catch (error) { rejected = errorData(error); }
  const raw = { classification, returned: returned ?? null, rejected, activeChildren: host.activeChildren() };
  save(prefix + '-raw.json', raw);
  let failure = null;
  try { predicate(raw); } catch (error) { failure = errorData(error); }
  const observation = { family, name, classification, outcome: failure ? 'CONTROL_FAILURE_REQUIRES_REVIEW' : 'CONTROL_PASS', failure, input: relative(evidence, prefix + '-input.json'), raw: relative(evidence, prefix + '-raw.json') };
  save(prefix + '-verdict.json', observation);
  observations.push(observation);
  authenticateCopies();
  integrity.verifyGuards([recipeGuard]);
  consumerRecipe.verifyRecipe(consumerSealHash);
  assert.deepEqual(host.activeChildren(), [], 'Stop: a known owned child is not reaped');
}

function refused(raw, code) {
  assert(raw.rejected, 'Unrecognized or unsafe input was accepted');
  if (code) assert.equal(raw.rejected.code, code);
}
function succeeded(raw) { assert.equal(raw.rejected, null); }
function makeDirectory(name) {
  const path = join(scratch, name);
  mkdirSync(path, { mode: 0o755 });
  return path;
}
function physicalFile(root, name, bytes) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o644 });
  return path;
}
function makeReceipt(id, extra = {}) { return { schemaVersion: 1, jobId: id, outcome: 'PASS', ...extra }; }
async function cohort(name, specifications, options = {}) {
  const root = makeDirectory(name);
  const guarded = makeDirectory(name + '-guarded');
  const input = physicalFile(guarded, 'input.txt', 'original\n');
  const boundary = { kind: 'tree', path: guarded, sha256: integrity.jsonHash(integrity.treeSnapshot(guarded)) };
  const jobs = specifications.map((specification, index) => {
    const id = `job${index}`;
    const spec = { id, ...specification };
    if (spec.mutate === true) spec.mutate = input;
    if (index > 0) spec.marker = join(root, `admitted-${index}.txt`);
    const filename = join(root, `${id}.json`);
    save(filename, spec);
    return { id, args: [childPath, filename], cwd: root };
  });
  const summary = await host.runJobs({ executable: process.execPath, jobs, guards: [recipeGuard, boundary], evidenceParent: hostEvidence, bounds: { ...bounds, ...options.bounds }, withholdReapProof: options.withholdReapProof ?? false, assertReceipt: options.assertReceipt ?? (() => {}) });
  return { summary, rawFiles: rawTree(summary.evidence), secondMarker: existsSync(join(root, 'admitted-1.txt')), effects: { input: readFileSync(input, 'utf8') } };
}
function cohortFail(raw, admitted, stop = undefined) {
  succeeded(raw);
  assert.equal(raw.returned.summary.aggregate, 'FAIL');
  assert.equal(raw.returned.summary.admitted, admitted);
  if (stop !== undefined) assert.equal(raw.returned.summary.stop, stop);
  assert.deepEqual(raw.returned.summary.activeChildren, []);
  assert(raw.returned.summary.results.filter((row) => row.admitted).every((row) => row.metadata.reaped));
}

const data = fixtures.loadData(recipe, authentication.frozen);
const cmdJob = fixtures.materializeJobs(data, ['CMD-01'])[0];
const captured = {
  schemaVersion: 1, jobId: 'job0', outcome: 'CAPTURED',
  capture: { stdoutHex: Buffer.from('raw-out').toString('hex'), stderrHex: Buffer.from('raw-err').toString('hex'), status: 7, rejected: false, rejection: null, cleanupErrors: [], effects: { before: [], after: [] }, events: [{ kind: 'synthetic-event', reason: { kind: 'null' } }] },
};
save(join(evidence, 'CONTROL-BINDINGS.json'), {
  preparedControls: '../FIXTURES.json#/controls', clarification: '../PRE-REVIEW-ER08-CLARIFICATION-v1.md',
  independentRecipe: Object.fromEntries(['authenticate.py', 'review.mjs', 'synthetic-child.mjs'].map((name) => [name, hash(readFileSync(join(ownRoot, name)))])),
  targets: { 'ER-01/02/04/05/06/08/17': 'runtime/recipe/host.mjs runJobs/ownedNode/parseReceipt', 'ER-03/16': 'runtime/recipe/assert-capture.mjs assertCapture; context.mjs encodeRejection', 'ER-07/18': 'runtime integrity.verifyGuards/createEvidence; consumer verifyRecipe/validateReceiptShape/assertSourceMap', 'ER-09/14/16': 'runtime fixtures.materializeJobs and authenticated inventory rows', 'ER-10': 'actual authorize and execute.mjs entry fence', 'ER-11/12': 'consumer expectedPackage/assertPackageTree/verifyPreseal', 'ER-13': 'consumer copyAndMoveRegularTree/resolveImportPath/withMaterializedImports', 'ER-15': 'consumer classifyCompilerOutcome/assertWorkerExit' },
  exclusions: ['No actual product candidate loaded', 'No compiler or build', 'No author control suite', 'No replacement executor or forged capability'],
});

await observe('ER-01', 'pass-exit7', { receipt: 'PASS', exit: 7 }, () => cohort('pass-exit7', [{ exitCode: 7 }]), (raw) => cohortFail(raw, 1));
await observe('ER-02', 'fail-then-pass', { integrity: true, knownReap: true }, () => cohort('fail-then-pass', [{ mode: 'fail' }, {}]), (raw) => { cohortFail(raw, 2, null); assert(raw.returned.secondMarker); assert.equal(raw.returned.summary.results[1].outcome, 'PASS'); });
await observe('ER-03', 'capture-before-assert', captured, () => cohort('capture-before-assert', [{ receipt: captured, stderr: 'runner-stderr\n' }], { assertReceipt(receipt, job, folder) {
  for (const file of ['stdout.bin', 'stderr.bin', 'child.json', 'boundary.json', 'receipt.json']) assert(existsSync(join(folder, file)), 'Raw capture missing before assertion');
  captureAssertions.assertCapture(receipt, { ...cmdJob, expected: { status: 0 } }, folder, []);
} }), (raw) => { cohortFail(raw, 1); for (const file of ['stdout.bin', 'stderr.bin', 'child.json', 'command-stdout.bin', 'command-stderr.bin']) assert(Object.hasOwn(raw.returned.rawFiles, `job0/${file}`)); });
await observe('ER-03', 'reason-identities', { sameObjectTwice: true, distinctEqualLookingObjects: true }, () => {
  const first = { name: 'same', message: 'same' };
  const second = { name: 'same', message: 'same' };
  return { primitives: [undefined, null, false].map(context.encodeRejection), first: context.encodeRejection(first), firstAgain: context.encodeRejection(first), second: context.encodeRejection(second) };
}, (raw) => { succeeded(raw); assert.equal(new Set(raw.returned.primitives.map(JSON.stringify)).size, 3); assert.deepEqual(raw.returned.first, raw.returned.firstAgain); assert.notDeepEqual(raw.returned.first, raw.returned.second, 'Distinct reason objects lose observable identity'); });
await observe('ER-04', 'missing-receipt', {}, () => cohort('missing', [{ mode: 'missing' }]), (raw) => cohortFail(raw, 1));
for (const [name, bytes] of [
  ['duplicate', JSON.stringify(makeReceipt('job0')) + '\n' + JSON.stringify(makeReceipt('job0')) + '\n'],
  ['malformed', '{bad}\n'], ['wrong-job', JSON.stringify(makeReceipt('other')) + '\n'],
  ['duplicate-key', '{"schemaVersion":1,"jobId":"job0","outcome":"FAIL","outcome":"PASS"}\n'],
]) await observe('ER-05', name, { stdout: bytes }, () => cohort(name, [{ raw: bytes }]), (raw) => cohortFail(raw, 1));
await observe('ER-06', 'mutation-stops-next', {}, () => cohort('mutation-stops-next', [{ mutate: true }, {}]), (raw) => { cohortFail(raw, 1, 'integrity'); assert.equal(raw.returned.secondMarker, false); });
for (const variant of ['bytes', 'mode', 'new-file', 'new-directory', 'new-symlink']) {
  await observe('ER-07', variant, { guarded: 'synthetic candidate/recipe tree', mutation: variant }, () => {
    const root = makeDirectory('guard-' + variant);
    const path = physicalFile(root, 'input', 'frozen');
    const guard = { kind: 'tree', path: root, sha256: integrity.jsonHash(integrity.treeSnapshot(root)) };
    if (variant === 'bytes') writeFileSync(path, 'changed');
    if (variant === 'mode') chmodSync(path, 0o600);
    if (variant === 'new-file') physicalFile(root, 'extra', 'extra');
    if (variant === 'new-directory') mkdirSync(join(root, 'extra'));
    if (variant === 'new-symlink') symlinkSync(path, join(root, 'extra'));
    integrity.verifyGuards([guard]);
  }, refused);
}
for (const variant of ['mode', 'new-file']) await observe('ER-07', 'consumer-recipe-' + variant, { mutation: variant }, () => {
  const target = variant === 'mode' ? join(authentication.consumers, 'guards.mjs') : join(authentication.consumers, 'independent-extra');
  try {
    if (variant === 'mode') chmodSync(target, 0o600); else writeFileSync(target, 'synthetic\n', { flag: 'wx' });
    return consumerRecipe.verifyRecipe(consumerSealHash);
  } finally { if (variant === 'mode') chmodSync(target, 0o644); else rmSync(target); }
}, refused);
await observe('ER-08', 'timeout-reaped', { correctedPredicate: 'STOP or continuation after integrity AND reap; sticky FAIL' }, () => cohort('timeout-reaped', [{ mode: 'timeout' }, {}], { bounds: { deadlineMs: 100 } }), (raw) => { succeeded(raw); assert.equal(raw.returned.summary.aggregate, 'FAIL'); assert(raw.returned.summary.results[0].metadata.timedOut); if (raw.returned.secondMarker) assert(raw.returned.summary.results[0].integrity && raw.returned.summary.results[0].reapProof); });
await observe('ER-08', 'withheld-reap', { actualChildMustStillBeReaped: true, seam: 'actual runJobs withholdReapProof' }, () => cohort('withheld-reap', [{}, {}], { withholdReapProof: true }), (raw) => { cohortFail(raw, 1, 'reap'); assert.equal(raw.returned.secondMarker, false); });
await observe('ER-08', 'bad-both-boundaries', {}, () => cohort('bad-both', [{ mutate: true }, {}], { withholdReapProof: true }), (raw) => { cohortFail(raw, 1, 'integrity'); assert.equal(raw.returned.secondMarker, false); });

await observe('ER-09', 'inventory-accounting', { proof: 'DATA/SOURCE only, not 194 runtime passes' }, () => {
  const rows = data.inventory.rows;
  const selected = rows.filter((row) => row.runtimeProofRole);
  const jobs = fixtures.materializeJobs(data, selected.map((row) => row.id));
  const originalIds = data.sources.get('final-manifest').coverage.groups.flatMap((group) => group.caseIds.split(' '));
  for (const row of rows) {
    const original = data.sources.get(row.frozen.source).cases.find((entry) => entry.id === row.id);
    assert.equal(integrity.jsonHash(original), row.frozen.recordSha256);
    assert.equal(row.semanticDenominatorEligible, row.primaryRole === 'command-semantic-runtime');
    assert.equal(row.result, 'PENDING_AUTHORIZED_CANDIDATE');
    if (row.missingBindings.length) assert.equal(row.fullRecordEligibleAfterProjection, false);
  }
  assert.deepEqual(rows.map((row) => row.id), originalIds);
  return { count: rows.length, roles: Object.fromEntries([...new Set(rows.map((row) => row.primaryRole))].map((role) => [role, rows.filter((row) => row.primaryRole === role).length])), projections: selected.length, jobs: jobs.length, fullSemantic: rows.filter((row) => row.semanticDenominatorEligible && row.fullRecordEligibleAfterProjection).length, partialSemantic: selected.filter((row) => row.semanticDenominatorEligible && row.missingBindings.length).length, missing: rows.filter((row) => row.missingBindings.length).length, unprepared: rows.filter((row) => !row.runtimeProofRole).length, pending: rows.length, semanticPasses: data.inventory.denominators.semanticPasses, sourceIds: rows.filter((row) => row.primaryRole === 'source-static-counterproof').map((row) => ({ id: row.id, missingBindings: row.missingBindings })) };
}, (raw) => { succeeded(raw); const result = raw.returned; assert.equal(result.count, 194); assert.deepEqual(result.roles, { 'command-semantic-runtime': 111, 'admission-error-boundary': 34, 'source-static-counterproof': 23, 'lifecycle-cooperative': 11, 'materialized-package-infrastructure': 4, 'type-consumer': 5, 'negative-control': 6 }); assert.deepEqual([result.projections, result.jobs, result.fullSemantic, result.partialSemantic, result.missing, result.unprepared, result.semanticPasses], [132, 149, 94, 17, 80, 62, 0]); }, 'DATA_SOURCE_NOT_RUNTIME_SEMANTIC');

async function fakeExecution(name, source, changes = {}) {
  const root = makeDirectory(name);
  const sourceRoot = makeDirectory(name + '-source');
  const compiledRoot = makeDirectory(name + '-compiled');
  physicalFile(sourceRoot, 'synthetic.txt', 'Not product source; no build.\n');
  const marker = join(root, 'import-marker.txt');
  const entryPath = physicalFile(compiledRoot, 'entry.mjs', source.replaceAll('@@MARKER@@', JSON.stringify(marker)));
  const sourceHash = integrity.jsonHash(integrity.treeSnapshot(sourceRoot));
  const compiledHash = integrity.jsonHash(integrity.treeSnapshot(compiledRoot));
  const provenancePath = join(root, 'composition.json');
  save(provenancePath, { candidateCommit: 'b'.repeat(40), baselineCommit: '5137a74ec855a32d8a8860eb66b62eb44d11e290', acceptedLengthCommit: '74361026502d76b8c2b696f9c60e410ac9b78d95', sourceTreeSha256: sourceHash, compiledTreeSha256: compiledHash, rootAcceptedComposition: true, buildReceiptSha256: 'd'.repeat(64), newPaths: ['src/commands/yq/synthetic.ts'], qualification: 'Independent synthetic trusted-attestation fixture, NOT source/build/candidate acceptance' });
  const authorizationPath = join(root, 'authorization.json');
  const authorizationObject = {
    schemaVersion: 1, purpose: 'YQ_CANDIDATE_EXECUTION_EXPLICIT_HANDOFF', rootApproval: 'SYNTHETIC FRAMEWORK ONLY', candidateCommit: 'b'.repeat(40), baselineCommit: '5137a74ec855a32d8a8860eb66b62eb44d11e290', acceptedLengthCommit: '74361026502d76b8c2b696f9c60e410ac9b78d95', contractCommit: 'bd471ef682d768692a682d40009a874f51e3ad68', independentReviewCommit: 'de89e478d8ddce62eac955708f1b87d7be1bd137',
    recipe: { root: recipe, sealSha256: '2fce675f035a2ad39c2e2e2ee9d54e2762a531383e70507149993268acedb7e8', treeSha256: recipeGuard.sha256 },
    source: { root: sourceRoot, treeSha256: sourceHash, provenance: { path: provenancePath, sha256: hash(readFileSync(provenancePath)) } },
    compiled: { root: compiledRoot, treeSha256: compiledHash, entry: { path: 'entry.mjs', sha256: hash(readFileSync(entryPath)), exportName: 'createYqCommand', proofRole: 'direct-compiled-factory-handler-not-public-package' } },
    node: { path: process.execPath, sha256: authentication.nodeSha256, mode: lstatSync(process.execPath).mode & 0o7777 },
    frozenRepository: authentication.frozen, selection: { ids: ['CMD-01'], jobsSha256: integrity.jsonHash([cmdJob]) }, bounds, evidenceParent: hostEvidence,
  };
  save(authorizationPath, authorizationObject);
  const args = changes.absent ? [join(recipe, 'execute.mjs')] : [join(recipe, 'execute.mjs'), authorizationPath, changes.badHash ? '0'.repeat(64) : hash(readFileSync(authorizationPath)), join(authentication.runtime, 'RECIPE-SEAL.json'), authorizationObject.recipe.sealSha256];
  const capturedChild = await host.ownedNode({ executable: process.execPath, args, cwd: root, bounds: { ...bounds, deadlineMs: 4000 } });
  save(join(evidence, name + '-process-raw.json'), { args, stdoutBase64: capturedChild.stdout.toString('base64'), stderrBase64: capturedChild.stderr.toString('base64'), metadata: capturedChild.metadata });
  let summary = null;
  let files = null;
  if (capturedChild.stdout.length) {
    const output = JSON.parse(capturedChild.stdout.toString());
    if (output.evidence) { summary = JSON.parse(readFileSync(join(output.evidence, 'summary.json'))); files = rawTree(output.evidence); }
  }
  return { stdoutBase64: capturedChild.stdout.toString('base64'), stderrBase64: capturedChild.stderr.toString('base64'), metadata: capturedChild.metadata, summary, rawFiles: files, importMarkerSeen: capturedChild.stdout.includes('INDEPENDENT_IMPORT_SIDE_EFFECT'), authorization: authorizationObject };
}
const fakeModule = `export function createYqCommand() { return { name: "yq", async execute(context) { await context.stdout.write(new TextEncoder().encode(${JSON.stringify(cmdJob.expected.stdoutUtf8)})); return { exitCode: 0 }; } }; }\n`;
for (const [name, options] of [['missing-authorization', { absent: true }], ['hash-mismatch', { badHash: true }]]) await observe('ER-10', name, { deferredMarker: 'stdout INDEPENDENT_IMPORT_SIDE_EFFECT would be emitted by fake module if reached', authorization: options }, () => fakeExecution(name, 'process.stdout.write("INDEPENDENT_IMPORT_SIDE_EFFECT\\n");\n' + fakeModule, options), (raw) => { succeeded(raw); assert.notEqual(raw.returned.metadata.exitCode, 0); assert(raw.returned.metadata.reaped); assert.equal(raw.returned.summary, null); assert.equal(raw.returned.importMarkerSeen, false); });
await observe('ER-05', 'actual-execute-positive', { syntheticFactory: true, semanticCredit: 0 }, () => fakeExecution('execute-positive', fakeModule), (raw) => { succeeded(raw); assert.equal(raw.returned.metadata.exitCode, 0); assert.equal(raw.returned.summary.aggregate, 'PASS'); assert(raw.returned.summary.results.every((row) => row.metadata.reaped)); });
const forged = { schemaVersion: 1, jobId: cmdJob.id, outcome: 'CAPTURED', proofRole: 'direct-compiled-factory-handler-not-public-package', binding: { candidateCommit: 'wrong' }, capture: {} };
await observe('ER-05', 'actual-execute-forged-binding', forged, () => fakeExecution('execute-forged', `process.stdout.write(${JSON.stringify(JSON.stringify(forged) + '\n')}); process.exit(0); export function createYqCommand() {}\n`), (raw) => { succeeded(raw); assert.equal(raw.returned.metadata.exitCode, 1); assert.equal(raw.returned.summary.aggregate, 'FAIL'); assert(raw.returned.summary.results[0].failures.some((failure) => failure.startsWith('assertion:'))); });

const packageRoot = makeDirectory('fake-package');
const packageContents = { 'README.md': 'Independent fake package README\n', 'package.json': '{"type":"module"}\n', 'dist/contracts/index.js': 'export const contract = true;\n', 'dist/contracts/index.d.ts': 'export declare const contract: boolean;\n', 'dist/commands/yq/index.js': 'export const origin = import.meta.url;\n', 'dist/commands/yq/index.js.map': '{}\n', 'dist/commands/yq/index.d.ts': 'export declare const origin: string;\n', 'dist/commands/yq/index.d.ts.map': '{}\n' };
for (const [path, bytes] of Object.entries(packageContents)) physicalFile(packageRoot, path, bytes);
const packageTree = guards.inspectTree(packageRoot);
const baseline = Object.fromEntries(Object.entries(packageTree.files).filter(([path]) => !path.startsWith('dist/commands/')));
const packageReceipt = { sourceAdditions: { 'src/commands/yq/index.ts': { sha256: 'a'.repeat(64), bytes: 1, mode: 420 } }, packageAdditions: Object.fromEntries(Object.entries(packageTree.files).filter(([path]) => path.startsWith('dist/commands/'))), packageDirectories: packageTree.directories, entries: { yq: 'dist/commands/yq/index.js', contracts: 'dist/contracts/index.js' } };
const expectedPackage = guards.expectedPackage(packageReceipt, baseline, baseline['README.md']);
for (const [family, name] of [['ER-11', 'readme-absent'], ['ER-11', 'readme-changed'], ['ER-12', 'extra-entry']]) await observe(family, name, { baseline: baseline['README.md'], candidateFiles: Object.keys(expectedPackage.files) }, () => {
  const target = join(packageRoot, name === 'extra-entry' ? 'extra.txt' : 'README.md');
  try {
    if (name === 'readme-absent') rmSync(target); else writeFileSync(target, 'changed\n');
    return guards.assertPackageTree(packageRoot, expectedPackage);
  } finally { if (name === 'extra-entry') rmSync(target); else writeFileSync(target, packageContents['README.md'], { mode: 0o644 }); }
}, refused);
await observe('ER-12', 'baseline-omits-readme', {}, () => { const missing = { ...baseline }; delete missing['README.md']; return guards.expectedPackage(packageReceipt, missing, baseline['README.md']); }, (raw) => refused(raw, 'README_IDENTITY'));
await observe('ER-12', 'authenticated-baseline-omission', { target: 'TMP copy BASELINE-PACKAGE.json, original recipe restored after refused check' }, () => {
  const target = join(authentication.consumers, 'BASELINE-PACKAGE.json');
  const original = readFileSync(target);
  try { const changed = JSON.parse(original); delete changed[Object.keys(changed)[0]]; writeFileSync(target, JSON.stringify(changed)); return guards.verifyPreseal(); }
  finally { writeFileSync(target, original); }
}, (raw) => refused(raw, 'PRESEAL_HASH'));
await observe('ER-12', 'authorized-addition-count', { expectedCount: 8, qualification: 'tiny fake map, not an actual baseline package' }, () => guards.expectedPackage(packageReceipt, baseline, baseline['README.md']), (raw) => { succeeded(raw); assert.equal(Object.keys(raw.returned.files).length, 8); });

let movement;
await observe('ER-13', 'physical-move', {}, () => { movement = guards.copyAndMoveRegularTree(packageRoot, join(scratch, 'moved-package'), expectedPackage, '/Users/kjopek/Workspace/safe-bash'); return { movement, originalFile: { ino: lstatSync(join(packageRoot, 'README.md')).ino }, movedFile: { ino: lstatSync(join(movement.root, 'README.md')).ino }, stagingExists: existsSync(movement.staging), package: guards.assertPackageTree(movement.root, expectedPackage) }; }, (raw) => { succeeded(raw); assert.equal(raw.returned.stagingExists, false); assert.notEqual(raw.returned.originalFile.ino, raw.returned.movedFile.ino); });
const parentURL = pathToFileURL(join(movement.root, 'dist/commands/yq/index.js')).href;
const importPolicy = { root: movement.root, workspace: '/Users/kjopek/Workspace/safe-bash', entries: { yq: parentURL }, files: expectedPackage.files, allowedBuiltins: [], hookParent: 'independent-synthetic-hook' };
await observe('ER-13', 'moved-path-resolution', { specifier: parentURL }, () => guards.resolveImportPath(parentURL, importPolicy.hookParent, importPolicy), (raw) => { succeeded(raw); assert.equal(raw.returned, parentURL); });
for (const specifier of ['virtual-bash', '/Users/kjopek/Workspace/safe-bash/src/index.ts', '../../../node_modules/fallback.js', '../../../../../outside.js']) await observe('ER-13', 'fallback-' + observations.filter((row) => row.family === 'ER-13').length, { specifier }, () => guards.resolveImportPath(specifier, parentURL, importPolicy), refused);
await observe('ER-13', 'symlink-escape', {}, () => {
  const path = join(movement.root, 'README.md');
  try { rmSync(path); symlinkSync(join(packageRoot, 'README.md'), path); return guards.assertPackageTree(movement.root, expectedPackage); }
  finally { rmSync(path); writeFileSync(path, packageContents['README.md'], { mode: 0o644 }); }
}, (raw) => refused(raw, 'SYMLINK'));
let callbackReached = false;
await observe('ER-13', 'unbound-import-capability', {}, () => guards.withMaterializedImports({ root: movement.root }, ['yq'], () => { callbackReached = true; }), (raw) => { refused(raw, 'BINDING'); assert.equal(callbackReached, false); });
for (const identifier of ['WRK-22', 'MOV-02', 'TYP-04', 'UNKNOWN-PROJECTION']) await observe('ER-14', identifier, { id: identifier, preserveGap: true }, () => fixtures.materializeJobs(data, [identifier]), refused, 'DATA_ADMISSION_NOT_YQ_RUNTIME');
await observe('ER-14', 'public-integration-pending', {}, () => guards.assertPublicAdmission(), (raw) => refused(raw, 'PUBLIC_EXPORT_GAP'));

const compilerDirectory = makeDirectory('fake-compiler-data');
const compilerFixture = physicalFile(compilerDirectory, 'negative.mts', 'synthetic text; never compiled\n');
const declaration = join(movement.root, 'dist/commands/yq/index.d.ts');
const typeJob = JSON.parse(readFileSync(join(authentication.consumers, 'JOBS.json'))).jobs.find((job) => job.name === 'factory-command-extra');
const compilerFiles = { cwd: compilerDirectory, fixture: compilerFixture, candidate: movement.root, candidateFiles: expectedPackage.files, tools: [], requiredDeclarations: [declaration] };
const rawCompiler = { status: 2, signal: null, error: null, stderr: '', stdout: `${compilerFixture}(2,1): error TS2554: Expected 0 arguments, but got 1.\n${compilerFixture}\n${declaration}\n` };
for (const [name, change, shouldAccept] of [['declared-negative', {}, true], ['missing-module', { stdout: rawCompiler.stdout.replace('TS2554', 'TS2307') }, false], ['missing-declaration', { stdout: rawCompiler.stdout.replace(declaration + '\n', '') }, false], ['declaration-error', { stdout: rawCompiler.stdout.replace(`${compilerFixture}(2,1)`, `${declaration}(2,1)`) }, false], ['signal', { signal: 'SIGTERM' }, false]]) await observe('ER-15', name, { job: typeJob, raw: { ...rawCompiler, ...change }, files: compilerFiles }, () => typeWorker.classifyCompilerOutcome(typeJob, { ...rawCompiler, ...change }, compilerFiles), (raw) => shouldAccept ? (succeeded(raw), assert.equal(raw.returned.classification, 'ACCEPTED_COMPILE_REJECTION')) : refused(raw));
for (const exitCode of [0, 7]) await observe('ER-15', 'type-worker-exit-' + exitCode, { compiler: rawCompiler, exitCode }, () => cohort('type-worker-' + exitCode, [{ mode: 'type', typeModule: join(authentication.consumers, 'type-worker.mjs'), job: typeJob, raw: rawCompiler, files: compilerFiles, exitCode }]), (raw) => { succeeded(raw); const result = raw.returned.summary.results[0]; const worker = { status: result.metadata.exitCode, signal: result.metadata.signal, error: result.metadata.spawnError }; if (exitCode === 0) { typeWorker.assertWorkerExit(worker); assert.equal(raw.returned.summary.aggregate, 'PASS'); } else { cohortFail(raw, 1); assert.throws(() => typeWorker.assertWorkerExit(worker), { code: 'WORKER_EXIT' }); } });

await observe('ER-16', 'source-not-runtime', { id: 'WRK-26' }, () => fixtures.materializeJobs(data, ['WRK-26']), refused, 'DATA_ADMISSION_NOT_YQ_RUNTIME');
await observe('ER-16', 'unknown-data-projection', { kind: 'unbound-independent-projection' }, () => fixtures.materializeDataRecipe({ kind: 'unbound-independent-projection' }), refused, 'DATA_ADMISSION_NOT_YQ_RUNTIME');
await observe('ER-16', 'unknown-assertion', { existingId: 'CMD-01', expected: { ...cmdJob.expected, assertions: ['UNBOUND_INDEPENDENT_ASSERTION_MUST_NOT_GREEN'] } }, () => {
  const receipt = { ...captured, capture: { ...captured.capture, stdoutHex: Buffer.from(cmdJob.expected.stdoutUtf8).toString('hex'), stderrHex: '', status: 0, events: [] } };
  return cohort('unknown-assertion', [{ receipt }], { assertReceipt(actual, job, folder) { captureAssertions.assertCapture(actual, { ...cmdJob, expected: { ...cmdJob.expected, assertions: ['UNBOUND_INDEPENDENT_ASSERTION_MUST_NOT_GREEN'] } }, folder, []); } });
}, (raw) => cohortFail(raw, 1));
for (const mode of ['signal', 'overflow']) await observe('ER-17', mode, {}, () => cohort('child-' + mode, [{ mode }]), (raw) => cohortFail(raw, 1));
await observe('ER-18', 'evidence-overlap', {}, () => integrity.createEvidence(recipe, [recipeGuard]), refused);
await observe('ER-18', 'missing-authorization-direct', {}, () => authorization.authorize({}), refused);
for (const path of ['src/shell/runtime.ts', 'src/commands/structured/limits.ts', 'src/commands/yq/../outside.ts']) await observe('ER-18', 'forbidden-source-' + observations.filter((row) => row.family === 'ER-18').length, { path }, () => guards.validateReceiptShape({ schema: 1, sourceBase: '5137a74ec855a32d8a8860eb66b62eb44d11e290', acceptedLength: '74361026502d76b8c2b696f9c60e410ac9b78d95', candidateCommit: 'b'.repeat(40), sourceAdditions: { [path]: { sha256: 'a'.repeat(64), bytes: 1, mode: 420 } } }, true), refused);
await observe('ER-18', 'exact-source-map', { change: 'unlisted source entry' }, () => guards.assertSourceMap({ 'src/index.ts': { sha256: 'a' }, 'src/extra.ts': { sha256: 'b' } }, { 'src/index.ts': { sha256: 'a' } }), (raw) => refused(raw, 'SOURCE_BINDING'));

const result = {
  date: '2026-08-28', classification: 'INDEPENDENT_SYNTHETIC_FRAMEWORK_REVIEW_NOT_PRODUCT_ACCEPTANCE',
  controls: observations, controlObservations: observations.length, familiesRepresented: [...new Set(observations.map((row) => row.family))].sort(),
  failures: observations.filter((row) => row.outcome !== 'CONTROL_PASS'), elapsedMs: Date.now() - start,
  activeChildren: host.activeChildren(), productImports: 0, productExecutions: 0, builds: 0, typeCompiles: 0, authorControlSuitesExecuted: 0,
  gaps: ['No actual candidate/source/build acceptance: separate root-routed binding stage required.', 'No implemented semantic scoring aggregator to stress with appended nonsemantic jobs; checked actual inventory and materialized job roles only.', 'No forged consumer authority: successful capability-bound withMaterializedImports remains pending actual source/package authorization; low-level physical move and resolution helpers exercised.', 'Source-primary records remain pending and do not prove runtime memory/progress/identity.', 'Known process groups only; no opaque escaped-descendant or hard-preemption guarantee.'],
};
save(join(evidence, 'RESULTS.json'), result);
process.stdout.write(JSON.stringify({ evidence, observations: result.controlObservations, families: result.familiesRepresented.length, controlFailures: result.failures.map((row) => `${row.family}/${row.name}`), activeChildren: result.activeChildren, elapsedMs: result.elapsedMs }) + '\n');
