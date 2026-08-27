import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path));
const capture = json(join(here, 'CAPTURE.json'));
const manifest = json(join(here, 'RAW-MANIFEST.json'));
const temporary = mkdtempSync(join(tmpdir(), 'aliases-column-capture-verification-'));
try {
  const bytes = Buffer.from(readFileSync(join(here, 'raw-capture.tar.gz.b64'), 'utf8'), 'base64');
  assert.equal(bytes.length, capture.bytes); assert.equal(hash(bytes), capture.sha256);
  const archive = join(temporary, 'raw.tar.gz'); writeFileSync(archive, bytes);
  const entries = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(entries.every(path => !path.startsWith('/') && !path.split('/').includes('..')));
  const raw = join(temporary, 'raw'); mkdirSync(raw);
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', raw]);
  const actual = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), local = prefix ? prefix + '/' + name : name, stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(path, local);
      else { assert.equal(stat.isFile(), true); const content = readFileSync(path); actual.push({ path: local, bytes: content.length, sha256: hash(content) }); }
    }
  }
  walk(raw); assert.deepEqual(actual, manifest.files); assert.equal(actual.length, capture.files);
  const report = json(join(raw, 'attempt-04/REPORT.json'));
  const binding = json(join(raw, 'candidate-04.json'));
  assert.deepEqual(binding, json(join(here, 'CANDIDATE.json')));
  assert.equal(report.candidate, '3dc0ac26d681badfd4db6319f2630274095c3100');
  assert.equal(binding.candidate, report.candidate);
  assert.equal(binding.base, '0123c83d3aae72a15621acbb29a165b97b2c6ab6');
  assert.equal(binding.rootSourceCommit, 'cb940da68052a9f1ab7e115279900d277e051fdb');
  assert.equal(binding.changed.length, 14);
  assert.equal(report.status, 'scoped-author-integration-pass-awaits-independent-review');
  assert.deepEqual(report.registry, { tests: 63, pass: 63, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(report.publicTests, [1, 2].map(() => ({ tests: 17, pass: 17, fail: 0, cancelled: 0, skipped: 0, todo: 0 })));
  assert.deepEqual(report.negativeTypes, ['TS2322', 'TS2322', 'TS2322', 'TS2353', 'TS2353', 'TS2353']);
  assert.equal(report.adjacentConsumers.length, 2); assert.ok(report.adjacentConsumers.every(row => row.status === 0));
  assert.equal(report.controls.length, 6);
  assert.equal(report.commands.filter(row => row.name.startsWith('missing-')).length, 4);
  for (const command of report.commands) {
    assert.equal(command.signal, null); assert.equal(command.error, null);
    if (command.name.startsWith('missing-')) { assert.equal(command.status, 1); assert.match(command.stderr, /ERR_MODULE_NOT_FOUND/); }
    else if (command.name === 'source-filesystem-denied') { assert.equal(command.status, 1); assert.match(command.stderr, /ERR_ACCESS_DENIED/); }
    else if (command.name === 'private-source-export-denied') { assert.equal(command.status, 1); assert.match(command.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/); }
    else if (command.name === 'negative-types') assert.equal(command.status, 2);
    else assert.equal(command.status, 0);
  }
  assert.deepEqual(report.packageBefore, report.packageAfter);
  assert.equal(report.packageBefore.length, 738);
  assert.equal(report.gitInputs, 238); assert.equal(report.sourceBefore.length, 238);
  assert.equal(report.sourceUnchanged, true); assert.equal(report.ownedTemporaryRemoved, true);
  assert.equal(report.package.sha256, '994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5');
  assert.equal(hash(readFileSync(join(raw, 'package/virtual-bash-0.0.0.tgz'))), report.package.sha256);
  assert.equal(report.manifestSha256, '691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535');
  for (const attempt of ['01', '02', '03']) {
    const failed = json(join(raw, `attempt-${attempt}/REPORT.json`));
    assert.equal(failed.status, 'failed'); assert.equal(failed.ownedTemporaryRemoved, true);
    if (failed.package) assert.equal(failed.package.sha256, report.package.sha256);
    const phase = json(join(raw, `attempt-${attempt}/${attempt === '02' ? 'registry-tests' : 'public-runtime-1'}.json`));
    assert.equal(phase.status, 1);
    const expected = attempt === '01' ? [16, 12, 4] : attempt === '02' ? [63, 61, 2] : [17, 14, 3];
    for (const [index, label] of ['tests', 'pass', 'fail'].entries()) assert.match(phase.stdout, new RegExp(`^# ${label} ${expected[index]}$`, 'm'));
  }
  console.log(JSON.stringify({ status: 'capture-verified', candidate: report.candidate, files: actual.length, package: report.package.sha256, registry: '63/63', public: '17/17 twice', historicalFailedAttempts: 3, productExecutions: 0 }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
