import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { recipe, scope, repository, work, raw, read, fileHash, sha, tree, fileMap, save, write, protectedGuard, authenticateTools, authenticateRecipe } from './recipe/common.mjs';

const result = read(join(raw, 'RESULT.json'));
assert.equal(result.status, 'STOP_NO_RETRY'); assert.equal(result.phase, 'T03');
assert.equal(result.allChildrenReaped, true); assert.equal(result.finalIntegrity, 'PASS');
assert.equal(result.source.length, 19); assert.equal(result.moved.length, 19); assert.equal(result.actualFrozenPasses, 22);
assert.equal(result.children.length, 42);
const bound = read(join(recipe, 'BINDINGS.json'));
authenticateTools(bound); protectedGuard(bound); authenticateRecipe(result.recipeCommit);
for (const child of result.children) {
  assert.equal(child.forced, false); assert.equal(child.pidAbsent, true); assert.equal(child.processGroupEmpty, true);
  for (const target of [child.pid, -child.pid]) {
    let error; try { process.kill(target, 0); } catch (caught) { error = caught; }
    assert.equal(error?.code, 'ESRCH');
  }
}
const parseLines = path => fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const observations = { source: { loads: 0, productLoads: 0, uniqueProduct: new Set() }, moved: { loads: 0, productLoads: 0, uniqueProduct: new Set() } };
for (const profile of ['source', 'moved']) for (const row of result[profile]) {
  const records = parseLines(join(scope, row.directory, 'module-loads.jsonl'));
  for (const entry of records.filter(entry => entry.event === 'module-load')) {
    observations[profile].loads++;
    if (entry.key.startsWith('node_modules/virtual-bash/')) {
      assert.ok(!entry.key.includes('/shell/cancellation.'));
      observations[profile].productLoads++; observations[profile].uniqueProduct.add(entry.key);
    }
  }
}
for (const profile of ['source', 'moved']) observations[profile].uniqueProduct = observations[profile].uniqueProduct.size;
const t03 = result.children.find(child => child.label === 'T03');
const diagnostic = fs.readFileSync(join(scope, t03.directory, 'stdout.data'), 'utf8');
assert.equal(diagnostic, "consumer.ts(2,29): error TS2322: Type 'string' is not assignable to type 'number'.\n");
assert.equal(fs.readFileSync(join(scope, t03.directory, 'stderr.data'), 'utf8'), '');
assert.equal(t03.exit.code, 2); assert.equal(t03.exit.signal, null);
const typeReads = parseLines(join(raw, 'T03-tool.jsonl')).filter(row => row.kind === 'actual-file-read' && row.path.includes('/node_modules/virtual-bash/'));
for (const row of typeReads) assert.equal(row.sha256, bound.packageFiles[row.path.split('/node_modules/virtual-bash/')[1]]);
assert.ok(typeReads.some(row => row.path.endsWith('/dist/commands/du/index.d.ts')));
assert.ok(!typeReads.some(row => row.path.endsWith('/virtual-bash/dist/index.d.ts')));
const tools = fs.readdirSync(raw).filter(name => name.endsWith('-tool.jsonl')).flatMap(name => parseLines(join(raw, name)));
const report = {
  schema: 'du-public29-independent-checkpoint/1', at: new Date().toISOString(), verdict: 'HOLD_VERIFIER_T03_DECLARATION_ROUTE',
  recipeCommit: result.recipeCommit, recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')),
  candidate: result.candidate, freeze: result.freeze, package: result.package,
  R07: { bindingSha256: fileHash(join(recipe, 'R07.json')), chronology: 'postcandidate-preexecution', source: 'PASS', moved: 'PASS', observationsPerProfile: 9, family: 'htmlToMarkdown', optionalRoutingCounterfactual: 'not implemented by existing frozen framework; no coverage claimed' },
  counts: { sourceRuntime: 19, movedRuntime: 19, uniqueFrozenCases: 29, acceptedFrozenCases: 22, attemptedUnaccepted: ['T03'], neverExecuted: ['P03', 'P04', 'P05', 'P06', 'T04', 'T05'], typeInvocations: 3, acceptedTypeCases: ['T01', 'T02'], controlledNegativeCompilerStatuses: { T02: 2, T03: 2 }, A06: 'PASS-new-release', addendumP03: 'UNEXECUTED', lifecycleMappingsPerRuntimeProfile: 8, naturalChildren: 42, activeChildren: 0, watchdogs: 0, synchronousGitReturns: 881, successfulIntegrityGuards: 85 },
  observations, tools: { actualCommonJsCompiles: tools.filter(row => row.kind === 'actual-commonjs-compile').length, actualFileReadObservations: tools.filter(row => row.kind === 'actual-file-read').length, regularFilesPrebound: 2274, aliasesMetadataOnly: 12 },
  failure: { class: 'verifier-contract-mismatch', location: 'recipe/executor.mjs:94', exactCause: 'validateTool unconditionally requires dist/index.d.ts even when original T03 imports only virtual-bash/commands/du.', originalFixture: 'consumers/negative-limits.ts.data', actualSubpathDeclarationRead: true, rootDeclarationRead: false, exactCompilerOutput: diagnostic, status: 2, stderr: '', productBugEstablished: false, rescore: false },
  recommendation: 'Root may authorize a separately sealed minimal per-fixture declaration-route predicate. Require both root/subpath for T01/T02, subpath for T03/T04, root for T05, and the declared missing-export route for P03. Keep actual read hashes, full diagnostic sets, permissions and all original fixtures unchanged; test missing/wrong-route/hash controls first. Do not replay source/moved cohorts or call this original invocation a pass.',
  rawQualification: 'Original RESULT.json uses unexecuted for all unaccepted IDs and therefore includes executed T03. It remains unchanged; this report explicitly distinguishes T03 post-compiler harness rejection from six genuinely unexecuted cases.',
  integrity: 'protected inputs, original15, recipe, tools and fresh source/package trees unchanged at final audit; repeated post-only authentication before compaction',
  history: { previous3e02038d: '0/29 preexecution hold unchanged', firstAdmissionStop: 'b0a7b441 unchanged', acceptedAdmission: '5508a2a2 bound, not rerun', originalModuleAndNative: 'unchanged separate qualifications', preparation: 'PREPARATION-01.json preserves unsealed inventory-order failure and missing complete terminal stderr' },
  boundaries: { fullGate: false, whole76: false, public29Accepted: false, privateHelperApproved: false, privateHelperLoaded: false, physicalAllocationClaims: false, duplicateOperandsO060: 'deferred profile gap', newNativeOrMetadataCohort: false, fullHistoryArchiveProof: false },
};
save(join(scope, 'REPORT.json'), report);
write(join(scope, 'RESULT-original.json'), fs.readFileSync(join(raw, 'RESULT.json')));
const rawFiles = tree(raw).filter(row => row.type === 'file');
const entries = rawFiles.map(row => ({ ...row, path: `raw/${row.path}`, base64: fs.readFileSync(join(raw, row.path)).toString('base64') }));
const packPath = join(work, 'candidate.tgz');
entries.push({ path: 'reproducible-input/candidate.tgz', mode: 0o644, type: 'file', bytes: fs.statSync(packPath).size, sha256: fileHash(packPath), base64: fs.readFileSync(packPath).toString('base64') });
const archive = gzipSync(entries.map(row => JSON.stringify(row)).join('\n') + '\n', { level: 9 });
write(join(scope, 'captures.jsonl.gz'), archive);
const restored = gunzipSync(archive).toString().trim().split('\n').map(JSON.parse);
assert.equal(restored.length, entries.length);
for (let index = 0; index < restored.length; index++) { const row = restored[index], original = entries[index]; assert.equal(row.path, original.path); assert.equal(sha(Buffer.from(row.base64, 'base64')), original.sha256); assert.equal(Buffer.from(row.base64, 'base64').length, original.bytes); }
save(join(scope, 'CAPTURE-INVENTORY.json'), { schema: 1, archiveSha256: sha(archive), compressedBytes: archive.length, entries: entries.map(({ base64, ...row }) => row), verifiedLossless: true });
write(join(scope, 'WORK-INVENTORY.json.gz'), gzipSync(JSON.stringify(tree(work)), { level: 9 }));
fs.rmSync(work, { recursive: true }); fs.rmSync(raw, { recursive: true });
save(join(scope, 'CLEANUP.json'), { at: new Date().toISOString(), scratchRemoved: !fs.existsSync(work), rawCompactedLosslessly: !fs.existsSync(raw), childrenNatural: 42, processGroupsEmpty: 42, active: 0, reexecutedCases: 0, scopeOnly: relative(repository, scope) });
console.log(JSON.stringify({ verdict: report.verdict, counts: report.counts, observations, tools: report.tools, compressedBytes: archive.length, rawFiles: rawFiles.length, scratchRemoved: true }));
