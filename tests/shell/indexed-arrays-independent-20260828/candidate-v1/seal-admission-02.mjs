import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { census, digest, tarInventory, verifyTree } from '../executor-v1/boundary.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const work = path.join(here, 'admission-hVrBBX');
const reportBytes = fs.readFileSync(path.join(work, 'ADMISSION.json'));
assert.equal(digest(reportBytes), 'dbfd2b0bbc628635fb78d87c754c0798f2662f546dc844cc05ed5d7ba1c0cd54');
const report = JSON.parse(reportBytes);
assert.equal(report.work, work); assert.equal(report.accepted, false);
assert.equal(report.commands.length, 2); assert.equal(report.types.length, 9);
for (const run of [...report.commands.map(row => row.run), ...report.types.map(row => row.run)]) {
  assert.ok(run.closeObserved && run.groupAbsent && !run.fault && !run.signal && !run.spawnError);
}
assert.ok(report.commands.every(row => row.run.code === 0));
assert.ok(report.types.every(row => row.run.code === 2 && !row.accepted));
assert.equal(report.productRuntimeImports, 0); assert.equal(report.nativeCalls, 0);
verifyTree(report.sourceTree);
for (const tree of report.typeTrees) verifyTree(tree);
const npm = JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'), 'utf8').trim(), 'base64')));
verifyTool(npm);
const selectedTree = 'd6c17f62d2d3062b5ab074044a86b8a455820373';
const selected = report.sourceProjection.map(({ mode, blob, path: filename }) => ({ mode, blob, path: filename })).sort((left, right) => left.path < right.path ? -1 : 1);
function computedTree(entries) {
  const directories = new Map(), members = [];
  for (const entry of entries) {
    const [name, ...remaining] = entry.path.split('/');
    if (!remaining.length) members.push({ name, mode: entry.mode, blob: entry.blob });
    else { if (!directories.has(name)) directories.set(name, []); directories.get(name).push({ ...entry, path: remaining.join('/') }); }
  }
  for (const [name, children] of directories) members.push({ name, mode: '40000', blob: computedTree(children) });
  members.sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
  const bytes = Buffer.concat(members.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.blob, 'hex')])));
  return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
}
const projectionOnlyTree = computedTree(selected);
assert.equal(projectionOnlyTree, 'f68883ccb7dec07d1f3f7827bee1f02c36c50d2e');
const baseline = JSON.parse(fs.readFileSync(path.join(here, '../executor-v1/BASELINE.json')));
const baseGitTree = '48e5ae39ce98e1c8e416bae77da40d88b75e1db5';
function composedTree(tree, prefix, overrides) {
  const members = new Map();
  if (tree) {
    const raw = execFileSync('/usr/bin/git', ['cat-file', 'tree', tree], { cwd: root, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(createHash('sha1').update(`tree ${raw.length}\0`).update(raw).digest('hex'), tree);
    for (let offset = 0; offset < raw.length;) {
      const space = raw.indexOf(32, offset), nul = raw.indexOf(0, space);
      assert.ok(space >= offset && nul > space && nul + 21 <= raw.length);
      const name = raw.subarray(space + 1, nul).toString();
      members.set(name, { name, mode: raw.subarray(offset, space).toString(), blob: raw.subarray(nul + 1, nul + 21).toString('hex') });
      offset = nul + 21;
    }
  }
  for (const key of overrides.keys()) if (key.startsWith(prefix)) {
    const tail = key.slice(prefix.length), name = tail.split('/')[0];
    if (!members.has(name)) members.set(name, { name, mode: tail.includes('/') ? '40000' : '100644' });
  }
  const entries = [...members.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
  const body = Buffer.concat(entries.map(entry => {
    const filename = prefix + entry.name;
    const descendants = [...overrides.keys()].some(key => key.startsWith(filename + '/'));
    const blob = overrides.get(filename) ?? (entry.mode === '40000' && descendants ? composedTree(entry.blob, filename + '/', overrides) : entry.blob);
    assert.match(blob, /^[a-f0-9]{40}$/u);
    return Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(blob, 'hex')]);
  }));
  return createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
}
assert.equal(composedTree(baseGitTree, '', new Map(baseline.source.map(entry => [entry.path, entry.blob]))), '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e');
assert.equal(composedTree(baseGitTree, '', new Map(selected.map(entry => [entry.path, entry.blob]))), selectedTree, 'accepted whole-tree metadata plus exact selected source overrides');
for (const entry of report.sourceProjection) {
  const bytes = execFileSync('/usr/bin/git', ['cat-file', 'blob', entry.blob], { cwd: root, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(digest(bytes), entry.sha256);
}
for (const name of ['boundary.mjs', 'types.mjs']) {
  const filename = `tests/shell/indexed-arrays-independent-20260828/executor-v1/${name}`;
  assert.equal(digest(execFileSync('/usr/bin/git', ['show', `fd422e68:${filename}`], { cwd: root, timeout: 10000 })), digest(fs.readFileSync(path.join(root, filename))), 'original regular guard/type validator byte unchanged');
}
const packed = fs.readFileSync(report.package.path);
assert.equal(digest(packed), '0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26');
assert.equal(Object.keys(tarInventory(packed)).length, 862);
const stage = { root: work, entries: census(work) };
const capsule = Buffer.from(JSON.stringify({ kind: 'array-independent-admission-attempt-02-preserved', sourcePreseal: '30ee5b1a', crossRealmPreexecutionCorrection: 'dd493fa1', selectedTree, projectionOnlyTree, compositionQualification: 'Whole-tree metadata identity, selected269 physical build inputs only; no whole Git archive or instruction bodies copied.', reportSha256: digest(reportBytes), reportBase64: reportBytes.toString('base64'), packageSha256: digest(packed), packageBase64: packed.toString('base64'), stage }));
const encoded = gzipSync(capsule, { level: 9 }).toString('base64') + '\n';
function put(filename, text) {
  assert.ok(!fs.existsSync(path.join(here, filename)), 'exclusive evidence');
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path.join(here, filename)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
}
put('ADMISSION-02.json.gz.base64', encoded);
const reread = gunzipSync(Buffer.from(fs.readFileSync(path.join(here, 'ADMISSION-02.json.gz.base64'), 'utf8').trim(), 'base64'));
assert.equal(digest(reread), digest(capsule));
verifyTree(stage); verifyTool(npm);
assert.equal(fs.realpathSync(work), work); assert.ok(fs.lstatSync(work).isDirectory());
fs.rmSync(work, { recursive: true }); assert.ok(!fs.existsSync(work));
const summary = { kind: 'preserved-admission-02-with-exact-owned-cleanup', selectedTree, sourceFiles: selected.length, reportSha256: digest(reportBytes), packageSha256: digest(packed), packageMembers: 862, capsuleEncodedSha256: digest(encoded), capsuleDecodedSha256: digest(capsule), bytes: { rawReport: reportBytes.length, rawCapsule: capsule.length, encodedCapsule: encoded.length }, toolControls: { total: 24, passed: 24 }, build: { code: 0 }, pack: { code: 0 }, types: { total: 9, accepted: 0, rejected: 9, allExitCode: 2, underlying: 'TS2307 resolution skipped real node_modules outside read roots' }, children: { total: 11, closeObserved: 11, groupsAbsent: 11, active: 0 }, productRuntimeImports: 0, nativeCalls: 0, originalRegularGuardsUnchanged: true, cleanup: { exactOwnedRoot: work, removedAfterCapsuleAndInventoryVerification: true }, accepted: false };
put('ADMISSION-02-SUMMARY.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
