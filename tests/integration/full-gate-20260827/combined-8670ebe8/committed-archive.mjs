import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join, posix } from 'node:path';
import { assessNative, digest } from '../preflight-repair/preflight.mjs';

const git = (repository, args, input) => execFileSync('git', ['--no-replace-objects', ...args], {
  cwd: repository, input, maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' },
});

export function assessCommittedRevision({ repository, candidate, profile, environment = process.env }) {
  const report = { mode: 'committed-archive', candidate, profileCandidate: profile.candidate,
    profileSha256: digest(JSON.stringify(profile)), scope: profile.scope, issues: [], suiteLaunched: false };
  if (!/^[a-f0-9]{40}$/u.test(candidate) || candidate !== profile.candidate || !/^[a-f0-9]{40}$/u.test(profile.candidateTree ?? '')) {
    report.issues.push({ kind: 'unreviewed-candidate', actual: candidate });
  } else {
    try {
      assert.equal(git(repository, ['rev-parse', '--verify', `${candidate}^{commit}`]).toString().trim(), candidate);
      report.tree = git(repository, ['rev-parse', `${candidate}^{tree}`]).toString().trim();
      assert.equal(report.tree, profile.candidateTree, 'Committed tree differs from frozen receipt');
      report.entries = git(repository, ['ls-tree', '-rzl', '--full-tree', candidate]).toString().split('\0').filter(Boolean).map(record => {
        const separator = record.indexOf('\t');
        const [mode, type, blob, size] = record.slice(0, separator).trim().split(/\s+/u);
        const path = record.slice(separator + 1);
        assert.equal(type, 'blob'); assert.ok(['100644', '100755', '120000'].includes(mode));
        assert.ok(path && !path.startsWith('/') && !path.split('/').some(part => !part || part === '..' || part === '.'));
        assert.ok(Number.isSafeInteger(Number(size)) && Number(size) >= 0, `Missing committed blob: ${path}`);
        return { path, mode, blob, bytes: Number(size) };
      });
      const tree = new Map(report.entries.map(entry => [entry.path, entry]));
      assert.equal(tree.size, report.entries.length);
      for (const input of profile.scopeInputs) {
        const actual = tree.get(input.path); assert.ok(actual, `Missing committed input: ${input.path}`);
        assert.equal(actual.blob, input.blob, `Committed input binding: ${input.path}`);
        assert.equal(actual.mode, input.mode, `Committed input mode: ${input.path}`);
      }
      const canonical = report.entries.map(entry => entry.path).filter(path => /^tests\/.*\.test\.ts$/u.test(path) && !path.startsWith('tests/commands/regex-execution/continuation/artifacts/native/')).sort();
      assert.deepEqual(canonical, profile.canonicalFiles, 'Canonical discovery differs from frozen policy');
      const blobs = [...new Set(report.entries.map(entry => entry.blob))];
      const available = git(repository, ['cat-file', '--batch-check'], blobs.join('\n') + '\n').toString().trim().split('\n');
      assert.equal(available.length, blobs.length);
      for (const [index, row] of available.entries()) assert.match(row, new RegExp(`^${blobs[index]} blob \\d+$`, 'u'), 'Missing committed blob object');
      report.availableBlobs = blobs.length;
      for (const binding of profile.historicalBindings) assert.equal(digest(git(repository, ['show', `${candidate}:${binding.path}`])), binding.expected, `Unresolved source binding: ${binding.path}`);
      assert.equal(profile.blockedWriters.length, 0, 'Candidate still has an unresolved artifact writer');
      report.canonicalFiles = canonical.length;
    } catch (error) { report.issues.push({ kind: 'committed-source-binding', message: error.message }); }
  }
  if (profile.platform !== process.platform || profile.arch !== process.arch) report.issues.push({ kind: 'native-host-profile', expected: `${profile.platform}/${profile.arch}`, actual: `${process.platform}/${process.arch}` });
  report.native = assessNative(profile.native, repository, environment);
  report.issues.push(...report.native.issues);
  report.environment = profile.environment;
  report.status = report.issues.length ? 'preflight-rejected-before-suite' : 'preflight-admitted-not-product-acceptance';
  report.workingTreePolicy = 'No working-tree product/test/configuration bytes read or overlaid. Git objects and separately pinned native assets only; existing live-worktree guard is unchanged.';
  return report;
}

export function verifyFreshCommittedArchive(directory, entries) {
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const files = [], directories = [];
  const walk = prefix => {
    for (const name of readdirSync(join(directory, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(join(directory, path));
      if (stat.isDirectory() && !stat.isSymbolicLink()) { directories.push(path); walk(path); }
      else files.push(path);
    }
  };
  walk('');
  assert.deepEqual(files.sort(), entries.map(entry => entry.path).sort(), 'Dirty archive: missing or extra input');
  const expectedDirectories = new Set();
  for (const entry of entries) {
    let parent = posix.dirname(entry.path);
    while (parent !== '.') { expectedDirectories.add(parent); parent = posix.dirname(parent); }
  }
  assert.deepEqual(directories.sort(), [...expectedDirectories].sort(), 'Dirty archive: extra directory');
  const manifest = {};
  for (const entry of entries) {
    const filename = join(directory, entry.path), stat = lstatSync(filename), symlink = entry.mode === '120000';
    assert.equal(stat.isSymbolicLink(), symlink, `Archive entry kind: ${entry.path}`);
    assert.ok(symlink || stat.isFile() && stat.nlink === 1, `Archive regular owned file required: ${entry.path}`);
    const bytes = symlink ? Buffer.from(readlinkSync(filename)) : readFileSync(filename);
    if (symlink) {
      const target = bytes.toString(), normalized = posix.normalize(posix.join(posix.dirname(entry.path), target));
      assert.ok(!posix.isAbsolute(target) && normalized !== '..' && !normalized.startsWith('../'), 'Archive link escapes owned root');
    } else assert.equal(stat.mode & 0o777, Number.parseInt(entry.mode.slice(-3), 8), `Archive mode: ${entry.path}`);
    assert.equal(bytes.length, entry.bytes, `Archive length: ${entry.path}`);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.blob, `Archive Git blob: ${entry.path}`);
    manifest[entry.path] = { blob: entry.blob, sha256: digest(bytes), bytes: bytes.length, mode: stat.mode & 0o777, symlink };
  }
  return { files: manifest, count: entries.length, source: 'fresh committed archive, exact path set and Git blob/mode verification; no working-tree overlay' };
}
