import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { artifact, digest, handoff, root, snapshot } from './common.mjs';
import { git } from '../jq-42-independent-review/common.mjs';
import { inventory, manifest, prefix, proposal } from './preservation.mjs';

const before = snapshot();
const pinned = {};
for (const [directory, commit] of [
  ['jq-grammar-canonical-plan', 'eab1d48a90456c1c2cdeb9289b32f1ed62429137'],
  ['jq-grammar-literal-file-review', '013c1afdbda1d017beacb2c61771ef8a32cad41b'],
  ['jq-grammar-source-review', '0f82d80bde6581dee8a8143a924a04950f5b072b'],
  ['jq-grammar-review-fixes', '2dbb27c'],
]) {
  const paths = git(['ls-tree', '-r', '--name-only', commit, `${prefix}${directory}`]).toString().trim().split('\n');
  assert.ok(paths.length > 2);
  for (const path of paths) {
    const bytes = readFileSync(join(root, path));
    assert.deepEqual(bytes, git(['show', `${commit}:${path}`]), path);
    pinned[path] = { commit, sha256: digest(bytes) };
  }
}
assert.equal(existsSync('/tmp/safe-bash-jq-grammar-review-fix-report.txt'), true, 'author immutable closing check must finish');
const closingMarker = readFileSync('/tmp/safe-bash-jq-grammar-review-fix-report.txt', 'utf8');
assert.match(closingMarker, /Committed and frozen/u);
assert.match(closingMarker, /09926fb/u);
const patches = {};
for (const [name, expected] of [['native-v3.patch', 'c83cd9adabd99925007bb79332899913829166ac21a6a25353dcfd199196627d'], ['host-conditional-v3.patch', '18abf8765ce8474b30b0704063743f2e93217a19810a568160b4c30736187f0b']]) {
  const path = `${proposal}${name}`;
  assert.equal(digest(readFileSync(path)), expected);
  const check = spawnSync('git', ['apply', '--check', path], { cwd: root, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  patches[name] = { sha256: expected, checkStatus: check.status };
}
assert.equal(manifest.files.length, 13);
assert.equal(manifest.files.filter(file => file.patch === 'native').length, 12);
for (const file of manifest.files) {
  if (file.beforeSha256 === null) assert.equal(existsSync(file.path), false);
  else {
    assert.equal(digest(readFileSync(file.path)), file.beforeSha256);
    assert.deepEqual(readFileSync(file.path), readFileSync(file.beforeSnapshot));
    assert.deepEqual(readFileSync(file.path), git(['show', `HEAD:${file.path}`]), 'canonical originals already committed');
  }
  assert.equal(digest(readFileSync(file.afterSnapshot)), file.afterSha256);
}
const read = path => JSON.parse(readFileSync(path));
const literalPath = `${prefix}jq-grammar-literal-file-review/native-review.json`;
assert.equal(digest(readFileSync(literalPath)), '08b138d97e839a678e6c4120ef14f16dabb24ea82cf30ea02abc4e19d5ed44b6');
const literal = read(literalPath);
for (const [path, expected] of Object.entries(literal.sourceFixtures)) assert.equal(digest(readFileSync(path)), expected);
assert.equal(literal.counts.exactCapturePasses, 4);
assert.equal(literal.counts.metadataPasses, 2);
const dataFile = manifest.files.find(file => file.path.endsWith('jq-grammar-native-v3.json'));
const proposed = read(dataFile.afterSnapshot);
const native = read(`${proposal}native-v3.json`);
assert.equal(digest(readFileSync(`${proposal}native-v3.json`)), proposed.nativeProofSha256);
const inputKey = row => JSON.stringify([row.argv, row.inputHex, Object.entries(row.files).sort()]);
const nativeKeys = new Map(native.results.map(row => [inputKey(row), row]));
assert.equal(nativeKeys.size, 90);
assert.equal(proposed.vectors.length, 90);
for (const vector of proposed.vectors) {
  const proof = nativeKeys.get(inputKey(vector));
  assert.ok(proof);
  assert.deepEqual(vector.expected, proof.expected);
  if (proof.executed) {
    for (const capture of [proof.first, proof.second]) {
      assert.deepEqual(capture.argv, vector.argv);
      assert.equal(capture.inputHex, vector.inputHex);
      assert.deepEqual({ status: capture.status, stdoutHex: capture.stdoutHex, stderrHex: capture.stderrHex }, vector.expected);
    }
  } else {
    const supplemental = literal.cases.find(row => inputKey(row) === inputKey(vector));
    assert.ok(supplemental);
    assert.equal(vector.inputHex, '98800a');
    assert.deepEqual(vector.files, { 'unicode-start': 'f09f' });
    assert.deepEqual(supplemental.expected, vector.expected);
    assert.equal(supplemental.captures.length, 2);
    for (const capture of supplemental.captures) {
      assert.deepEqual(capture.argv, vector.argv);
      assert.equal(capture.inputHex, vector.inputHex);
      assert.deepEqual(capture.actual, vector.expected);
      assert.deepEqual(capture.before, capture.after);
      assert.equal(capture.before.entries.length, 1);
      const entry = capture.before.entries[0];
      assert.equal(entry.name, 'unicode-start');
      assert.equal(entry.regularFile, true);
      assert.equal(entry.symbolicLink, false);
      assert.equal(entry.bytesHex, 'f09f');
      assert.equal(entry.sha256, digest(Buffer.from('f09f', 'hex')));
      assert.equal(capture.childReaped, true);
      assert.equal(capture.cleanup.removed, true);
      assert.equal(capture.cleanup.absenceConfirmed, true);
    }
  }
}
for (const capture of literal.metadata) {
  assert.equal(capture.actual.status, 0);
  assert.equal(capture.cleanup.absenceConfirmed, true);
  assert.equal(capture.childReaped, true);
}
assert.equal(literal.executableSha256, native.executableSha256);
assert.deepEqual(literal.environment, native.environment);
const verification = read(new URL('pre-proposal-verify.json', import.meta.url));
assert.equal(verification.status, 0);
assert.deepEqual(JSON.parse(verification.stdout), { selectedRows: 29, selectedSchedules: 464, hostConditionalRows: 1, mutantsRejected: 14, helpersChecked: 2, unselectedTests: 373, noProductImport: true, literalFileChecksUnavailable: 2 });
const failures = record => [...record.stdout.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]).sort();
const broad = read(new URL('pre-broad-unchanged.json', import.meta.url));
const prior = read(`${prefix}jq-grammar-source-review/broad-unchanged.json`);
assert.deepEqual(failures(broad), failures(prior));
assert.equal(failures(broad).length, 30);
for (const mode of ['source', 'compiled']) {
  const cohorts = read(new URL(`pre-${mode}-cohorts.json`, import.meta.url));
  for (const [name, count] of [['main', 790], ['legacy', 376], ['grammar', 178]]) {
    assert.equal(cohorts.summary[name].pass, count);
    assert.equal(cohorts.summary[name].fail, 0);
  }
  assert.equal(cohorts.stableProduct, true);
  assert.equal(cohorts.stableTooling, true);
}
artifact('pre-approval-audit.json', { at: new Date().toISOString(), handoff, before, after: snapshot(), pinned, patches,
  closingMarker, closingMarkerSha256: digest(closingMarker), inventory: inventory(), failures: failures(broad),
  literalGate: { evidence: literalPath, sha256: digest(readFileSync(literalPath)), capturePasses: 4, metadataPasses: 2, recapturedHere: false },
  proposalVerification: JSON.parse(verification.stdout), interpretation: 'Proposal unavailable literal-file flags are dated capture truths, superseded only for this gate by separately pinned exact evidence; original artifacts untouched.' });
console.log('Independent pins, 90 exact proposal keys, literal-file evidence, original30 inventory and pre gates verified');
