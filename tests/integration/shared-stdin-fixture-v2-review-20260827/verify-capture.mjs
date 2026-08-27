import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const capture = json(join(here, 'CAPTURE.json'));
const manifest = json(join(here, 'RAW-MANIFEST.json'));
const scratch = mkdtempSync(join(tmpdir(), 'shared-stdin-v2-capture-review-'));
try {
  const payload = Buffer.from(readFileSync(join(here, 'raw-capture.tar.gz.b64'), 'utf8'), 'base64');
  assert.equal(hash(payload), capture.sha256);
  assert.equal(payload.length, capture.bytes);
  const archive = join(scratch, 'capture.tar.gz');
  writeFileSync(archive, payload);
  const entries = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(entries.every(entry => !entry.startsWith('/') && !entry.split('/').includes('..')));
  const directory = join(scratch, 'capture');
  mkdirSync(directory);
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', directory]);
  const actual = [];
  function walk(root, prefix = '') {
    for (const name of readdirSync(root).sort()) {
      const path = join(root, name), local = prefix ? prefix + '/' + name : name;
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(path, local);
      else {
        assert.equal(stat.isFile(), true);
        const bytes = readFileSync(path);
        actual.push({ path: local, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  walk(directory);
  assert.deepEqual(actual, manifest.files);
  assert.equal(actual.length, capture.files);
  const read = path => json(join(directory, path));
  const summary = read('replay/summary.json');
  const authentication = read('replay/authentication.json');
  const integrity = read('replay/integrity-after.json');
  const negative = read('negative/RESULT.json');
  for (const candidate of [summary.candidate, authentication.candidate, negative.candidate, manifest.candidate]) assert.equal(candidate, capture.candidate);
  assert.equal(capture.candidate, 'f8819e9d6b6d535b0626e0aa004bb10a7bc36785');
  assert.equal(summary.fixtureCommit, '8e5fec07ec9a39582987736269bbed51caeb795e');
  assert.deepEqual([summary.mainPasses, summary.mainCount, summary.columnPasses, summary.columnCount], [35, 35, 6, 6]);
  assert.deepEqual([summary.negativeAssertionExecutions, summary.negativeAssertionRows, summary.negativeAssertionExecutionsDetected], [3, 8, 3]);
  assert.equal(summary.childrenClosed, true);
  assert.equal(summary.activeOwnedChildren, 0);
  assert.equal(summary.watchdogExpiries, 0);
  const commands = read('replay/commands.json');
  assert.equal(commands.length, 39);
  assert.ok(commands.every(command => command.closed && !command.expired && !command.overLimit && command.signal === null));
  assert.equal(commands.filter(command => command.status === 0).length, 36);
  assert.equal(commands.filter(command => command.status === 1).length, 3);
  assert.deepEqual(integrity.priorAfter, authentication.priorBefore);
  assert.equal(integrity.fullEntryInventoryEqual, true);
  assert.equal(integrity.fixtureFilesUnchanged, true);
  assert.equal(integrity.consumerEntryCount, 786);
  assert.equal(authentication.priorBefore.packageSha256, '62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6');
  assert.equal(authentication.priorBefore.loadedInputJsSha256, 'f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a');
  assert.deepEqual(negative.failures, []);
  assert.equal(negative.status, 'independent-negative-controls-pass');
  assert.equal(negative.controls.length, 4);
  assert.ok(negative.controls.every(control => control.status === 'pass'));
  assert.equal(negative.controls.reduce((total, control) => total + control.detectedRows, 0), 11);
  assert.equal(negative.controls[3].unchangedPassingRows, 3);
  assert.equal(negative.commands.length, 4);
  assert.ok(negative.commands.every(command => command.status === 1 && command.signal === null));
  assert.equal(negative.loadedReceipts, 714);
  assert.equal(negative.sourceMutants, 0);
  assert.equal(negative.temporaryRemoved, true);
  assert.equal(negative.consumerBefore.length, 785);
  assert.deepEqual(negative.consumerBefore, negative.consumerAfter);
  const before = read('audit-before.json'), after = read('audit-after.json');
  assert.deepEqual(before, after);
  assert.equal(after.status, 'audit-pass');
  assert.equal(after.checks.length, 9);
  assert.equal(after.authenticated.length, 267);
  assert.deepEqual(after.changedCaseIds, ['shell-primary-read-zero', 'shell-primary-read-error']);
  assert.equal(read('cleanup.json').reviewScratchRemoved, true);
  console.log(JSON.stringify({ status: 'capture-verified', candidate: capture.candidate, files: actual.length, main: '35/35', column: '6/6', independentNegativeExecutions: 4, intendedAssertionFailures: 11, productExecutions: 0 }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
