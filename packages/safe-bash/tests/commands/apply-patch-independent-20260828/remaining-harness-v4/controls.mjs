import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256, describe, authenticate, inventory } from './primitives.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const started = performance.now();
const sealBytes = fs.readFileSync(path.join(own, 'PRESEAL.json'));
const seal = JSON.parse(sealBytes);
const [presealCommit, presealSha256] = process.argv.slice(2);
assert.match(presealCommit, /^[a-f0-9]{40}$/);
assert.equal(sha256(sealBytes), presealSha256);
assert.equal(process.execPath, seal.tools.node.path);
assert.equal(process.version, seal.nodeVersion);
assert.deepEqual(Object.keys(process.env), []);
const output = path.join(own, seal.output);
assert.equal(fs.existsSync(output), false, 'one attempt; collision STOP');
fs.mkdirSync(output, { mode: 0o700 });
const work = path.join(output, 'work');
const results = [];
const receipts = [];
const events = [];
let active;
let actualChildren = 0;
let peak = 1;
let capturedBytes = 0;
let persistedBytes = 0;
let writtenWorkBytes = 0;
let workIdentity;
let stopped = null;
let cleanup = null;
const elapsed = () => performance.now() - started;
function checkTime(reserve = 60000) { assert.ok(elapsed() + reserve < seal.bounds.totalMs, 'deadline STOP'); }
function event(value) {
  assert.ok(events.length < 128);
  events.push({ elapsedMs: elapsed(), ...value });
}
function put(filename, bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (filename.startsWith(work + path.sep)) {
    assert.ok(writtenWorkBytes + payload.length <= seal.bounds.workBytes);
    writtenWorkBytes += payload.length;
  } else {
    assert.ok(filename.startsWith(output + path.sep));
    assert.ok(persistedBytes + payload.length <= seal.bounds.persistedBytes);
    persistedBytes += payload.length;
  }
  fs.writeFileSync(filename, payload, { flag: 'wx', mode: 0o644 });
}
function integrity() {
  checkTime();
  assert.deepEqual(fs.readdirSync(own).sort(), [...Object.keys(seal.files), 'PRESEAL.json', seal.output].sort());
  assert.equal(sha256(fs.readFileSync(path.join(own, 'PRESEAL.json'))), presealSha256);
  for (const [name, binding] of Object.entries(seal.files)) assert.deepEqual(describe(path.join(own, name)), binding, name);
  for (const [name, binding] of Object.entries(seal.sourceBindings)) assert.deepEqual(describe(path.join(repository, name)), binding, name);
  for (const tool of Object.values(seal.tools)) assert.deepEqual(describe(tool.path), tool.binding, tool.path);
}
function reserveChild() {
  assert.equal(active, undefined, 'occupied child lease');
  checkTime();
  assert.ok(actualChildren < seal.bounds.actualChildren);
}
async function child(planned, handshake = false) {
  reserveChild();
  assert.equal(planned.id, seal.children[actualChildren].id);
  integrity();
  const receipt = { id: planned.id, executable: planned.executable, args: planned.args, env: planned.env, cwd: work, pid: null, closeObserved: false, absent: false, code: null, signal: null, fault: null, stdoutBase64: '', stderrBase64: '' };
  receipts.push(receipt);
  active = receipt;
  actualChildren++;
  const chunks = { stdout: [], stderr: [] };
  let total = 0;
  let childHandle;
  let closeResolve;
  let hardResolve;
  let killTimer;
  let released = false;
  const closed = new Promise(resolve => { closeResolve = resolve; });
  const hard = new Promise(resolve => { hardResolve = resolve; });
  function stop(message) {
    receipt.fault ??= message;
    if (childHandle && !receipt.closeObserved && receipt.pid !== null) {
      try { childHandle.kill('SIGTERM'); }
      catch (reason) { receipt.fault += `; TERM: ${reason.code}`; }
      killTimer ??= setTimeout(() => {
        if (!receipt.closeObserved) {
          try { childHandle.kill('SIGKILL'); }
          catch (reason) { receipt.fault += `; KILL: ${reason.code}`; }
        }
      }, 200);
    }
  }
  const timer = setTimeout(() => stop('child deadline STOP'), planned.timeoutMs);
  const hardTimer = setTimeout(() => { stop('unknown retirement STOP'); hardResolve(); }, planned.timeoutMs + 2500);
  try {
    childHandle = spawn(planned.executable, planned.args, { cwd: work, env: planned.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    receipt.pid = childHandle.pid ?? null;
    childHandle.once('close', (code, signal) => {
      receipt.closeObserved = true;
      receipt.code = code;
      receipt.signal = signal;
      event({ kind: 'close', id: planned.id, pid: receipt.pid, code, signal });
      closeResolve();
    });
    childHandle.on('error', reason => stop(`spawn/child error: ${reason.code}`));
    childHandle.stdin.on('error', reason => stop(`stdin error: ${reason.code}`));
    for (const channel of ['stdout', 'stderr']) childHandle[channel].on('error', reason => stop(`${channel} error: ${reason.code}`));
    assert.ok(Number.isSafeInteger(receipt.pid));
    peak = Math.max(peak, 2);
    event({ kind: 'spawn', id: planned.id, pid: receipt.pid, controllerPid: process.pid, ownedProcesses: 2 });
    for (const channel of ['stdout', 'stderr']) childHandle[channel].on('data', chunk => {
      try {
        total += chunk.length;
        capturedBytes += chunk.length;
        assert.ok(total <= planned.maxBytes && capturedBytes <= seal.bounds.rawBytes, 'capture STOP');
        chunks[channel].push(Buffer.from(chunk));
        if (handshake && channel === 'stdout' && !released) {
          const text = Buffer.concat(chunks.stdout).toString('utf8');
          if (text.includes('\n')) {
            assert.equal(text.split('\n').length, 2);
            const record = JSON.parse(text.trimEnd());
            assert.deepEqual(record, { kind: 'nested-refused', pid: receipt.pid, ppid: process.pid, code: 'ERR_ACCESS_DENIED', permission: 'ChildProcess' });
            process.kill(receipt.pid, 0);
            const before = actualChildren;
            assert.throws(() => reserveChild(), /occupied child lease/);
            assert.equal(actualChildren, before);
            receipt.handshake = record;
            receipt.occupiedAdmissionRefused = true;
            event({ kind: 'nested-and-occupied-refused', pid: receipt.pid, actualChildren, ownedProcesses: 2 });
            released = true;
            childHandle.stdin.end('release\n');
          }
        }
      } catch (reason) { stop(reason.message); }
    });
    if (!handshake) childHandle.stdin.end();
    await Promise.race([closed, hard]);
  } catch (reason) {
    stop(reason.message);
    if (childHandle) await Promise.race([closed, hard]);
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(hardTimer);
    for (const channel of ['stdout', 'stderr']) receipt[channel + 'Base64'] = Buffer.concat(chunks[channel]).toString('base64');
    receipt.bytes = total;
    if (receipt.closeObserved && receipt.pid !== null) {
      try { process.kill(receipt.pid, 0); receipt.fault ??= 'PID present after close STOP'; }
      catch (reason) {
        if (reason.code === 'ESRCH') receipt.absent = true;
        else receipt.fault ??= `unknown PID probe: ${reason.code}`;
      }
    }
    if (receipt.closeObserved && receipt.absent) {
      active = undefined;
      event({ kind: 'retired', pid: receipt.pid, ownedProcesses: 1 });
    } else if (childHandle) {
      childHandle.stdin.destroy();
      childHandle.stdout.destroy();
      childHandle.stderr.destroy();
      childHandle.unref();
    }
  }
  assert.equal(receipt.fault, null);
  assert.equal(receipt.closeObserved, true);
  assert.equal(receipt.absent, true);
  assert.equal(receipt.code, 0);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.stderrBase64, '');
  if (handshake) {
    assert.equal(released, true);
    const records = Buffer.from(receipt.stdoutBase64, 'base64').toString().trimEnd().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(records, [receipt.handshake, { kind: 'released', pid: receipt.pid, ppid: process.pid }]);
  }
  integrity();
  return receipt;
}
function passed(id, details) {
  assert.equal(id, seal.controls[results.length].id);
  results.push({ id, status: 'PASS_CONTROL_ONLY', ...details });
}
try {
  integrity();
  fs.mkdirSync(work, { mode: 0o700 });
  workIdentity = fs.lstatSync(work);
  const input = JSON.parse(fs.readFileSync(path.join(own, 'INPUTS.json')));
  const installed = path.join(work, 'installed');
  const moved = path.join(work, 'physically-moved');
  fs.mkdirSync(installed);
  const bodies = input.variants.map(name => Buffer.from(input.bodyPrefix + name + '\n'));
  for (const [index, name] of input.variants.entries()) put(path.join(installed, input.installedPrefix + name + input.suffix), bodies[index]);
  put(path.join(installed, 'package-data.txt'), input.packageBody);
  const before = inventory(installed);
  fs.renameSync(installed, moved);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(inventory(moved), before);
  const negatives = [];
  for (const [index, name] of input.variants.entries()) {
    const oldName = path.join(moved, input.installedPrefix + name + input.suffix);
    assert.throws(() => put(oldName, bodies[index]), { code: 'EEXIST' });
    negatives.push(name);
    const newName = path.join(moved, input.movedPrefix + name + input.suffix);
    put(newName, bodies[index]);
    authenticate(newName, bodies[index], input.mode);
    authenticate(oldName, bodies[index], input.mode);
  }
  assert.deepEqual(inventory(moved).entries.filter(entry => !entry.path.startsWith(input.movedPrefix)), before.entries);
  assert.equal(inventory(moved).entries.length, 11);
  passed('R01', { physicalRenameNoError: true, oldNamesPreserved: 5, oldEexistExpected: negatives, distinctNamesCreated: 5 });
  const beforeAuth = inventory(moved);
  for (const [index, name] of input.variants.entries()) authenticate(path.join(moved, input.movedPrefix + name + input.suffix), bodies[index], input.mode);
  assert.deepEqual(inventory(moved), beforeAuth);
  passed('R02', { authenticated: 5, writes: 0 });
  const refusals = path.join(work, 'refusals');
  fs.mkdirSync(refusals);
  put(path.join(refusals, 'different'), Buffer.from('!'.repeat(bodies[0].length)));
  put(path.join(refusals, 'mode'), bodies[0]);
  fs.chmodSync(path.join(refusals, 'mode'), 0o600);
  const original = path.join(moved, input.movedPrefix + input.variants[0] + input.suffix);
  fs.symlinkSync(original, path.join(refusals, 'symlink'));
  put(path.join(refusals, 'alias-source'), bodies[0]);
  fs.linkSync(path.join(refusals, 'alias-source'), path.join(refusals, 'alias'));
  const refusalBefore = inventory(refusals);
  for (const [name, reason] of [['different', /bytes refused/], ['mode', /mode refused/], ['symlink', /regular file required/], ['alias', /alias refused/]]) assert.throws(() => authenticate(path.join(refusals, name), bodies[0], input.mode), reason);
  assert.deepEqual(inventory(refusals), refusalBefore);
  passed('R03', { refused: ['different-bytes', 'mode', 'symlink', 'hardlink-alias'], noWritesDuringAuthentication: true });
  const buffer = [];
  const admit = bytes => { assert.ok(bytes.length <= 64, 'bounded capture refusal'); buffer.push(Buffer.from(bytes)); };
  admit(Buffer.alloc(64, 17));
  assert.throws(() => admit(Buffer.alloc(65)), /bounded capture refusal/);
  assert.equal(buffer.length, 1);
  passed('B01', { exactBytesAdmitted: 64, overBytesRefused: 65, retainedBytes: 64, childProcesses: 0, qualification: 'pre-admission helper only, not child-abort cleanup' });
  const gitRoot = path.join(work, 'metadata.git');
  for (const directory of ['metadata.git', 'metadata.git/objects', 'metadata.git/refs', 'empty', 'home', 'tmp']) fs.mkdirSync(path.join(work, directory));
  put(path.join(gitRoot, 'HEAD'), 'ref: refs/heads/control\n');
  put(path.join(gitRoot, 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = true\n');
  function object(kind, payload) {
    const bytes = Buffer.concat([Buffer.from(`${kind} ${payload.length}\0`), payload]);
    const digest = crypto.createHash('sha1').update(bytes).digest('hex');
    const directory = path.join(gitRoot, 'objects', digest.slice(0, 2));
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    put(path.join(directory, digest.slice(2)), deflateSync(bytes));
    return digest;
  }
  const blob = object('blob', Buffer.from(input.gitBlob));
  const tree = object('tree', Buffer.concat(input.gitPaths.map(name => Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(blob, 'hex')]))));
  const commit = object('commit', Buffer.from(`tree ${tree}\n${input.gitCommitTail}`));
  assert.equal(commit, seal.gitFixture.commit);
  const gitReceipt = await child(seal.children[0]);
  const expected = Buffer.concat(input.gitPaths.map(name => Buffer.from(`100644 blob ${blob}\t${name}\0`)));
  assert.equal(expected.toString('base64'), seal.gitFixture.expectedStdoutBase64);
  assert.deepEqual(Buffer.from(gitReceipt.stdoutBase64, 'base64'), expected);
  passed('G01', { actualChildren: 1, nulRecords: 2, expectedSha256: sha256(expected), fixtureCommit: commit });
  const nested = await child(seal.children[1], true);
  passed('P01', { actualChildren: 1, handshake: nested.handshake, nestedDeniedBeforeSpawn: true, occupiedAdmissionRefused: true, closeObserved: nested.closeObserved, absent: nested.absent });
  assert.equal(actualChildren, 2);
  assert.equal(results.length, seal.controls.length);
  integrity();
} catch (reason) {
  stopped = { name: reason.name, message: reason.message, stack: reason.stack };
} finally {
  try {
    checkTime(1000);
    if (fs.existsSync(work)) {
      assert.equal(active, undefined, 'unknown retirement; preserve work');
      const stat = fs.lstatSync(work);
      assert.equal(stat.ino, workIdentity.ino);
      assert.equal(stat.dev, workIdentity.dev);
      const finalInventory = inventory(work);
      put(path.join(output, 'work-inventory.json'), JSON.stringify(finalInventory, null, 2) + '\n');
      fs.rmSync(work, { recursive: true });
      cleanup = { removed: !fs.existsSync(work), inventorySha256: sha256(JSON.stringify(finalInventory)), workBytes: finalInventory.bytes, entries: finalInventory.entries.length };
    } else cleanup = { removed: true, neverCreated: true };
    integrity();
  } catch (reason) {
    cleanup = { failure: reason.message, preserved: fs.existsSync(work) };
    stopped ??= { name: reason.name, message: reason.message };
  }
  const report = { schema: 'remaining-harness-v4-controls-only', presealCommit, presealSha256, controllerPid: process.pid, controllerPpid: process.ppid, startedAt: new Date(Date.now() - elapsed()).toISOString(), elapsedMs: elapsed(), stopped, results, unrun: seal.controls.slice(results.length).map(control => control.id), actualChildren, peakReviewOwnedProcesses: peak, peakQualification: 'finite inspected routes; actual PID/PPID Node handshake and direct child handles, not OS-global census', capturedBytes, writtenWorkBytes, persistedBytesBeforeOutcome: persistedBytes, receipts, events, cleanup, productExecutions: 0, candidateLoads: 0, remainingJobsExecuted: 0, admission: 'NONE' };
  put(path.join(output, 'OUTCOME.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ stopped, passedControls: results.length, actualChildren, peak, controllerPid: process.pid, cleanup, elapsedMs: elapsed() }) + '\n');
  process.exitCode = stopped ? 1 : 0;
}
