# Exact preparation-only static verifier

This temporary helper checks data, hashes, raw repeats, independent elementary
byte expectations and helper syntax. It never imports or executes product code.
The original supplied proposal and temporary helpers were still available during
this check. For later replay, use authenticated copies and a newly owned temporary
root; do not treat changed external prerequisites as an automatic passing check.
The checked helper source hash and actual result are in `static-checks.json`.

```javascript
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = '/Users/kjopek/Workspace/safe-bash/tests/commands/grep-aliases-stress';
const owner = '/tmp/safe-bash-grep-aliases-verifier.VIG08c';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const load = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const corpus = load('data/corpus.json');
const safety = load('data/safety-holdouts.json');
const captures = load('data/native-captures.json');
const goldens = load('data/native-goldens.json');
const profiles = load('data/candidate-profiles.json');
const provenance = load('docs/provenance.json');
const checks = [];
const check = (name, action) => { action(); checks.push(name); };
const bytes = fixture => Buffer.from(fixture.hex ?? fixture.utf8, fixture.hex === undefined ? 'utf8' : 'hex');
check('26 native and 12 safety rows with unique frozen IDs; 17 exact byte fixtures', () => {
  assert.equal(corpus.cases.length, 26);
  assert.equal(safety.cases.length, 12);
  assert.equal(Object.keys(corpus.fixtures).length, 17);
  assert.deepEqual(corpus.cases.map(row => row.id), Array.from({ length: 26 }, (_, index) => `N${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(safety.cases.map(row => row.id), Array.from({ length: 12 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`));
  for (const fixture of Object.values(corpus.fixtures)) {
    assert.equal(Object.hasOwn(fixture, 'hex') !== Object.hasOwn(fixture, 'utf8'), true);
    if (Object.hasOwn(fixture, 'hex')) assert.match(fixture.hex, /^(?:[0-9a-f]{2})*$/);
  }
});
check('Original pre-native corpus and safety SHA-256 pins still match', () => {
  assert.equal(sha256(readFileSync(join(root, 'data/corpus.json'))), 'a745efbc79d4c48d31b6a5e3e5e5fe51de0bd19f1a51dd66d984abc24f7161a8');
  assert.equal(sha256(readFileSync(join(root, 'data/safety-holdouts.json'))), '4d596e745df702040c0aa6975abc64b0d6db22ab6384eab28659fe2ec8aac2bc');
  for (const artifact of [captures, goldens, profiles]) assert.equal(artifact.corpusSha256, provenance.inputFreeze.corpusSha256);
});
check('Proposal snapshot byte-exact against permitted supplied contract', () => {
  assert.deepEqual(readFileSync(join(root, 'docs/alias-api-proposal.txt')), readFileSync('/tmp/safe-bash-alias-api.txt'));
  assert.equal(provenance.sourceBoundary.proposal.sha256, sha256(readFileSync(join(root, 'docs/alias-api-proposal.txt'))));
});
check('All native argv/stdin/file snapshots agree with original corpus; no timeouts, signals, launch errors or file effects', () => {
  assert.equal(captures.records.length, 26);
  assert.equal(captures.nativeChildCount, 54);
  for (const [index, row] of corpus.cases.entries()) {
    assert.ok(['egrep', 'fgrep'].includes(row.command));
    const record = captures.records[index];
    assert.equal(record.id, row.id);
    assert.equal(record.runs.length, 2);
    const expectedFiles = Object.fromEntries(Object.entries(row.files).map(([name, fixture]) => {
      assert.match(name, /^[A-Za-z0-9_.-]+$/);
      return [name, bytes(corpus.fixtures[fixture]).toString('hex')];
    }));
    assert.deepEqual(record.filesBeforeHex, expectedFiles);
    for (const run of record.runs) {
      assert.equal(run.executable, `/usr/bin/${row.command}`);
      assert.deepEqual(run.argv, row.args);
      assert.equal(run.stdinHex, bytes(corpus.fixtures[row.stdin]).toString('hex'));
      assert.deepEqual(run.filesAfterHex, expectedFiles);
      assert.equal(run.launchError, null);
      assert.equal(run.signal, null);
      assert.ok([0, 1, 2].includes(run.status));
      for (const key of ['stdinHex', 'stdoutHex', 'stderrHex']) assert.match(run[key], /^(?:[0-9a-f]{2})*$/);
    }
    for (const key of ['status', 'stdoutHex', 'stderrHex']) assert.equal(record.runs[0][key], record.runs[1][key]);
  }
});
check('26 always-available goldens exactly preserve first native captures and stderr', () => {
  assert.equal(goldens.rows.length, 26);
  for (const [index, golden] of goldens.rows.entries()) {
    assert.equal(golden.id, captures.records[index].id);
    const run = captures.records[index].runs[0];
    for (const key of ['status', 'stdoutHex', 'stderrHex', 'filesAfterHex']) assert.deepEqual(golden[key], run[key]);
  }
  assert.deepEqual(captures.stderrTransformations, []);
  assert.deepEqual(goldens.warningProfile.stderrTransformations, []);
  assert.equal(goldens.rows.filter(row => row.stderrHex !== '').length, 4);
});
check('16 ordinary outputs independently checked by hand-derived byte expectations, not product code', () => {
  const expected = {
    N01: [0, '1:red\n2:blue\n'], N02: [0, '3:red|blue\n'],
    N09: [0, 'ant\ncat\n'], N10: [0, 'ant\ncat\n'], N11: [0, 'ant\ncat\n'],
    N12: [0, '-needle\n--needle\n'], N13: [0, '-needle\n--needle\n'],
    N14: [0, 'a.txt:1:hit:a\na.txt:3:hit:b\nb.txt:2:hit:c\n'],
    N15: [0, '(standard input):1:hit:stdin\nb.txt:2:hit:c\n'], N16: [1, ''],
    N20: [0, Buffer.from('ff6869740a686974fe0a', 'hex')], N21: [0, 'red\0blue\0'],
    N22: [0, 'hit:last\n'], N23: [1, ''], N24: [0, ''], N25: [0, 'a.txt:1\nb.txt:1\n']
  };
  assert.equal(Object.keys(expected).length, 16);
  for (const [id, [status, output]] of Object.entries(expected)) {
    const golden = goldens.rows.find(row => row.id === id);
    assert.equal(golden.status, status);
    assert.equal(golden.stdoutHex, Buffer.from(output).toString('hex'));
    assert.equal(golden.stderrHex, '');
  }
});
check('Profile denominator retained: 16 exact ordinary, 4 conflict, 6 explicit diagnostic/option rows', () => {
  assert.equal(profiles.rows.length, 26);
  assert.deepEqual(profiles.rows.map(row => row.id), corpus.cases.map(row => row.id));
  assert.equal(profiles.rows.filter(row => row.candidateProfile === 'exact-native-golden-including-stderr').length, 16);
  assert.equal(profiles.rows.filter(row => row.candidateProfile === 'existing-bounded-E-F-conflict').length, 4);
  assert.equal(profiles.rows.filter(row => ['unsupported-G-in-bounded-option-set', 'bounded-alias-diagnostic'].includes(row.candidateProfile)).length, 6);
  assert.equal(profiles.candidateRuns, 0);
});
check('Executable, capture, exact recipe and provenance hashes consistent; no native subtree remains', () => {
  for (const pin of Object.values(captures.identities)) {
    assert.equal(sha256(readFileSync(pin.path)), pin.sha256);
    assert.equal(pin.version.status, 0);
    assert.equal(pin.version.signal, null);
    assert.equal(pin.version.launchError, null);
    assert.equal(pin.version.stderrHex, '');
  }
  assert.equal(sha256(readFileSync(join(root, 'data/native-captures.json'))), provenance.native.nativeCaptureSha256);
  const recipe = readFileSync(join(root, 'docs/native-capture-recipe.md'), 'utf8');
  const source = recipe.split('```javascript\n')[1].split('```\n')[0];
  assert.equal(sha256(source), captures.captureSourceSha256);
  assert.equal(source, readFileSync(join(owner, 'capture-native.mjs'), 'utf8'));
  assert.equal(existsSync(captures.nativeRoot), false);
});
check('Only prepared JSON/Markdown/TXT data exists under ownership; no tests or executable product imports', () => {
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else assert.match(entry.name, /\.(?:json|md|txt)$|^SHA256SUMS$/);
    }
  }
  visit(root);
  assert.equal(provenance.productImports, 0);
  assert.equal(provenance.candidateExecutions, 0);
  assert.equal(provenance.candidateCommit, null);
  assert.equal(provenance.gnuAvailability.nativeInvocations, 0);
});
check('Temporary helper syntax checked with Node --check only; no product or candidate execution', () => {
  for (const name of ['capture-native.mjs', 'prepare-artifacts.mjs', 'static-verify.mjs']) {
    const result = spawnSync(process.execPath, ['--check', join(owner, name)], { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
  }
});
const report = { classification: 'static-preparation-check-results-not-candidate-tests', checkedAt: new Date().toISOString(), node: process.version, checkCount: checks.length, checks, staticVerifierSourceSha256: sha256(readFileSync(new URL(import.meta.url))), candidateRuns: 0, productImports: 0, nativeRerunsDuringStaticChecks: 0, status: 'passed' };
writeFileSync(join(owner, 'static-checks.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
```
