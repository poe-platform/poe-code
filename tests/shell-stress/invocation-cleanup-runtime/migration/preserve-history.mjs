import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { digest, fixturePath, probePath } from './binding.ts';
import { git, historicalHarness, historicalPins, historicalRuntime } from './replay.mjs';

const output = join(dirname(fileURLToPath(import.meta.url)), 'history');
await mkdir(output);
const entries = [];
for (const [source, name] of [[fixturePath, 'original-canonical.ts.data'], [probePath, 'original-public-worker.mjs.data']]) {
  const bytes = git(['show', `${historicalHarness}:${source}`]);
  await writeFile(join(output, name), bytes, { flag: 'wx' });
  entries.push({ sourceCommit: historicalHarness, source, stored: name, bytes: bytes.length, sha256: digest(bytes) });
}
const originalFixture = git(['show', `${historicalHarness}:${fixturePath}`]).toString();
for (const [path, hash] of Object.entries(historicalPins)) {
  assert.ok(originalFixture.includes(`"${path}": "${hash}"`));
  assert.equal(digest(git(['show', `${historicalRuntime}:${path}`])), hash);
}
const reportCommit = '954406871fae381b1c69441b34946a224201d7ad';
const reportRoot = 'tests/integration/full-gate-20260827/combined-b494675c';
const manifest = JSON.parse(git(['show', `${reportCommit}:${reportRoot}/EVIDENCE_MANIFEST.json`]));
const capture = manifest.captures.find(entry => entry.key === 'canonical/test.stdout.log');
const stored = git(['show', `${reportCommit}:${reportRoot}/${capture.path}`]);
assert.equal(digest(stored), capture.storedSha256);
const tap = capture.encoding === 'identity' ? stored : gunzipSync(Buffer.from(stored.toString().trim(), 'base64'));
assert.equal(digest(tap), capture.originalSha256);
const routing = JSON.parse(git(['show', `${reportCommit}:${reportRoot}/FAILURE_ROUTING.json`]));
const failed = routing.failures.filter(row => row.file === fixturePath && row.group === 'historical-cleanup-pin');
assert.equal(failed.length, 10);
for (const row of failed) {
  assert.equal(row.failureType, 'hookFailed');
  assert.ok(tap.toString().includes(row.detail));
}
const failures = { originalCandidate: routing.revision, reportCommit, originalCapture: capture, count: 10, result: 'Ten failed before-hooks retained; no scenario bodies accepted', rows: failed };
const bytes = Buffer.from(`${JSON.stringify(failures, null, 2)}\n`);
await writeFile(join(output, 'original-failed-hooks.json'), bytes, { flag: 'wx' });
entries.push({ stored: 'original-failed-hooks.json', bytes: bytes.length, sha256: digest(bytes) });
await writeFile(join(output, 'MANIFEST.json'), `${JSON.stringify({ historicalRuntime, historicalHarness, historicalPins, entries, classification: 'Historical fixture/probe/source pins and original red results; not current-candidate acceptance', preservedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ historicalRuntime, historicalHarness, originalFailedHooks: failed.length, preservedFiles: entries.length }));
