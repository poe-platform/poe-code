import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), repository = resolve(own, '../../..');
const baseRelative = 'tests/integration/html-public-independent-20260827/admission-v2';
const base = join(repository, baseRelative);
const before = JSON.parse(readFileSync(join(own, 'PRE.json')));
const frozen = JSON.parse(readFileSync(join(own, 'EXECUTION-FREEZE.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = { PATH: '/usr/bin:/bin', HOME: own, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' };
function identity(filename) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile(), filename);
  const buffer = Buffer.alloc(65536), sha256 = createHash('sha256'), blob = createHash('sha1').update(`blob ${stat.size}\0`);
  const descriptor = openSync(filename, 'r');
  try { let count; while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) { sha256.update(buffer.subarray(0, count)); blob.update(buffer.subarray(0, count)); } }
  finally { closeSync(descriptor); }
  return { sha256: sha256.digest('hex'), blob: blob.digest('hex'), bytes: stat.size, mode: stat.mode & 0o111 ? '100755' : '100644' };
}
function files(directory, prefix = '') {
  const result = {};
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name, absolute = join(directory, path), stat = lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), absolute);
    if (stat.isDirectory()) Object.assign(result, files(directory, path));
    else result[path] = identity(absolute);
  }
  return result;
}
function git(args) {
  const result = spawnSync('/usr/bin/git', ['--no-replace-objects', '-C', repository, ...args], { env, maxBuffer: 16 * 1024 ** 2, timeout: 180000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr?.toString()); assert.equal(result.signal, null);
  return result.stdout;
}
function projectedIndex(commit) {
  const rows = git(['ls-tree', '-rz', commit]).toString().split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t'), [mode, type, blob] = record.slice(0, tab).split(' '), path = record.slice(tab + 1);
    assert.equal(type, 'blob');
    return { path, line: `${mode} ${blob} 0\t${path}\0` };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return { sha256: hash(rows.map(row => row.line).join('')), entries: rows.length };
}
function json(name, data) { writeFileSync(join(own, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' }); }
const preHead = '9cccda89e185b80f31d011797b97a27c47a691ff';
const currentHead = git(['rev-parse', 'HEAD']).toString().trim();
const preProjection = projectedIndex(preHead), currentProjection = projectedIndex(currentHead);
assert.equal(preProjection.sha256, before.indexSha256);
const index = git(['ls-files', '--stage', '-z']), cached = git(['diff', '--cached', '--binary']);
const stagedPaths = git(['diff', '--cached', '--name-only', '-z']).toString().split('\0').filter(Boolean);
const changed = git(['diff', '--name-only', '-z', preHead, currentHead]).toString().split('\0').filter(Boolean);
const protectedPaths = new Set([...Object.keys(before.fixtures), ...Object.keys(before.duProof), ...Object.keys(before.sealed).map(path => `${baseRelative}/${path}`)]);
assert.ok(changed.every(path => !protectedPaths.has(path)));
assert.ok(stagedPaths.every(path => !protectedPaths.has(path)));
const immutable = {};
immutable.sealed = files(base);
assert.deepEqual(immutable.sealed, before.sealed);
for (const group of ['fixtures', 'duProof']) {
  immutable[group] = {};
  for (const [path, expected] of Object.entries(before[group])) {
    immutable[group][path] = identity(join(repository, path));
    assert.deepEqual(immutable[group][path], expected, path);
  }
}
immutable.tools = {};
for (const [name, expected] of Object.entries(before.tools)) {
  if (expected.files !== undefined) {
    const inventory = Object.fromEntries(Object.entries(files(expected.path)).map(([path, entry]) => [path, entry.sha256]));
    assert.deepEqual(inventory, expected.inventory);
    immutable.tools[name] = { path: expected.path, sha256: hash(JSON.stringify(inventory)), files: Object.keys(inventory).length };
  } else { assert.equal(identity(expected.path).sha256, expected.sha256); immutable.tools[name] = { path: expected.path, sha256: expected.sha256 }; }
}
for (const [name, expected] of Object.entries(frozen.helpers)) assert.equal(identity(join(own, name)).sha256, expected);
for (const tool of Object.values(frozen.tools)) assert.equal(identity(tool.resolved).sha256, tool.sha256);
const reconciliation = { at: new Date().toISOString(), preHead, currentHead, preProjection, currentProjection, actualIndexSha256: hash(index), currentIndexMatchesObservedHead: hash(index) === currentProjection.sha256, cachedDiffBytes: cached.length, cachedDiffSha256: hash(cached), stagedPaths, changedPaths: changed, protectedPathsChanged: [], immutable, originalPostFailure: 'POST-AUTH-FAILURE.json: whole-index equality failed after unrelated concurrent commits; original failure preserved. This is reconciliation, not an unchanged-index claim.', policy: 'Unrelated live edits/commits neither enter nor veto immutable archive inputs. No reset, stash, foreign staging change or source overlay.', actual34: 0 };
json('POST-RECONCILIATION.json', reconciliation);
const args = ['--no-replace-objects', '-C', repository, 'archive', '--format=tar', before.candidate];
json('POST-ARCHIVE-RECONCILED-PRE.json', { at: new Date().toISOString(), executable: '/usr/bin/git', executableIdentity: identity('/usr/bin/git'), helperIdentity: identity(fileURLToPath(import.meta.url)), args, env, maxBytes: 3 * 1024 ** 3, expectedBytes: 2340945920, expectedSha256: before.expected.archive, timeoutMs: 180000, purpose: 'Required immutable post-archive stream only; no control retry/materialization/compiler/npm/runtime.' });
const child = spawn('/usr/bin/git', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = new Promise(resolveResult => child.on('close', (code, signal) => resolveResult({ code, signal })));
let error, streamError, timedOut = false, bytes = 0, chunks = 0, maxChunkBytes = 0, stderr = '';
child.on('error', caught => { error = caught.message; });
child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 65536) { error = 'stderr overflow'; child.kill('SIGKILL'); } });
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 180000);
const digest = createHash('sha256');
try {
  for await (const chunk of child.stdout) {
    bytes += chunk.length; chunks++; maxChunkBytes = Math.max(maxChunkBytes, chunk.length);
    assert.ok(bytes <= 3 * 1024 ** 3); assert.ok(chunk.length <= 1024 ** 2); digest.update(chunk);
  }
} catch (caught) { streamError = caught.message; child.kill('SIGKILL'); }
const result = { ...await closed, bytes, chunks, maxChunkBytes, stderr, error, streamError, timedOut, sha256: digest.digest('hex'), closeObserved: true };
clearTimeout(timer);
json('POST-ARCHIVE-RECONCILED-RAW.json', result);
assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(error, undefined); assert.equal(streamError, undefined); assert.equal(timedOut, false);
assert.equal(bytes, 2340945920); assert.equal(result.sha256, before.expected.archive);
json('POST-COMPLETE.json', { at: new Date().toISOString(), immutableFiles: Object.keys(before.sealed).length, originalFixtures: Object.keys(before.fixtures).length, du75FrozenFiles: Object.keys(before.duProof).length, helperAndToolsUnchanged: true, indexUnchanged: false, concurrentIndexChangesReconciled: true, archive: result, actual34: 0 });
console.log(JSON.stringify({ immutableFiles: Object.keys(before.sealed).length, preHead, currentHead, changedPaths: changed.length, protectedPathsChanged: 0, archive: result, actual34: 0 }));
