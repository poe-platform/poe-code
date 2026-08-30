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
const sealBytes = fs.readFileSync(path.join(own, 'PRESEAL-V2.json'));
assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
const inputs = JSON.parse(fs.readFileSync(path.join(own, 'INPUTS.json')));
const payload = JSON.parse(fs.readFileSync(path.join(own, 'PAYLOAD.json')));
const output = path.join(own, 'data-v2-01');
const scratch = path.join(output, 'scratch');
const receipt = { schema: 'independent-c18-regular-run-v1', started: new Date(started).toISOString(), children: [], failures: [], guards: [], productActual: 0, symlinkOperations: 0 };
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
  assert.equal(hash(fs.readFileSync(path.join(own, 'PRESEAL-V2.json'))), hash(sealBytes));
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
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { result[key + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(key); }
      else { assert.ok(stat.isFile()); result[key] = { bytes: stat.size, mode: stat.mode & 0o777, sha256: hash(fs.readFileSync(path.join(directory, key))) }; }
      assert.ok(Object.keys(result).length < 1024);
    }
  }
  visit(''); return result;
}
assert.equal(fs.existsSync(output), false, 'one-shot namespace');
fs.mkdirSync(output);
let before;
try {
  receipt.guards.push(guards());
  receipt.bindingCounterchecks = [];
  for (const label of ['capture-io.mjs', 'manifests/positive.json', '/bin/node']) {
    const entry = inputs.entries.find(entry => entry.path.endsWith(label));
    assert.ok(entry);
    assert.throws(() => authenticate({ ...entry, sha256: '0'.repeat(64) }), { code: 'ERR_ASSERTION' });
    receipt.bindingCounterchecks.push({ label, wrongDigestRejected: true });
  }
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
      if (entry.type === 'directory') fs.mkdirSync(path.join(directory, entry.name));
      else { assert.equal(entry.type, 'file'); put(path.join(directory, entry.name), Buffer.from(entry.raw ?? entry.base64, 'base64'), entry.mode); }
    }
  }
  before = census(scratch);
  const node = inputs.entries.find(entry => entry.path.endsWith('/bin/node'));
  assert.equal(path.resolve(repository, node.path), process.execPath);
  const args = ['--unhandled-rejections=strict', '--max-old-space-size=128', '--permission', `--allow-fs-read=${own}`, `--allow-fs-write=${path.join(scratch, 'capture-membership-v3/runs/author-01/work')}`, path.join(own, 'observe.mjs'), scratch, path.join(own, 'PAYLOAD.json')];
  const childReceipt = { executable: process.execPath, args, pid: null, closeObserved: false, groupAbsent: false, stdoutBytes: 0, stderrBytes: 0, fault: null };
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
    put(path.join(output, channel + '.raw'), bytes, 0o644, true);
  }
  assert.ok(childReceipt.closeObserved && childReceipt.groupAbsent);
  assert.equal(childReceipt.fault, null);
  assert.equal(childReceipt.signal, null);
  const observations = JSON.parse(Buffer.concat(streams.stdout));
  receipt.observations = observations.observations;
  receipt.loads = observations.loads;
  assert.equal(childReceipt.code, 0);
  assert.equal(observations.observations.length, 52);
  assert.ok(observations.observations.every(row => row.status === 'PASS'));
} catch (error) { receipt.failures.push({ phase: 'primary', name: error.name, code: error.code, message: error.message, stack: error.stack }); }
finally {
  try { receipt.guards.push(guards()); } catch (error) { receipt.failures.push({ phase: 'postguard', message: error.message }); }
  try {
    assert.ok(receipt.children.every(child => child.closeObserved && child.groupAbsent), 'retire before cleanup');
    if (fs.existsSync(scratch)) {
      const after = census(scratch);
      if (before && receipt.observations) {
        delete before['capture-membership-v3/runs/author-01/work/c18-original/' + payload.restore.remove];
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
console.log(JSON.stringify({ passed: receipt.passed, observations: receipt.observations?.length ?? 0, children: receipt.children.length, cleanup: receipt.cleanup, failures: receipt.failures, output }));
process.exitCode = receipt.passed ? 0 : 1;
