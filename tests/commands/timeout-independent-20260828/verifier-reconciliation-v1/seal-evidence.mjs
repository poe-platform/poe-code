import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { recipe, scope, repository, work, raw, read, fileHash, sha, tree, matchInventory, tarEntries } from './recipe/io.mjs';

const evidence = join(scope, 'evidence');
const startedAt = new Date().toISOString();
assert.equal(fileHash(join(recipe, 'MANIFEST.json')), '32ebd8694afc58d317303b5ea631ee757c2f91e4be0d139ae1ab3f66eacb9fdd');
const manifest = read(join(recipe, 'MANIFEST.json'));
for (const [name, digest] of Object.entries(manifest.files)) assert.equal(fileHash(join(recipe, name)), digest);
const bindings = read(join(recipe, 'BINDINGS.json'));
for (const row of bindings.protectedRows) {
  const target = join(repository, row.path);
  assert.ok(fs.lstatSync(target).isFile()); assert.equal(fileHash(target), row.sha256, row.path);
}
const resultBytes = fs.readFileSync(join(raw, 'RESULT.json'));
const result = JSON.parse(resultBytes);
assert.equal(result.recipeCommit, '7e6a0b781a2d0cb9e1bc7b0dd02ee973cd857504');
assert.equal(result.candidate, '9ed9a0f14d12758713a8dc42be1ff75f0c87a36f');
assert.equal(result.status, 'RECONCILIATION_COMPLETE_PC01_BOUNDARY_REVIEW_REQUIRED');
assert.equal(result.attempts, 1); assert.equal(result.retries, 0);
assert.equal(result.integrity, 'PASS'); assert.equal(result.allChildrenReaped, true);
assert.equal(result.children.length, 9);
assert.equal(result.focusedControls.length, 28);
assert.ok(result.focusedControls.every(row => row.actual === row.expected));
assert.ok(result.types.length === 2 && result.types.every(row => row.status === 'PASS'));
assert.ok(result.controls.length === 2 && result.controls.every(row => row.status === 'PASS'));
assert.ok(result.mutants.length === 2 && result.mutants.every(row => row.status === 'PASS'));
const reaping = [];
for (const child of result.children) {
  assert.equal(child.forced, false); assert.deepEqual(child.exit, child.close);
  assert.equal(child.pidAbsent, true); assert.equal(child.processGroupAbsent, true);
  for (const identifier of [child.pid, -child.pid]) {
    let failure;
    try { process.kill(identifier, 0); } catch (error) { failure = error; }
    assert.equal(failure?.code, 'ESRCH', `PROCESS_PRESENT:${identifier}`);
  }
  reaping.push({ label: child.label, pid: child.pid, exit: child.exit, pidAndGroupAbsent: true });
}
const closure = read(join(repository, bindings.closurePath));
assert.equal(process.execPath, closure.binaries[0].path);
for (const binary of closure.binaries) {
  assert.equal(fs.realpathSync(binary.path), binary.realpath); assert.equal(fileHash(binary.path), binary.sha256);
}
let regular = 0, aliases = 0;
for (const packageRow of closure.packages) {
  const destination = ['npm', 'typescript'].includes(packageRow.name) ? join(work, 'tools', packageRow.name) : join(work, 'dependencies/node_modules', packageRow.name);
  const expected = [];
  for (const row of packageRow.records) {
    const input = join(packageRow.root, row.path), stat = fs.lstatSync(input);
    assert.equal(stat.mode & 511, row.mode);
    if (row.type === 'directory') assert.ok(stat.isDirectory());
    else if (row.type === 'symlink') {
      assert.ok(stat.isSymbolicLink()); assert.equal(fs.readlinkSync(input), row.link);
      assert.equal(fs.existsSync(join(destination, row.path)), false); aliases++;
    } else {
      assert.ok(stat.isFile()); assert.equal(fileHash(input), row.sha256);
      expected.push({ path: row.path, mode: row.mode, bytes: stat.size, sha256: row.sha256 }); regular++;
    }
  }
  matchInventory(tree(destination), expected);
}
assert.equal(regular, 2274); assert.equal(aliases, 12);
const archive = fs.readFileSync(join(repository, bindings.sourceArchive.path));
assert.equal(sha(archive), bindings.sourceArchive.sha256);
matchInventory(tarEntries(archive), bindings.inputs);
const pack = fs.readFileSync(join(repository, bindings.retainedPack.path));
assert.equal(sha(pack), bindings.pack.sha256);
matchInventory(tarEntries(pack, true).map(row => ({ ...row, path: row.path.slice(8) })), bindings.packageFiles);
assert.equal(fs.existsSync(join(work, 'installed')), false);
const profileSummary = [];
for (const profile of ['source', 'moved', 'M01', 'M02']) {
  const configPath = join(work, `${profile}-config.json`), configuration = read(configPath);
  const child = result.children.find(row => row.label === profile);
  assert.equal(fileHash(configPath), child.environment.TIMEOUT_CONFIG_SHA256);
  for (const guard of configuration.guardRoots) matchInventory(tree(guard.root), guard.entries);
  for (const [target, digest] of Object.entries(configuration.loads)) assert.equal(fileHash(target), digest);
  const receipt = read(join(raw, profile, 'RESULT.json'));
  assert.equal(receipt.cases.length, 1); assert.equal(receipt.cleanup.pending, 0); assert.equal(receipt.cleanup.schedulerLive, 0);
  assert.deepEqual(receipt.cleanup.unhandled, []); assert.deepEqual(receipt.unexecuted, []);
  assert.equal(receipt.cases[0].integrity, 'UNCHANGED');
  const trace = fs.readFileSync(configuration.trace, 'utf8').trim().split('\n').map(JSON.parse);
  const loads = trace.filter(row => row.kind === 'actual-module-load');
  for (const load of loads) assert.equal(load.sha256, configuration.loads[load.path]);
  profileSummary.push({ profile, originalAssertionOutcome: receipt.cases[0].status, failure: receipt.cases[0].error?.text,
    numericVectorsExecuted: receipt.numeric.length, actualModuleLoads: loads.length,
    productLoads: loads.filter(row => row.path.startsWith(configuration.guardRoots[0].root + '/')).length,
    observations: receipt.diagnosticObservations, cleanup: receipt.cleanup });
}
const toolMap = read(join(work, 'tool-map.json'));
const tools = [];
for (const name of fs.readdirSync(raw).filter(name => name.endsWith('-tool.jsonl')).sort()) {
  const observations = fs.readFileSync(join(raw, name), 'utf8').trim().split('\n').map(JSON.parse);
  const compiles = observations.filter(row => row.kind === 'actual-commonjs-compile');
  const reads = observations.filter(row => row.kind === 'actual-file-read');
  for (const row of compiles) { assert.equal(row.compileSha256, toolMap[row.path]); assert.equal(row.diskSha256, row.compileSha256); }
  for (const row of reads) if (Object.hasOwn(toolMap, row.path)) assert.equal(row.sha256, toolMap[row.path]);
  const declarations = [...new Map(reads.filter(row => row.path.includes('/node_modules/virtual-bash/') && row.path.endsWith('.d.ts')).map(row => [row.path, { path: row.path, sha256: row.sha256 }])).values()];
  for (const row of declarations) assert.equal(fileHash(row.path.replace('/work/installed/', '/work/physically-moved/consumer/')), row.sha256);
  tools.push({ name, actualCompiles: compiles.length, actualReads: reads.length, packageDeclarationClosure: declarations });
}
const newSourceNotice = {
  rootAnnouncedSource: 'a23867d6a42e1cb2f2e7278cf22061737a4bea9d',
  rootAnnouncedFreeze: '72a109971d6c82f783ae91de62f7c15e2af21d8b',
  rootAnnouncedEvidence: 'b53f7fff5a2a33c8ab3501ead65d40fadcfbc644',
  timing: 'Received after this reconciliation recipe was committed and its one execution completed.',
  inspected: false, authenticatedByThisRun: false, executed: false,
  nextBoundary: 'Return the exact PC01 boundary proposal to root before implementing any semantic predicate correction; new source needs its own versioned bindings and execution.'
};
const borrowed = result.source.diagnosticObservations.find(row => row.route === 'borrowed-outer-invoke');
assert.deepEqual(borrowed, result.moved.diagnosticObservations.find(row => row.route === 'borrowed-outer-invoke'));
const proposal = {
  schema: 'timeout-PC01-boundary-proposal-not-applied/1', status: 'ROOT_DECISION_REQUIRED',
  basis: 'New observations on old pinned candidate, not reconstructed historical bytes and not original pre-code literals.',
  sourceAndMovedNewObservation: borrowed,
  retainForBothRoutes: ['observed own deadline sentinel equals caller reason by Object.is', 'raw timeout handler rejects that exact object, never returns124', 'handler and outer remain pending until selected child cleanup release', 'actual required dispatch and completed selected-child/retirement cleanup with zero owned resources'],
  rootCallerRoute: { change: 'NONE', expected: 'raw handler and outer Shell both reject the exact caller sentinel' },
  borrowedInvokeRoute: { rawInvoke: 'reject exact sentinel', actualDispatch: { timeout: 1, child: 1, outer: 1 },
    outer: { status: 'fulfilled', exitCode: 1, stdoutBase64: '', stderrBase64: borrowed.outer.stderrBase64, stderrText: borrowed.outer.stderr },
    reason: 'Accepted Stage2 maps a live outer command handler error to status1 after the borrowed invocation rejects; no root-caller signal was supplied to that Shell exec.' },
  counterfactual: 'M01 actually returns124 from the raw handler while root Shell still rejects; the unchanged raw-handler predicate kills it, so outer behavior cannot mask a timeout mapping defect.',
  nonClaims: ['No old PC01 rescore', 'No amendment applied to its assertions', 'No global mapping of arbitrary host errors', 'No new candidate acceptance']
};
const rawInventory = tree(raw), workInventory = tree(work);
const retained = rawInventory.map(row => ({ ...row, path: `raw/${row.path}`, base64: fs.readFileSync(join(raw, row.path)).toString('base64') }));
const selectedWork = workInventory.filter(row => !['tools/', 'dependencies/', 'source/', 'M01/', 'M02/', 'physically-moved/consumer/node_modules/'].some(prefix => row.path.startsWith(prefix)));
for (const row of selectedWork) retained.push({ ...row, path: `work/${row.path}`, base64: fs.readFileSync(join(work, row.path)).toString('base64') });
const encoded = Buffer.from(retained.map(row => JSON.stringify(row)).join('\n') + '\n');
const compressed = gzipSync(encoded, { level: 9 });
assert.deepEqual(gunzipSync(compressed), encoded);
for (const row of retained) { const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
fs.mkdirSync(evidence);
const write = (name, bytes) => fs.writeFileSync(join(evidence, name), bytes, { flag: 'wx' });
const save = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
write('RESULT-original.json', resultBytes);
write('raw-and-configs.jsonl.gz', compressed);
write('work-inventory.json.gz', gzipSync(Buffer.from(JSON.stringify(workInventory) + '\n'), { level: 9 }));
save('PC01-BOUNDARY-PROPOSAL.json', proposal);
save('NEXT-SOURCE-NOTICE.json', newSourceNotice);
save('POST-AUTHENTICATION.json', { startedAt, protectedFiles: bindings.protectedRows.length,
  recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')), sourceArchiveSha256: sha(archive), inputs: bindings.inputs.length,
  packSha256: sha(pack), packageMembers: bindings.packageFiles.length, packReproduction: 'BOUND_PRIOR_ACTUAL_NOT_RERUN',
  tools: { regular, metadataOnlyAliases: aliases }, observations: tools, freshGuardTreesUnchanged: true,
  originalInstalledPathAbsent: true, reaping, rawInventoryEntries: rawInventory.length, workInventoryEntries: workInventory.length });
save('SUMMARY.json', {
  schema: 'timeout-independent-verifier-reconciliation-disposition/1', recipeCommit: result.recipeCommit, candidate: result.candidate,
  startedAt: result.startedAt, finishedAt: result.finishedAt, attempts: 1, retries: 0,
  originalResultStatus: result.status, originalResultSha256: sha(resultBytes),
  focusedControls: { passed: 28, total: 28, exactRoot: 13, strictLoadDenial: 10, publicSubpathDenial: 5 },
  rootTypes: { passed: 2, total: 2, diagnostic: 'TS2724', location: 'consumer.ts(1,10)', compilerExit: 2, declarationsPerLayout: 85 },
  diagnosticProfiles: profileSummary, negativeControls: result.controls, mutants: result.mutants,
  children: { asynchronous: 9, natural: 9, forced: 0, reaped: true, synchronousGitNaturalReturns: result.preRunGitSynchronousNaturalReturns },
  guards: { supervisor: result.guards.length, perCasePost: 4, final: result.integrity },
  toolLoads: { actualCompiles: tools.reduce((sum, row) => sum + row.actualCompiles, 0), actualReads: tools.reduce((sum, row) => sum + row.actualReads, 0) },
  rawPreservation: { rawFiles: rawInventory.length, rawBytes: rawInventory.reduce((sum, row) => sum + row.bytes, 0), retainedWorkFiles: selectedWork.length, archiveBytes: compressed.length, sha256: sha(compressed) },
  currentDeclaredTailUnexecuted: [], native: 0, safeJS: 0,
  remaining: ['Root decision on PC01 exact borrowed-boundary proposal before semantic amendment', 'Separate new F22 candidate authentication/review/execution including previously unexecuted F22 resource/resolver assertions'],
  nonClaims: ['Original31/34 and7/8 and A09 stop unchanged', 'No original missing bytes recovered', 'No full-cohort rerun', 'No public/default/whole-gate/private-helper approval', 'New F22 source is only root-announced, not authenticated or inspected here']
});
assert.deepEqual(fs.readFileSync(join(evidence, 'RESULT-original.json')), fs.readFileSync(join(raw, 'RESULT.json')));
assert.deepEqual(gunzipSync(fs.readFileSync(join(evidence, 'raw-and-configs.jsonl.gz'))), encoded);
for (const target of [work, raw]) { assert.ok(target.startsWith(scope + '/')); assert.equal(fs.realpathSync(target), resolve(target)); }
fs.rmSync(work, { recursive: true }); fs.rmSync(raw, { recursive: true });
save('CLEANUP.json', { at: new Date().toISOString(), ownedWorkRemoved: !fs.existsSync(work), rawRemovedAfterLosslessArchival: !fs.existsSync(raw), allNineChildrenReapedBeforeCleanup: true, postOnlySealerProductExecutions: 0, productRetries: 0 });
console.log(JSON.stringify({ status: 'RECONCILIATION_EVIDENCE_SEALED', rawFiles: rawInventory.length, controls: 28, types: 2, negatives: 2, mutants: 2, children: 9, PC01: 'PROPOSAL_NOT_APPLIED', scratchRemoved: true }));
