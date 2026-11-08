import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = resolve(root, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const artifacts = json(resolve(evidence, 'artifact-hashes.json'));
for (const [path, expected] of Object.entries(artifacts)) assert.equal(hash(readFileSync(resolve(root, path))), expected, path);
const freeze = json(resolve(evidence, 'FROZEN.json'));
for (const name of ['cases.json', 'native-controls.json', 'intent.json']) assert.equal(hash(readFileSync(resolve(evidence, name))), freeze.hashes[name], name);
const fixtures = json(resolve(evidence, 'cases.json'));
assert.equal(fixtures.length, 85);
assert.equal(new Set(fixtures.map(item => item.id)).size, 85);
assert.equal(json(resolve(evidence, 'native-controls.json')).length, 48);
const native = resolve(evidence, 'gnu-strings-supplement');
for (const [name, expected] of Object.entries(json(resolve(native, 'SHA256.json')))) assert.equal(hash(readFileSync(resolve(native, name))), expected, name);
const supplement = json(resolve(native, 'report.json'));
assert.deepEqual(supplement.captures.map(item => item.id), fixtures.filter(item => item.command === 'strings').map(item => item.id));
assert.deepEqual(supplement.captures.filter(item => item.differences.length).map(item => item.id), ['strings-dash-stdin-extension']);
let calls = 0;
let runs = 0;
for (const snapshot of readdirSync(evidence).filter(name => name.startsWith('snapshot-'))) {
  const directory = resolve(evidence, snapshot);
  const manifest = json(resolve(directory, 'SNAPSHOT.json'));
  assert.equal(hash(readFileSync(resolve(directory, 'harness.ts.txt'))), manifest.snapshotHashes['tests/commands/stream-inspection-stress/holdouts.test.ts']);
  for (const run of readdirSync(directory).filter(name => name.startsWith('run-'))) {
    const result = json(resolve(directory, run, 'result.json'));
    const stdout = readFileSync(resolve(directory, run, 'stdout.tap'));
    const stderr = json(resolve(directory, run, 'stderr.json'));
    assert.equal(hash(stdout), result.stdoutSha256);
    assert.equal(hash(stderr), result.stderrSha256);
    assert.equal(result.signal, null);
    assert.equal(result.error, null);
    const testCount = Number(stdout.toString().match(/^# tests (\d+)$/m)?.[1]);
    assert.ok(Number.isSafeInteger(testCount) && testCount > 0);
    if (run === 'run-original' || run === 'run-native') {
      assert.equal(testCount, 85);
      const outcomes = json(resolve(directory, run, 'outcomes.json'));
      assert.equal(outcomes.length, 85);
      assert.deepEqual(outcomes.map(item => item.id).sort(), fixtures.map(item => item.id).sort());
    }
    calls += testCount;
    runs++;
  }
}
if (existsSync(resolve(evidence, 'SUMMARY.json'))) assert.equal(calls, json(resolve(evidence, 'SUMMARY.json')).actualTestCalls);
console.log(JSON.stringify({ artifactHashes: Object.keys(artifacts).length, frozenFixtures: 85, nativeStrings: 20, appleControls: 48, runs, actualTestCalls: calls, result: 'all evidence checks passed; no product execution' }, null, 2));
