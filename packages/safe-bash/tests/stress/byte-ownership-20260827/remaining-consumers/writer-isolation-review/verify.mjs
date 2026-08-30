import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archive, canonical, census, differences, fixture, git, review, root, run, save, sha256, treePaths } from './harness.mjs';

const revision = process.argv[2];
assert.match(revision ?? '', /^[a-f0-9]{40}$/);
const ready = readFileSync('/tmp/byte-writer-fix-author-ready.txt', 'utf8');
assert.ok(ready.includes(revision), 'Author ready marker must name exact archived revision');
save('execution/author-ready.txt', ready);
const directory = archive(revision, 'candidate-clean');
const capture = 'tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation/capture.mjs';
const paths = treePaths(revision);
const before = census(directory, paths);
const sourceBefore = census(directory, treePaths(revision, 'src'));
save('execution/candidate-tests-before.json', before);
save('execution/candidate-source-before.json', sourceBefore);
const tempRoot = join(review, '.scratch', 'capture-temp');
mkdirSync(tempRoot);
const environment = { TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot, TSX_DISABLE_CACHE: '1', VIRTUAL_BASH_DIRECT_CURL_CAPTURE: '' };
const sentinels = [join(directory, 'verifier-sentinel.data'), join(directory, fixture, 'artifacts', 'verifier-sentinel.data')];
for (const path of sentinels) writeFileSync(path, Buffer.from([0, 255, 128, 83, 65, 70, 69, 10]), { flag: 'wx', mode: 0o400 });
const sentinelBefore = sentinels.map(path => ({ path, sha256: sha256(readFileSync(path)), base64: readFileSync(path).toString('base64') }));
const assertSentinels = () => assert.deepEqual(sentinels.map(path => ({ path, sha256: sha256(readFileSync(path)), base64: readFileSync(path).toString('base64') })), sentinelBefore);
const vectorsBefore = readFileSync(join(directory, fixture, 'expectations.json'));
const historicalPinBefore = readFileSync(join(directory, fixture, 'source-pin.json'));
const frozen = JSON.parse(readFileSync(join(review, 'frozen/baseline.json')));
assert.equal(sha256(vectorsBefore), frozen.pins.find(row => row.path.endsWith('/expectations.json')).sha256);
assert.equal(sha256(historicalPinBefore), frozen.pins.find(row => row.path.endsWith('/source-pin.json')).sha256);
const checkPass = result => {
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /# pass 2\n/);
  assert.match(result.stdout, /# fail 0\n/);
  assert.doesNotMatch(result.stdout, /VIRTUAL_BASH_DIRECT_CURL_OBSERVATION/);
};
checkPass(await run(directory, ['--import', 'tsx', '--test', canonical], 'candidate-default', environment));
const concurrent = await Promise.all([1, 2].map(number => run(directory, ['--import', 'tsx', '--test', canonical], `candidate-concurrent-${number}`, environment)));
concurrent.forEach(checkPass);
assert.deepEqual(readdirSync(tempRoot), [], 'Default canonical must not persist temporary files');
assertSentinels();
const afterDefault = census(directory, paths);
assert.deepEqual(differences(before, afterDefault), []);
save('execution/candidate-tests-after-default.json', afterDefault);
const outputs = [];
async function checkCapture(result, expectedCode, label, sourceDirectory = directory) {
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, null);
  assert.equal(result.code, expectedCode, result.stdout + result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.exitCode, expectedCode);
  assert.ok(summary.directory.startsWith(`${tempRoot}/virtual-bash-direct-curl-capture-`));
  const files = readdirSync(summary.directory).sort();
  for (const name of files) save(`execution/captures/${label}/${name}.data`, readFileSync(join(summary.directory, name)));
  const manifest = JSON.parse(readFileSync(join(summary.directory, 'manifest.json')));
  const observations = JSON.parse(readFileSync(join(summary.directory, 'observations.json')));
  assert.equal(observations.length, 2);
  assert.equal(manifest.outcome.status, expectedCode);
  assert.equal(manifest.before.sha256, manifest.after.sha256);
  assert.deepEqual(manifest.errors, []);
  assert.equal(manifest.before.files[canonical], sha256(readFileSync(join(sourceDirectory, canonical))));
  assert.equal(manifest.expectedVectorsSha256, sha256(vectorsBefore));
  for (const [path, expected] of Object.entries(manifest.before.files)) assert.equal(sha256(readFileSync(join(sourceDirectory, path))), expected, path);
  for (const [index, observation] of observations.entries()) {
    const vector = JSON.parse(vectorsBefore).cases[index];
    assert.deepEqual(observation.expectedFirst, vector.expectedFirst);
    assert.deepEqual(observation.expectedSecond, vector.expectedSecond);
    assert.deepEqual(observation.errors, []);
    assert.equal(observation.activeUploads, 0);
    assert.equal(observation.activeTransports, 0);
    assert.equal(observation.watchdogFired, false);
    assert.ok(!observation.activeResourceTypesAfterCleanup.includes('Timeout'));
  }
  if (expectedCode) {
    assert.notDeepEqual(observations[0].requests[1].bytes, observations[0].expectedSecond);
    assert.match(readFileSync(join(summary.directory, 'raw.tap'), 'utf8'), /# fail 1\n/);
  }
  outputs.push({ ...summary, label, files, beforeSourceInventory: manifest.before.sha256, observedBytesSha256: manifest.observationsSha256 });
  return summary;
}
const captures = await Promise.all([1, 2].map(number => run(directory, [capture], `candidate-capture-${number}`, environment)));
await checkCapture(captures[0], 0, 'success-1');
await checkCapture(captures[1], 0, 'success-2');
assert.notEqual(outputs[0].directory, outputs[1].directory);
const sealed = join(directory, fixture, 'artifacts');
const link = join(tempRoot, 'sealed-link');
symlinkSync(sealed, link, 'dir');
for (const [label, args, overrides] of [
  ['existing-output', [capture, outputs[0].directory], {}],
  ['sealed-output', [capture, sealed], {}],
  ['symlink-output', [capture, link], {}],
  ['sealed-temp-root', [capture], { TMPDIR: sealed }],
  ['symlink-temp-root', [capture], { TMPDIR: link }],
]) {
  const existingBefore = readdirSync(tempRoot).sort();
  const result = await run(directory, args, `candidate-refuse-${label}`, { ...environment, ...overrides });
  assert.equal(result.code, 1);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /Capture accepts no paths or options|Capture temp root must be (?:disjoint|outside)/);
  assert.deepEqual(readdirSync(tempRoot).sort(), existingBefore);
  assertSentinels();
}
for (const output of outputs) {
  for (const name of output.files) assert.deepEqual(readFileSync(join(output.directory, name)), readFileSync(join(review, 'execution/captures', output.label, `${name}.data`)));
}
const failureDirectory = join(review, '.scratch', 'failure-copy');
mkdirSync(failureDirectory);
const failureTar = join(review, '.scratch', 'failure-source.tar.gz');
git('archive', '--format=tar.gz', `--output=${failureTar}`, revision, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', fixture, capture);
execFileSync('tar', ['-xf', failureTar, '-C', failureDirectory]);
symlinkSync(join(root, 'node_modules'), join(failureDirectory, 'node_modules'), 'dir');
const bodyPath = join(failureDirectory, 'src/commands/network/body.ts');
const originalBody = readFileSync(bodyPath, 'utf8');
assert.ok(originalBody.includes('else cache.push(new Uint8Array(chunk));'));
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Update File: ${bodyPath}\n@@\n-              else cache.push(new Uint8Array(chunk));\n+              else cache.push(chunk.slice());\n*** End Patch\n` });
save('execution/failure-copy-body.ts.data', readFileSync(bodyPath));
const failureSentinel = join(failureDirectory, fixture, 'artifacts', 'verifier-failure-sentinel.data');
writeFileSync(failureSentinel, Buffer.from([0, 255, 128, 70, 65, 73, 76, 10]), { flag: 'wx', mode: 0o400 });
const failureSentinelBefore = readFileSync(failureSentinel);
save('execution/failure-sentinel-before.data', failureSentinelBefore);
const failureBefore = census(failureDirectory, treePaths(revision, fixture));
const failedDefault = await run(failureDirectory, ['--import', 'tsx', '--test', canonical], 'candidate-forced-failure-default', environment);
assert.equal(failedDefault.code, 1);
assert.match(failedDefault.stdout, /# fail 1\n/);
assert.doesNotMatch(failedDefault.stdout, /VIRTUAL_BASH_DIRECT_CURL_OBSERVATION/);
const failure = await run(failureDirectory, [capture], 'candidate-forced-failure-capture', environment);
await checkCapture(failure, 1, 'failure', failureDirectory);
assert.deepEqual(differences(failureBefore, census(failureDirectory, treePaths(revision, fixture))), []);
assert.deepEqual(readFileSync(failureSentinel), failureSentinelBefore);
save('execution/failure-sentinel-after.data', readFileSync(failureSentinel));
const after = census(directory, paths);
assert.deepEqual(differences(before, after), []);
assert.deepEqual(census(directory, treePaths(revision, 'src')), sourceBefore);
assertSentinels();
save('execution/candidate-tests-after.json', after);
const cleanup = [];
for (const output of outputs) {
  assert.ok(output.directory.startsWith(`${tempRoot}/virtual-bash-direct-curl-capture-`));
  rmSync(output.directory, { recursive: true });
  cleanup.push({ path: output.directory, removed: !existsSync(output.directory), originalBytesPreserved: `execution/captures/${output.label}` });
}
save('execution/candidate-result.json', {
  revision, directory, controls: 10, pass: 10, fail: 0, defaultCanonicalExecutions: 3, concurrentCanonicalProcesses: 2,
  successfulCanonicalAssertions: 6, concurrentCaptureProcesses: 2, successfulCaptureAssertions: 4,
  forcedFailureExecutions: 2, forcedFailurePerExecution: { pass: 1, fail: 1 }, refusalCases: 5,
  trackedTests: paths.length, testsBeforeSha256: sha256(JSON.stringify(before)), testsAfterSha256: sha256(JSON.stringify(after)), changes: [],
  sentinelBefore, sentinelAfter: sentinelBefore, outputs, cleanup, capturesRetainedByDesignUntilVerifierCleanup: true,
  candidateSourceTree: git('rev-parse', `${revision}:src`).toString().trim(), baselineSourceTree: git('rev-parse', '954406871fae381b1c69441b34946a224201d7ad:src').toString().trim(), historicalSourceTree: git('rev-parse', 'b494675c34dc289f4ad4b10a9201e1211eb0a7d8:src').toString().trim(),
  frozenVectorsSha256: sha256(vectorsBefore), historicalPinUnchanged: true,
  tsxVersion: JSON.parse(readFileSync(join(root, 'node_modules/tsx/package.json'))).version,
  replayProfile: 'No replay acceptance API implemented; capture never repins or converts failure to success',
  tempProfile: 'TMPDIR/TMP/TEMP explicitly set to disjoint verifier-owned scratch directory; driver uses OS tmpdir API and mkdtemp. TSX_DISABLE_CACHE=1 disables compiler disk caching (confirmed in installed tsx) to distinguish fixture persistence from compiler cache; no test/source exclusions',
  safety: 'No external network; only exact owned process watchdogs, none fired; source regression only in separate owned archive',
});
console.log(JSON.stringify({ controls: 10, pass: 10, revision, trackedTests: paths.length, outputs: outputs.map(output => ({ label: output.label, exitCode: output.exitCode })) }, null, 2));
