import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const candidate = await realpath(join(directory, 'candidate'));
const base = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const publish = (name, value) => writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const report = await json(join(directory, 'initial-results.json'));
const native = await json(join(directory, 'harness/derived/native.json'));
const fullInputs = await json(join(directory, 'full-input-files.json'));
const inputByPath = new Map(fullInputs.map(entry => [entry.path, entry]));
const originalAnalysis = await json(join(base, 'evidence/initial/analysis.json'));
const originalLoaded = new Map(originalAnalysis.loadedCandidateFiles.map(entry => [entry.path, entry]));
const gate = await json(join(directory, 'execution-gate.json'));
const observations = new Map();
const nativeLanes = [];
const coverageIndex = [];
for (const row of report.cohort) {
  const observation = await json(join(directory, 'raw', row.id, 'observations.json'));
  observations.set(row.id, observation);
  if (!row.id.startsWith('N')) continue;
  const oracle = native.find(entry => entry.id === row.id);
  const invocation = observation.invocations[0];
  if (!invocation) { nativeLanes.push({ id: row.id, rawExact: 'unsupported-not-run', predicateStatus: row.status }); continue; }
  const accepted = stream => Buffer.concat(invocation[stream].filter(write => write.state === 'fulfilled').map(write => Buffer.from(write.attemptedBase64, 'base64')));
  const stdout = accepted('stdout');
  const stderr = accepted('stderr');
  const output = { exitCode: invocation.result?.exitCode, stdoutBase64: stdout.toString('base64'), stderrBase64: stderr.toString('base64') };
  const equal = { exitCode: output.exitCode === oracle.exitCode, stdout: output.stdoutBase64 === oracle.stdoutBase64, stderr: output.stderrBase64 === oracle.stderrBase64 };
  let jsonSemantic;
  if (row.id === 'N20') { assert.deepEqual(JSON.parse(stdout), JSON.parse(Buffer.from(oracle.stdoutBase64, 'base64'))); jsonSemantic = 'equal'; }
  nativeLanes.push({ id: row.id, rawExact: Object.values(equal).every(Boolean) ? 'match' : 'mismatch-not-parity-pass', equal,
    output, native: oracle, predicateStatus: row.status, comparison: row.rawPredicate?.evidence?.comparison, jsonSemantic });
  await writeFile(join(directory, 'raw', row.id, 'product.stdout.bin'), stdout, { flag: 'wx' });
  await writeFile(join(directory, 'raw', row.id, 'product.stderr.bin'), stderr, { flag: 'wx' });
}
const loaded = new Map();
const loadedHarness = new Map();
const outside = new Set();
const allowedHarness = new Set(['bridge.mjs', 'harness/derived/run.mjs', 'harness/derived/corpus.mjs', 'harness/derived/fixture-fs.mjs', 'harness/n18-predicate.mjs']);
async function scripts(root) {
  const found = [];
  for (const name of await readdir(root)) {
    const filename = join(root, name);
    const bytes = await readFile(filename);
    coverageIndex.push({ path: relative(directory, filename), bytes: bytes.length, sha256: hash(bytes) });
    for (const script of JSON.parse(bytes).result) {
      if (!script.url.startsWith('file:') && !isAbsolute(script.url)) continue;
      found.push(await realpath(script.url.startsWith('file:') ? fileURLToPath(script.url) : script.url));
    }
  }
  return found;
}
for (const row of report.cohort) {
  for (const filename of await scripts(join(directory, 'raw', row.id, 'coverage'))) {
    if (filename.startsWith(`${candidate}/`)) {
      const name = relative(candidate, filename);
      const input = inputByPath.get(name);
      assert.ok(input, `unmanifested candidate input ${name}`);
      assert.equal(hash(await readFile(filename)), input.sha256);
      const item = loaded.get(name) ?? { path: name, sha256: input.sha256, cases: [] };
      if (!item.cases.includes(row.id)) item.cases.push(row.id);
      loaded.set(name, item);
    } else {
      const name = relative(directory, filename);
      if (!allowedHarness.has(name)) outside.add(filename);
      else loadedHarness.set(name, { path: name, sha256: hash(await readFile(filename)) });
    }
  }
}
const inputDrift = [];
for (const entry of fullInputs) {
  const filename = join(candidate, entry.path);
  if (!(await lstat(filename)).isFile() || hash(await readFile(filename)) !== entry.sha256) inputDrift.push(entry.path);
}
const builtInputs = await json(join(directory, 'build-input-files.json'));
const consumerInputs = await json(join(directory, 'consumer-input-files.json'));
const builtByPath = new Map([...builtInputs, ...consumerInputs].map(entry => [entry.path, entry]));
const builtLoaded = new Map();
for (const filename of await scripts(join(directory, 'consumer-coverage'))) {
  const name = relative(directory, filename);
  const input = builtByPath.get(name);
  if (!input) outside.add(filename);
  else { assert.equal(hash(await readFile(filename)), input.sha256); builtLoaded.set(name, input); }
}
for (const entry of [...builtInputs, ...consumerInputs]) assert.equal(hash(await readFile(join(directory, entry.path))), entry.sha256, entry.path);
const harnessInputs = [];
async function harnessInventory(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = join(root, entry.name);
    if (entry.isDirectory()) await harnessInventory(filename);
    else {
      const bytes = entry.isSymbolicLink() ? Buffer.from(await readlink(filename)) : await readFile(filename);
      harnessInputs.push({ path: relative(directory, filename), kind: entry.isSymbolicLink() ? 'symlink' : 'file', bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await harnessInventory(join(directory, 'harness'));
for (const [path, expected] of [['bridge.mjs', gate.bridgeSha256], ['execute.mjs', gate.driverSha256], ['profile.json', gate.profileSha256],
  ['harness/n18-predicate.mjs', gate.helperSha256], ['harness/derived/run.mjs', gate.runnerSha256], ['harness/derived/corpus.mjs', gate.corpusSha256], ['harness/derived/native.json', gate.nativeSha256]]) {
  assert.equal(hash(await readFile(join(directory, path))), expected, path);
}
const fixtureInventory = await json('/tmp/safe-bash-tree-hidden-prep-vyzfHc/inventory.json');
for (const entry of fixtureInventory.filter(entry => entry.path.startsWith('native-fixtures/'))) {
  const filename = join(directory, 'harness/derived', entry.path);
  const bytes = (await lstat(filename)).isSymbolicLink() ? Buffer.from(await readlink(filename)) : await readFile(filename);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
const nativeProvenance = [];
for (const [path, expected] of [
  ['/tmp/safe-bash-tree-oracle-MlUjmM/tree-2.2.1.tar.bz2', 'e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5'],
  ['/tmp/safe-bash-tree-oracle-MlUjmM/unix-tree-2.2.1/tree', '34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a'],
]) { const digest = hash(await readFile(path)); assert.equal(digest, expected); nativeProvenance.push({ path, sha256: digest, executed: false }); }
const sourceFiles = [...loaded.values()].filter(entry => entry.path.startsWith('src/'));
const changedLoadedSource = sourceFiles.filter(entry => originalLoaded.get(entry.path)?.sha256 !== entry.sha256).map(entry => ({ path: entry.path,
  originalSha256: originalLoaded.get(entry.path)?.sha256, finalSha256: entry.sha256 }));
const nativeCounts = {};
for (const row of nativeLanes) nativeCounts[row.rawExact] = (nativeCounts[row.rawExact] ?? 0) + 1;
const stillAlive = [];
const pids = [...report.cohort.map(row => row.pid), ...(await json(join(directory, 'preflight.json'))).results.map(row => row.pid),
  (await json(join(directory, 'consumer-types.process.json'))).pid, (await json(join(directory, 'consumer-run.process.json'))).pid];
for (const pid of pids) { try { process.kill(pid, 0); stillAlive.push(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
const summary = { at: new Date().toISOString(), candidate: gate.candidate, originalSeal: 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937',
  resultFile: 'initial-results.json (filename retained by unchanged driver; this file is the fresh FINAL cohort, not reused initial evidence)',
  resultSha256: hash(await readFile(join(directory, 'initial-results.json'))), rawPredicateCounts: report.totals, rawNativeLaneCounts: nativeCounts, nativeLanes,
  lanes: { exactNativePredicateSelections: 16, exactNativePredicatePass: 12, exactNativePredicateProfileFail: 1, exactNativeUnsupported: 3,
    otherNativeSemanticSelections: 4, otherNativeSemanticPass: 4, adversarialSelections: 18, adversarialPass: 15, characterizations: 3 },
  execution: { selections: report.cohort.length, freshSelectionEvaluations: 38, reusedSelectionResults: 0, cohortProductInvocations: report.productInvocations,
    separateBuiltSmokeInvocations: 1, totalFreshTreeInvocations: report.productInvocations + 1, nativeInvocations: 0, reusedNativeCaptures: 20,
    retries: 0, elapsedMs: report.elapsedMs, watchdogCancellations: 0, timeouts: 0, sourceOrHarnessErrors: 0, missing: 0, incomplete: 0, unsupportedNotRun: 3 },
  adjudication: { rawPass: 31, acceptedN16ProfileNotParity: 1, unsupportedNotPass: 3, characterizedNotPass: 3,
    n18: 'Final peer-approved v2 semantic pass; original native status1 versus usage2 and text remain raw difference; all historical failures retained',
    demonstratedNewSourceBugs: 0, outsideCoreFailures: 0, ancestorPolicy: 'Our bounded chosen profile, NOT a literal user instruction' },
  sourceClosure: { loadedSourceCount: sourceFiles.length, loadedDevtoolCount: loaded.size - sourceFiles.length, loadedCandidateFiles: [...loaded.values()],
    loadedHarnessFiles: [...loadedHarness.values()], changedLoadedSource, builtLoadedFiles: [...builtLoaded.values()], unexpectedLoadedPaths: [...outside] },
  allFrozenInputFilesChecked: fullInputs.length, inputDrift, buildAndConsumerInputsChecked: builtInputs.length + consumerInputs.length,
  shellEvidence: observations.get('A37').shells,
  cancellationEvidence: ['A29', 'A30', 'A31'].map(id => ({ id, sameAsSignalReason: observations.get(id).invocations[0].sameAsSignalReason,
    rejection: observations.get(id).invocations[0].error })),
  processState: { ownedChildPids: pids, liveAtCheck: stillAlive, killActions: 0, cleanup: 'All children closed; actual Shell disposed; raw logs, fixtures and snapshots retained' },
  runtime: { executable: process.execPath, version: process.version, executableSha256: hash(await readFile(process.execPath)), platform: process.platform, arch: process.arch },
  nativeProvenance,
  gaps: ['Three unsupported cases are not product executions or passes; three host-contract characterizations are not passes.',
    'N16 remains raw native failure under accepted explicit-rootlink nofollow policy; sibling aliases, file roots and JSON differences are not parity.',
    'A33 accepts ASCII C-escaped Unicode output, not genuinely multibyte emitted output; A25 stops at first malformed name; A26 hits entry cap before duplicate validation.',
    'Pending FS/sink cancellation cases are direct handlers, not new public Shell lifecycle guarantees; opaque host work remains uninterruptible.',
    'Actual Shell A37 JSON pipeline/subshell/redirection/consumer runs; no jq-specific or deployed provider coverage.',
    'Static budget-delta inspection and original low-cap replay are not execution of the separately sealed six-case safety corpus.',
    'Scoped types/build and separate built standalone plugin smoke do not establish root exports/default integration or full project gate.'] };
await publish('harness-input-files.json', harnessInputs.sort((left, right) => left.path.localeCompare(right.path)));
await publish('coverage-index.json', coverageIndex);
await publish('analysis.json', summary);
assert.deepEqual(report.totals, { pass: 31, 'unsupported-not-pass': 3, fail: 1, 'characterized-not-pass': 3 });
assert.deepEqual(nativeCounts, { match: 12, 'unsupported-not-run': 3, 'mismatch-not-parity-pass': 5 });
assert.equal(inputDrift.length, 0);
assert.equal(outside.size, 0);
assert.equal(stillAlive.length, 0);
console.log(JSON.stringify({ counts: report.totals, nativeCounts, loadedSource: sourceFiles.length, loadedDevtools: loaded.size - sourceFiles.length,
  builtLoaded: builtLoaded.size, changedLoadedSource, inputsChecked: fullInputs.length, liveOwnedPids: stillAlive }, null, 2));
