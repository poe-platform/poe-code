import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { account } from '../../account.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(here, 'RAW-MANIFEST.json')));
const capture = JSON.parse(readFileSync(join(here, 'CAPTURE.json')));
const summary = JSON.parse(readFileSync(join(here, 'SUMMARY.json')));
const temporary = mkdtempSync(join(tmpdir(), 'safe-bash-gate-capture-review-'));
try {
  for (const artifact of capture.files) {
    const payload = Buffer.from(readFileSync(join(here, artifact.name), 'utf8'), 'base64');
    assert.equal(digest(payload), artifact.encodedPayloadSha256);
    const original = artifact.encoding === 'base64(gzip(raw))' ? gunzipSync(payload) : payload;
    assert.equal(original.length, artifact.originalBytes);
    assert.equal(digest(original), artifact.originalSha256);
    if (artifact.name === 'raw-capture.tar.gz.b64') writeFileSync(join(temporary, 'capture.tar.gz'), payload);
  }
  const directory = join(temporary, 'capture');
  mkdirSync(directory);
  execFileSync('/usr/bin/tar', ['-xf', join(temporary, 'capture.tar.gz'), '-C', directory]);
  const observed = [];
  function walk(root, relative = '') {
    for (const name of readdirSync(root).sort()) {
      const path = join(root, name), local = relative ? `${relative}/${name}` : name, stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(path, local);
      else {
        assert.equal(stat.isFile(), true);
        const bytes = readFileSync(path);
        observed.push({ path: local, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  walk(directory);
  assert.deepEqual(observed, manifest.files);
  const parsed = account(readFileSync(join(directory, 'test.stdout.log'), 'utf8'));
  assert.equal(parsed.reconciled, true);
  assert.deepEqual(parsed.summary, summary.canonical);
  assert.deepEqual(parsed.nonpassing.map(entry => entry.name), summary.failures.map(entry => entry.name));
  const report = JSON.parse(readFileSync(join(directory, 'report.json')));
  assert.equal(report.revision, capture.candidate);
  assert.equal(report.revision, manifest.candidate);
  assert.equal(report.revision, summary.candidate);
  assert.deepEqual(report.phases.find(entry => entry.label === 'test').sourceChanges, summary.postSuiteSourceChanges);
  assert.equal(report.status, 'infrastructure-failed');
  console.log(JSON.stringify({ files: observed.length, counts: parsed.counts, reconciled: true, candidate: report.revision, productExecutions: 0 }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
  assert.equal(existsSync(temporary), false);
}
