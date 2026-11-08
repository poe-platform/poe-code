import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson(join(here, 'MANIFEST.json'));
const validation = readJson(join(here, 'VALIDATION.json'));
const body = readFileSync(join(here, manifest.commitBody.file));
assert.equal(body.length, 604);
assert.equal(body.length, manifest.commitBody.bytes);
assert.equal(digest(body), manifest.commitBody.sha256);
assert.equal(createHash('sha1').update(Buffer.from(`commit ${body.length}\0`)).update(body).digest('hex'), manifest.candidate);
assert.equal(manifest.bindings.length, 14);
assert.equal(new Set(manifest.bindings.map(row => row.path)).size, 14);
assert.equal(validation.candidate, manifest.candidate);
assert.equal(validation.tree, manifest.tree);
assert.equal(validation.packSha256, manifest.acceptedPackSha256);
for (const input of validation.executedInputs) assert.equal(digest(readFileSync(join(here, input.path))), input.sha256, input.path);
const bytes = Buffer.from(readFileSync(join(here, validation.archive.file), 'utf8'), 'base64');
assert.equal(bytes.length, validation.archive.bytes);
assert.equal(digest(bytes), validation.archive.sha256);
const temporary = mkdtempSync(join(tmpdir(), 'candidate-provenance-evidence-'));
try {
  const archive = join(temporary, 'validation.tar.gz');
  writeFileSync(archive, bytes, { flag: 'wx' });
  const entries = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(entries.every(path => !path.startsWith('/') && !path.split('/').includes('..')));
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temporary]);
  const files = [];
  function inspect(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, path);
      if (stat.isDirectory()) inspect(path, `${prefix}${name}/`);
      else {
        assert.equal(stat.isFile(), true, path);
        files.push({ path: `${prefix}${name}`, bytes: stat.size, sha256: digest(readFileSync(path)) });
      }
    }
  }
  inspect(join(temporary, 'records'));
  assert.deepEqual(files, validation.files);
  for (const name of ['attempt-01', 'attempt-02']) {
    const report = readJson(join(temporary, 'records', name, 'REPORT.json'));
    assert.match(report.status, /^PASS reconstructed exact commit/);
    assert.equal(report.isolation.candidateAbsentBefore, true);
    for (const flag of ['alternates', 'httpAlternates', 'shallow', 'hardlinks']) assert.equal(report.isolation[flag], false);
    assert.equal(report.reconstruction.candidatePresentAfter, true);
    assert.equal(report.reconstruction.candidate, manifest.candidate);
    assert.equal(report.reconstruction.tree, manifest.tree);
    assert.equal(report.reconstruction.parent, manifest.parent);
    assert.equal(report.reconstruction.body.sha256, manifest.commitBody.sha256);
    assert.deepEqual(report.reconstruction.changed, manifest.bindings.map(binding => binding.path));
    assert.deepEqual(report.reconstruction.missingObjects, []);
    assert.deepEqual(report.reconstruction.refs, []);
    assert.equal(report.build.pack.sha256, manifest.acceptedPackSha256);
    assert.equal(report.build.pack.bytes, 648636);
    assert.equal(report.build.entries, 738);
    assert.equal(report.build.sourceArchive.sha256, manifest.sourceArchiveSha256);
    assert.equal(report.build.sourceUnchanged, true);
    assert.equal(report.tools.node.sha256, manifest.toolchain.nodeSha256);
    assert.equal(report.capture.files, 122);
    assert.equal(report.capture.archive.sha256, manifest.capture.sha256);
    const step = name => {
      const matches = report.steps.filter(row => row.name === name);
      assert.equal(matches.length, 1, name);
      return matches[0];
    };
    assert.equal(step('candidate-absent-before').status, 128);
    assert.match(step('candidate-absent-before').stderr, /Not a valid object name/);
    assert.equal(step('candidate-present-after').status, 0);
    assert.equal(step('write-reconstructed-tree').stdout.trim(), manifest.tree);
    assert.equal(step('write-exact-commit-body').stdout.trim(), manifest.candidate);
    assert.equal(step('write-exact-commit-body').input, body.toString('utf8'));
    assert.equal(step('export-reachable-only').input, `${manifest.reachableAnchor}\n`);
    assert.equal(step('npm-version').stdout.trim(), manifest.toolchain.npmVersion);
    assert.equal(step('compiler-version').stdout.trim(), `Version ${manifest.toolchain.typescriptVersion}`);
    assert.equal(step('install-pinned-lock').status, 0);
    assert.equal(step('complete-reconstructed-integrity').status, 0);
    assert.equal(report.relocation.edits.length, 3);
    assert.equal(report.relocation.reverseEditsRestoreOriginalBytes, true);
    assert.equal(report.relocation.consumersExecuted, false);
    assert.equal(report.relocation.frozenFilesUnchanged, 11);
    for (const [index, binding] of manifest.bindings.entries()) {
      assert.equal(step(`binding-${index}-source`).stdout.trimEnd(), `${binding.mode} blob ${binding.blob}\t${binding.path}`);
      assert.equal(step(`binding-${index}-bytes`).stdoutFile.sha256, binding.sha256);
    }
  }
  assert.equal(readFileSync(join(temporary, 'records/attempt-02/exit.txt'), 'utf8'), '0\n');
  for (const name of ['corrupt-body', 'incorrect-source-binding', 'missing-reachable-anchor', 'reject-existing-output']) {
    const control = readJson(join(temporary, 'records/controls', `${name}.json`));
    assert.equal(control.status, 1, name);
    assert.equal(control.signal, null, name);
  }
  const preservation = readJson(join(temporary, 'records/preservation.json'));
  assert.equal(preservation.files.length, 17);
  assert.ok(preservation.files.every(file => file.unchanged));
  assert.equal(preservation.frozenFiles, 11);
  assert.equal(preservation.reviewFiles, 6);
  console.log(JSON.stringify({ status: 'PASS provenance capture authentication only', files: files.length, bodyBytes: body.length, candidate: manifest.candidate, tree: manifest.tree, exactPack: manifest.acceptedPackSha256, exactBuilds: 2, failureControls: 4, preservedFiles: 17, productExecutions: 0, originalFrozenAdmission: 'REJECTED, unchanged' }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
