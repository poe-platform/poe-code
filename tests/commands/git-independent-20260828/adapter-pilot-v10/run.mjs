import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const started = process.hrtime.bigint();
const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(readFileSync(join(root, 'PRESEAL.json')));
const receipt = { schema: 'adapter-pilot-v10-author-cohort', startedWall: new Date().toISOString(), startedMonotonicNs: started.toString(),
  coordinatorPid: process.pid, children: [], guards: [], qualificationDirectChildren: 0, conservativeProcessCount: 1,
  syntaxChildren: 0, nativeOracleChildren: 0, peak: 1, captures: [], status: 'RUNNING' };
const inventory = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name); assert.ok(!entry.isSymbolicLink());
  return entry.isDirectory() ? [{ path, directory: true, bytes: 0 }, ...inventory(path)] : [{ path, sha256: hash(readFileSync(path)), bytes: statSync(path).size }];
}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
function guard(label) {
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  assert.equal(hash(readFileSync(seal.node.path)), seal.node.sha256);
  for (const row of seal.files) assert.equal(hash(readFileSync(join(root, row.path))), row.sha256, row.path);
  assert.deepEqual(readdirSync(root).filter(name => name !== 'RUN-01').sort(), [...seal.files.map(row => row.path), 'PRESEAL.json'].sort());
  for (const tree of seal.oldTrees) assert.deepEqual(inventory(tree.root), tree.rows, 'old bytes/census ' + tree.root);
  const toolFiles = inventory(seal.typescript.root);
  const expected = seal.typescript.rows.map(row => ({ path: join(seal.typescript.root, row.path), ...(row.directory ? { directory: true, bytes: 0 } : { bytes: row.bytes, sha256: row.sha256 }) }));
  assert.deepEqual(toolFiles, expected, 'entire TS tool input census');
  assert.ok(elapsed() < 590000, 'aggregate cleanup reserve');
  receipt.guards.push({ label, elapsedMs: elapsed(), allSealedHashes: true, oldCompleteDirectoryCensus: true, toolCensus: true });
}
const known = new Set();
function enroll(child, row) {
  const stdout = [], stderr = [];
  let complete;
  const closed = new Promise(resolve => { complete = resolve; });
  let escalation;
  const stop = reason => {
    row.stopReason ??= reason;
    if (!row.closeObserved) {
      row.signals.push({ signal: 'SIGTERM', accepted: child.kill('SIGTERM'), elapsedMs: elapsed() });
      escalation ??= setTimeout(() => { if (!row.closeObserved) row.signals.push({ signal: 'SIGKILL', accepted: child.kill('SIGKILL'), elapsedMs: elapsed() }); }, 1000);
    }
  };
  child.once('error', error => { row.error = String(error); stop('child error'); });
  child.once('exit', (code, signal) => { row.exit = { code, signal, elapsedMs: elapsed() }; });
  child.once('close', (code, signal) => { row.closeObserved = true; row.close = { code, signal, elapsedMs: elapsed() }; clearTimeout(escalation); complete(); });
  for (const [name, stream, pieces] of [['stdout', child.stdout, stdout], ['stderr', child.stderr, stderr]]) {
    stream.once('close', () => { row[name + 'Closed'] = true; });
    stream.on('error', error => { row.captureError = String(error); stop('stdio error'); });
    stream.on('data', bytes => {
      row.outputBytes += bytes.length;
      if (row.outputBytes > 18 * 1024 * 1024) stop('capture cap');
      else pieces.push(Buffer.from(bytes));
    });
  }
  row.listenersEnrolled = true;
  const cleanup = async () => {
    row.cleanupAttempted = true;
    if (!row.closeObserved) stop('known-owned finally');
    let timer;
    await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer); clearTimeout(escalation);
    row.cleanupSettled = row.closeObserved && row.stdoutClosed === true && row.stderrClosed === true;
    row.unknownClosure = !row.cleanupSettled;
  };
  return { closed, stop, cleanup, stdout, stderr };
}
let directory;
async function runChild(recipe, index) {
  const row = { role: recipe.role, args: recipe.argv, environment: seal.childEnvironment, pid: null, outputBytes: 0,
    signals: [], closeObserved: false, cleanupAttempted: false, cleanupSettled: false, startedMs: elapsed() };
  receipt.children.push(row);
  const child = spawn(seal.node.path, recipe.argv, { cwd: root, env: seal.childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  known.add(child);
  let owned, timer, hardTimer;
  try {
    owned = enroll(child, row);
    row.pid = child.pid; row.enrollment = 'known.add immediately after spawn, before fallible helpers';
    receipt.qualificationDirectChildren++; receipt.conservativeProcessCount++; receipt.peak = 2;
    const limit = index === 0 ? 120000 : 110000;
    timer = setTimeout(() => owned.stop('child deadline'), limit);
    await Promise.race([owned.closed, new Promise(resolve => { hardTimer = setTimeout(resolve, limit + 7000); })]);
    if (!row.closeObserved) owned.stop('unknown closure');
  } finally {
    clearTimeout(timer); clearTimeout(hardTimer);
    if (owned) await owned.cleanup();
    else {
      row.enrollmentFailed = true;
      child.on('error', () => {});
      let emergencyTimer;
      const emergency = new Promise(resolve => child.once('close', () => { row.closeObserved = true; resolve(); }));
      child.kill('SIGKILL');
      await Promise.race([emergency, new Promise(resolve => { emergencyTimer = setTimeout(resolve, 5000); })]);
      clearTimeout(emergencyTimer);
      row.unknownClosure = true;
    }
    for (const [suffix, pieces] of [['stdout.jsonl', owned?.stdout], ['stderr.txt', owned?.stderr]]) {
      if (pieces) {
        const bytes = Buffer.concat(pieces), path = join(directory, `child-${index + 1}.${suffix}`);
        writeFileSync(path, bytes, { flag: 'wx' });
        receipt.captures.push({ path, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  assert.ok(row.cleanupSettled && !row.unknownClosure, 'known handle closure');
  assert.equal(row.exit?.code, 0, 'nonzero child remains FAIL even if rows all PASS');
  assert.equal(row.exit?.signal, null); assert.equal(row.stopReason, undefined); assert.equal(row.captureError, undefined);
  assert.equal(Buffer.concat(owned.stderr).length, 0, 'stderr diagnostic stops');
  return Buffer.concat(owned.stdout).toString().trim().split('\n').map(line => JSON.parse(line));
}

try {
  guard('pre-setup');
  directory = join(root, 'RUN-01'); mkdirSync(directory);
  const setup = await runChild(seal.children[0], 0);
  assert.equal(setup[0].pid, receipt.children[0].pid); assert.equal(setup[0].ppid, process.pid);
  const manifestBytes = readFileSync(join(directory, 'MODULES.json')), manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.changedEmits, 5); assert.equal(manifest.originalEmitsReused, 219);
  const original = JSON.parse(readFileSync(join(root, 'PACKAGE-DATA.json'))).modules;
  const transforms = JSON.parse(readFileSync(join(root, 'TRANSFORMS.json'))).moduleTransforms;
  for (const item of manifest.files) {
    assert.equal(hash(readFileSync(item.path)), item.sha256);
    if (item.role === 'instrumented-emitted-module') {
      const emitted = manifest.transforms.find(row => item.path.endsWith(row.path.replace('src/', 'dist/').replace(/\.ts$/, '.js')));
      assert.ok(emitted); assert.equal(emitted.emittedSha256, item.sha256);
      assert.equal(emitted.transformedSourceSha256, transforms.find(row => row.path === emitted.path).transformedSha256);
    } else if (item.role === 'authenticated-original-emit') assert.equal(item.sha256, original.find(row => item.path.endsWith('/' + row.path)).sha256);
  }
  receipt.moduleManifestSha256BeforeLoad = hash(manifestBytes);
  assert.ok(elapsed() < 120000, 'setup inclusive compiler/guards <=120s');
  guard('before-candidate-load');
  const pilot = await runChild(seal.children[1], 1);
  assert.equal(pilot[0].pid, receipt.children[1].pid); assert.equal(pilot[0].ppid, process.pid);
  receipt.pilot = pilot.filter(row => row.kind === 'case').map(row => ({ id: row.id, passed: row.passed, safety: row.safety, mechanicalHolds: row.mechanicalHolds }));
  receipt.summary = pilot.find(row => row.kind === 'summary');
  assert.deepEqual(receipt.pilot.map(row => row.id), ['A57','A60','H09']);
  assert.ok(receipt.pilot.every(row => row.passed && !row.safety));
  assert.equal(receipt.summary?.stopped, false);
  assert.equal(hash(readFileSync(join(directory, 'MODULES.json'))), receipt.moduleManifestSha256BeforeLoad);
  for (const item of manifest.files) assert.equal(hash(readFileSync(item.path)), item.sha256);
  const loads = readFileSync(join(directory, 'loads.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const modules = loads.filter(row => row.kind === 'module-load');
  for (const item of modules) assert.equal(item.sha256, manifest.files.find(row => row.path === fileURLToPath(item.url)).sha256);
  assert.equal(modules.filter(row => row.role === 'instrumented-emitted-module').length, 5, 'all five actual loaded overlay identities');
  receipt.actualLoadedModules = modules.map(row => ({ url: row.url, sha256: row.sha256, role: row.role }));
  guard('post-owned-closure');
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'HOLD'; receipt.error = { message: error.message, stack: error.stack };
} finally {
  if (directory) {
    receipt.finishedWall = new Date().toISOString(); receipt.inclusiveBeforeReceiptMs = elapsed();
    receipt.workBytesBeforeReceipt = inventory(root).reduce((total, row) => total + row.bytes, 0);
    receipt.captureBytesBeforeReceipt = inventory(directory).filter(row => !row.path.includes('/app/')).reduce((total, row) => total + row.bytes, 0);
    receipt.boundsSatisfied = elapsed() < 600000 && receipt.workBytesBeforeReceipt + 262144 < 256 * 1024 * 1024 &&
      receipt.captureBytesBeforeReceipt + 262144 < 32 * 1024 * 1024 && receipt.conservativeProcessCount <= 12 && receipt.peak <= 2;
    writeFileSync(join(directory, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(join(directory, 'PUBLICATION-CLOCK.json'), JSON.stringify({ afterReceiptWriteMs: elapsed(), finalClockWriteTailMeasured: false }) + '\n', { flag: 'wx' });
  }
}
console.log(JSON.stringify({ status: receipt.status, error: receipt.error, summary: receipt.summary, children: receipt.children.map(row => ({ role: row.role, exit: row.exit, cleanupSettled: row.cleanupSettled })), elapsedMs: elapsed() }));
process.exitCode = receipt.status === 'PASS' && receipt.boundsSatisfied && elapsed() < 600000 ? 0 : 1;
