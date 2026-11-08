import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { recipe, scope, repository, work, raw, read, fileHash, sha, tree, matchInventory, tarEntries } from './recipe/io.mjs';

const startedAt = new Date().toISOString();
const evidence = join(scope, 'evidence');
assert.equal(fileHash(join(recipe, 'MANIFEST.json')), '6bc3c407c859e7ba1c1790c581cd10df44de2299149fcfa6adfad4c654984d99');
const manifest = read(join(recipe, 'MANIFEST.json'));
for (const [name, digest] of Object.entries(manifest.files)) assert.equal(fileHash(join(recipe, name)), digest, name);
const bindings = read(join(recipe, 'BINDINGS.json'));
const resultBytes = fs.readFileSync(join(raw, 'RESULT.json'));
const result = JSON.parse(resultBytes);
assert.equal(result.recipeCommit, '289d00d253136032c1bd6b078662ba5f37e39a3d');
assert.equal(result.candidate, bindings.candidate);
assert.equal(result.status, 'STOP_NO_RETRY');
assert.equal(result.phase, 'A09-source-permission-denial');
assert.equal(result.attempts, 1);
assert.equal(result.retries, 0);
assert.equal(result.integrity, 'PASS');
assert.equal(result.allChildrenReaped, true);
assert.equal(result.children.length, 23);
for (const row of bindings.protectedRows) {
  const target = join(repository, row.path);
  assert.ok(fs.lstatSync(target).isFile());
  assert.equal(fileHash(target), row.sha256, row.path);
}
const closure = read(join(repository, bindings.closurePath));
for (const binary of closure.binaries) {
  assert.equal(fs.realpathSync(binary.path), binary.realpath);
  assert.equal(fileHash(binary.path), binary.sha256);
}
assert.equal(process.execPath, closure.binaries[0].path);
const reaping = [];
for (const child of result.children) {
  assert.equal(child.forced, false);
  assert.deepEqual(child.exit, child.close);
  assert.equal(child.pidAbsent, true);
  assert.equal(child.processGroupAbsent, true);
  const checks = [];
  for (const identifier of [child.pid, -child.pid]) {
    let error;
    try { process.kill(identifier, 0); } catch (caught) { error = caught; }
    assert.equal(error?.code, 'ESRCH', `PROCESS_STILL_PRESENT:${identifier}`);
    checks.push({ identifier, observation: 'ESRCH' });
  }
  reaping.push({ label: child.label, pid: child.pid, exit: child.exit, checks });
}
let regular = 0, aliases = 0;
const stagedTools = [];
for (const packageRow of closure.packages) {
  const destination = ['npm', 'typescript'].includes(packageRow.name)
    ? join(work, 'tools', packageRow.name)
    : join(work, 'dependencies/node_modules', packageRow.name);
  const expected = [];
  for (const row of packageRow.records) {
    const target = join(packageRow.root, row.path);
    const stat = fs.lstatSync(target);
    assert.equal(stat.mode & 511, row.mode);
    if (row.type === 'symlink') {
      assert.ok(stat.isSymbolicLink());
      assert.equal(fs.readlinkSync(target), row.link);
      assert.equal(fs.existsSync(join(destination, row.path)), false);
      aliases++;
    } else if (row.type === 'directory') {
      assert.ok(stat.isDirectory());
    } else {
      assert.ok(stat.isFile());
      assert.equal(fileHash(target), row.sha256);
      expected.push({ path: row.path, mode: row.mode, bytes: stat.size, sha256: row.sha256 });
      regular++;
    }
  }
  matchInventory(tree(destination), expected);
  stagedTools.push(...expected.map(row => ({ ...row, path: relative(work, join(destination, row.path)) })));
}
assert.equal(regular, 2274);
assert.equal(aliases, 12);
const configurations = ['source', 'moved'].map(profile => read(join(work, `${profile}-config.json`)));
for (const configuration of configurations) {
  for (const guard of configuration.guardRoots) matchInventory(tree(guard.root), guard.entries);
  for (const [target, digest] of Object.entries(configuration.loads)) assert.equal(fileHash(target), digest);
}
const sourceArchive = fs.readFileSync(join(repository, bindings.sourceArchive.path));
assert.equal(sha(sourceArchive), bindings.sourceArchive.sha256);
matchInventory(tarEntries(sourceArchive), bindings.inputs);
const packPath = join(work, 'pack/virtual-bash-0.0.0.tgz');
assert.equal(fileHash(packPath), bindings.pack.sha256);
matchInventory(tarEntries(fs.readFileSync(packPath), true).map(row => ({ ...row, path: row.path.slice(8) })), bindings.packageFiles);
assert.equal(fs.existsSync(join(work, 'installed')), false);

