import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const started = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - started) / 1e6;
const seal = JSON.parse(readFileSync(join(root, 'PRESEAL.json')));
const receipt = { schema: 'observer-v8-cohort-receipt', startedWall: new Date().toISOString(), startedMonotonicNs: started.toString(),
  deadlineMs: 600000, qualificationDirectChildren: 0, syntaxChildren: 0, controlsChildren: 0,
  workerChildren: 0, coordinatorProcesses: 1, peakOwnedProcesses: 1, candidateChildren: 0,
  child: null, guards: [], captureBytes: 0, safety: null, completed: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  assert.ok(!entry.isSymbolicLink(), 'no symlink in guarded scope');
  return entry.isDirectory() ? [{ path, directory: true, bytes: 0 }, ...inventory(path)] : [{ path, sha256: hash(readFileSync(path)), bytes: statSync(path).size }];
}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

function guard(label) {
  assert.equal(process.execPath, seal.node.path);
  assert.equal(process.version, seal.node.version);
  assert.equal(hash(readFileSync(seal.node.path)), seal.node.sha256);
  for (const file of seal.files) assert.equal(hash(readFileSync(join(root, file.path))), file.sha256, file.path);
  const names = readdirSync(root).filter(name => name !== 'RUN-01').sort();
  assert.deepEqual(names, [...seal.files.map(file => file.path), 'PRESEAL.json'].sort(), 'new entries checked in sealed directory');
  for (const tree of seal.oldTrees) assert.deepEqual(inventory(tree.root), tree.rows, 'old bytes and file/directory census: ' + tree.root);
  assert.ok(now() < 590000, 'aggregate cleanup reserve');
  receipt.guards.push({ label, elapsedMs: now(), nodeHash: true, sealedHashes: true, oldHashes: true, newEntriesChecked: true });
}

function enroll(child, row) {
  const stdout = [], stderr = [];
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const signals = [];
  let escalation;
  const stop = reason => {
    if (!row.failure) row.failure = reason;
    if (!row.closeObserved) {
      signals.push({ signal: 'SIGTERM', elapsedMs: now(), ownedHandle: true, accepted: child.kill('SIGTERM') });
      if (!escalation) escalation = setTimeout(() => {
        if (!row.closeObserved) signals.push({ signal: 'SIGKILL', elapsedMs: now(), ownedHandle: true, accepted: child.kill('SIGKILL') });
      }, 1000);
    }
  };
  child.once('error', error => { row.spawnError = { name: error.name, message: error.message }; stop('child error'); });
  child.once('exit', (code, signal) => { row.exit = { code, signal, elapsedMs: now() }; });
  child.once('close', (code, signal) => {
    row.closeObserved = true; row.close = { code, signal, elapsedMs: now() }; clearTimeout(escalation); resolveClosed();
  });
  for (const [name, stream, pieces] of [['stdout', child.stdout, stdout], ['stderr', child.stderr, stderr]]) {
    stream.on('error', error => stop(name + ' ' + error.message));
    stream.once('close', () => { row[name + 'CloseObserved'] = true; });
    stream.on('data', bytes => {
      row.outputBytes += bytes.length;
      if (row.outputBytes > 4 * 1024 * 1024) stop('stdio capture bound');
      else pieces.push(Buffer.from(bytes));
    });
  }
  row.enrolled = true;
  row.enrollment = 'immediate next statement after spawn; before hashes, IPC, observer, publication';
  const cleanup = async () => {
    row.cleanupAttempted = true;
    if (!row.closeObserved) stop('finally-owned-child-cleanup');
    let timer;
    await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer); clearTimeout(escalation);
    row.cleanupSettled = row.closeObserved && row.stdoutCloseObserved === true && row.stderrCloseObserved === true;
    row.unknownClosure = !row.cleanupSettled;
  };
  return { closed, cleanup, stdout, stderr, stop, signals };
}

