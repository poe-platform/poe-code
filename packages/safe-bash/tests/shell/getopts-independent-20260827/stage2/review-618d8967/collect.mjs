import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { own, work, candidate, author, freeze, hash, git, write, save, inventory } from './harness.mjs';
import { authenticateBoundary } from './boundary.mjs';

const evidence = path.join(own, 'evidence-v1');
assert(!fs.existsSync(evidence));
const binding = JSON.parse(fs.readFileSync(path.join(work, 'BINDING.json')));
const packed = JSON.parse(fs.readFileSync(path.join(work, 'PACKAGE.json')));
const sourceAfter = inventory(path.join(work, 'source'));
const nongenerated = Object.fromEntries(Object.entries(sourceAfter).filter(([name]) => name !== 'dist/' && !name.startsWith('dist/') && name !== 'node_modules/' && !name.startsWith('node_modules/')));
assert.deepEqual(nongenerated, binding.sourceBefore);
assert.deepEqual(inventory(path.join(work, 'source/node_modules')), binding.tools);
assert.deepEqual(inventory(path.join(work, 'source/dist')), packed.built);
assert.deepEqual(inventory(packed.product), packed.installed);
const boundaries = authenticateBoundary();
const processes = fs.readdirSync(path.join(work, 'logs')).sort().map(name => JSON.parse(fs.readFileSync(path.join(work, 'logs', name, 'PROCESS.json'))));
assert(processes.every(row => row.closeAwaited && row.signal === null && row.termination === null && row.error === null));
const expectedFailures = new Set(['independent-public', 'types-negative-options', 'types-negative-sink', 'types-negative-invoke', 'load-negative-wrong-binding', 'load-negative-internal-export', 'mutant-cursor-publication', 'mutant-task-checkpoint', 'mutant-task-checkpoint-v2']);
for (const row of processes) assert.equal(row.status === 0, !expectedFailures.has(row.label), row.label);
for (const name of ['types-positive', 'legacy-consumer', 'types-negative-options', 'types-negative-sink', 'types-negative-invoke']) {
  const output = fs.readFileSync(path.join(work, 'logs', name, 'stdout'), 'utf8');
  assert(output.includes(`Module name 'virtual-bash' was successfully resolved to '${packed.product}/dist/index.d.ts'`), `installed declaration binding ${name}`);
  assert(!output.includes(path.join(work, 'source/src/')));
  const diagnostics = [...output.matchAll(/error TS(\d+):/gu)].map(match => match[1]);
  if (name.startsWith('types-negative-')) { assert(diagnostics.length > 0); assert(diagnostics.every(code => code === '2322')); }
  else assert.equal(diagnostics.length, 0);
}
assert(fs.readFileSync(path.join(work, 'logs/load-negative-wrong-binding/stderr'), 'utf8').includes('REVIEW_PACKAGE_BINDING_MISMATCH'));
assert(fs.readFileSync(path.join(work, 'logs/load-negative-internal-export/stderr'), 'utf8').includes('ERR_PACKAGE_PATH_NOT_EXPORTED'));
const imports = fs.readFileSync(path.join(work, 'public-loads.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
for (const entry of imports) assert.equal(entry.sha256, packed.installed[new URL(entry.url).pathname.slice(packed.product.length + 1)].sha256);
for (const name of ['shell.js', 'runtime.js', 'getopts.js']) assert(imports.some(entry => entry.url.endsWith(`/dist/shell/${name}`)));
for (const name of ['cursor-publication', 'task-checkpoint-v2']) {
  const output = fs.readFileSync(path.join(work, `logs/mutant-${name}/stdout`), 'utf8');
  assert(output.includes("failureType: 'testCodeFailure'") && /^  code: 'ERR_ASSERTION'$/mu.test(output));
  const mutation = JSON.parse(fs.readFileSync(path.join(work, `mutant-${name}-binding.json`)));
  assert.equal(mutation.originalSHA256, packed.installed['dist/shell/runtime.js'].sha256);
  assert.notEqual(mutation.changedSHA256, mutation.originalSHA256);
}
const safejs = [];
const safeRoot = path.join(work, 'safejs');
for (const name of fs.readdirSync(safeRoot).filter(name => name.startsWith('cohort-')).sort()) {
  const report = JSON.parse(fs.readFileSync(path.join(safeRoot, name, 'evidence/report.json')));
  assert.equal(report.status, 'AUTHOR_COHORT_PASS');
  assert.equal(report.privateBeforeAfter, 'EXACTLY_UNCHANGED');
  assert.equal(report.copiedInputsBeforeAfter, 'UNCHANGED_INCLUDING_NEW_ENTRIES');
  assert.equal(report.publicBeforeAfter, 'UNCHANGED_INCLUDING_NEW_ENTRIES');
  assert.equal(report.knownLiveChildren.length, 0);
  safejs.push({ family: report.family, status: report.status, counts: report.counts, privateBeforeAfter: report.privateBeforeAfter, copiedInputsBeforeAfter: report.copiedInputsBeforeAfter, publicBeforeAfter: report.publicBeforeAfter, knownLiveChildren: 0, rows: report.rows.map(row => {
    assert.equal(row.engineSourceFiles, 63);
    assert.equal(row.naturalExit, true);
    const actual = JSON.parse(fs.readFileSync(row.resultFile));
    return { id: row.id, qualifiedClassification: row.classification, engineRuns: row.engineRuns, engineSourceFiles: row.engineSourceFiles, productFiles: row.productFiles, engineOk: actual.engine?.ok ?? null, engineOutcome: actual.engineOutcome?.kind ?? null, publicKind: actual.publicOutcome?.kind ?? (actual.shell?.rejected ? 'rejection' : 'result'), publicExitCode: actual.publicOutcome?.result?.exitCode ?? actual.shell?.exitCode ?? null, stdout: actual.publicOutcome?.result?.stdout ?? actual.shell?.stdout ?? null, stderr: actual.publicOutcome?.result?.stderr ?? actual.shell?.stderr ?? null, sourceResult: path.relative(work, row.resultFile) };
  }) });
}
assert.equal(safejs.reduce((sum, cohort) => sum + cohort.counts.pass, 0), 25);
const product = JSON.parse(fs.readFileSync(path.join(work, 'PUBLIC-OBSERVATIONS.json')));
const stage = path.join(work, 'source/tests/shell/getopts-independent-20260827/stage2');
const projections = ['bash53', 'bash32'].map(profile => {
  const capture = JSON.parse(fs.readFileSync(path.join(stage, `capture-01/${profile}.json`)));
  return { profile: capture.profile, historicalCountsUnchanged: capture.counts, nativeExecutionsThisReview: 0, currentOracleAvailability: 'Not probed; reused exact committed captures.', rows: product.map(row => {
    const native = capture.results.find(value => value.id === row.id);
    return { id: row.id, productPolicyPassed: row.actual.stdout === row.productExpectation.stdout && row.actual.exitCode === row.productExpectation.exitCode, stdoutEqualToCapturedNative: row.actual.stdout === native.productStdout, stderrByteEqualToCapturedNative: row.actual.stderr === native.execution.stderr, intentionalPolicy: row.intentionalPolicy, correctedOracle: ['N05', 'N13'].includes(row.id) };
  }), interpretation: 'Equality dimensions only, not a native parity gate or historical rescore.' };
});
save(path.join(evidence, 'NATIVE-PROJECTIONS.json'), projections);
save(path.join(evidence, 'SAFEJS-QUALIFICATION.json'), { cohorts: safejs, actualReplayedQualifiedProfiles: 25, successfulGuestCapabilityExamples: ['surface01 stdio/VFS/args/cwd/env and explicit exit7', 'surface03 supported namespace spread', 'surface04 actual shell.exec returns shell-positive', 'lifecycle L01 exact byte aliases and explicit exit7', 'lifecycle L03 live callback execution and later-lifetime suppression', 'lifecycle L04 explicit child ownership', 'lifecycle L06-open and control Z01-open curl with explicitly injected mock transport'], notSuccessfulCapabilityProofs: ['surface05 missing registerCleanup, surface06 missing acquire, surface08 function-spread refusal', 'budget exhaustion, cancellation/error precedence, closed-consumer and HTTP/redirect refusal controls'], limits: ['No actual getopts-specific SafeJS guest added or claimed.', 'No installed private package, external network, deployed provider or hard-preemption claim.'] });
save(path.join(evidence, 'PRESERVATION.json'), { candidate, author, freeze, recordedAt: new Date().toISOString(), boundaries, sourceFiles: binding.selectedBlobs.length, sourceBeforeAfterEntries: Object.keys(nongenerated).length, sourceIncludingNewEntriesUnchanged: true, generatedDirectoriesSeparatelyBound: ['dist', 'node_modules'], compilerAndToolCopiesUnchanged: true, builtAndInstalledPackageUnchanged: true, sourceBindings: Object.fromEntries(['src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/getopts.ts'].map(name => [name, hash(fs.readFileSync(path.join(work, 'source', name)))])), protectedCandidateEntries: 243, acceptedOwnedOutputAddedLines: 26, ownProductDelta: binding.ownProductDelta, wholeBaselineDelta: binding.wholeBaselineDelta, fullPackagePackInstallMove: true, packageTarballSHA256: packed.tarballSHA256, importedInstalledFiles: new Set(imports.map(row => row.url)).size, installedTypesPositive: 2, malformedTypeFixtures: 3, malformedTypeDiagnostic: 'TS2322 only (four diagnostics across three fixtures)', boundedMeaningfulMutants: 2, supervisorProcessesClosed: processes.length, actualSafeJsChildrenClosed: 25, noKnownLiveOwnedChildren: true, noPrivateWrites: true, safejs: safejs.map(({ rows, ...rest }) => rest), noNativeReruns: true, noGlobalGate: true });
save(path.join(evidence, 'PROCESSES.json'), processes);
const captures = new Map();
function captureFile(filename) {
  const relative = path.relative(work, filename);
  assert(!relative.startsWith('..'));
  assert(!/(^|\/)engine\//u.test(relative), 'private engine bytes must not be captured');
  captures.set(relative, fs.readFileSync(filename));
}
function captureTree(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) captureTree(filename); else captureFile(filename);
  }
}
for (const name of fs.readdirSync(work).sort()) if (fs.statSync(path.join(work, name)).isFile() && /\.(json|jsonl)$/u.test(name)) captureFile(path.join(work, name));
captureTree(path.join(work, 'logs'));
for (const name of fs.readdirSync(packed.moved).filter(name => /\.(mjs|ts|json)$/u.test(name))) captureFile(path.join(packed.moved, name));
for (const name of fs.readdirSync(safeRoot).filter(name => name.startsWith('cohort-'))) {
  captureTree(path.join(safeRoot, name, 'evidence'));
  captureTree(path.join(safeRoot, name, 'logs'));
  captureFile(path.join(safeRoot, name, 'CURRENT-IMPORTS.json'));
}
for (const name of ['harness', 'profiles', 'execution-v1', 'safejs-execution-v1']) captureTree(path.join(safeRoot, name));
const raw = Buffer.from(JSON.stringify({ format: 'independent-getopts-raw-captures-v1', files: [...captures].sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') })) }));
const compressed = gzipSync(raw, { level: 9 });
write(path.join(evidence, 'RAW.json.gz.base64'), compressed.toString('base64') + '\n');
write(path.join(evidence, 'candidate.tar.gz'), gzipSync(fs.readFileSync(path.join(work, 'candidate.tar')), { level: 9 }));
write(path.join(evidence, 'public-package.tgz'), fs.readFileSync(packed.tarball));
for (const name of ['candidate.commit.data', 'candidate.root-tree.data']) write(path.join(evidence, name), fs.readFileSync(path.join(work, name)));
save(path.join(evidence, 'MANIFEST.json'), { candidate, files: Object.fromEntries(Object.entries(inventory(evidence)).filter(([,value]) => value.kind === 'file')), rawCaptureFiles: captures.size, rawBytes: raw.length, rawSHA256: hash(raw), compressedSHA256: hash(compressed), candidateArchiveRawSHA256: binding.archiveSHA256, classification: 'Captured data and immutable committed source/emitted package archives, not canonical TypeScript inputs. No private engine bytes or public tool binaries vendored.', selfBinding: 'Final layered manifest and Git commit bind this manifest.' });
console.log(JSON.stringify({ captures: captures.size, rawBytes: raw.length, compressedBytes: compressed.length, candidateArchiveBytes: fs.statSync(path.join(evidence, 'candidate.tar.gz')).size, processes: processes.length, sourceFiles: binding.selectedBlobs.length, safejsProfiles: 25 }));