const toolMap = read(join(work, 'tool-map.json'));
const toolObservations = [];
for (const name of fs.readdirSync(raw).filter(name => name.endsWith('-tool.jsonl')).sort()) {
  const observations = fs.readFileSync(join(raw, name), 'utf8').trim().split('\n').map(JSON.parse);
  const compiles = observations.filter(row => row.kind === 'actual-commonjs-compile');
  const reads = observations.filter(row => row.kind === 'actual-file-read');
  for (const row of compiles) {
    assert.equal(row.compileSha256, toolMap[row.path]);
    assert.equal(row.diskSha256, row.compileSha256);
  }
  for (const row of reads) if (Object.hasOwn(toolMap, row.path)) assert.equal(row.sha256, toolMap[row.path]);
  toolObservations.push({ file: name, observations: observations.length, actualCompiles: compiles.length, actualReads: reads.length });
}
const profiles = [];
for (const configuration of configurations) {
  const profile = configuration.profile;
  const receipt = result[profile];
  assert.equal(receipt.cases.length, 34);
  assert.equal(receipt.cases.filter(row => row.status === 'PASS').length, 31);
  assert.deepEqual(receipt.cases.filter(row => row.status === 'FAIL').map(row => row.id), ['F01', 'F22', 'PC01']);
  assert.equal(receipt.numeric.length, 70);
  assert.equal(new Set(receipt.diagnostics.map(row => row.label)).size, 14);
  assert.equal(receipt.cleanup.pending, 0);
  assert.equal(receipt.cleanup.schedulerLive, 0);
  assert.deepEqual(receipt.cleanup.unhandled, []);
  for (const row of receipt.cases) {
    assert.equal(row.integrity, 'UNCHANGED');
    assert.equal(row.cleanup.pending, 0);
    assert.equal(row.cleanup.schedulerLive, 0);
  }
  const trace = fs.readFileSync(configuration.trace, 'utf8').trim().split('\n').map(JSON.parse);
  const loads = trace.filter(row => row.kind === 'actual-module-load');
  for (const row of loads) assert.equal(row.sha256, configuration.loads[row.path]);
  const productRoot = configuration.guardRoots[0].root;
  const productLoads = loads.filter(row => row.path.startsWith(`${productRoot}/`));
  profiles.push({ profile, attempted: 34, qualified: 31, originalFamiliesQualified: 30, holdoutsQualified: 1,
    failures: ['F01', 'F22', 'PC01'], numericPassed: 70, diagnosticLabels: 14,
    diagnosticObservations: receipt.diagnostics.length, actualModuleLoads: loads.length,
    actualProductModuleLoads: productLoads.length,
    timeoutModuleLoads: productLoads.filter(row => row.path.includes('/commands/timeout/')),
    cleanup: receipt.cleanup, activations: receipt.activations.filter(row => ['PC01', 'PC02'].includes(row.id)) });
}
const denialLoads = fs.readFileSync(join(raw, 'A09-source-permission-denial/module-loads.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(denialLoads.length, 1);
assert.ok(denialLoads[0].path.endsWith('/A09-source-permission-denial.mjs'));
const nowFunctionBody = Function.prototype.toString.call(performance.now);
assert.equal(sha(nowFunctionBody), 'f057a3172d752722356f41404077910dda0d4f381b9fbb7914020d4c0c7f7d11');
const postOnlyDiagnosis = {
  classification: 'post-run static inspection, no product call or control replay',
  nodeSha256: fileHash(process.execPath), nowFunctionBody, nowFunctionBodySha256: sha(nowFunctionBody),
  defaultScheduler: {
    actual: 'F22 expected 7, received 125, source and moved',
    cause: 'scheduler.ts:11-15 captures performance.now with undefined receiver; :27 Reflect.apply supplies that receiver; pinned Node method body validates the Performance receiver; index.ts:153 catches start failure and selects timer-setup failure.',
    recommendation: 'Bind the captured performance.now method to its Performance receiver, or retain the valid receiver in the default binding; preserve fixed capture and injected-scheduler behavior.',
    missingOriginalObservations: ['F22 default-call stderr bytes', 'caught underlying timer-start exception']
  },
  pc01: {
    actual: 'Root-caller route passes; outer-context route raw timeout handler rejects same sentinel, but top-level Shell fulfills.',
    qualification: 'No timeout-handler mapping to 124 is established. The borrowed invoke-option route is not a root-caller signal; fixed baseline runtime.ts:949-970 maps ordinary command errors and clears their cancellation report when its own signal is not aborted. contracts/command.md:26-39 expressly preserves already mapped outcomes. The verifier overextends raw handler priority to the outer Shell. Keep frozen PC01 unqualified; any boundary-specific predicate correction requires a separate version.',
    missingOriginalObservations: ['outer fulfilled value exitCode', 'outer stdout', 'outer stderr']
  },
  rootNegative: { actual: 'TS2724 at consumer.ts(1,10), compiler exit 2, denies createTimeoutCommand root export', expectedByVerifier: 'TS2305', classification: 'verifier diagnostic-code mismatch; no new public export established' },
  a09: {
    actual: 'negative helper caught ERR_ASSERTION, expected ERR_ACCESS_DENIED; helper assertion exits 1; only the negative helper was loaded',
    qualification: 'Strict preload resolve/bound allowlist precedes module load; external target is not listed. This explains competing denial guards, but the exact caught assertion message was not retained. Do not claim an observed UNBOUND_MODULE message or a filesystem-permission denial.',
    missingOriginalObservations: ['original caught error message before helper code assertion']
  }
};

const rawInventory = tree(raw);
const workInventory = tree(work);
const retained = rawInventory.map(row => ({ ...row, path: `raw/${row.path}`, base64: fs.readFileSync(join(raw, row.path)).toString('base64') }));
const retainedWork = workInventory.filter(row => !['tools/', 'dependencies/', 'source/', 'pack/', 'physically-moved/consumer/node_modules/'].some(prefix => row.path.startsWith(prefix)));
for (const row of retainedWork) retained.push({ ...row, path: `work/${row.path}`, base64: fs.readFileSync(join(work, row.path)).toString('base64') });
const encoded = Buffer.from(retained.map(row => JSON.stringify(row)).join('\n') + '\n');
const compressed = gzipSync(encoded, { level: 9 });
assert.deepEqual(gunzipSync(compressed), encoded);
for (const row of retained) {
  const bytes = Buffer.from(row.base64, 'base64');
  assert.equal(bytes.length, row.bytes);
  assert.equal(sha(bytes), row.sha256);
}
fs.mkdirSync(evidence);
const write = (name, bytes) => fs.writeFileSync(join(evidence, name), bytes, { flag: 'wx' });
const save = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
write('RESULT-original.json', resultBytes);
write('raw-and-configs.jsonl.gz', compressed);
write('work-inventory.json.gz', gzipSync(Buffer.from(JSON.stringify(workInventory) + '\n'), { level: 9 }));
write('reproduced-package.tgz', fs.readFileSync(packPath));
save('POST-ONLY-DIAGNOSIS.json', postOnlyDiagnosis);
save('POST-AUTHENTICATION.json', { startedAt, protectedFiles: bindings.protectedRows.length,
  recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')), sourceInputs: bindings.inputs.length,
  sourceArchiveSha256: sha(sourceArchive), packageMembers: bindings.packageFiles.length,
  packSha256: fileHash(packPath), tools: { regular, metadataOnlyAliases: aliases },
  freshGuardTreesUnchanged: true, originalInstalledPathAbsent: true, reaping,
  toolObservations, workInventoryEntries: workInventory.length, rawInventoryEntries: rawInventory.length });
save('SUMMARY.json', {
  schema: 'timeout-independent-post-run-disposition/1', candidate: result.candidate,
  baseline: result.baseline, recipeCommit: result.recipeCommit,
  status: 'REJECT_PRODUCT_DEFAULT_SCHEDULER_AND_HOLD_VERIFIER_TAIL',
  originalResultStatus: result.status, originalResultSha256: sha(resultBytes),
  startedAt: result.startedAt, finishedAt: result.finishedAt, attempts: 1, retries: 0,
  profiles, types: result.types.map(({ profile, name, status, exitCode, diagnostics }) => ({ profile, name, status, exitCode, diagnostics })),
  qualifiedControls: result.controls.map(row => row.id), failedControl: 'A09-source-permission-denial',
  unexecuted: ['A10-public-subpath-absent runtime negative', 'M01 caller-priority product mutant', 'M02 retirement-priority product mutant', 'F22 trailing real-Shell resolver126/127 subchecks in both layouts', 'F22 post-success default timer resource assertion in both layouts', '12 prospective native rows', 'SafeJS'],
  children: { asynchronous: 23, natural: 23, forced: 0, reaped: true, synchronousGitReturns: result.preRunGitSynchronousNaturalReturns },
  guards: { supervisor: result.guards.length, perCasePost: 68, final: result.integrity },
  build: 'PASS', offlineInstall: 'PASS', physicalMove: 'PASS', wholePackReproduction: result.pack,
  preRunToolBindings: result.tools, actualToolCompiles: toolObservations.reduce((total, row) => total + row.actualCompiles, 0),
  actualToolReads: toolObservations.reduce((total, row) => total + row.actualReads, 0),
  rawPreservation: { files: rawInventory.length, bytes: rawInventory.reduce((total, row) => total + row.bytes, 0), retainedWorkFiles: retainedWork.length, compressedBytes: compressed.length, sha256: sha(compressed) },
  chronology: manifest.chronology,
  qualification: 'No original rescore; no public/default/root wiring, native, SafeJS, private-helper or whole-gate approval. Source reconstructed from declared fixed baseline plus four pinned module files, not full candidate history.'
});
assert.deepEqual(fs.readFileSync(join(evidence, 'RESULT-original.json')), fs.readFileSync(join(raw, 'RESULT.json')));
assert.deepEqual(gunzipSync(fs.readFileSync(join(evidence, 'raw-and-configs.jsonl.gz'))), encoded);
assert.equal(fileHash(join(evidence, 'reproduced-package.tgz')), bindings.pack.sha256);
for (const target of [work, raw]) {
  assert.ok(target.startsWith(`${scope}/`));
  assert.equal(fs.realpathSync(target), resolve(target));
}
fs.rmSync(work, { recursive: true });
fs.rmSync(raw, { recursive: true });
save('CLEANUP.json', { at: new Date().toISOString(), workRemoved: !fs.existsSync(work), rawRemovedAfterLosslessArchival: !fs.existsSync(raw), childrenAlreadyReaped: true, productExecutions: 0, controlReplays: 0, rawRecordsAltered: 0 });
console.log(JSON.stringify({ status: 'SEALED_POST_ONLY_EVIDENCE', profiles: profiles.map(row => ({ profile: row.profile, qualified: row.qualified, attempted: row.attempted })), rawFiles: rawInventory.length, children: 23, cleanup: 'OWNED_WORK_AND_ARCHIVED_RAW_REMOVED' }));
