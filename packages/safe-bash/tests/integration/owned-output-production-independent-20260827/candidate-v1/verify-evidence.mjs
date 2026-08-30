import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const own = dirname(fileURLToPath(import.meta.url)), repo = join(own, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(own, 'MANIFEST.json'))), compressed = Buffer.from(readFileSync(join(own, 'EVIDENCE.json.gz.base64'), 'utf8').trim(), 'base64');
assert.equal(hash(compressed), manifest.gzipSHA256); const payload = gunzipSync(compressed); assert.equal(hash(payload), manifest.payloadSHA256);
const evidence = JSON.parse(payload); assert.deepEqual(Object.keys(evidence.files).sort(), Object.keys(manifest.files).sort());
for (const [name, expected] of Object.entries(manifest.files)) assert.equal(hash(Buffer.from(evidence.files[name], 'base64')), expected, name);
for (const [path, expected] of Object.entries(manifest.harness)) {
  assert.equal(hash(readFileSync(join(repo, path))), expected, path);
  assert.equal(hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', evidence.summary.harnessCommit + ':' + path])), expected, path);
}
const state = JSON.parse(Buffer.from(evidence.files['STATE.json'], 'base64'));
assert.equal(state.candidate, evidence.summary.candidate); assert.equal(state.packageSHA256, evidence.summary.packageSHA256);
for (const [path, expected] of Object.entries(state.inputs)) assert.equal(hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', state.candidate + ':' + path])), expected, path);
assert.deepEqual(JSON.parse(readFileSync(join(own, 'CHECKPOINT.json'))), evidence.summary);
console.log(JSON.stringify({ candidate: state.candidate, authenticatedEvidenceFiles: Object.keys(manifest.files).length, authenticatedCandidateInputs: Object.keys(state.inputs).length, observations: evidence.summary.observations }));
