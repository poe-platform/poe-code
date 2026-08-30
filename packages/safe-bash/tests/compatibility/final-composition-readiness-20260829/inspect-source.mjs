import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
const [repoArgument, ownArgument] = process.argv.slice(2);
assert(process.argv.length === 4);
const repo = fs.realpathSync(repoArgument), own = fs.realpathSync(ownArgument);
assert(own === path.join(repo, 'tests/compatibility/final-composition-readiness-20260829'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
function read(filename) { const before = fs.lstatSync(filename); assert(before.isFile() && before.size <= 16777216); const bytes = fs.readFileSync(filename), after = fs.lstatSync(filename); assert.equal(before.ino, after.ino); assert.equal(before.mtimeMs, after.mtimeMs); assert.equal(bytes.length, before.size); return bytes; }
function json(name, value) { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert(bytes.length <= 16777216); fs.writeFileSync(path.join(own, name), bytes, { flag: 'wx' }); }
const receipts = [];
function git(id, args) {
  const stdout = fs.openSync(path.join(own, id + '.stdout'), 'wx'), stderr = fs.openSync(path.join(own, id + '.stderr'), 'wx');
  const result = spawnSync('/usr/bin/git', args, { cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: repo, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', stdout, stderr], timeout: 60000 });
  fs.closeSync(stdout); fs.closeSync(stderr); receipts.push({ id, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null }); assert.equal(result.status, 0); return read(path.join(own, id + '.stdout'));
}
const trackedRaw = git('tracked-source', ['ls-files', '--stage', '-z', '--', 'src', 'package.json', 'README.md', 'tsconfig*.json', 'types', 'scripts', 'build']);
const tracked = trackedRaw.toString('utf8').split('\0').filter(Boolean).map(record => { const match = record.match(/^(\d+) ([a-f0-9]{40}) (\d)\t([\s\S]+)$/); assert(match && match[3] === '0'); const filename = match[4], absolute = path.join(repo, filename); if (!fs.existsSync(absolute)) return { path: filename, indexBlob: match[2], missing: true }; const bytes = read(absolute); return { path: filename, mode: match[1], indexBlob: match[2], workingBlob: blob(bytes), size: bytes.length, sha256: sha(bytes), differsFromIndex: match[2] !== blob(bytes) }; });
json('CURRENT-TRACKED.json', { at: new Date().toISOString(), pathDomain: 'UTF-8 repository-relative paths; full-path unsigned UTF-8 byte order', rows: tracked.sort((left, right) => order(left.path, right.path)), count: tracked.length, canonicalRowsSha256: sha(Buffer.from(JSON.stringify(tracked))) });
const evidenceRoots = ['tests/integration/node-public-author-20260829', 'tests/integration/node-public-independent-20260829', 'tests/compatibility/bash-function-keyword-author-20260829', 'tests/compatibility/bash-function-keyword-k08-actual-independent-20260829', 'tests/compatibility/bash-pipestatus-typed-native-reference-20260829', 'tests/compatibility/bash-pipestatus-typed-native-independent-20260829', 'tests/compatibility/bash-ere-core-public-pilot-preparation-20260829', 'tests/compatibility/bash-ere-core-producer-independent-20260829'];
const evidencePaths = git('evidence-paths', ['ls-files', '-z', '--', ...evidenceRoots]).toString('utf8').split('\0').filter(Boolean);
const metadataNames = evidencePaths.filter(filename => /(?:SOURCE[^/]*|[^/]*SEAL|[^/]*MANIFEST|REPORT|HANDOFF|RECEIPT)\.(?:json|md)$/i.test(path.basename(filename)) && !/(?:\/raw\/|\/layouts\/|\/source\/|\/captures\/)/.test(filename));
const metadata = [], baselineCandidates = [];
for (const filename of metadataNames) {
  const bytes = read(path.join(repo, filename)), text = bytes.toString('utf8');
  if (text.includes('3adc676a')) { metadata.push({ path: filename, size: bytes.length, sha256: sha(bytes), matchedBaseline: true }); if (filename.endsWith('.json')) { const value = JSON.parse(text); const find = (item, pointer) => { if (Array.isArray(item)) { if (item.length === 309 && item.every(row => row && typeof row.path === 'string' && (row.blob || row.sha256))) baselineCandidates.push({ path: filename, pointer, rows: item, document: value }); else for (let index = 0; index < item.length; index++) if (typeof item[index] === 'object') find(item[index], pointer + '/' + index); } else if (item && typeof item === 'object') for (const [key, entry] of Object.entries(item)) find(entry, pointer + '/' + key); }; find(value, ''); } }
}
json('PUBLIC-BASELINE-DISCOVERY.json', { metadataFilesRead: metadataNames.length, matches: metadata, candidates: baselineCandidates.map(item => ({ path: item.path, pointer: item.pointer, count: item.rows.length, first: item.rows[0], documentKeys: Object.keys(item.document) })), evidencePaths });
const stdoutFd = fs.openSync(path.join(own, 'objects.stdout'), 'wx'), stderrFd = fs.openSync(path.join(own, 'objects.stderr'), 'wx');
const child = spawn('/usr/bin/git', ['cat-file', '--batch'], { cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: repo, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
let pending = Buffer.alloc(0), waiter, captureBytes = 0, exit, close, stdoutEOF = false, stderrEOF = false;
const closed = new Promise(resolve => { child.once('exit', (code, signal) => { exit = { code, signal }; }); child.once('close', (code, signal) => { close = { code, signal }; resolve(); }); });
function accept(descriptor, bytes) { captureBytes += bytes.length; assert(captureBytes <= 25165824); let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } }
child.stdout.on('data', bytes => { accept(stdoutFd, bytes); pending = Buffer.concat([pending, bytes]); waiter?.(); }); child.stderr.on('data', bytes => accept(stderrFd, bytes)); child.stdout.on('end', () => { stdoutEOF = true; waiter?.(); }); child.stderr.on('end', () => { stderrEOF = true; });
const objectCache = new Map();
async function object(identity) {
  if (objectCache.has(identity)) return objectCache.get(identity);
  child.stdin.write(identity + '\n');
  while (true) {
    const end = pending.indexOf(10);
    if (end >= 0) {
      const header = pending.subarray(0, end).toString('utf8');
      if (header.endsWith(' missing')) { pending = pending.subarray(end + 1); return null; }
      const [oid, type, sizeText] = header.split(' '), size = Number(sizeText); assert(Number.isSafeInteger(size) && size <= 16777216);
      if (pending.length >= end + 1 + size + 1) { const bytes = Buffer.from(pending.subarray(end + 1, end + 1 + size)); pending = pending.subarray(end + 1 + size + 1); assert.equal(crypto.createHash('sha1').update(Buffer.from(type + ' ' + size + '\0')).update(bytes).digest('hex'), oid); const result = { oid, type, bytes }; objectCache.set(identity, result); objectCache.set(oid, result); return result; }
    }
    assert(!stdoutEOF); await new Promise(resolve => { waiter = resolve; }); waiter = null;
  }
}
const treeCache = new Map();
async function tree(identity, prefix = '') {
  const key = identity + ':' + prefix; if (treeCache.has(key)) return treeCache.get(key);
  const value = await object(identity); assert.equal(value.type, 'tree'); const rows = []; let offset = 0;
  while (offset < value.bytes.length) { const blank = value.bytes.indexOf(32, offset), nul = value.bytes.indexOf(0, blank), mode = value.bytes.subarray(offset, blank).toString(), name = value.bytes.subarray(blank + 1, nul).toString(), oid = value.bytes.subarray(nul + 1, nul + 21).toString('hex'); offset = nul + 21; const filename = prefix + name;
    if (!prefix && !['src', 'package.json', 'README.md', 'types', 'scripts', 'build'].includes(name) && !/^tsconfig.*\.json$/.test(name)) continue;
    if (mode === '40000') rows.push(...await tree(oid, filename + '/')); else rows.push({ path: filename, mode, blob: oid });
  }
  treeCache.set(key, rows); return rows;
}
const revisions = [['ere-core', 'e013f817'], ['ere-engine', '72187e5'], ['ere-transport', '46611'], ['transport-repair', '4abbdeec'], ['function-keyword', '52b6711e'], ['positional-arithmetic', 'ffac894a'], ['pipestatus', '73d9e74d'], ['pipestatus-correction', '43050e86'], ['ere-producer-independent-data', '5c2ef079']];
const featureDeltas = [], acceptedFiles = new Map(), currentByPath = new Map(tracked.map(row => [row.path, row]));
for (const [feature, identity] of revisions) {
  const commit = await object(identity); assert(commit && commit.type === 'commit'); const text = commit.bytes.toString(); const treeId = text.match(/^tree ([a-f0-9]{40})/m)[1], parentId = text.match(/^parent ([a-f0-9]{40})/m)?.[1]; const parentCommit = parentId ? await object(parentId) : null;
  const after = await tree(treeId), before = parentCommit ? await tree(parentCommit.bytes.toString().match(/^tree ([a-f0-9]{40})/m)[1]) : [];
  const beforeMap = new Map(before.map(row => [row.path, row])), afterMap = new Map(after.map(row => [row.path, row])); const changed = [];
  for (const filename of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort(order)) {
    const old = beforeMap.get(filename), next = afterMap.get(filename); if (old?.blob === next?.blob && old?.mode === next?.mode) continue;
    const original = old ? await object(old.blob) : null, selected = next ? await object(next.blob) : null, current = currentByPath.get(filename);
    const item = { path: filename, feature, commit: commit.oid, parent: parentId, before: old ? { ...old, size: original.bytes.length, sha256: sha(original.bytes) } : null, after: next ? { ...next, size: selected.bytes.length, sha256: sha(selected.bytes) } : null, working: current ?? null, status: !current || current.missing ? 'MISSING_WORKING' : current.workingBlob === next?.blob ? 'EXACT_ACCEPTED_VERSION' : current.workingBlob === old?.blob ? 'ACCEPTED_DELTA_ABSENT_PARENT_BYTES' : 'DIFFERS_REQUIRES_HUNK_REVIEW' };
    changed.push(item); if (filename.startsWith('src/') || filename === 'package.json') { const values = acceptedFiles.get(filename) ?? []; values.push(item); acceptedFiles.set(filename, values); }
    const stem = feature + '--' + filename.replaceAll('/', '__'); if (original) fs.writeFileSync(path.join(own, stem + '.before.txt'), original.bytes); if (selected) fs.writeFileSync(path.join(own, stem + '.after.txt'), selected.bytes); if (current && !current.missing) fs.writeFileSync(path.join(own, stem + '.working.txt'), read(path.join(repo, filename)));
  }
  featureDeltas.push({ feature, commit: commit.oid, parent: parentId, subject: text.split('\n\n')[1]?.trim(), changed });
}
let publicBaseline = null;
if (baselineCandidates.length) {
  const candidate = baselineCandidates.find(item => item.rows.every(row => row.blob)) ?? baselineCandidates[0];
  const rows = [];
  for (const source of candidate.rows) { const value = source.blob ? await object(source.blob) : null; if (value) { assert.equal(value.type, 'blob'); if (source.sha256) assert.equal(sha(value.bytes), source.sha256); } const current = currentByPath.get(source.path); rows.push({ ...source, working: current ?? null, status: !current || current.missing ? 'MISSING_WORKING' : current.workingBlob === source.blob || current.sha256 === source.sha256 ? 'EXACT_PUBLIC_BASELINE' : 'DIFFERS_FROM_PUBLIC_BASELINE' }); if (value && current && current.workingBlob !== source.blob && (source.path === 'package.json' || source.path.startsWith('src/'))) { const stem = 'public-baseline--' + source.path.replaceAll('/', '__'); fs.writeFileSync(path.join(own, stem + '.before.txt'), value.bytes); fs.writeFileSync(path.join(own, stem + '.working.txt'), read(path.join(repo, source.path))); } }
  publicBaseline = { source: candidate.path, pointer: candidate.pointer, count: rows.length, documentKeys: Object.keys(candidate.document), rows }; json('PUBLIC-BASELINE.json', publicBaseline);
}
child.stdin.end(); await closed; fs.closeSync(stdoutFd); fs.closeSync(stderrFd); assert.equal(close.code, 0); assert(stdoutEOF && stderrEOF); receipts.push({ id: 'objects', pid: child.pid, exit, close, stdoutEOF, stderrEOF, captureBytes, uniqueObjects: new Set([...objectCache.values()].map(value => value.oid)).size });
const unionPaths = new Set([...(publicBaseline?.rows.map(row => row.path) ?? []), ...acceptedFiles.keys()]);
const union = [...unionPaths].sort(order).map(filename => ({ path: filename, publicBaseline: publicBaseline?.rows.find(row => row.path === filename) ?? null, acceptedOrigins: acceptedFiles.get(filename) ?? [], working: currentByPath.get(filename) ?? null }));
json('FEATURE-DELTAS.json', featureDeltas); json('SOURCE-UNION.json', { selectedBaselineAvailable: !!publicBaseline, count: union.length, pathDomain: 'UTF-8 repository-relative, full-path byte ordering', canonicalRowsSha256: sha(Buffer.from(JSON.stringify(union))), rows: union, trackedExtras: tracked.filter(row => !unionPaths.has(row.path)) }); json('PROCESS-RECEIPTS.json', receipts);
console.log(JSON.stringify({ tracked: tracked.length, dirtyTracked: tracked.filter(row => row.differsFromIndex).map(row => row.path), publicBaseline: publicBaseline && { source: publicBaseline.source, count: publicBaseline.count, differences: publicBaseline.rows.filter(row => row.status !== 'EXACT_PUBLIC_BASELINE').map(row => ({ path: row.path, status: row.status })) }, baselineCandidates: baselineCandidates.map(item => ({ path: item.path, pointer: item.pointer })), featureDeltas: featureDeltas.map(item => ({ feature: item.feature, commit: item.commit, files: item.changed.map(row => ({ path: row.path, status: row.status })) })), unionCount: union.length, trackedExtras: tracked.filter(row => !unionPaths.has(row.path)).map(row => row.path), metadataMatches: metadata, childCount: receipts.length, captureBytes }));
