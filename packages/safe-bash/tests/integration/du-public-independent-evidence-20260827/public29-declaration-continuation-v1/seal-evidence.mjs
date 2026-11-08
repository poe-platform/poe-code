import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { recipe, scope, repository, work, raw, read, fileHash, sha, tree, save, write, protectedGuard, authenticateTools, authenticateRecipe } from './recipe/common.mjs';
import { authenticatePrior, prior as priorRoot } from './recipe/prior.mjs';
import { declarationReadProof, assertExactT03 } from './recipe/predicate.mjs';

const result = read(join(raw, 'RESULT.json'));
assert.equal(result.status, 'COMPOSED_SCOPED_DU29_QUALIFIED');
assert.equal(result.finalIntegrity, 'PASS');
assert.equal(result.allChildrenReaped, true);
assert.equal(result.attempts, 1);
assert.equal(result.retries, 0);
assert.deepEqual(result.cases.map(row => row.id), ['T03', 'T04', 'T05', 'P03', 'P04', 'P05', 'P06']);
assert.deepEqual(result.unexecuted, []);
assert.equal(result.source.length, 0);
assert.equal(result.moved.length, 0);
assert.equal(result.children.length, 9);
assert.equal(result.focused.length, 22);
for (const row of result.focused) assert.equal(row.observed, row.expected, row.id);
assert.equal(result.focused.filter(row => row.observed === 'accepted').length, 3);
assert.equal(result.controls.filter(row => row.status === 'EXPECTED_REJECTION').length, 23);
assert.equal(result.guards.length, 17);
for (const row of result.guards) assert.equal(row.status, 'unchanged');
authenticatePrior();
const bindings = read(join(priorRoot, 'recipe/BINDINGS.json'));
authenticateTools(bindings);
protectedGuard(bindings);
authenticateRecipe(result.recipeCommit);
const routes = read(join(recipe, 'ROUTES.json'));
const parseLines = target => fs.readFileSync(target, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const reaping = [];
for (const child of result.children) {
  assert.equal(child.forced, false);
  assert.equal(child.pidAbsent, true);
  assert.equal(child.processGroupEmpty, true);
  assert.equal(child.exit.signal, null);
  assert.equal(child.exit.code, child.close.code);
  for (const target of [child.pid, -child.pid]) {
    let failure;
    try { process.kill(target, 0); } catch (error) { failure = error; }
    assert.equal(failure?.code, 'ESRCH', `PROCESS_REAPING:${target}`);
  }
  reaping.push({ label: child.label, pid: child.pid, status: child.exit.code, pidAbsent: true, processGroupAbsent: true });
}
for (const proof of result.declarationProofs) {
  const child = result.children.find(row => row.label === proof.label);
  const records = parseLines(join(raw, `${proof.label}-tool.jsonl`));
  assert.deepEqual(declarationReadProof(records, proof.label, child.cwd, join(work, 'tools'), routes), proof);
}
const t03 = result.children.find(row => row.label === 'T03');
assertExactT03({ code: t03.exit.code, signal: t03.exit.signal, stdout: fs.readFileSync(join(scope, t03.directory, 'stdout.data'), 'utf8'), stderr: fs.readFileSync(join(scope, t03.directory, 'stderr.data'), 'utf8') }, routes);
const observations = fs.readdirSync(raw).filter(name => name.endsWith('-tool.jsonl')).flatMap(name => parseLines(join(raw, name)));
assert.equal(observations.filter(row => row.kind === 'actual-commonjs-compile').length, 568);
assert.equal(observations.filter(row => row.kind === 'actual-file-read').length, 2043);
const aliasPath = join(work, 'guard-controls/alias');
const aliasStat = fs.lstatSync(aliasPath);
assert.ok(aliasStat.isSymbolicLink());
assert.equal(fs.readlinkSync(aliasPath), 'input.data');
const alias = { path: 'guard-controls/alias', type: 'symlink', mode: aliasStat.mode & 0o777, link: fs.readlinkSync(aliasPath), disposition: 'intentional P06 negative; metadata recorded without following; removed before strict remaining-work inventory' };
const report = {
  schema: 'du-public29-composed-independent-qualification/1', at: new Date().toISOString(),
  verdict: result.status, recipeCommit: result.recipeCommit, recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')),
  candidate: result.candidate, freeze: result.freeze, package: result.package,
  originalEvidence: '83645ad032238edb6d0887ae445c3b8c9d7c7f2a', originalEvidenceManifestSha256: fileHash(join(priorRoot, 'EVIDENCE-MANIFEST.json')),
  counts: { priorQualified: 22, newlyQualified: 7, composedUniqueCases: 29, newCaseIds: result.cases.map(row => row.id), newUnexecuted: [], priorSourceRuntime: 19, priorMovedRuntime: 19, sourceReruns: 0, movedReruns: 0, newCompilerInvocations: 6, newRuntimeNegativeInvocations: 2, focusedControls: 22, focusedAcceptedInputs: 3, focusedExpectedRejects: 19, originalPackageGuardExpectedRejects: 23, naturalChildren: 9, activeChildren: 0, watchdogs: 0, synchronousGitReturns: result.gitSynchronousNaturalReturns, integrityCheckpoints: 17 },
  declarationProofs: result.declarationProofs,
  typeOutcomes: [...result.types, result.cases.find(row => row.id === 'P03').strictType],
  toolProof: { regularFilesPrebound: 2274, aliasesMetadataOnly: 12, actualCommonJsCompiles: 568, actualFileReads: 2043 },
  release: { A06: 'genuine accepted HTML74 prerequisite passed in immutable83645ad0, bound not rerun', addendumP03: 'PASS composed22+7 completion with actual moved declaration reads', oldP03P06T04T05: 'previously unrun; now independently executed once', T03: 'new strict leaf closure proof; original correct TS2322 and old verifier rejection remain unchanged', T04T05: 'actual unchanged imports require ROOT and all79 transitive declarations' },
  loadQualification: { newSuccessfulRuntimeLoads: 0, originalRuntimeLoadProof: '83645ad0 source19 and moved19 bound; actual load hashes preserved', P05: 'six countercontrols on authenticated historical moved-P01 trace, not a new successful load', privateHelperApproved: false, privateHelperProductLoads: 0 },
  historicalQualification: { original22: 'not rescored', originalT03Failure: 'unchanged', originalSixUnrunDisposition: 'unchanged original invocation; continuation separately versioned', old3e02038dAndAdmissionStops: 'unchanged', moduleAndNative: 'separate accepted proofs, no rerun or composite historical footer', v2v3Delta: 'permanently unproved', O060: 'deferred duplicate-operand deterministic-order profile gap' },
  boundaries: { scopedPublicDuPrerequisite: true, whole76: false, fullGate: false, newNativeOrMetadataAudit: false, fullHistoryArchiveProof: false, wholeLiveCheckoutProof: false, newFullPackReproduction: false, sourceFallback: false, productChanges: false },
  reaping, postOnlyCompaction: true, intentionalAlias: alias,
};
save(join(scope, 'REPORT.json'), report);
write(join(scope, 'RESULT-original.json'), fs.readFileSync(join(raw, 'RESULT.json')));
const rawFiles = tree(raw).filter(row => row.type === 'file');
const entries = rawFiles.map(row => ({ ...row, path: `raw/${row.path}`, base64: fs.readFileSync(join(raw, row.path)).toString('base64') }));
const packPath = join(work, 'candidate.tgz');
assert.equal(fileHash(packPath), result.packSha256);
entries.push({ path: 'reproducible-input/candidate.tgz', mode: fs.statSync(packPath).mode & 0o777, type: 'file', bytes: fs.statSync(packPath).size, sha256: fileHash(packPath), base64: fs.readFileSync(packPath).toString('base64') });
const archive = gzipSync(entries.map(row => JSON.stringify(row)).join('\n') + '\n', { level: 9 });
write(join(scope, 'captures.jsonl.gz'), archive);
const restored = gunzipSync(archive, { maxOutputLength: 32 * 1024 ** 2 }).toString().trim().split('\n').map(JSON.parse);
assert.equal(restored.length, entries.length);
for (let index = 0; index < restored.length; index++) {
  const restoredBytes = Buffer.from(restored[index].base64, 'base64');
  assert.equal(restored[index].path, entries[index].path);
  assert.equal(sha(restoredBytes), entries[index].sha256);
  assert.equal(restoredBytes.length, entries[index].bytes);
}
save(join(scope, 'CAPTURE-INVENTORY.json'), { schema: 1, archiveSha256: sha(archive), compressedBytes: archive.length, entries: entries.map(({ base64, ...row }) => row), verifiedLossless: true });
fs.unlinkSync(aliasPath);
const workInventory = tree(work);
write(join(scope, 'WORK-INVENTORY.json.gz'), gzipSync(JSON.stringify({ intentionalAlias: alias, remainingStrictTree: workInventory }), { level: 9 }));
fs.rmSync(work, { recursive: true });
fs.rmSync(raw, { recursive: true });
save(join(scope, 'CLEANUP.json'), { at: new Date().toISOString(), scratchRemoved: !fs.existsSync(work), rawCompactedLosslessly: !fs.existsSync(raw), childrenNatural: 9, processGroupsEmpty: 9, active: 0, postOnlyAuditProductReexecutions: 0, scopeOnly: relative(repository, scope), intentionalAlias: alias });
console.log(JSON.stringify({ verdict: report.verdict, counts: report.counts, captureRecords: entries.length, compressedBytes: archive.length, sha256: sha(archive), scratchRemoved: true }));
