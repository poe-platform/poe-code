import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson(join(here, 'RAW-MANIFEST.json'));
const summary = readJson(join(here, 'SUMMARY.json'));
const temporary = mkdtempSync('/tmp/aliases-column-independent-capture-check-');

try {
  const bytes = Buffer.from(readFileSync(join(here, 'raw-results.tar.gz.b64'), 'utf8'), 'base64');
  assert.equal(bytes.length, manifest.archive.bytes);
  assert.equal(digest(bytes), manifest.archive.sha256);
  assert.deepEqual(summary.rawArchive, manifest.archive);
  const archive = join(temporary, 'raw.tar.gz');
  writeFileSync(archive, bytes, { flag: 'wx' });
  const entries = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(entries.every(path => !path.startsWith('/') && !path.split('/').includes('..')));
  const raw = join(temporary, 'raw');
  mkdirSync(raw);
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', raw]);
  const files = [];
  function inspect(directory, prefix = '') {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const relative = prefix + name;
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) inspect(path, relative + '/');
      else {
        assert.equal(stat.isFile(), true);
        const content = readFileSync(path);
        files.push({ path: relative, bytes: content.length, sha256: digest(content) });
      }
    }
  }
  inspect(raw);
  files.sort((first, second) => first.path.localeCompare(second.path));
  assert.deepEqual(files, manifest.files);
  assert.equal(files.length, 122);
  const authentication = readJson(join(raw, 'review/authentication.json'));
  const original = readJson(join(raw, 'frozen/report.json'));
  const exact = readJson(join(raw, 'review/exact-artifact-report.json'));
  const postrun = readJson(join(raw, 'review/postrun-verification.json'));
  assert.equal(authentication.binding.candidate, '3dc0ac26d681badfd4db6319f2630274095c3100');
  assert.equal(authentication.binding.base, '0123c83d3aae72a15621acbb29a165b97b2c6ab6');
  assert.equal(authentication.binding.changed.length, 14);
  assert.equal(authentication.revisions.dbceec2b, 'dbceec2b9890927ea93cee3b416f78908c648cc6');
  assert.equal(manifest.expectedPackSha256, '994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5');
  assert.equal(digest(readFileSync(join(raw, 'exact/virtual-bash-0.0.0.tgz'))), manifest.expectedPackSha256);
  assert.equal(exact.artifactAdmission.supplied, manifest.expectedPackSha256);
  assert.equal(exact.artifactAdmission.independentlyRebuilt, manifest.expectedPackSha256);
  assert.equal(digest(readFileSync(join(raw, 'frozen/virtual-bash-0.0.0.tgz'))), original.pack.sha256);
  assert.notEqual(original.pack.sha256, manifest.expectedPackSha256);
  assert.equal(exact.frozenDriverPackMismatch.frozenDriverAdmission.startsWith('REJECTED'), true);
  assert.deepEqual(original.runtime.totals, { passed: 56, failed: 0 });
  assert.deepEqual(exact.runtime.totals, { passed: 56, failed: 0 });
  assert.deepEqual(exact.supplemental.totals, { passed: 4, failed: 0 });
  assert.equal(exact.runtime.loaded.length, 181);
  assert.equal(exact.runtime.workers.length, 33);
  assert.equal(exact.negativeDiagnostics.length, 13);
  assert.deepEqual(exact.nestedReplaceDiagnostics.map(row => [row.line, row.code]), [[2, '2353'], [3, '2353']]);
  assert.deepEqual(exact.sensitivity.totals, { passed: 55, failed: 1 });
  assert.deepEqual(exact.installedBefore, exact.installedAfter);
  assert.deepEqual(exact.sourceBefore, exact.sourceAfter);
  assert.deepEqual(exact.fixtureBefore, exact.fixtureAfter);
  assert.deepEqual(postrun.workerTotals, { total: 138, ready: 136, exited: 138 });
  for (const [name, sha256] of Object.entries(authentication.fixtureBefore)) {
    assert.equal(digest(readFileSync(join(here, '..', name))), sha256, `preserved fixture: ${name}`);
    const committed = execFileSync('git', ['show', `${authentication.revisions.dbceec2b}:tests/integration/aliases-column-public-independent-20260827/${name}`], { cwd: repository });
    assert.equal(digest(committed), sha256);
  }
  const verification = readJson(join(raw, 'review/author-capture-verification.json'));
  assert.equal(verification.status, 0);
  assert.equal(JSON.parse(verification.stdout).historicalFailedAttempts, 3);
  assert.equal(postrun.historicalAttempts.length, 4);
  console.log(JSON.stringify({ status: 'PASS capture authentication only', files: files.length, candidate: summary.candidate, exactPack: manifest.expectedPackSha256, originalDriverPack: 'REJECTED mismatch preserved', runtime: '56/56 exact + 56/56 original', supplemental: '4/4', frozenFilesUnchanged: 11, observedWorkerExits: 138, productExecutions: 0 }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
