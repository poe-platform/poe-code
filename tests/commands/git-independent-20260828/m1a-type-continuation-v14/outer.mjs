import assert from 'node:assert/strict';
import { mkdirSync, openSync, writeSync, closeSync, readFileSync, rmSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url)), started = process.hrtime.bigint();
const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = join(root, 'RUN-01'), files = new Map(), children = [], guards = [], results = [];
let captureBytes = 0, peak = 1, workPeakBytes = 0, failure, seal, bindings, guard, status = 'HOLD', removed = false;
let globalTimer, childStop, publicationClosed = false;
const write = (name, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  assert.ok(captureBytes + bytes.length <= 16 * 1024 * 1024, 'capture ceiling');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(files.get(name), bytes, offset, bytes.length - offset);
  captureBytes += bytes.length;
};
const event = value => write('events.jsonl', JSON.stringify({ elapsedMs: elapsed(), ...value }) + '\n');
const usage = path => {
  if (!existsSync(path)) return 0;
  const info = lstatSync(path);
  assert.ok(!info.isSymbolicLink(), 'owned symlink refused');
  return info.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + usage(join(path, name)), 0) : info.size;
};
const capacity = () => {
  const bytes = usage(root);
  workPeakBytes = Math.max(workPeakBytes, bytes);
  assert.ok(bytes <= 128 * 1024 * 1024, 'owned disk ceiling');
  assert.ok(elapsed() < 300000, 'overall deadline');
};
async function launch(role) {
  assert.ok(elapsed() < seal.limits.admissionMilliseconds, 'admission deadline');
  assert.ok(children.length + 2 <= seal.limits.controlledProcesses);
  const row = { id: role.id, enrolledBeforeSpawn: true, args: [join(root, 'compiler.mjs'), role.id], stdoutBytes: 0, stderrBytes: 0, stdoutClosed: false, stderrClosed: false, closed: false, rescueSignals: [] };
  children.push(row);
  let child, timer, escalation, hardTimer, resolveClosed;
  const chunks = [], errors = [], closed = new Promise(resolve => { resolveClosed = resolve; });
  const stop = reason => {
    row.stopReason ??= reason;
    if (child && !row.closed) {
      row.rescueSignals.push('SIGTERM'); child.kill('SIGTERM');
      escalation ??= setTimeout(() => { if (!row.closed) { row.rescueSignals.push('SIGKILL'); child.kill('SIGKILL'); } }, 1000);
    }
  };
  childStop = stop;
  try {
    child = spawn(seal.node.path, row.args, { cwd: root, env: { PATH: dirname(seal.node.path), HOME: root, TMPDIR: seal.work, LANG: 'C', LC_ALL: 'C', TZ: 'America/Chicago', M1A_SEAL_SHA256: hash(readFileSync(join(root, 'PRESEAL.json'))) }, stdio: ['ignore', 'pipe', 'pipe'] });
    row.pid = child.pid; peak = Math.max(peak, 2);
    child.once('error', error => { row.spawnError = error.message; });
    child.once('exit', (code, signal) => { row.exit = { code, signal }; });
    child.once('close', (code, signal) => { row.closed = true; row.close = { code, signal }; resolveClosed(); });
    child.stdout.once('close', () => { row.stdoutClosed = true; });
    child.stderr.once('close', () => { row.stderrClosed = true; });
    for (const [stream, name, collection] of [[child.stdout, 'stdout', chunks], [child.stderr, 'stderr', errors]]) {
      stream.on('error', error => { row.captureError = error.message; stop('capture-error'); });
      stream.on('data', chunk => {
        try {
          write(name + '.raw', chunk); write(role.id + '.' + name + '.raw', chunk);
          row[name + 'Bytes'] += chunk.length;
          assert.ok(row.stdoutBytes + row.stderrBytes <= 4 * 1024 * 1024, 'role-output ceiling');
          collection.push(Buffer.from(chunk));
        } catch (error) { row.captureError = error.message; stop('capture-failure'); }
      });
    }
    event({ kind: 'child-started', ...row });
    timer = setTimeout(() => stop('child-deadline'), seal.limits.childMilliseconds);
    await Promise.race([closed, new Promise(resolve => { hardTimer = setTimeout(resolve, seal.limits.childMilliseconds + 5000); })]);
    assert.ok(row.closed, 'unknown child retirement');
  } finally {
    clearTimeout(timer); clearTimeout(hardTimer);
    if (!row.closed && child) {
      stop('finally-retirement');
      await Promise.race([closed, new Promise(resolve => { hardTimer = setTimeout(resolve, 5000); })]);
    }
    clearTimeout(hardTimer); clearTimeout(escalation); childStop = undefined;
    row.cleanupSettled = row.closed && row.stdoutClosed && row.stderrClosed;
    event({ kind: 'child-closed', ...row });
  }
  assert.ok(row.cleanupSettled && !row.stopReason && !row.spawnError && !row.captureError, 'controlled child safety');
  assert.equal(row.close.signal, null);
  return { row, stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errors).toString('utf8') };
}
try {
  mkdirSync(directory);
  for (const name of ['stdout.raw', 'stderr.raw', 'events.jsonl', 'receipt.json', 'positive.stdout.raw', 'positive.stderr.raw', 'negative-public-root.stdout.raw', 'negative-public-root.stderr.raw', 'timing.json']) files.set(name, openSync(join(directory, name), 'wx'));
  event({ kind: 'outer-startup', pid: process.pid, ppid: process.ppid, beforeSealAdmission: true, beforeChildLaunch: true });
  const sealBytes = readFileSync(join(root, 'PRESEAL.json'));
  seal = JSON.parse(sealBytes);
  event({ kind: 'seal-read', sha256: hash(sealBytes), expectedPresealCommit: process.env.M1A_PRESEAL_COMMIT ?? null });
  assert.match(process.env.M1A_PRESEAL_COMMIT ?? '', /^[a-f0-9]{40}$/, 'committed preseal identity required');
  for (const row of seal.files) assert.equal(hash(readFileSync(row.path)), row.sha256, row.path);
  const helpers = await import('./guard.mjs'); guard = helpers.guard;
  bindings = JSON.parse(readFileSync(join(root, 'INPUT-BINDINGS.json')));
  globalTimer = setTimeout(() => { failure ??= { message: 'global-admission-deadline' }; childStop?.('global-deadline'); }, seal.limits.admissionMilliseconds);
  capacity();
  guards.push({ phase: 'before', rows: await guard(seal, bindings) });
  event({ kind: 'admitted', guardRoots: guards[0].rows.length, packageMembers: seal.packageMembers });
  for (const role of seal.roles) {
    assert.ok(!failure, 'prior safety failure');
    const output = await launch(role);
    capacity();
    guards.push({ phase: 'after-' + role.id, rows: await guard(seal, bindings) });
    let report;
    try { report = JSON.parse(output.stdout); }
    catch (error) {
      failure = { message: 'compiler wrapper did not publish a valid report', primary: { role: role.id, exit: output.row.close, stderr: output.stderr }, secondary: { message: error.message } };
      event({ kind: 'secondary-report-parse-failure', failure });
      throw error;
    }
    assert.equal(report.schema, 'M1A-v13-compiler-result', 'wrapper/bootstrap failures stop dependent work');
    assert.equal(report.nestedProcessAttempts, 0); assert.equal(report.networkAttempts, 0);
    let verdict = 'FAIL', assertion;
    try {
      assert.equal(output.row.close.code, role.exitCode);
      assert.equal(output.stderr, '');
      assert.equal(report.schema, 'M1A-v13-compiler-result'); assert.equal(report.role, role.id);
      assert.equal(report.pid, output.row.pid); assert.equal(report.ppid, process.pid);
      assert.equal(report.nativeExitCode, role.exitCode);
      assert.deepEqual(report.args, role.args); assert.deepEqual(report.compiler, seal.compiler);
      assert.equal(report.consumerSha256, role.consumerSha256);
      assert.deepEqual(report.diagnostics, role.diagnostics); assert.equal(report.formatted, role.formatted);
      assert.equal(report.nestedProcessAttempts, 0); assert.equal(report.networkAttempts, 0);
      verdict = 'PASS';
    } catch (error) { assertion = { message: error.message, stack: error.stack }; }
    results.push({ role: role.id, verdict, assertion, actualExitCode: output.row.close.code, outputSha256: hash(output.stdout) });
    event({ kind: 'verdict', ...results.at(-1) });
  }
  status = results.length === 2 && results.every(row => row.verdict === 'PASS') ? 'SCOPED_PASS' : 'SCOPED_FAILURES';
} catch (error) {
  failure ??= { message: error.message, stack: error.stack };
  try { event({ kind: 'outer-failure', failure }); } catch {}
} finally {
  clearTimeout(globalTimer);
  try {
    assert.ok(children.every(row => row.cleanupSettled), 'unknown owned retirement; dependent work STOP');
    if (seal && bindings && guard) {
      guards.push({ phase: 'before-cleanup', rows: await guard(seal, bindings) });
      assert.equal(seal.work, join(root, 'work'));
      rmSync(seal.work, { recursive: true }); removed = !existsSync(seal.work);
      guards.push({ phase: 'after-cleanup', rows: await guard(seal, { ...bindings, censuses: bindings.censuses.filter(row => row.root !== seal.work), routes: bindings.routes.filter(row => !row.physical.startsWith(seal.work + '/')) }) });
    }
    capacity();
  } catch (error) { status = 'HOLD'; failure ??= { message: error.message, stack: error.stack }; }
  if (failure) status = 'HOLD';
  const receipt = { schema: 'M1A-v13-outer-receipt', status, failure, presealCommit: process.env.M1A_PRESEAL_COMMIT ?? null, sealSha256: seal ? hash(readFileSync(join(root, 'PRESEAL.json'))) : null, pid: process.pid, children, controlledProcesses: children.length + 1, peak, results, guards, workRemoved: removed, workPeakBytes, captureBytesBeforeReceipt: captureBytes, elapsedBeforePublicationMs: elapsed(), noUniversalProcessCensus: true };
  try {
    if (files.has('receipt.json')) write('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
    for (const [name, descriptor] of files) if (name !== 'timing.json') closeSync(descriptor);
    publicationClosed = true;
    if (files.has('timing.json')) { write('timing.json', JSON.stringify({ elapsedAfterReceiptAndRawClosureMs: elapsed(), captureBytesBeforeTiming: captureBytes, status, finalTimingWriteTailMeasured: false }) + '\n'); closeSync(files.get('timing.json')); }
  } catch (error) { status = 'HOLD'; failure ??= { message: error.message }; }
  if (!publicationClosed) for (const descriptor of files.values()) try { closeSync(descriptor); } catch {}
}
console.log(JSON.stringify({ status, elapsedThroughPublicationAndClosureMs: elapsed(), captureBytes, workPeakBytes, controlledProcesses: children.length + 1, peak, workRemoved: removed, failure }));
process.exitCode = status === 'SCOPED_PASS' ? 0 : 1;
