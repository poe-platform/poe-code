import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const read = name => readFileSync(new URL(name, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(read('CAPTURES.json'));
const archive = Buffer.from(read('CAPTURES.json.gz.base64').toString(), 'base64');
assert.equal(hash(archive), metadata.archiveSha256);
const files = JSON.parse(gunzipSync(archive));
const expected = metadata.attempts.flatMap(attempt => attempt.files);
assert.deepEqual(Object.keys(files).sort(), expected.map(file => file.path).sort());
for (const file of expected) {
  const bytes = Buffer.from(files[file.path], 'base64');
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(hash(bytes), file.sha256, file.path);
}
const report = prefix => JSON.parse(Buffer.from(files[prefix + '/report.json'], 'base64'));
assert.deepEqual(metadata.attempts.map(attempt => [attempt.status, attempt.currentGroups, attempt.controls]), [
  ['fail', 0, 6], ['fail', 2, 6], ['pass', 3, 11], ['pass', 3, 11],
]);
assert.match(report('attempt-01').error, /resource: '\/var'/u);
assert.match(report('attempt-02').error, /Invalid network limit: maxRedirects/u);
const final = report('attempt-04');
assert.equal(final.publicSmoke.count, 73);
assert.equal(final.publicSmoke.imports.length, 27);
assert.equal(final.publicSmoke.workflows.length, 6);
assert.equal(final.publicSmoke.types, 'pass');
assert.equal(final.packageSha256, report('attempt-03').packageSha256);
assert.ok(metadata.attempts.every(attempt => attempt.temporaryRemoved));
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { maxBuffer: 8 * 1024 * 1024 });
const original = read('alias-consumer-original.mts.data');
assert.equal(hash(original), metadata.originalAlias.beforeSha256);
assert.deepEqual(original, git(['show', 'd4ed8322:tests/commands/grep-aliases/consumer.mts']));
const migrated = git(['show', metadata.classificationSource + ':tests/commands/grep-aliases/consumer.mts']);
assert.equal(hash(migrated), metadata.originalAlias.afterSha256);
assert.equal(migrated.toString(), original.toString()
  .replace('../../../dist/index.js', 'virtual-bash')
  .replace('../../../dist/commands/grep-aliases/index.js', 'virtual-bash/commands/grep-aliases'));
const before = JSON.parse(git(['show', 'd4ed8322:tests/plugins/qualified-current-release/inventory.json']));
const after = JSON.parse(git(['show', metadata.classificationSource + ':tests/plugins/qualified-current-release/inventory.json']));
for (const entry of before.entries) assert.deepEqual(after.entries.find(candidate => candidate.path === entry.path), entry);
const additions = after.entries.filter(entry => !before.entries.some(prior => prior.path === entry.path));
assert.equal(additions.length, 12);
assert.equal(additions.filter(entry => entry.classification === 'frozen-evidence').length, 6);
for (const entry of additions) {
  assert.equal(hash(git(['show', metadata.classificationSource + ':' + entry.path])), entry.sha256, entry.path);
  for (const evidence of entry.freeze?.evidence ?? []) {
    assert.equal(hash(git(['show', metadata.classificationSource + ':' + evidence.path])), evidence.sha256, evidence.path);
  }
}
console.log(JSON.stringify({ files: expected.length, captureArchive: metadata.archiveSha256, unchangedPriorEntries: before.entries.length, additions: additions.length, currentGroupsActuallyRun: 3, controls: 11, publicNames: 73, publicImports: 27, publicWorkflows: 6 }));
