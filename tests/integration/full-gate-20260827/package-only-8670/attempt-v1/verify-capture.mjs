import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = JSON.parse(readFileSync(join(here, 'CAPTURE.json')));
const expected = JSON.parse(readFileSync(join(here, 'RAW-MANIFEST.json')));
const summary = JSON.parse(readFileSync(join(here, 'SUMMARY.json')));
const scratch = mkdtempSync(join(tmpdir(), 'safe-bash-package-capture-review-'));
try {
  const bytes = Buffer.from(readFileSync(join(here, 'raw-capture.tar.gz.b64'), 'utf8'), 'base64');
  assert.equal(hash(bytes), capture.sha256);
  assert.equal(bytes.length, capture.bytes);
  writeFileSync(join(scratch, 'capture.tar.gz'), bytes);
  const directory = join(scratch, 'capture');
  mkdirSync(directory);
  execFileSync('/usr/bin/tar', ['-xf', join(scratch, 'capture.tar.gz'), '-C', directory]);
  const actual = [];
  function walk(root, prefix = '') {
    for (const name of readdirSync(root).sort()) {
      const file = join(root, name), local = prefix ? prefix + '/' + name : name;
      const stat = lstatSync(file);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(file, local);
      else {
        assert.equal(stat.isFile(), true);
        const content = readFileSync(file);
        actual.push({ path: local, bytes: content.length, sha256: hash(content) });
      }
    }
  }
  walk(directory);
  assert.deepEqual(actual, expected.files);
  assert.equal(actual.length, capture.files);
  const report = JSON.parse(readFileSync(join(directory, 'report.json')));
  assert.equal(report.candidate, summary.candidate);
  assert.equal(report.candidate, capture.candidate);
  assert.equal(report.candidate, expected.candidate);
  assert.equal(report.status, 'separate-package-cohort-failed');
  assert.equal(report.public.count, 70);
  assert.equal(report.public.imports.length, 25);
  assert.equal(report.currentConsumers.groups.length, 19);
  assert.equal(report.currentConsumers.groups.filter(group => group.compile === 'pass').length, 19);
  assert.equal(report.currentConsumers.groups.filter(group => group.error).length, 16);
  assert.equal(report.currentConsumers.groups.flatMap(group => group.runtimeResults).length, 0);
  assert.equal(report.packageSha256, summary.packageSha256);
  const packed = JSON.parse(readFileSync(join(directory, 'pack.stdout.log')))[0];
  assert.equal(hash(readFileSync(join(directory, packed.filename))), report.packageSha256);
  const denied = JSON.parse(readFileSync(join(directory, 'current-consumers/current-consumer-source-denied.json')));
  assert.equal(denied.status, 9);
  assert.match(denied.stderr, /bad option: --experimental-permission/);
  assert.deepEqual(report.sourceChanges, []);
  assert.equal(report.packageAfter, undefined);
  assert.equal(report.temporaryRemoved, true);
  console.log(JSON.stringify({ candidate: report.candidate, files: actual.length, packageSha256: report.packageSha256, status: report.status, productExecutions: 0 }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(existsSync(scratch), false);
}
