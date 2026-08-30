import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const capture = fs.mkdtempSync('/tmp/strict-extension-v2-tail-seal-');
const descriptor = fs.openSync(path.join(capture, 'events.jsonl'), 'wx');
const note = value => fs.writeSync(descriptor, JSON.stringify(value) + '\n');
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => { const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 16 * 1024 * 1024); return fs.readFileSync(file); };
try {
  note({ role: 'UNRUN_TAIL_DATA_PRESEAL', started: new Date().toISOString(), pid: process.pid, ppid: process.ppid, productExecutions: 0 });
  fs.appendFileSync('/tmp/strict-extension-v2-prep-VIBsVO/admin.jsonl', JSON.stringify({ action: 'seal-tail-v2', phase: 'ACTUAL_V2', pid: process.pid, ppid: process.ppid, started: new Date().toISOString(), capture }) + '\n');
  assert.deepEqual(process.argv.slice(2), ['--seal']);
  const oldExecutor = JSON.parse(read(path.join(own, 'EXECUTOR-v2.json'))), oldSeal = JSON.parse(read(path.join(own, 'PRESEAL-v2.json')));
  const previousRoot = '/tmp/strict-extension-v2-author-aHDK4G';
  const bytes = read(path.join(previousRoot, 'RESULT.json')), result = JSON.parse(bytes);
  assert.match(result.error, /35 !== 33/); assert.equal(result.children.length, 22);
  assert.ok(result.children.every(row => row.closed && !row.alarm && !row.spawnError && !row.resourceClosureUnknown && row.signal === null && row.code !== 78));
  assert.ok(result.cleanup.allClosed); assert.deepEqual(result.cleanup.signals, []);
  const outerBytes = read('/tmp/strict-extension-v2-launch-tg4IRZ/TERMINAL.json'), outer = JSON.parse(outerBytes);
  assert.equal(outer.code, 1); assert.equal(outer.signal, null); assert.equal(outer.closed, true); assert.deepEqual(outer.signals, []);
  assert.equal(sha(read(path.join(own, 'run-v2.mjs'))), '3f5fee4185efa6437136f02bcd3fa62ab654817ad067e4f7d5e0b5a8918e8765');
  const movedBytes = read(path.join(previousRoot, 'moved-extension.stdout'));
  const rows = movedBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 36); assert.equal(rows.at(-1).summary.cases, 35); assert.equal(rows.at(-1).summary.pass, 35);
  assert.ok(rows.slice(0, -1).every(row => row.pass && !row.cleanupFailure));
  assert.equal(result.package.sha256, oldSeal.expectedPackageSha256);
  assert.equal(sha(read(path.join(previousRoot, result.package.file))), oldSeal.expectedPackageSha256);
  const script = read(path.join(own, 'continue-v2.mjs')).toString();
  assert.ok(script.includes("await cohort('moved-arrays-tail'"));
  assert.ok(!script.includes("await child('production-build-once'"));
  assert.ok(!script.includes("await cohort('moved-extension'"));
  assert.ok(script.includes('seal.previous.directChildren'));
  for (const name of ['continue-v2.mjs', 'launch-v2-tail.mjs']) {
    const child = spawnSync(oldSeal.node.path, ['--check', path.join(own, name)], { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 });
    note({ action: 'syntax-only', name, pid: child.pid, status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr });
    assert.equal(child.status, 0); assert.equal(child.signal, null);
  }
  const previous = { root: previousRoot, resultSha256: sha(bytes), outerSha256: sha(outerBytes), movedExtensionSha256: sha(movedBytes), directChildren: 22, loaderReservations: 14, workerCount: 0, captureBytes: result.captureBytes, scratchWriteBytes: result.scratchWriteBytes };
  const seal = { ...oldSeal, continuation: 'UNRUN_TAIL_ONLY', previous, remainingPlanned: { directChildren: 17, loaderAdmissions: 15, semanticCases: 12, typeGroups: 2, expectedNegativeDiagnostics: 8, mutants: 6, restored: 6, bindingRefusals: 2 } };
  fs.writeFileSync(path.join(own, 'PRESEAL-v2-tail.json'), JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' });
  const files = oldExecutor.files.map(row => { const data = read(path.join(repo, row.path)); assert.equal(sha(data), row.sha256); return row; });
  for (const name of ['continue-v2.mjs', 'launch-v2-tail.mjs', 'seal-tail-v2.mjs', 'CONTINUATION-v2.md', 'PRESEAL-v2-tail.json']) { const data = read(path.join(own, name)); files.push({ path: path.relative(repo, path.join(own, name)), bytes: data.length, sha256: sha(data) }); }
  fs.writeFileSync(path.join(own, 'EXECUTOR-v2-tail.json'), JSON.stringify({ role: 'V2_UNRUN_TAIL', source: oldExecutor.source, files, previous }, null, 2) + '\n', { flag: 'wx' });
  note({ finished: new Date().toISOString(), productExecutions: 0, unchangedClock: oldSeal.masterGrantStarted, previous, remaining: seal.remainingPlanned });
  console.log(JSON.stringify({ capture, unchangedClock: oldSeal.masterGrantStarted, remaining: seal.remainingPlanned, productExecutions: 0 }));
} catch (error) { note({ failure: String(error), stack: error?.stack }); throw error; }
finally { fs.closeSync(descriptor); }