let owned, timer, runDirectory;
const knownHandles = new Set();
try {
  guard('pre');
  runDirectory = join(root, 'RUN-01');
  mkdirSync(runDirectory);
  const row = { role: 'one-sequential-harmless-cohort', pid: null, enrolled: false, closeObserved: false,
    cleanupAttempted: false, cleanupSettled: false, outputBytes: 0, startedMs: now(), args: [join(root, 'worker.mjs')],
    environment: { PATH: dirname(seal.node.path), UV_THREADPOOL_SIZE: '1' } };
  receipt.child = row;
  const child = spawn(seal.node.path, row.args, { cwd: root, env: row.environment, stdio: ['ignore', 'pipe', 'pipe'] });
  knownHandles.add(child);
  try {
    owned = enroll(child, row);
    row.pid = child.pid;
    receipt.qualificationDirectChildren = 1; receipt.workerChildren = 1; receipt.peakOwnedProcesses = 2;
    timer = setTimeout(() => owned.stop('worker deadline 60s'), 60000);
    let hardTimer;
    await Promise.race([owned.closed, new Promise(resolve => { hardTimer = setTimeout(resolve, 67000); })]);
    clearTimeout(hardTimer);
    if (!row.closeObserved) owned.stop('unknown closure at hard wait');
  } finally {
    clearTimeout(timer);
    if (owned) await owned.cleanup();
  }
  row.signals = owned.signals;
  const stdout = Buffer.concat(owned.stdout), stderr = Buffer.concat(owned.stderr);
  const raw = stdout.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const birth = raw.find(value => value.kind === 'birth');
  assert.equal(birth?.pid, row.pid); assert.equal(birth?.ppid, process.pid);
  row.birth = birth;
  receipt.summary = raw.find(value => value.kind === 'summary') ?? null;
  receipt.cases = raw.filter(value => value.kind === 'case').map(value => ({ id: value.id, role: value.role, passed: value.passed, safety: value.safety }));
  receipt.safety = row.unknownClosure || !!row.failure || stderr.length !== 0 || row.exit?.code !== 0 ||
    receipt.summary?.stopped !== false || receipt.summary?.executed !== 19;
  guard('post-known-owned-cleanup');
  for (const [name, bytes] of [['worker.stdout.jsonl', stdout], ['worker.stderr.txt', stderr]]) {
    receipt.captureBytes += bytes.length;
    assert.ok(receipt.captureBytes < 32 * 1024 * 1024, '32MiB capture cap');
    writeFileSync(join(runDirectory, name), bytes, { flag: 'wx' });
  }
  receipt.completed = !receipt.safety;
} catch (error) {
  receipt.safety = true;
  receipt.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  clearTimeout(timer);
  if (owned && !receipt.child.cleanupAttempted) await owned.cleanup();
  if (!owned && knownHandles.size) {
    receipt.safety = true;
    receipt.child.enrollmentHelperFailed = true;
    receipt.child.cleanupAttempted = true;
    for (const child of knownHandles) {
      let timer;
      let closed = false;
      child.on('error', () => { receipt.child.emergencyChildError = true; });
      const observed = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
      child.kill('SIGKILL');
      await Promise.race([observed, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
      clearTimeout(timer);
      receipt.child.emergencyCloseObserved = closed;
      receipt.child.unknownClosure = !closed;
    }
  }
  if (runDirectory) {
    for (const [name, pieces] of [['worker.stdout.jsonl', owned?.stdout], ['worker.stderr.txt', owned?.stderr]]) {
      if (pieces && !readdirSync(runDirectory).includes(name)) writeFileSync(join(runDirectory, name), Buffer.concat(pieces), { flag: 'wx' });
    }
    receipt.finishedWall = new Date().toISOString();
    receipt.aggregateIncludingCleanupMs = now();
    receipt.captureBytes = inventory(runDirectory).reduce((total, file) => total + file.bytes, 0);
    receipt.scratchBytesBeforeReceipt = inventory(root).reduce((total, file) => total + file.bytes, 0);
    receipt.boundsSatisfied = receipt.aggregateIncludingCleanupMs < 600000 && receipt.captureBytes + 65536 < 32 * 1024 * 1024 &&
      receipt.scratchBytesBeforeReceipt + 65536 < 128 * 1024 * 1024 && receipt.qualificationDirectChildren <= 6 && receipt.peakOwnedProcesses <= 2;
    writeFileSync(join(runDirectory, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  }
}
const publicationEndMs = now();
if (runDirectory) writeFileSync(join(runDirectory, 'PUBLICATION-CLOCK.json'), JSON.stringify({ afterReceiptWriteMs: publicationEndMs, beforeFinalClockWrite: true, limitMs: 600000 }) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ completed: receipt.completed, safety: receipt.safety, error: receipt.error,
  cases: receipt.cases, elapsedMs: receipt.aggregateIncludingCleanupMs }));
process.exitCode = receipt.completed && receipt.boundsSatisfied && publicationEndMs < 600000 ? 0 : 1;
