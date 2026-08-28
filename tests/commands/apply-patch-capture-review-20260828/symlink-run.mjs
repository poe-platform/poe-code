import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../..');
const started = Date.now();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(own, 'SYMLINK-PRESEAL.json'));
assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
const inputs = JSON.parse(fs.readFileSync(path.join(own, 'INPUTS.json')));
const payload = JSON.parse(fs.readFileSync(path.join(own, 'SYMLINK-PAYLOAD.json')));
const output = path.join(own, 'symlink-v1-01');
const scratch = path.join(output, 'scratch');
const receipt = { schema: 'independent-c18-symlink-run-v1', started: new Date(started).toISOString(), children: [], failures: [], guards: [], productActual: 0, symlinkOperations: 0 };
let written = 0, captured = 0;
function checkTime() { assert.ok(Date.now() - started < 300000, 'five-minute aggregate bound'); }
function authenticate(entry) {
  checkTime();
  const filename = path.resolve(repository, entry.path);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), entry.path);
  assert.equal(stat.mode & 0o777, entry.mode, entry.path);
  assert.equal(stat.size, entry.bytes, entry.path);
  const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(65536), descriptor = fs.openSync(filename, 'r');
  try { let count; while ((count = fs.readSync(descriptor, buffer)) > 0) { digest.update(buffer.subarray(0, count)); checkTime(); } }
  finally { fs.closeSync(descriptor); }
  assert.equal(digest.digest('hex'), entry.sha256, entry.path);
}
function guards() {
  for (const entry of [...inputs.entries, ...seal.files]) authenticate(entry);
  assert.equal(hash(fs.readFileSync(path.join(own, 'SYMLINK-PRESEAL.json'))), hash(sealBytes));
  return { entries: inputs.entries.length + seal.files.length, checked: true };
}
function put(filename, bytes, mode = 0o644, capture = false) {
  checkTime();
  if (capture) { captured += bytes.length; assert.ok(captured <= 16 * 1024 * 1024); }
  else { written += bytes.length; assert.ok(written <= 64 * 1024 * 1024); }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  assert.equal(fs.lstatSync(filename).mode & 0o777, mode);
}
function census(directory) {
  const result = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      assert.notEqual(name, 'AGENTS.md');
      const key = relative ? relative + '/' + name : name;
      const stat = fs.lstatSync(path.join(directory, key));
      if (stat.isSymbolicLink()) {
        assert.equal(key, payload.linkRelative);
        assert.equal(fs.readlinkSync(path.join(directory, key)), payload.targetText);
        result[key] = { symlink: payload.targetText, mode: stat.mode & 0o777 };
      } else if (stat.isDirectory()) { result[key + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(key); }
      else { assert.ok(stat.isFile()); result[key] = { bytes: stat.size, mode: stat.mode & 0o777, sha256: hash(fs.readFileSync(path.join(directory, key))) }; }
      assert.ok(Object.keys(result).length < 1024);
    }
  }
  visit(''); return result;
}
function checkParents(directory) {
  let current = directory;
  while (true) {
    const stat = fs.lstatSync(current); assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(fs.realpathSync(current), current);
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
checkParents(own);
assert.equal(fs.existsSync(output), false, 'one-shot namespace');
fs.mkdirSync(output);
const outputIdentity = fs.lstatSync(output);

let before;
try {
  receipt.guards.push(guards());
  for (const entry of payload.files) {
    assert.ok(!entry.path.split('/').includes('AGENTS.md') && !entry.path.split('/').includes('..'));
    const bytes = Buffer.from(entry.base64, 'base64');
    assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
    put(path.join(scratch, entry.path), bytes, entry.mode);
  }
  for (const control of payload.cases) {
    const directory = path.join(scratch, 'capture-membership-v3/runs/author-01/work', control.id);
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of control.files) {
      assert.match(entry.name, /^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/);
      if (entry.type === 'symlink') {
        assert.equal(control.id, 'file-symlink'); assert.equal(entry.name, 'synthetic-stdout-0.json');
        assert.equal(entry.target, payload.targetText); continue;
      }
      assert.equal(entry.type, 'file');
      put(path.join(directory, entry.name), Buffer.from(entry.raw ?? entry.base64, 'base64'), entry.mode);
    }
  }
  const link = path.join(scratch, payload.linkRelative);
  assert.equal(payload.linkRelative, 'capture-membership-v3/runs/author-01/work/file-symlink/synthetic-stdout-0.json');
  assert.equal(payload.targetText, 'synthetic.json');
  const target = path.join(path.dirname(link), payload.targetText);
  checkParents(path.dirname(link));
  assert.equal(fs.realpathSync(target), target);
  const targetStat = fs.lstatSync(target); assert.ok(targetStat.isFile() && !targetStat.isSymbolicLink());
  assert.ok(target.startsWith(scratch + path.sep)); assert.equal(fs.existsSync(link), false);
  const targetBefore = hash(fs.readFileSync(target));
  const targetRecord = payload.cases.find(row => row.id === 'file-symlink').files.find(row => row.name === payload.targetText);
  assert.equal(targetBefore, hash(Buffer.from(targetRecord.raw ?? targetRecord.base64, 'base64')));
  assert.equal(targetStat.mode & 0o777, targetRecord.mode);
  fs.symlinkSync(payload.targetText, link);
  receipt.symlinkOperations = 1;
  const linkStat = fs.lstatSync(link); assert.ok(linkStat.isSymbolicLink());
  assert.equal(fs.readlinkSync(link), payload.targetText);
  receipt.preparation = { link, target, linkText: payload.targetText, targetSha256: targetBefore, targetMode: targetStat.mode & 0o777, linkIdentity: { dev: linkStat.dev, ino: linkStat.ino, mode: linkStat.mode & 0o777 }, observerPermissionsExpanded: false };
  before = census(scratch);
  receipt.observations = [];
  for (const phase of ['initial', 'restored']) {
    if (phase === 'restored') {
      assert.ok(receipt.children.every(child => child.closeObserved && child.groupAbsent));
      assert.deepEqual(census(scratch), before);
      const current = fs.lstatSync(link); assert.equal(current.dev, linkStat.dev); assert.equal(current.ino, linkStat.ino); assert.ok(current.isSymbolicLink());
      fs.unlinkSync(link);
      const fragment = payload.cases.find(row => row.id === 'file-symlink').files.find(row => row.type === 'symlink');
      put(link, Buffer.from(fragment.base64, 'base64'), fragment.mode);
      before[payload.linkRelative] = { bytes: Buffer.from(fragment.base64, 'base64').length, mode: fragment.mode, sha256: hash(Buffer.from(fragment.base64, 'base64')) };
      assert.deepEqual(census(scratch), before);
      receipt.restoration = { afterReaping: true, regular: true, targetSha256: hash(fs.readFileSync(target)) };
      assert.equal(receipt.restoration.targetSha256, targetBefore);
    }
  const node = inputs.entries.find(entry => entry.path.endsWith('/bin/node'));
  assert.equal(path.resolve(repository, node.path), process.execPath);
  const args = ['--unhandled-rejections=strict', '--max-old-space-size=128', '--permission', `--allow-fs-read=${own}`, `--allow-fs-write=${path.join(scratch, 'capture-membership-v3/runs/author-01/work')}`, path.join(own, 'symlink-observer.mjs'), scratch, path.join(own, 'SYMLINK-PAYLOAD.json'), phase];
  const childReceipt = { phase, executable: process.execPath, args, pid: null, closeObserved: false, groupAbsent: false, stdoutBytes: 0, stderrBytes: 0, fault: null };
  receipt.children.push(childReceipt);
  const streams = { stdout: [], stderr: [] };
  let child, timer, killTimer;
  const kill = signal => { if (childReceipt.pid !== null) try { process.kill(-childReceipt.pid, signal); } catch (error) { if (error.code !== 'ESRCH') receipt.failures.push({ phase: 'kill', message: error.message }); } };
  const stop = fault => { childReceipt.fault ??= fault; kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 2000); };
  await new Promise(resolve => {
    try { child = spawn(process.execPath, args, { cwd: own, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', NODE_DISABLE_COMPILE_CACHE: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { childReceipt.fault = 'spawn-threw'; childReceipt.error = error.message; resolve(); return; }
    childReceipt.pid = child.pid ?? null;
    child.once('close', (code, signal) => { childReceipt.code = code; childReceipt.signal = signal; childReceipt.closeObserved = true; clearTimeout(timer); clearTimeout(killTimer); resolve(); });
    child.on('error', error => { childReceipt.fault ??= 'child-error'; childReceipt.error = error.message; });
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => {
      childReceipt[channel + 'Bytes'] += bytes.length;
      if (childReceipt.stdoutBytes + childReceipt.stderrBytes <= 1024 * 1024) streams[channel].push(Buffer.from(bytes));
      else stop('CAPTURE_LIMIT');
    });
    timer = setTimeout(() => stop('DEADLINE'), 45000);
  });
  if (childReceipt.pid !== null) {
    try { process.kill(-childReceipt.pid, 0); childReceipt.fault ??= 'GROUP_SURVIVED'; kill('SIGKILL'); }
    catch (error) { if (error.code === 'ESRCH') childReceipt.groupAbsent = true; else throw error; }
  }
  for (const channel of ['stdout', 'stderr']) {
    const bytes = Buffer.concat(streams[channel]);
    childReceipt[channel + 'Retained'] = bytes.length;
    childReceipt[channel + 'Sha256'] = hash(bytes);
    put(path.join(output, phase + '.' + channel + '.raw'), bytes, 0o644, true);
  }
  assert.ok(childReceipt.closeObserved && childReceipt.groupAbsent);
  assert.equal(childReceipt.fault, null);
  assert.equal(childReceipt.signal, null);
  const observations = JSON.parse(Buffer.concat(streams.stdout));
  assert.equal(observations.phase, phase);
  assert.equal(observations.observerHash, seal.files.find(entry => entry.path.endsWith('/symlink-observer.mjs')).sha256);
  assert.equal(observations.rows.length, phase === 'initial' ? 4 : 2);
  assert.equal(observations.controls.length, phase === 'initial' ? 4 : 0);
  assert.ok(observations.events.length < 1024);
  const allPassed = [...observations.rows, ...observations.controls].every(row => row.status === 'PASS');
  assert.equal(childReceipt.code, allPassed ? 0 : 1);
  receipt.observations.push(observations);
  if (!allPassed) receipt.failures.push({ phase, message: 'ordinary observation failure; known child closed, continuing only after integrity' });
  assert.deepEqual(census(scratch), before);
  receipt.guards.push(guards());
  }
} catch (error) { receipt.failures.push({ phase: 'primary', name: error.name, code: error.code, message: error.message, stack: error.stack }); }
finally {
  try { receipt.guards.push(guards()); } catch (error) { receipt.failures.push({ phase: 'postguard', message: error.message }); }
  try {
    assert.ok(receipt.children.every(child => child.closeObserved && child.groupAbsent), 'retire before cleanup');
    const outputAfter = fs.lstatSync(output); assert.equal(outputAfter.dev, outputIdentity.dev); assert.equal(outputAfter.ino, outputIdentity.ino);
    checkParents(output);
    if (fs.existsSync(scratch)) {
      const after = census(scratch);
      if (before && receipt.observations) {
        assert.deepEqual(after, before);
      }
      receipt.finalCensusSha256 = hash(Buffer.from(JSON.stringify(after)));
      fs.rmSync(scratch, { recursive: true });
    }
    receipt.cleanup = { scratchAbsent: !fs.existsSync(scratch), allChildrenClosed: true };
  } catch (error) { receipt.failures.push({ phase: 'cleanup', message: error.message }); }
  receipt.finished = new Date().toISOString(); receipt.elapsedMs = Date.now() - started;
  receipt.writtenBytes = written; receipt.capturedBytesBeforeReceipt = captured;
  receipt.passed = receipt.failures.length === 0 && receipt.elapsedMs < 300000;
  put(path.join(output, 'RECEIPT.json'), Buffer.from(JSON.stringify(receipt, null, 2) + '\n'), 0o644, true);
}
console.log(JSON.stringify({ passed: receipt.passed, observations: receipt.observations?.reduce((total, entry) => total + entry.rows.length, 0) ?? 0, children: receipt.children.length, cleanup: receipt.cleanup, failures: receipt.failures, output }));
process.exitCode = receipt.passed ? 0 : 1;
