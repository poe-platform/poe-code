import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const destination = path.join(own, 'results-v5');
fs.mkdirSync(destination);
const log = fs.openSync(path.join(destination, 'publication-events.jsonl'), 'wx');
const sha = data => createHash('sha256').update(data).digest('hex');
const note = value => fs.writeSync(log, JSON.stringify(value) + '\n');
function read(file, maximum = 16777216) {
  assert.ok(!file.split('/').includes('AGENTS.md'));
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  return fs.readFileSync(file);
}
const roots = { v4: '/tmp/strict-n14-v4-author-rD68Yv', v5: '/tmp/strict-n14-v5-author-w43M6U' };
const outers = { v4: '/tmp/strict-n14-v4-launch-dafouN', v5: '/tmp/strict-n14-v5-launch-wdOxjF', prep: '/tmp/strict-extension-v2-launch-PNbf8I' };
try {
  note({ pid: process.pid, parentPid: process.ppid, started: new Date().toISOString(), role: 'READONLY_DATA_PUBLICATION' });
  assert.deepEqual(process.argv.slice(2), ['--publish']);
  const resultBytes = read(path.join(roots.v5, 'RESULT.json'));
  const result = JSON.parse(resultBytes), old = JSON.parse(read(path.join(roots.v4, 'RESULT.json')));
  assert.equal(result.status, 'AUTHOR_SCOPED_PASS'); assert.equal(result.failures.length, 0);
  assert.equal(result.package.sha256, '3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49');
  assert.equal(result.package.members.length, 954);
  const sourceBytes = read(path.join(own, 'SOURCE.json')), source = JSON.parse(sourceBytes);
  assert.equal(sha(sourceBytes), '12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4');
  for (const row of source.inputs) {
    assert.ok(!path.isAbsolute(row.path) && !row.path.split('/').includes('..'));
    const bytes = read(path.join(roots.v5, 'source', row.path));
    assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
  }
  const movedRoot = path.join(roots.v5, 'moved package/node_modules/virtual-bash');
  for (const row of result.package.members) {
    assert.ok(!path.isAbsolute(row.path) && !row.path.split('/').includes('..'));
    const file = path.join(movedRoot, row.path), stat = fs.lstatSync(file), bytes = read(file);
    assert.equal(sha(bytes), row.sha256); assert.equal(stat.mode & 0o777, row.mode);
  }
  const main = result.cohorts.filter(row => !row.label.endsWith('-restored'));
  const restorations = result.cohorts.filter(row => row.label.endsWith('-restored'));
  const count = row => Array.isArray(row.cases) ? row.cases.length : row.cases;
  const mainCount = main.reduce((total, row) => total + count(row), 0);
  assert.equal(mainCount, 672); assert.ok(main.every(row => row.pass === count(row)));
  assert.equal(restorations.length, 7); assert.ok(restorations.every(row => row.pass === 1));
  assert.equal(result.types.length, 6); assert.ok(result.types.every(row => row.pass));
  assert.equal(result.controls.length, 9); assert.ok(result.controls.every(row => row.detected === true || row.pass === true));
  assert.ok(result.children.every(row => row.closed && row.signal === null && !row.alarm && !row.spawnError && !row.resourceClosureUnknown));
  const collected = [], serialized = {}; let bytes = 0;
  function retain(key, file) {
    const data = read(file); bytes += data.length; assert.ok(bytes <= 33554432);
    collected.push({ key, path: file, bytes: data.length, sha256: sha(data) });
    serialized[key] = data.toString('base64');
  }
  for (const [version, root] of Object.entries(roots)) {
    retain(version + '/RESULT.json', path.join(root, 'RESULT.json'));
    for (const name of fs.readdirSync(root).sort()) {
      if (name.endsWith('.stdout') || name.endsWith('.stderr') || name.endsWith('-loads.jsonl') || name.endsWith('-resources.jsonl') || name.endsWith('-cases.json')) retain(version + '/' + name, path.join(root, name));
    }
  }
  for (const [version, root] of Object.entries(outers)) for (const name of ['START.json', 'TERMINAL.json', 'stdout', 'stderr']) retain('outer-' + version + '/' + name, path.join(root, name));
  const prep = path.join(own, 'bootstrap-output-v5');
  for (const name of fs.readdirSync(prep).sort()) {
    if (name.endsWith('.jsonl') || name.endsWith('.stdout') || name.endsWith('.stderr')) retain('prep/' + name, path.join(prep, name));
  }
  const encoded = Buffer.from(JSON.stringify(serialized)), archive = gzipSync(encoded, { level: 9 });
  fs.writeFileSync(path.join(destination, 'RAW.json.gz'), archive, { flag: 'wx' });
  const summary = {
    role: 'AUTHOR_SCOPED_NOT_INDEPENDENT_ACCEPTANCE', sourceCommit: '7196bace8ea2c141d5ed1020fef5bf721c321ace',
    candidate: source.computedTree, sourceManifestSha256: sha(sourceBytes), sourceInputs: source.inputs.length,
    runtime: source.inputs.find(row => row.path === 'src/shell/runtime.ts'), packageSha256: result.package.sha256, packageMembers: 954,
    main: main.map(row => ({ label: row.label, cases: count(row), pass: row.pass })), mainCount,
    focused: main.filter(row => row.label.endsWith('-n14')).map(row => ({ label: row.label, cases: row.cases })),
    types: result.types.map(row => ({ label: row.label, negative: row.negative, pass: row.pass, errors: row.errors })),
    controls: result.controls, restores: restorations.map(row => ({ label: row.label, pass: row.pass })),
    priorVersion: { status: old.status, error: old.error, mainPass: old.cohorts.reduce((total, row) => total + row.pass, 0), typeGroups: old.types.length, packageSha256: old.package.sha256, cleanup: old.cleanup },
    currentCleanup: result.cleanup, previousVersionUsage: result.previousVersionUsage, captureBytesCumulative: result.captureBytes,
    actualScratchBytesCumulative: result.actualScratchBytes, currentElapsedMs: result.elapsedMs,
    postguards: { source: source.inputs.length, movedPackage: result.package.members.length },
    archive: { bytes: archive.length, sha256: sha(archive), decodedJsonBytes: encoded.length, originalCapturedBytes: bytes, entries: collected.length },
    processQualification: 'Direct child exit/close/resource observations only; loader reservations are not OS births; no full transitive PGID/kernel-drain claim. Administrative commands separate.',
    nativeRuns: 0, privateRuns: 0, engineRuns: 0, coherentCompositionRuns: 0,
  };
  fs.writeFileSync(path.join(destination, 'INDEX.json'), JSON.stringify(collected, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  note({ finished: new Date().toISOString(), mainCount, source: source.inputs.length, packageMembers: result.package.members.length, archive: summary.archive });
  console.log(JSON.stringify({ ...summary, focused: summary.focused.map(row => ({ label: row.label, cases: row.cases.length })), types: summary.types.map(row => ({ label: row.label, negative: row.negative, pass: row.pass, errors: row.errors.length })), runtime: summary.runtime }, null, 2));
} catch (error) { note({ error: String(error), stack: error?.stack }); console.error(error); process.exitCode = 1; }
finally { fs.closeSync(log); }
