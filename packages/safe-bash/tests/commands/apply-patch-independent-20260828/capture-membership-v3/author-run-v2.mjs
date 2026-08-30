import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { deadline } from '../path-transport-v2/deadline.mjs';
import { ownership, retired, supervise } from '../path-transport-v2/supervisor.mjs';

const origin = performance.now(), started = '2026-08-28T18:48:37.102Z';
const priorElapsed = Date.now() - Date.parse(started);
const clock = deadline(300000, () => priorElapsed + performance.now() - origin, 0);
const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(own, 'PRESEAL-V2.json'));
assert.equal(hash(sealBytes), process.argv[2], 'externally committed preseal SHA256');
assert.match(process.argv[3] ?? '', /^[0-9a-f]{40}$/, 'source commit label, authenticated outside dispatch');
const seal = JSON.parse(sealBytes), output = path.join(own, 'runs/author-02'), work = path.join(own, 'runs/author-01/work');
const owner = ownership('c18-data-only', 'DATA');
const receipt = { schema: 'c18-author-receipt-v3', started, sourceCommit: process.argv[3], presealSha256: hash(sealBytes), children: [], productActual: 0, failedAttemptsPreserved: true };
let persistentBytes = 0;
assert.equal(fs.existsSync(output), false, 'unique one-shot output'); fs.mkdirSync(output, { recursive: true });
const outputIdentity = fs.lstatSync(output);
function put(name, bytes) {
  persistentBytes += bytes.length; assert.ok(persistentBytes <= 16 * 1024 * 1024, 'capture16MiB');
  fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx', mode: 0o644 });
}
function fileHash(filename) {
  const hasher = crypto.createHash('sha256'), buffer = Buffer.alloc(65536), descriptor = fs.openSync(filename, 'r');
  try { let count; while ((count = fs.readSync(descriptor, buffer)) > 0) { clock.check('source/tool hash', 10000); hasher.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(descriptor); }
  return hasher.digest('hex');
}
function authenticate() {
  let bytes = 0;
  for (const entry of seal.entries) {
    clock.check('pre/post guard', 10000);
    const filename = path.resolve(repository, entry.path), stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), entry.path);
    assert.equal(stat.size, entry.bytes); assert.equal(stat.mode & 0o777, entry.mode);
    assert.equal(fileHash(filename), entry.sha256, entry.path); bytes += entry.bytes;
  }
  assert.deepEqual(fs.readdirSync(path.join(own, 'manifests')).sort(), seal.manifestNames);
  const allowed = new Set([...seal.rootInputNames, 'PRESEAL-V2.json', 'ROOT-COORDINATION.md', 'REPORT.md', 'runs']);
  assert.ok(fs.readdirSync(own).every(name => allowed.has(name)), 'source-root additions');
  assert.equal(hash(fs.readFileSync(path.join(own, 'PRESEAL-V2.json'))), hash(sealBytes));
  return { files: seal.entries.length, cumulativeBytesHashed: bytes, entriesSha256: hash(Buffer.from(JSON.stringify(seal.entries))), manifestsExactNamespace: true, rootExactAllowlist: true };
}
function cleanup() {
  assert.ok(retired(owner), 'no deletion while child unretired');
  const identity = fs.lstatSync(output); assert.equal(identity.ino, outputIdentity.ino); assert.equal(identity.dev, outputIdentity.dev);
  let files = 0, bytes = 0, symlinks = 0, directories = 0;
  function remove(directory) {
    for (const name of fs.readdirSync(directory)) {
      clock.check('owned cleanup', 1000);
      const filename = path.join(directory, name), stat = fs.lstatSync(filename);
      if (stat.isDirectory() && !stat.isSymbolicLink()) remove(filename);
      else { bytes += stat.isFile() ? stat.size : 0; assert.ok(bytes <= 64 * 1024 * 1024); if (stat.isSymbolicLink()) symlinks++; files++; fs.unlinkSync(filename); }
    }
    fs.rmdirSync(directory); directories++;
  }
  if (fs.existsSync(work)) {
    assert.ok(fs.lstatSync(work).isDirectory() && !fs.lstatSync(work).isSymbolicLink()); remove(work);
  }
  return { workAbsent: !fs.existsSync(work), files, bytes, symlinks, directories, childRetired: retired(owner), ownedTimers: 'supervise clears timeout, kill and hard-close timers in finally; no controller timers', persistentResources: 0 };
}
try {
  receipt.before = authenticate(); clock.check('dispatch', 90000);
  assert.equal(fs.existsSync(work), false); fs.mkdirSync(work);
  const fixtureDirectory = path.join(work, 'file-symlink'); fs.mkdirSync(fixtureDirectory);
  fs.symlinkSync(path.join(fixtureDirectory, 'synthetic.json'), path.join(fixtureDirectory, 'synthetic-stdout-0.json'));
  receipt.preparation = { role: 'controller-owned DATA fixture', symlinks: 1, grantsExpanded: false, originalWorkWasAbsent: true, originalOutputsUntouched: true };
  assert.equal(seal.child.executable, process.execPath);
  const run = await supervise(seal.child.executable, seal.child.args, { cwd: repository, env: seal.child.env, timeoutMs: 60000, maxBytes: 1024 * 1024 }, owner, clock);
  receipt.children.push({ ...run, stdout: undefined, stderr: undefined, stdoutBase64: undefined, stderrBase64: undefined, retired: retired(owner) });
  put('stdout.raw', Buffer.from(run.stdoutBase64, 'base64')); put('stderr.raw', Buffer.from(run.stderrBase64, 'base64'));
  assert.equal(run.fault, null); assert.equal(run.signal, null); assert.equal(run.code, 0); assert.ok(retired(owner));
  receipt.observations = JSON.parse(run.stdout);
  assert.equal(receipt.observations.helper.passed, seal.expected.helper); assert.equal(receipt.observations.composed.passed, seal.expected.composed);
} catch (reason) {
  receipt.failure = { name: reason?.name, message: reason?.message, stack: reason?.stack };
} finally {
  try { receipt.after = authenticate(); assert.deepEqual(receipt.after, receipt.before); }
  catch (reason) { receipt.postGuardFailure = { name: reason?.name, message: reason?.message }; }
  try { receipt.cleanup = cleanup(); }
  catch (reason) { receipt.cleanupFailure = { name: reason?.name, message: reason?.message }; }
  receipt.finished = new Date().toISOString(); receipt.elapsedMs = clock.elapsed();
  receipt.budget = { maximumMs: 300000, children: receipt.children.length, aggregateChildrenIncludingAttempt1: receipt.children.length + 1, priorAttemptRetainedBytes: 4196, maximumChildren: 8, peakOwnedProcesses: owner.spawnReturned ? 2 : 1, maximumPeak: 2, captureBytesBeforeReceipt: persistentBytes, maximumCaptureBytes: 16 * 1024 * 1024, maximumWorkBytes: 64 * 1024 * 1024, resourceMeaning: 'owned controller + DATA child; not CLI/global peak or RSS' };
  receipt.passed = !receipt.failure && !receipt.postGuardFailure && !receipt.cleanupFailure && receipt.elapsedMs < 300000;
  put('receipt.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
  console.log(JSON.stringify({ passed: receipt.passed, elapsedMs: receipt.elapsedMs, helper: receipt.observations?.helper, composed: receipt.observations?.composed, children: receipt.children.length, cleanup: receipt.cleanup, output }));
}
process.exitCode = receipt.passed ? 0 : 1;
