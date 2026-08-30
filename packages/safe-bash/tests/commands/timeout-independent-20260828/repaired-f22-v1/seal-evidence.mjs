import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { recipe, scope, repository, work, raw, read, fileHash, sha, tree, matchInventory, tarEntries } from './recipe/io.mjs';

const evidence = join(scope, 'evidence'), startedAt = new Date().toISOString();
assert.equal(fileHash(join(recipe, 'MANIFEST.json')), 'af30a8a18b9c3f85148d4feee9f0553e1afce30e22c7d34de577452ae0dc908e');
const manifest = read(join(recipe, 'MANIFEST.json'));
for (const [name, digest] of Object.entries(manifest.files)) assert.equal(fileHash(join(recipe, name)), digest);
const bindings = read(join(recipe, 'BINDINGS.json'));
for (const row of bindings.protectedRows) {
  const target = join(repository, row.path); assert.ok(fs.lstatSync(target).isFile()); assert.equal(fileHash(target), row.sha256, row.path);
}
const resultBytes = fs.readFileSync(join(raw, 'RESULT.json')), result = JSON.parse(resultBytes);
assert.equal(result.recipeCommit, '93196f7e4851a6fe5880c90ba69827923e82ffc5');
assert.equal(result.candidate, 'a23867d6a42e1cb2f2e7278cf22061737a4bea9d');
assert.equal(result.status, 'SCOPED_TIMEOUT_MODULE_REVIEW_PASSED');
assert.equal(result.attempts, 1); assert.equal(result.retries, 0);
assert.equal(result.integrity, 'PASS'); assert.equal(result.allChildrenReaped, true);
assert.equal(result.children.length, 27);
assert.equal(result.focusedControls.length, 48); assert.ok(result.focusedControls.every(row => row.actual === row.expected));
assert.equal(result.controls.length, 15); assert.ok(result.controls.every(row => row.rejected === true || row.status === 'PASS'));
assert.equal(result.types.length, 16); assert.ok(result.types.every(row => row.status === 'PASS'));
assert.equal(result.mutants.length, 3); assert.ok(result.mutants.every(row => row.status === 'PASS'));
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
for (const binary of closure.binaries) { assert.equal(fs.realpathSync(binary.path), binary.realpath); assert.equal(fileHash(binary.path), binary.sha256); }
let regular = 0, aliases = 0;
for (const packageRow of closure.packages) {
  const destination = ['npm', 'typescript'].includes(packageRow.name) ? join(work, 'tools', packageRow.name) : join(work, 'dependencies/node_modules', packageRow.name);
  const expected = [];
  for (const row of packageRow.records) {
    const input = join(packageRow.root, row.path), stat = fs.lstatSync(input); assert.equal(stat.mode & 511, row.mode);
    if (row.type === 'directory') assert.ok(stat.isDirectory());
    else if (row.type === 'symlink') {
      assert.ok(stat.isSymbolicLink()); assert.equal(fs.readlinkSync(input), row.link); assert.equal(fs.existsSync(join(destination, row.path)), false); aliases++;
    } else {
      assert.ok(stat.isFile()); assert.equal(fileHash(input), row.sha256); expected.push({ path: row.path, mode: row.mode, bytes: stat.size, sha256: row.sha256 }); regular++;
    }
  }
  matchInventory(tree(destination), expected);
}
assert.equal(regular, 2274); assert.equal(aliases, 12);
const archive = fs.readFileSync(join(repository, bindings.sourceArchive.path));
assert.equal(sha(archive), bindings.sourceArchive.sha256); matchInventory(tarEntries(archive), bindings.inputs);
const packPath = join(work, 'pack/virtual-bash-0.0.0.tgz'), pack = fs.readFileSync(packPath);
assert.equal(sha(pack), bindings.pack.sha256); assert.equal(pack.length, 736430);
matchInventory(tarEntries(pack, true).map(row => ({ ...row, path: row.path.slice(8) })), bindings.packageFiles);
assert.equal(fs.existsSync(join(work, 'installed')), false);
const profileSummary = [], actualModuleProofs = [];
for (const profile of ['source', 'moved', 'M01', 'M02', 'M03']) {
  const configPath = join(work, `${profile}-config.json`), configuration = read(configPath);
  const child = result.children.find(row => row.label === profile);
  assert.equal(fileHash(configPath), child.environment.TIMEOUT_CONFIG_SHA256);
  for (const guard of configuration.guardRoots) matchInventory(tree(guard.root), guard.entries);
  for (const [target, digest] of Object.entries(configuration.loads)) assert.equal(fileHash(target), digest);
  const receipt = read(join(raw, profile, 'RESULT.json'));
  assert.equal(receipt.cleanup.pending, 0); assert.equal(receipt.cleanup.schedulerLive, 0);
  assert.deepEqual(receipt.cleanup.unhandled, []); assert.deepEqual(receipt.cleanup.disposalRejections, []); assert.deepEqual(receipt.unexecuted, []);
  for (const row of receipt.cases) { assert.equal(row.integrity, 'UNCHANGED'); assert.equal(row.cleanup.pending, 0); assert.equal(row.cleanup.schedulerLive, 0); }
  const trace = fs.readFileSync(configuration.trace, 'utf8').trim().split('\n').map(JSON.parse);
  const loads = trace.filter(row => row.kind === 'actual-module-load');
  for (const load of loads) assert.equal(load.sha256, configuration.loads[load.path]);
  const productRoot = configuration.guardRoots[0].root;
  const productLoads = loads.filter(row => row.path.startsWith(productRoot + '/'));
  const mutation = bindings.mutants.find(row => row.id === profile);
  if (mutation) {
    assert.equal(receipt.cases.length, 1); assert.equal(receipt.cases[0].status, 'FAIL');
    assert.ok(receipt.cases[0].error.text.includes(mutation.failure));
    const required = loads.find(row => row.path === join(productRoot, mutation.path));
    assert.ok(required, `ACTUAL_MUTANT_MODULE_LOAD_REQUIRED:${profile}`);
    assert.equal(required.sha256, mutation.mutantSha256);
    actualModuleProofs.push({ profile, kind: 'actual-mutated-module-load', requiredPath: mutation.path, ...required });
  } else {
    assert.equal(receipt.cases.length, 34); assert.ok(receipt.cases.every(row => row.status === 'PASS'));
    assert.equal(receipt.numeric.length, 70); assert.equal(new Set(receipt.diagnostics.map(row => row.label)).size, 14);
    for (const name of ['index', 'duration', 'scheduler']) {
      const entry = profile === 'source' ? `src/commands/timeout/${name}.ts` : `dist/commands/timeout/${name}.js`;
      const expected = (profile === 'source' ? bindings.inputs : bindings.packageFiles).find(row => row.path === entry);
      const required = loads.find(row => row.path === join(productRoot, entry));
      assert.ok(required, `ACTUAL_REPAIRED_MODULE_LOAD_REQUIRED:${profile}:${entry}`); assert.equal(required.sha256, expected.sha256);
      actualModuleProofs.push({ profile, kind: 'actual-repaired-module-load', requiredPath: entry, ...required });
    }
    const defaultCall = receipt.diagnosticObservations.find(row => row.kind === 'F22-default-before-assertion');
    assert.equal(defaultCall.outcome.status, 'fulfilled'); assert.equal(defaultCall.outcome.exitCode, 7);
    assert.equal(defaultCall.stdoutBase64, ''); assert.equal(defaultCall.stderrBase64, '');
    const resource = receipt.activations.find(row => row.id === 'F22');
    assert.equal(resource.timeoutResourcesBefore, 0); assert.equal(resource.timeoutResourcesAfter, 0);
    const resolver = receipt.diagnosticObservations.filter(row => row.kind === 'F22-resolver-before-assertion');
    assert.deepEqual(resolver.map(row => row.expected), [127, 126]);
    for (const row of resolver) { assert.equal(row.baseline.exitCode, row.expected); assert.deepEqual(row.baseline, row.wrapped); }
    const borrowed = receipt.diagnosticObservations.find(row => row.kind === 'PC01-boundaries' && row.route === 'borrowed-outer-invoke');
    assert.equal(borrowed.handler.status, 'rejected'); assert.equal(borrowed.handler.sameSentinel, true);
    assert.equal(borrowed.rawInvoke.status, 'rejected'); assert.equal(borrowed.rawInvoke.sameSentinel, true);
    assert.deepEqual(borrowed.dispatch, { timeout: 1, child: 1, outer: 1 });
    assert.equal(borrowed.outer.exitCode, 1); assert.equal(borrowed.outer.stdoutBase64, '');
    assert.equal(borrowed.outer.stderrBase64, Buffer.from('shell: line 1: [object Object]\n').toString('base64'));
    const retirement = receipt.activations.filter(row => row.id === 'PC02'); assert.equal(retirement.length, 2);
    for (const row of retirement) { assert.equal(row.sameSentinel, true); assert.equal(row.actualRetirementThrew, true); assert.equal(row.resources, 0); }
    assert.equal(retirement[0].actualProductRetirementEntered, true); assert.equal(retirement[1].retirementEntered, 1);
  }
  profileSummary.push({ profile, caseIds: receipt.cases.map(row => row.id), cases: receipt.cases.length,
    passed: receipt.cases.filter(row => row.status === 'PASS').length, intentionalNegative: Boolean(mutation),
    designatedFailure: mutation?.failure, numeric: receipt.numeric.length, diagnosticLabels: new Set(receipt.diagnostics.map(row => row.label)).size,
    diagnosticObservations: receipt.diagnostics.length, actualModuleLoads: loads.length, actualProductLoads: productLoads.length,
    cleanup: receipt.cleanup, activationReceipts: receipt.activations.filter(row => ['F22', 'PC01', 'PC02'].includes(row.id)),
    newObservations: receipt.diagnosticObservations });
}
const toolMap = read(join(work, 'tool-map.json')), toolObservations = [];
for (const name of fs.readdirSync(raw).filter(name => name.endsWith('-tool.jsonl')).sort()) {
  const observations = fs.readFileSync(join(raw, name), 'utf8').trim().split('\n').map(JSON.parse);
  const compiles = observations.filter(row => row.kind === 'actual-commonjs-compile'), reads = observations.filter(row => row.kind === 'actual-file-read');
  for (const row of compiles) { assert.equal(row.compileSha256, toolMap[row.path]); assert.equal(row.diskSha256, row.compileSha256); }
  for (const row of reads) if (Object.hasOwn(toolMap, row.path)) assert.equal(row.sha256, toolMap[row.path]);
  const declarations = [...new Map(reads.filter(row => row.path.includes('/node_modules/virtual-bash/') && row.path.endsWith('.d.ts')).map(row => [row.path, { path: row.path, sha256: row.sha256 }])).values()];
  for (const row of declarations) assert.equal(fileHash(row.path.replace('/work/installed/', '/work/physically-moved/consumer/')), row.sha256);
  toolObservations.push({ name, actualCompiles: compiles.length, actualReads: reads.length, declarations });
}
const rawInventory = tree(raw), workInventory = tree(work);
const retained = rawInventory.map(row => ({ ...row, path: `raw/${row.path}`, base64: fs.readFileSync(join(raw, row.path)).toString('base64') }));
const selectedWork = workInventory.filter(row => !['tools/', 'dependencies/', 'source/', 'M01/', 'M02/', 'M03/', 'pack/', 'physically-moved/consumer/node_modules/'].some(prefix => row.path.startsWith(prefix)));
for (const row of selectedWork) retained.push({ ...row, path: `work/${row.path}`, base64: fs.readFileSync(join(work, row.path)).toString('base64') });
const encoded = Buffer.from(retained.map(row => JSON.stringify(row)).join('\n') + '\n'), compressed = gzipSync(encoded, { level: 9 });
assert.deepEqual(gunzipSync(compressed), encoded);
for (const row of retained) { const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
fs.mkdirSync(evidence);
const write = (name, bytes) => fs.writeFileSync(join(evidence, name), bytes, { flag: 'wx' });
const save = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
write('RESULT-original.json', resultBytes);
write('raw-and-configs.jsonl.gz', compressed);
write('work-inventory.json.gz', gzipSync(Buffer.from(JSON.stringify(workInventory) + '\n'), { level: 9 }));
write('reproduced-package.tgz', pack);
save('ACTUAL-MODULE-PROOF.json', { schema: 'timeout-repaired-actual-load-qualification/1', sourceAndMovedActualLoads: 432, proofs: actualModuleProofs, allThreeMutatedModulesActuallyLoaded: true, diskIdentityOnly: false, productReplaysByThisSealer: 0 });
save('POST-AUTHENTICATION.json', { startedAt, protectedFiles: bindings.protectedRows.length, recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')),
  sourceArchiveSha256: sha(archive), selectedInputs: bindings.inputs.length, packSha256: sha(pack), packageMembers: bindings.packageFiles.length,
  independentBuildPackReproduction: true, tools: { regular, metadataOnlyAliases: aliases }, actualToolObservations: toolObservations,
  sourceMovedAndAllMutantFreshTreesUnchanged: true, originalInstalledPathAbsent: true, reaping, rawFiles: rawInventory.length, workFiles: workInventory.length });
save('SUMMARY.json', {
  schema: 'timeout-repaired-independent-scoped-verdict/1', verdict: 'SCOPED_TIMEOUT_MODULE_PASS', candidate: result.candidate, baseline: result.baseline,
  recipeCommit: result.recipeCommit, recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')),
  startedAt: result.startedAt, finishedAt: result.finishedAt, attempts: 1, retries: 0, originalResultSha256: sha(resultBytes),
  profiles: profileSummary, strictTypes: { passed: 16, total: 16, perLayout: 8, outcomes: result.types },
  focusedControls: { passed: 48, total: 48, unchangedReconciliation: 28, approvedBorrowedBoundary: 20 },
  admissionLoadGuards: { passed: 15, total: 15, outcomes: result.controls }, mutantControls: { killed: 3, total: 3, outcomes: result.mutants },
  build: 'PASS', exactPackReproduction: result.pack, offlineInstall: 'PASS', physicalMove: 'PASS',
  tools: { regular, metadataOnlyAliases: aliases, actualCompiles: toolObservations.reduce((sum, row) => sum + row.actualCompiles, 0), actualReads: toolObservations.reduce((sum, row) => sum + row.actualReads, 0) },
  children: { asynchronous: 27, natural: 27, forced: 0, reaped: true, synchronousGitNaturalReturns: result.preRunGitSynchronousNaturalReturns },
  guards: { supervisor: result.guards.length, perCasePost: 71, final: result.integrity },
  rawPreservation: { rawFiles: rawInventory.length, rawBytes: rawInventory.reduce((sum, row) => sum + row.bytes, 0), retainedWorkFiles: selectedWork.length, archiveBytes: compressed.length, sha256: sha(compressed) },
  coreUnexecuted: [], coreBlockers: [],
  intentionalNegativeShortCircuit: ['M01 stops at root raw-handler124; borrowed mutant branch is not counted', 'M02 stops at activated direct retirement124; mutant Shell branch is not counted', 'M03 stops at default125; later mutant resolver/resource success assertions are not counted'],
  native: { prospective: 12, executed: 0, requiredForThisCoreVerdict: false }, safeJS: 0,
  limits: ['Fixed baseline plus four pinned timeout files, not whole candidate HEAD/full-history proof', 'Same34 cases in two layouts, not68 distinct families', 'Original31/34 and original verifier failures remain unchanged', 'Approved exact PC01, TS2724 and A09 versioned amendments only', 'F22 real-clock status7 measured through direct handler in each layout; resolver comparisons use actual Shell', 'No public/default timeout wiring, whole-gate, GNU/native/signal parity, opaque-host preemption or separate private-helper approval']
});
assert.deepEqual(fs.readFileSync(join(evidence, 'RESULT-original.json')), fs.readFileSync(join(raw, 'RESULT.json')));
assert.deepEqual(gunzipSync(fs.readFileSync(join(evidence, 'raw-and-configs.jsonl.gz'))), encoded);
assert.equal(fileHash(join(evidence, 'reproduced-package.tgz')), bindings.pack.sha256);
for (const target of [work, raw]) { assert.ok(target.startsWith(scope + '/')); assert.equal(fs.realpathSync(target), resolve(target)); }
fs.rmSync(work, { recursive: true }); fs.rmSync(raw, { recursive: true });
save('CLEANUP.json', { at: new Date().toISOString(), ownedWorkRemoved: !fs.existsSync(work), rawRemovedAfterLosslessArchival: !fs.existsSync(raw), all27ChildrenReapedBeforeCleanup: true, postOnlySealerProductExecutions: 0, retries: 0 });
console.log(JSON.stringify({ verdict: 'SCOPED_TIMEOUT_MODULE_PASS', profiles: ['34/34 source', '34/34 moved'], types: 16, focusedControls: 48, guards: 15, mutants: 3, actualModuleProofs: actualModuleProofs.length, rawFiles: rawInventory.length, children: 27, scratchRemoved: true }));
