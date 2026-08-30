import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const own = dirname(fileURLToPath(import.meta.url)), repo = join(own, '../../../..'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(own, 'data/MANIFEST.json'))), gzip = Buffer.from(readFileSync(join(own, 'data/EVIDENCE.json.gz.base64'), 'utf8').trim(), 'base64');
assert.equal(hash(gzip), manifest.gzipSHA256); const raw = gunzipSync(gzip); assert.equal(hash(raw), manifest.dataSHA256);
const { summary, files } = JSON.parse(raw); assert.deepEqual(summary, JSON.parse(readFileSync(join(own, 'data/SUMMARY.json'))));
assert.deepEqual(Object.keys(files).sort(), Object.keys(manifest.files).sort()); for (const [path, expected] of Object.entries(manifest.files)) assert.equal(hash(Buffer.from(files[path], 'base64')), expected);
for (const [index, version] of summary.versions.entries()) {
  const binding = JSON.parse(Buffer.from(files[`v${index + 1}/BINDING.json`], 'base64'));
  for (const [path, expected] of Object.entries(binding.inputs)) assert.equal(hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', binding.candidate + ':' + path])), expected);
  assert.equal(hash(Buffer.from(files[`v${index + 1}/observer.mjs`], 'base64')), hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', version.commit + ':tests/integration/owned-output-production-independent-20260827/first-read-followup/observer.mjs'])));
}
console.log(JSON.stringify({ authenticatedFiles: Object.keys(files).length, observerExecutions: summary.observerExecutions, originalCanonicalScore: summary.originalCanonicalScore }));
