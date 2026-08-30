import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename));
assert.equal(process.argv[2], '--approval', 'STOP: explicit root approval file required');
assert.ok(process.argv[3]?.startsWith('/tmp/safe-bash-baseline-auth-'));
const approval = read(process.argv[3]);
assert.equal(approval.approved, true); assert.equal(approval.authority, 'root');
const approvedFiles = ['representative.mjs', 'observe-process.mjs', 'observe-load.mjs', 'representative-plan-v2.json', 'execution-closure.json'];
for (const filename of approvedFiles) assert.equal(hash(fs.readFileSync(path.join(output, filename))), approval.files?.[filename], `approval hash ${filename}`);
assert.equal(hash(fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt')), approval.textPlanSha256);
assert.equal(approval.resultBearingCalls, 8); assert.equal(approval.engineChildren, 8);
const plan = read(path.join(output, 'representative-plan-v2.json'));
const closure = read(path.join(output, 'execution-closure.json'));
const download = read(path.join(output, 'download.json'));
assert.equal(plan.rows.length, 8); assert.equal(plan.budget.warmups, 0);
assert.equal(read(path.join(output, 'package-comparison.json')).allEqual, true);
const root = fs.realpathSync(closure.root);
const resultRoot = path.join(output, 'representative-attempt-001');
fs.mkdirSync(resultRoot);
const write = (name, value) => fs.writeFileSync(path.join(resultRoot, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const record = value => fs.appendFileSync(path.join(resultRoot, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
function checkClosure() {
  const failures = [];
  for (const entry of closure.files) {
    const filename = path.join(root, entry.path), stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || hash(fs.readFileSync(filename)) !== entry.sha256 || (stat.mode & 0o777) !== entry.mode) failures.push(entry.path);
  }
  assert.equal(failures.length, 0, 'closure hash/mode gate');
  return { files: closure.files.length, failures };
}
write('integrity-before.json', checkClosure());
const observerRoot = path.join(root, 'auth-observer');
fs.mkdirSync(observerRoot, { mode: 0o700 });
for (const filename of ['observe-process.mjs', 'observe-load.mjs']) fs.copyFileSync(path.join(output, filename), path.join(observerRoot, filename), fs.constants.COPYFILE_EXCL);
const approvedObserverHashes = Object.fromEntries(['observe-process.mjs', 'observe-load.mjs'].map(filename => [filename, hash(fs.readFileSync(path.join(observerRoot, filename)))]));
const active = new Set();
const results = [];
let server, globalExpired = false, failure = null;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const globalTimer = setTimeout(() => { globalExpired = true; for (const child of active) child.kill('SIGTERM'); }, 150000);
function terminal(child) { return child.exitCode !== null || child.signalCode !== null; }
async function closeChild(child, identity) {
  if (child.connected) { record({ event: 'ipc-disconnect-request', ...identity }); child.disconnect(); }
  for (const [signal, timeout] of [[null, 2000], ['SIGTERM', 2000], ['SIGKILL', 2000]]) {
    if (terminal(child)) break;
    if (signal) { record({ event: 'cleanup-signal', ...identity, signal }); child.kill(signal); }
    const started = Date.now();
    while (!terminal(child) && Date.now() - started < timeout) await delay(20);
  }
  assert.ok(terminal(child), 'owned child failed cleanup');
  active.delete(child);
  return { code: child.exitCode, signal: child.signalCode, normal: child.exitCode === 0 && child.signalCode === null };
}
async function run(selection) {
  const identity = { sequence: selection.sequence, profile: selection.profile, recipeId: selection.id, requestId: selection.sequence };
  const importLog = path.join(resultRoot, `imports-${selection.sequence}.jsonl`);
  const enginePath = path.join(root, 'profiles', selection.profile, 'benchmarks/expanded/engine.mjs');
  const environment = { PATH: `${path.dirname(download.executable)}:/usr/bin:/bin`, HOME: download.environment.HOME, TMPDIR: download.environment.TMPDIR, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', AUTH_CLOSURE: root, AUTH_IMPORT_LOG: importLog, NODE_OPTIONS: `--import=${path.join(observerRoot, 'observe-process.mjs')}`, EXPANDED_ENGINE: 'just-bash', EXPANDED_SOURCE_ROOT: root, EXPANDED_BASELINE_ROOT: path.join(root, 'benchmarks/node_modules/just-bash') };
  const child = fork(enginePath, [], { execPath: download.executable, cwd: root, env: environment, execArgv: ['--expose-gc', '--unhandled-rejections=strict', '--import', 'tsx', '--max-old-space-size=256'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  active.add(child); identity.pid = child.pid;
  record({ event: 'child-launched', ...identity, enginePath, environment });
  let hostBytes = 0;
  for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream.on('data', bytes => { hostBytes += bytes.length; if (hostBytes > 1024 * 1024) child.kill('SIGTERM'); else fs.appendFileSync(path.join(resultRoot, `host-${selection.sequence}.${name}`), bytes); });
  let state = 'starting', requested = false, timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('startup deadline')), 15000);
      child.once('error', reject);
      child.once('exit', (code, signal) => { record({ event: 'child-exit', ...identity, code, signal, state }); if (state !== 'settled') reject(new Error(`premature child exit ${code}/${signal}`)); });
      child.on('message', message => {
        if (state === 'starting') {
          clearTimeout(timer);
          if (message.ready !== true) { reject(new Error(`entry import failed: ${message.error}`)); return; }
          record({ event: 'ready-received', ...identity, interpretation: 'exact engine sends ready only after awaited baseline entry import resolves' });
          state = 'requested'; requested = true;
          record({ event: 'request-send', ...identity, recipeSha256: selection.recipeSha256, instrument: true, warmup: 0 });
          timer = setTimeout(() => reject(new Error('request deadline')), 10000);
          child.send({ id: identity.requestId, specimen: selection.recipe, baseUrl: server.baseUrl, instrument: true, warmup: 0 }, error => { if (error) reject(error); });
        } else if (state === 'requested' && message.id === identity.requestId) {
          clearTimeout(timer); state = 'settled';
          record({ event: 'response-settled', ...identity, hasObservation: Boolean(message.observation), error: message.error ?? null });
          resolve(message);
        } else record({ event: 'unexpected-message', ...identity, message });
      });
    });
    const { compare } = await import(pathToFileURL(path.join(root, 'profiles', selection.profile, 'benchmarks/expanded/common.mjs')));
    const comparisons = response.observation ? { native: compare(selection.expectedNative, response.observation), oldBaseline: compare(selection.oldBaselineFourFields, response.observation) } : null;
    return { ...identity, requested, response, comparisons, expectedOldStatus: selection.oldBaselineStatus, hostBytes };
  } catch (error) {
    return { ...identity, requested, error: String(error.stack ?? error), hostBytes };
  } finally { clearTimeout(timer); const lifecycle = await closeChild(child, identity); write(`lifecycle-${selection.sequence}.json`, { ...identity, ...lifecycle }); }
}
try {
  write('approval.json', { path: process.argv[3], value: approval });
  const { localServer } = await import(pathToFileURL(path.join(root, 'profiles/original/benchmarks/expanded/server.mjs')));
  server = await localServer(); assert.equal(new URL(server.baseUrl).hostname, '127.0.0.1');
  record({ event: 'loopback-open', baseUrl: server.baseUrl });
  for (const selection of plan.rows) {
    assert.ok(!globalExpired, 'global deadline');
    const result = await run(selection);
    results.push(result); write(`result-${selection.sequence}.json`, result);
    const lifecycle = read(path.join(resultRoot, `lifecycle-${selection.sequence}.json`));
    if (result.error || result.response?.error || !result.comparisons?.oldBaseline.pass || !lifecycle.normal) throw new Error('STOP: representative mismatch/infrastructure/lifecycle failure; no retry or remaining cases');
  }
} catch (error) { failure = String(error.stack ?? error); }
finally {
  clearTimeout(globalTimer);
  for (const child of [...active]) await closeChild(child, { pid: child.pid, cleanupAfterFailure: true });
  if (server) { write('network-requests.json', server.requests); await server.close(); record({ event: 'loopback-closed' }); }
  write('integrity-after.json', checkClosure());
  for (const [filename, digest] of Object.entries(approvedObserverHashes)) assert.equal(hash(fs.readFileSync(path.join(observerRoot, filename))), digest);
  write('summary.json', { completedAt: new Date().toISOString(), productRequests: results.filter(row => row.requested).length, startedChildren: results.length, plannedCalls: 8, observations: results.filter(row => row.response?.observation).length, failure, globalExpired, activeChildren: active.size, oldObservationsMatch: results.every(row => row.comparisons?.oldBaseline.pass), noNew224Score: true, noPerformanceEvidence: true, note: 'Known baseline native failures remain failures; subset is not a new denominator or union.' });
}
if (failure) throw new Error(failure);
