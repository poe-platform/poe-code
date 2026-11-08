import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import assert from 'node:assert/strict';
import { captureLaunch, publishTerminal, processPresence, LIMITS } from './capture.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.join(home, 'controls-01');
const started = Date.now();
const sealStat = await fs.lstat(path.join(home, 'SEAL.json'));
assert.ok(sealStat.isFile() && sealStat.size <= 65536);
const sealBytes = await fs.readFile(path.join(home, 'SEAL.json'));
assert.equal(sha(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
const guard = async () => {
  for (const entry of [...seal.files.map(row => ({ ...row, path: path.join(home, row.path) })), seal.node, seal.bindings.launch]) {
    const stat = await fs.lstat(entry.path);
    assert.ok(stat.isFile());
    assert.equal(stat.size, entry.bytes);
    assert.equal(stat.mode & 511, entry.mode);
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(entry.path, { highWaterMark: 65536 })) hash.update(bytes);
    assert.equal(hash.digest('hex'), entry.sha256);
  }
};
await guard();
const plan = JSON.parse(await fs.readFile(path.join(home, 'CONTROL-PLAN.json')));
assert.equal(plan.attempts, 1);
await fs.mkdir(root, { mode: 0o700 });
const journal = await fs.open(path.join(root, 'CONTROLS.ndjson'), 'wx', 0o600);
const outcomes = [];
let unsafe = false;
let launched = 0;
let liveChildren = 0;
let maximumLiveChildren = 0;
let attemptedSpawns = 0;
let totalBytes = 0;
const raw = { stdout: Buffer.from('outer-ok\n'), stderr: Buffer.from('outer-diagnostic\n'), fd3: Buffer.from('{"stub":true}\n') };
const note = async row => {
  const bytes = Buffer.from(JSON.stringify(row) + '\n');
  assert.ok(bytes.length <= 65536);
  totalBytes += bytes.length;
  assert.ok(totalBytes <= 2097152);
  await journal.writeFile(bytes);
  await journal.sync();
};
for (const row of plan.cases) {
  assert.ok(Date.now() - started <= 180000);
  const outcome = { id: row.id, kind: row.kind, pass: false, child: null, independentlyRetired: null, handlesActuallyClosed: null };
  let result;
  const actualHandles = [];
  const sentinel = Object.freeze({ sentinel: row.id });
  const later = Object.assign(new Error('LATER_CLEANUP'), { code: 'LATER_CLEANUP' });
  const directory = path.join(root, row.id);
  let partialDone = false;
  const io = { open: async (file, flags, mode) => {
    const name = path.basename(file);
    if (row.kind === 'partial-open-failure' && name === 'stderr.raw') throw Object.assign(new Error('OPEN_FAULT'), { code: 'OPEN_FAULT' });
    const handle = await fs.open(file, flags, mode);
    const actual = { name, closed: false };
    actualHandles.push(actual);
    return {
      write: async (bytes, offset, length, position) => {
        if (row.kind === 'zero-write' && name === 'stdout.raw') return { bytesWritten: 0 };
        if (row.kind === 'partial-write-failure' && name === 'stdout.raw') {
          if (partialDone) throw Object.assign(new Error('PARTIAL_WRITE'), { code: 'PARTIAL_WRITE' });
          partialDone = true;
          return handle.write(bytes, offset, Math.min(3, length), position);
        }
        if (row.kind === 'receipt-write-failure' && name === 'RECEIPT.json') throw Object.assign(new Error('RECEIPT_WRITE'), { code: 'RECEIPT_WRITE' });
        if (row.kind === 'short-writes') return handle.write(bytes, offset, Math.min(3, length), position);
        return handle.write(bytes, offset, length, position);
      },
      sync: async () => {
        if ((row.kind === 'stderr-sync-failure' || row.kind === 'enrollment-undefined') && name === 'stderr.raw') throw later;
        if (row.kind === 'dual-cleanup-reasons' && name === 'stdout.raw') throw undefined;
        return handle.sync();
      },
      close: async () => {
        await handle.close();
        actual.closed = true;
        if ((row.kind === 'stdout-close-failure' || row.kind === 'preflight-null' || row.kind === 'enrollment-object') && name === 'stdout.raw') throw later;
        if (row.kind === 'dual-cleanup-reasons' && name === 'stderr.raw') throw null;
        if (row.kind === 'receipt-close-failure' && name === 'RECEIPT.json') throw later;
      }
    };
  } };
  try {
    if (row.kind.startsWith('terminal-')) {
      const parts = [];
      if (row.kind === 'terminal-short-write') {
        const published = publishTerminal({ schema: 'CONTROL', ok: true }, (bytes, offset, length) => { const count = Math.min(3, length); parts.push(Buffer.from(bytes.subarray(offset, offset + count))); return count; });
        assert.equal(published.ok, true);
        assert.equal(Buffer.concat(parts).toString(), '{"schema":"CONTROL","ok":true}\n');
        outcome.publisher = published;
      } else if (row.kind === 'terminal-undefined') {
        const published = publishTerminal({ schema: 'CONTROL' }, () => { throw undefined; });
        assert.equal(published.ok, false);
        assert.equal(published.primaryPresent, true);
        assert.equal(published.primaryReason, undefined);
        outcome.publisher = { ...published, reasonType: 'undefined' };
      } else {
        let called = false;
        const published = publishTerminal({ value: 'x'.repeat(8192) }, () => { called = true; return 1; });
        assert.equal(called, false);
        assert.equal(published.ok, false);
        assert.equal(published.primaryReason.code, 'OUTER_TERMINAL_BOUND');
        outcome.publisher = { ok: published.ok, bytes: published.bytes, retained: published.retained };
      }
    } else {
      if (row.kind === 'namespace-collision') {
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, 'SENTINEL.data'), 'preserve\n', { flag: 'wx' });
      }
      const beforeLaunch = async () => {
        if (row.kind === 'preflight-object') throw sentinel;
        if (row.kind === 'preflight-null') throw null;
      };
      const afterEnrolled = child => {
        assert.equal(child.enrolled, true);
        attemptedSpawns++;
        if (child.pid !== null) { launched++; liveChildren++; maximumLiveChildren = Math.max(maximumLiveChildren, liveChildren); }
        assert.ok(liveChildren <= 1 && launched <= 18);
        if (row.kind === 'enrollment-undefined') throw undefined;
        if (row.kind === 'enrollment-object') throw sentinel;
      };
      result = await captureLaunch({ directory, runId: row.id, totalMs: row.kind === 'deadline' ? 250 : 5000, termMs: 50, killMs: 50, command: { file: row.kind === 'spawn-error' ? path.join(root, 'ABSENT_EXECUTABLE') : process.execPath, args: ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(home, 'stub.mjs'), row.stub ?? 'normal'], cwd: root, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: root, TMPDIR: root } } }, { io, beforeLaunch, afterEnrolled, ...(row.kind === 'unknown-retirement' ? { presence: () => 'unknown' } : {}) });
      outcome.receipt = result.receipt;
      outcome.child = result.receipt.child;
      outcome.qualified = result.qualified;
      if (outcome.child.pid !== null) {
        outcome.independentlyRetired = outcome.child.close !== null && processPresence(outcome.child.pid) === 'absent' && processPresence(-outcome.child.pid) === 'absent';
        if (outcome.independentlyRetired) liveChildren--;
        if (!outcome.independentlyRetired) { unsafe = true; throw Error('REAL_RETIREMENT_NOT_ESTABLISHED'); }
      } else outcome.independentlyRetired = !outcome.child.attempted || outcome.child.error !== null && outcome.child.close !== null;
      outcome.handlesActuallyClosed = actualHandles.every(handle => handle.closed);
      if (!outcome.handlesActuallyClosed) { unsafe = true; throw Error('REAL_HANDLE_NOT_CLOSED'); }
      if (['normal', 'short-writes'].includes(row.kind)) {
        assert.equal(result.qualified, true);
        for (const name of Object.keys(raw)) {
          assert.deepEqual(await fs.readFile(path.join(directory, name + '.raw')), raw[name]);
          assert.equal(result.receipt.streams[name].observed, raw[name].length);
          assert.equal(result.receipt.streams[name].retained, raw[name].length);
          assert.equal(result.receipt.streams[name].sha256, sha(raw[name]));
        }
      } else assert.equal(result.qualified, false);
      if (row.kind === 'nonzero7') { assert.equal(outcome.child.exit.code, 7); assert.equal(outcome.child.natural, true); }
      if (row.kind === 'preflight-object' || row.kind === 'enrollment-object') assert.equal(result.primaryReason, sentinel);
      if (row.kind === 'preflight-null') { assert.equal(result.primaryPresent, true); assert.equal(result.primaryReason, null); assert.ok(result.receipt.secondary.some(entry => entry.phase === 'stdout:close')); }
      if (row.kind === 'bootstrap-before-inner') { assert.equal(outcome.child.exit.code, 1); assert.equal((await fs.readFile(path.join(directory, 'stderr.raw'))).toString(), 'STUB_BOOTSTRAP_BEFORE_INNER_COLLECTOR\n'); assert.equal((await fs.readdir(directory)).includes('inner-collector'), false); }
      if (row.kind === 'stdout-overflow' || row.kind === 'fd3-overflow') {
        const name = row.kind === 'stdout-overflow' ? 'stdout' : 'fd3';
        const state = result.receipt.streams[name];
        assert.ok(state.observed > LIMITS[name]); assert.equal(state.retained, LIMITS[name]); assert.equal(state.lost, state.observed - state.retained); assert.equal(state.truncated, true);
        assert.equal((await fs.stat(path.join(directory, name + '.raw'))).size, state.retained);
      }
      if (row.kind === 'zero-write') { assert.equal(result.receipt.streams.stdout.retained, 0); assert.equal(result.receipt.primary.reason.code, 'OUTER_WRITE_PROGRESS'); }
      if (row.kind === 'partial-write-failure') { assert.equal(result.receipt.streams.stdout.retained, 3); assert.equal((await fs.readFile(path.join(directory, 'stdout.raw'))).toString(), 'out'); assert.equal(result.receipt.streams.stdout.lost, result.receipt.streams.stdout.observed - 3); }
      if (row.kind === 'stderr-sync-failure') { assert.equal(result.receipt.files.stdout.synced, true); assert.equal(result.receipt.files.stderr.synced, false); assert.equal(result.receipt.files.stderr.closed, true); }
      if (row.kind === 'stdout-close-failure') { assert.equal(result.receipt.files.stdout.closed, false); assert.equal(result.receipt.files.stderr.closed, true); }
      if (row.kind === 'dual-cleanup-reasons') { assert.equal(result.primaryPresent, true); assert.equal(result.primaryReason, undefined); assert.ok(result.receipt.secondary.some(entry => entry.reason.type === 'null')); }
      if (row.kind === 'enrollment-undefined') { assert.equal(result.primaryPresent, true); assert.equal(result.primaryReason, undefined); assert.ok(result.receipt.secondary.some(entry => entry.phase === 'stderr:sync')); }
      if (row.kind === 'enrollment-object' || row.kind === 'enrollment-undefined') assert.ok(result.receipt.events.some(entry => entry.phase === 'child-enrolled-listeners-installed'));
      if (row.kind === 'unknown-retirement') { assert.equal(outcome.child.reaped, false); assert.equal(result.receipt.primary.reason.code, 'OUTER_RETIREMENT_UNKNOWN'); }
      if (row.kind === 'deadline') { assert.equal(result.receipt.primary.reason.code, 'OUTER_DEADLINE'); assert.equal(outcome.child.natural, false); assert.ok(result.receipt.signals.some(entry => entry.name === 'SIGTERM')); }
      if (row.kind === 'spawn-error') { assert.equal(outcome.child.pid, null); assert.equal(outcome.child.error.code, 'ENOENT'); }
      if (row.kind === 'receipt-write-failure' || row.kind === 'receipt-close-failure') { assert.equal(result.publicationPresent, true); assert.equal(result.qualified, false); }
      if (row.kind === 'namespace-collision') { assert.equal(outcome.child.attempted, false); assert.deepEqual(await fs.readdir(directory), ['SENTINEL.data']); }
      if (row.kind === 'partial-open-failure') { assert.equal(outcome.child.attempted, false); assert.equal(result.receipt.files.stdout.closed, true); }
      for (const name of ['stdout', 'stderr', 'fd3']) if (result.receipt.files[name]) assert.equal(result.receipt.files[name].closeAttempted, true);
    }
    try { await guard(); } catch (error) { unsafe = true; throw error; }
    outcome.pass = true;
  } catch (error) {
    outcome.failure = { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 2048) };
    if (liveChildren !== 0 || actualHandles.some(handle => !handle.closed)) unsafe = true;
  }
  await note(outcome);
  outcomes.push(outcome);
  if (unsafe) break;
}
await journal.sync();
await journal.close();
await guard();
let workBytes = 0;
const inventory = [];
const walk = async directory => {
  for (const name of await fs.readdir(directory)) {
    const location = path.join(directory, name);
    const stat = await fs.lstat(location);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) await walk(location);
    else {
      workBytes += stat.size;
      assert.ok(stat.size <= 262144 || location.endsWith('CONTROLS.ndjson'));
      inventory.push({ path: path.relative(root, location), bytes: stat.size, mode: stat.mode & 511, sha256: sha(await fs.readFile(location)) });
    }
  }
};
await walk(root);
assert.ok(workBytes <= 16777216);
const report = { schema: 'OUTER_ADAPTER_CONTROLS_V1', sealSha256: sha(sealBytes), attempted: outcomes.length, passed: outcomes.filter(row => row.pass).length, failed: outcomes.filter(row => !row.pass).length, unrun: plan.cases.slice(outcomes.length).map(row => row.id), unsafe, attemptedSpawns, actualChildren: launched, maximumLiveChildren, liveChildren, workBytes, elapsedMs: Date.now() - started, inventory, outcomes };
report.countQualified = attemptedSpawns === 18 && launched === 17;
const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
assert.ok(reportBytes.length <= 262144);
await fs.writeFile(path.join(root, 'REPORT.json'), reportBytes, { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ attempted: report.attempted, passed: report.passed, failed: report.failed, unrun: report.unrun, unsafe, attemptedSpawns, actualChildren: launched, liveChildren, report: path.join(root, 'REPORT.json') }) + '\n');
process.exitCode = report.failed || unsafe || report.unrun.length || !report.countQualified ? 1 : 0;
