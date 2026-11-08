import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { verifyCorrection, originalImmutable, correctedImmutable } from './correction.mjs';
import { own, work, root as originalRoot, candidate, hash, json, save, write, immutable, oldBoundary, protectedLive, privateShape, verifyFreeze } from './common.mjs';

const root = path.join(work, 'run-v2');
const freezeCommit = process.argv[2];
const freeze = verifyFreeze(freezeCommit);
const correction = verifyCorrection(freezeCommit);
const evidence = path.join(own, 'evidence-v2');
assert(!fs.existsSync(evidence));
fs.mkdirSync(evidence);
const guard = await import(pathToFileURL(path.join(work, 'helpers/safejs-execution-v1/private-guard.mjs')));
const report = { candidate, freezeCommit, started: new Date().toISOString(), intended: 2, rows: [], children: [], guards: {}, passed: false };
let before;
function inputGuard() {
  verifyFreeze(freezeCommit);
  verifyCorrection(freezeCommit);
  assert.equal(hash(JSON.stringify(originalImmutable())), freeze.immutableSHA256, 'Original frozen inputs with only explicit run-v2 sibling excluded');
  assert.equal(hash(JSON.stringify(correctedImmutable())), correction.immutableSHA256, 'Corrected copy membership including additions');
  assert.deepEqual(oldBoundary(), freeze.boundary);
  assert.deepEqual(protectedLive(), freeze.protection);
  return { correctionImmutableSHA256: correction.immutableSHA256, immutableSHA256: freeze.immutableSHA256, oldBoundary: freeze.boundary.inventorySHA256, protectedPaths: 243, sourcePaths: 2, additionsChecked: true };
}
async function childRun(id) {
  const log = path.join(root, 'logs');
  const args = ['--max-old-space-size=256', '--unhandled-rejections=strict', '--import', path.join(root, 'loader.mjs'), '--import', path.join(root, 'consumer/harness/guard.mjs'), '--import', path.join(root, 'witness-loader.mjs'), path.join(root, 'consumer/harness/child.mjs')];
  const environment = { PATH: '/usr/bin:/bin', HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp'), XDG_CACHE_HOME: path.join(root, 'tmp'), TSX_DISABLE_CACHE: '1', LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0', SURFACE_ROOT: root, SURFACE_IMPORTS: path.join(log, `${id}.imports.ndjson`), WITNESS_LOAD: path.join(log, `${id}.witness.ndjson`), LIFECYCLE_ROW: id, PROBE_ID: id, PROBE_RESULT: path.join(log, `${id}.json`) };
  const child = spawn(path.join(root, 'tools/bin/node'), args, { cwd: path.join(root, 'consumer'), env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { id, pid: child.pid, started: new Date().toISOString(), executable: path.join(root, 'tools/bin/node'), args, environment, closed: false, termination: null, error: null };
  report.children.push(state);
  const output = { stdout: [], stderr: [] };
  let bytes = 0;
  const terminate = reason => { state.termination ??= reason; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timeout = setTimeout(() => terminate('watchdog-20000ms'), 20000);
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => { bytes += chunk.length; if (bytes > 262144) terminate('output-262144'); else output[stream].push(Buffer.from(chunk)); });
  child.on('error', error => { state.error = String(error); });
  const settled = await new Promise(resolve => child.on('close', (status, signal) => resolve({ status, signal })));
  clearTimeout(timeout);
  Object.assign(state, settled, { closed: true, finished: new Date().toISOString(), outputBytes: bytes });
  for (const stream of ['stdout', 'stderr']) write(path.join(log, `${id}.${stream}`), Buffer.concat(output[stream]));
  const result = fs.existsSync(environment.PROBE_RESULT) ? json(environment.PROBE_RESULT) : null;
  const imports = fs.existsSync(environment.SURFACE_IMPORTS) ? fs.readFileSync(environment.SURFACE_IMPORTS, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const witness = fs.existsSync(environment.WITNESS_LOAD) ? fs.readFileSync(environment.WITNESS_LOAD, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const row = { id, classification: 'INFRASTRUCTURE_NONPASS', runtimeCalls: result?.runtimeCalls ?? 0, builtinEntries: result?.builtinEntries.length ?? 0, guestAssertions: result?.engine?.returnValue?.assertions ?? 0, resultCaptured: result !== null };
  try {
    assert.equal(state.termination, null); assert.equal(state.error, null); assert.equal(state.signal, null);
    const binding = json(path.join(root, 'CURRENT-IMPORTS.json'));
    for (const entry of imports) { const expected = binding.files.find(file => file.path === entry.path); assert(expected); assert.equal(entry.sha256, expected.sha256); assert.equal(entry.candidateCommit, candidate); }
    const engine = imports.filter(entry => entry.kind === 'actual-engine-source-copy').map(entry => entry.path).sort();
    assert.deepEqual(engine, [...binding.allowedEnginePaths].sort());
    assert.equal(engine.length, 63);
    assert(imports.some(entry => entry.path === 'consumer/node_modules/virtual-bash/dist/index.js'));
    assert(imports.some(entry => entry.path === 'consumer/node_modules/virtual-bash/dist/shell/getopts.js'));
    assert.equal(witness.length, 1);
    assert.equal(witness[0].candidate, candidate);
    assert.equal(witness[0].originalSHA256, binding.files.find(entry => entry.path === witness[0].path).sha256);
    assert.equal(witness[0].occurrences, 1); assert.equal(witness[0].diskModified, false);
    row.importAudit = { engineFiles: engine.length, totalFiles: imports.length, witness: witness[0] };
    assert(result);
    row.classification = result.runtimeCalls && result.engine ? 'GUEST_NONPASS' : 'INFRASTRUCTURE_NONPASS';
    assert.equal(state.status, 0); assert.equal(result.passed, true); assert.equal(result.disposed, 2);
    assert.deepEqual(result.guard, { failures: [], activeTimers: 0, workersCreated: 0, subprocessesCreated: 0, socketsCreated: 0 });
    row.classification = 'PASS';
  } catch (error) { row.failure = { message: error.message, stack: error.stack }; }
  return row;
}
try {
  report.guards.before = inputGuard();
  before = guard.privateSnapshot();
  save(path.join(evidence, 'private-before.json'), before);
  guard.verifyPrivatePrecondition(before);
  assert.equal(hash(JSON.stringify(before)), freeze.privateSnapshotSHA256);
  assert.equal(hash(JSON.stringify(privateShape())), freeze.privateShapeSHA256);
  for (const id of ['G1', 'G2']) {
    inputGuard();
    const row = await childRun(id);
    report.rows.push(row);
    inputGuard();
    console.log(JSON.stringify({ id, classification: row.classification, guestAssertions: row.guestAssertions, builtinEntries: row.builtinEntries }));
    if (row.classification !== 'PASS') break;
  }
} catch (error) { report.failure = { message: error.message, stack: error.stack }; }
finally {
  try {
    const after = guard.privateSnapshot();
    save(path.join(evidence, 'private-after.json'), after);
    assert(before); assert.deepEqual(after, before);
    assert.equal(hash(JSON.stringify(privateShape())), freeze.privateShapeSHA256);
    report.guards.private = 'EXACTLY_UNCHANGED_INCLUDING_ELIGIBLE_ADDITIONS';
  } catch (error) { report.guards.private = { failure: error.message }; }
  try { report.guards.after = inputGuard(); } catch (error) { report.guards.after = { failure: error.message }; }
  for (const id of ['G1', 'G2']) if (!report.rows.some(row => row.id === id)) report.rows.push({ id, classification: 'BLOCKED', runtimeCalls: 0, reason: 'Earlier prerequisite or probe nonpass; no rescue' });
  report.counts = { pass: report.rows.filter(row => row.classification === 'PASS').length, guestNonpass: report.rows.filter(row => row.classification === 'GUEST_NONPASS').length, infrastructureNonpass: report.rows.filter(row => row.classification === 'INFRASTRUCTURE_NONPASS').length, blocked: report.rows.filter(row => row.classification === 'BLOCKED').length, denominator: 2 };
  report.knownLiveChildren = report.children.filter(child => !child.closed);
  report.passed = report.counts.pass === 2 && !report.failure && typeof report.guards.private === 'string' && !report.guards.after.failure && report.knownLiveChildren.length === 0;
  report.finished = new Date().toISOString();
  save(path.join(evidence, 'RESULTS.json'), report);
  if (!report.passed) process.exitCode = 1;
  console.log(JSON.stringify({ counts: report.counts, private: report.guards.private, childrenClosed: report.children.every(child => child.closed) }));
}
