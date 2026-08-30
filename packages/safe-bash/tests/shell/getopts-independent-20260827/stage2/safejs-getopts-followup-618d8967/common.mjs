import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = '/Users/kjopek/Workspace/safe-bash';
export const relativeOwn = path.relative(repo, own);
export const work = path.join(own, '.scratch');
export const root = path.join(work, 'run');
export const accepted = '2dcefd4f26588f6dc662148e3713e41b09537333';
export const candidate = '618d8967009117547ab476256bc6eb0a9463309a';
export const oldOwner = 'tests/integration/owned-output-production-rebase/author-public';
export const old = path.join(path.dirname(own), 'review-618d8967');
export const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const json = filename => JSON.parse(fs.readFileSync(filename));
export const git = (...args) => execFileSync('/usr/bin/git', ['-C', repo, '-c', 'core.fsmonitor=false', ...args], { env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
export function write(filename, bytes, mode = 0o644) {
  assert(path.resolve(filename).startsWith(own + '/'));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
}
export const save = (filename, value) => write(filename, JSON.stringify(value, null, 2) + '\n');
export function inventory(directory, exclude = () => false) {
  assert.equal(fs.realpathSync(directory), directory);
  const entries = [];
  function visit(prefix) {
    for (const name of fs.readdirSync(path.join(directory, prefix)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (exclude(relative)) continue;
      const filename = path.join(directory, relative);
      const stat = fs.lstatSync(filename);
      assert(!stat.isSymbolicLink());
      const entry = { path: relative, kind: stat.isDirectory() ? 'directory' : 'file', mode: stat.mode & 0o777 };
      if (stat.isDirectory()) { entries.push(entry); visit(relative); }
      else { assert(stat.isFile()); const bytes = fs.readFileSync(filename); entries.push({ ...entry, bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  visit('');
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}
export function oldBoundary() {
  const phase = 'tests/shell/getopts-independent-20260827';
  const excluded = path.relative(path.join(repo, phase), own);
  const actual = inventory(path.join(repo, phase), name => name === excluded || name.startsWith(excluded + '/'));
  const records = git('ls-tree', '-rz', accepted, '--', phase).toString().split('\0').filter(Boolean);
  const expectedPaths = new Set();
  for (const record of records) {
    const [header, full] = record.split('\t');
    const [mode, type, oid] = header.split(' ');
    assert.equal(type, 'blob');
    const relative = full.slice(phase.length + 1);
    const entry = actual.find(item => item.path === relative);
    assert(entry, full);
    const bytes = fs.readFileSync(path.join(repo, full));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), oid, full);
    assert.equal(entry.mode & 0o111 ? '100755' : '100644', mode);
    expectedPaths.add(relative);
    let parent = path.dirname(relative);
    while (parent !== '.') { expectedPaths.add(parent); parent = path.dirname(parent); }
  }
  assert.deepEqual(actual.map(entry => entry.path).sort(), [...expectedPaths].sort());
  return { accepted, files: records.length, entries: actual.length, inventorySHA256: hash(JSON.stringify(actual)), onlyAuthorizedExclusion: excluded, additionsChecked: true };
}
export function captures() {
  const evidence = path.join(old, 'evidence-v1');
  const manifest = json(path.join(evidence, 'MANIFEST.json'));
  for (const [name, entry] of Object.entries(manifest.files)) { const bytes = fs.readFileSync(path.join(evidence, name)); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256, name); }
  const compressed = Buffer.from(fs.readFileSync(path.join(evidence, 'RAW.json.gz.base64'), 'utf8').trim(), 'base64');
  assert.equal(hash(compressed), manifest.compressedSHA256);
  const raw = gunzipSync(compressed);
  assert.equal(hash(raw), manifest.rawSHA256);
  assert.equal(raw.length, manifest.rawBytes);
  const records = new Map();
  for (const entry of JSON.parse(raw).files) {
    const bytes = Buffer.from(entry.base64, 'base64');
    assert.equal(hash(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes); assert(!records.has(entry.path)); records.set(entry.path, bytes);
  }
  assert.equal(records.size, manifest.rawCaptureFiles);
  return { manifest, records, binding: JSON.parse(records.get('BINDING.json')), publicBinding: JSON.parse(records.get('safejs/safejs-execution-v1/PUBLIC-BINDING.json')) };
}
export function protectedLive() {
  const baseline = JSON.parse(git('show', 'cb94b17d0eefc62e2a51f5a6f7cf46ebbcad2faf:tests/shell/getopts/runtime/baseline.json'));
  for (const [filename, expected] of Object.entries(baseline.protectedPaths)) assert.equal(hash(git('show', `${candidate}:${filename}`)), expected, filename);
  const liveHashes = Object.fromEntries(Object.keys(baseline.protectedPaths).map(filename => [filename, hash(fs.readFileSync(path.join(repo, filename)))]));
  for (const filename of ['src/shell/runtime.ts', 'src/shell/shell.ts']) assert.deepEqual(fs.readFileSync(path.join(repo, filename)), git('show', `${candidate}:${filename}`));
  return { protectedPaths: Object.keys(baseline.protectedPaths).length, sourcePaths: 2, currentLiveHashInventorySHA256: hash(JSON.stringify(liveHashes)), candidateProtectedHashesMatchBaseline: true, wholeLiveTreeClaim: false };
}
export function privateShape() {
  const directory = '/Users/kjopek/Workspace/poe-code/packages/safejs';
  const excluded = new Set(['.git', 'node_modules', 'dist', '.cache', '.turbo']);
  return inventory(directory, name => name.split('/').some(part => excluded.has(part))).map(({ path: filename, kind }) => ({ path: filename, kind }));
}
export const frozenFiles = ['PROTOCOL.md', 'G1.guest.txt', 'G2.guest.txt', 'witness-loader.mjs', 'child.mjs', 'common.mjs', 'prepare.mjs', 'run.mjs', 'finish.mjs', 'verify.mjs'];
export const immutable = () => inventory(work, name => ['run/logs', 'run/tmp', 'run/home'].some(prefix => name === prefix || name.startsWith(prefix + '/')));
export function verifyFreeze(commit) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(fs.readFileSync(path.join(own, 'FREEZE.json')), git('show', `${commit}:${relativeOwn}/FREEZE.json`));
  const freeze = json(path.join(own, 'FREEZE.json'));
  assert.deepEqual(Object.keys(freeze.inputs).sort(), [...frozenFiles].sort());
  for (const [name, digest] of Object.entries(freeze.inputs)) {
    const bytes = fs.readFileSync(path.join(own, name));
    assert.equal(hash(bytes), digest, name);
    assert.deepEqual(bytes, git('show', `${commit}:${relativeOwn}/${name}`));
  }
  return freeze;
}
