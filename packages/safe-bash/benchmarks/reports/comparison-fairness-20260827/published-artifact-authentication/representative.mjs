import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyLaunch, checkClosure, stageObservers, digest } from './launch-seal.mjs';
import { requestObservation, boundedStep, finalizeSteps, accounting } from './driver-lifecycle.mjs';

const output = path.dirname(fileURLToPath(import.meta.url));
assert.equal(process.argv[2], '--approval');
assert.equal(Number(process.env.AUTH_SUPERVISOR_PID), process.ppid, 'owned supervisor required');
const verified = verifyLaunch(output, process.argv[3]);
assert.equal(verified.approvalSha256, process.env.AUTH_APPROVAL_SHA256);
const { plan, download, root } = verified;
const resultRoot = path.join(output, 'representative-v3-attempt-001');
assert.ok(fs.lstatSync(resultRoot).isDirectory());
const events = [], failures = [], active = new Set();
const controller = new AbortController();
let server, opening, serverClosePromise, serverClosing = false, observersPresent = false, globalExpired = false, journalFailure = null;
const write = (name, value) => fs.writeFileSync(path.join(resultRoot, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
function record(value) {
  const entry = { at: new Date().toISOString(), ...value }; events.push(entry);
  try { fs.appendFileSync(path.join(resultRoot, 'events.jsonl'), `${JSON.stringify(entry)}\n`); }
  catch (error) { journalFailure ??= String(error); if (!controller.signal.aborted) controller.abort('event journal failure'); }
}
const deadline = setTimeout(() => {
  globalExpired = true; record({ event: 'coordinator-deadline', milliseconds: 140000 });
  controller.abort('coordinator deadline');
}, 140000);
const onTerm = () => { record({ event: 'coordinator-sigterm' }); controller.abort('exceptional supervisor SIGTERM'); };
process.on('SIGTERM', onTerm);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const terminal = entry => entry.spawnFailed || entry.child.exitCode !== null || entry.child.signalCode !== null;
function closeServer() { serverClosePromise ??= Promise.resolve().then(() => server.close()); return serverClosePromise; }

async function closeChild(entry) {
  const { child, identity } = entry;
  entry.transport?.beginClosing();
  const errors = [], signals = [];
  if (child.connected) {
    record({ event: 'ipc-disconnect-request', ...identity, routine: true });
    try { child.disconnect(); } catch (error) { errors.push(String(error)); record({ event: 'ipc-disconnect-error', ...identity, error: String(error) }); }
  }
  for (const [signal, milliseconds] of [[null, 2000], ['SIGTERM', 2000], ['SIGKILL', 2000]]) {
    if (terminal(entry)) break;
    if (signal) {
      signals.push(signal); record({ event: 'cleanup-signal', ...identity, signal, exceptional: true });
      try { if (!child.kill(signal)) errors.push(`${signal}: kill returned false`); }
      catch (error) { errors.push(String(error)); record({ event: 'cleanup-signal-error', ...identity, signal, error: String(error) }); }
    }
    const until = Date.now() + milliseconds;
    while (!terminal(entry) && Date.now() < until) await delay(20);
  }
  const ended = terminal(entry);
  if (ended) { active.delete(entry); entry.transport?.markClosed(); }
  const lifecycle = { ...identity, terminal: ended, spawnFailed: entry.spawnFailed, code: child.exitCode, signal: child.signalCode, signals, errors, normal: ended && !entry.spawnFailed && child.exitCode === 0 && child.signalCode === null && signals.length === 0 && errors.length === 0 };
  record({ event: 'child-cleanup-settlement', ...lifecycle });
  return lifecycle;
}

async function run(selection) {
  assert.ok(!controller.signal.aborted, 'closing fence prohibits next child');
  const identity = { sequence: selection.sequence, profile: selection.profile, recipeId: selection.id, requestId: selection.sequence };
  const importLog = path.join(resultRoot, `imports-${selection.sequence}.jsonl`);
  const enginePath = path.join(root, 'profiles', selection.profile, 'benchmarks/expanded/engine.mjs');
  const environment = { PATH: `${path.dirname(download.executable)}:/usr/bin:/bin`, HOME: download.environment.HOME, TMPDIR: download.environment.TMPDIR, npm_config_cache: download.environment.npm_config_cache, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', AUTH_CLOSURE: root, AUTH_IMPORT_LOG: importLog, NODE_OPTIONS: `--import=${path.join(root, 'auth-observer/observe-process.mjs')}`, EXPANDED_ENGINE: 'just-bash', EXPANDED_SOURCE_ROOT: root, EXPANDED_BASELINE_ROOT: path.join(root, 'benchmarks/node_modules/just-bash') };
  const result = { ...identity, response: null, comparisons: null, lifecycle: null, errors: [], hostBytes: 0 };
  let entry;
  record({ event: 'child-launch-attempt', ...identity, enginePath, environment, executable: download.executable, executableSha256: download.nodeSha256 });
  try {
    assert.ok(!controller.signal.aborted, 'launch publication failed or coordinator closing');
    const child = fork(enginePath, [], { execPath: download.executable, cwd: root, env: environment, detached: false, execArgv: ['--expose-gc', '--unhandled-rejections=strict', '--import', 'tsx', '--max-old-space-size=256'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    identity.pid = child.pid ?? null; result.pid = identity.pid;
    entry = { child, identity, spawnFailed: false, spawned: false }; active.add(entry);
    child.once('spawn', () => { entry.spawned = true; record({ event: 'child-launched', ...identity }); });
    child.on('error', error => { if (!entry.spawned) entry.spawnFailed = true; record({ event: 'child-process-error', ...identity, error: String(error) }); controller.abort('engine child error'); });
    child.on('disconnect', () => record({ event: 'ipc-disconnected', ...identity }));
    entry.transport = requestObservation({ child, identity, recipe: selection.recipe, recipeSha256: selection.recipeSha256, baseUrl: server.baseUrl, emit: record, signal: controller.signal });
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      stream.on('data', bytes => {
        result.hostBytes += bytes.length;
        if (result.hostBytes > 1024 * 1024) { record({ event: 'host-output-limit', ...identity }); controller.abort('engine host output limit'); return; }
        try { fs.appendFileSync(path.join(resultRoot, `host-${selection.sequence}.${name}`), bytes); }
        catch (error) { record({ event: 'host-output-write-error', ...identity, error: String(error) }); controller.abort('engine host output write error'); }
      });
      stream.on('error', error => { record({ event: 'host-stream-error', ...identity, name, error: String(error) }); controller.abort('engine host stream error'); });
    }
    result.response = await entry.transport.promise;
    const { compare } = await import(pathToFileURL(path.join(root, 'profiles', selection.profile, 'benchmarks/expanded/common.mjs')));
    result.comparisons = result.response.observation ? { native: compare(selection.expectedNative, result.response.observation), oldBaseline: compare(selection.oldBaselineFourFields, result.response.observation) } : null;
  } catch (error) { result.errors.push(String(error.stack ?? error)); record({ event: 'run-error', ...identity, error: String(error) }); }
  finally {
    if (entry) {
      entry.transport?.beginClosing('run finally: no further request dispatch');
      try { result.lifecycle = await boundedStep(() => closeChild(entry), 6500); }
      catch (error) { result.errors.push(`cleanup: ${error}`); record({ event: 'child-cleanup-error', ...identity, error: String(error) }); }
    }
  }
  try {
    const bytes = fs.readFileSync(importLog);
    const trace = bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    result.trace = { sha256: digest(bytes), events: trace.length, forbiddenProcessAttempts: trace.filter(event => event.event === 'forbidden-extra-process-attempt').length, limitation: 'resolve/load hooks and engine ready protocol only; not universal evaluation/thread/process tracing' };
    if (result.trace.forbiddenProcessAttempts) result.errors.push('observer reported forbidden extra process attempt');
  } catch (error) { result.errors.push(`observer evidence: ${error}`); }
  write(`result-${selection.sequence}.json`, result);
  if (result.errors.length || result.response?.error || !result.comparisons?.oldBaseline.pass || !result.lifecycle?.normal || controller.signal.aborted) throw new Error('STOP: mismatch/infrastructure/lifecycle failure; no retry or remaining cases');
}

try {
  write('launch-binding.json', { approvalSha256: verified.approvalSha256, actualNodePath: process.execPath, actualNodeSha256: digest(fs.readFileSync(process.execPath)), selectedNodePath: download.executable, selectedNodeSha256: download.nodeSha256, inputHashes: verified.approval.files });
  write('integrity-before.json', checkClosure(verified, false));
  const staged = stageObservers(verified); observersPresent = true; write('integrity-staged.json', staged);
  const { localServer } = await boundedStep(() => import(pathToFileURL(path.join(root, 'profiles/original/benchmarks/expanded/server.mjs'))), 5000);
  opening = localServer().then(value => {
    server = value;
    if (serverClosing) boundedStep(closeServer, 2500).then(() => record({ event: 'late-loopback-closed' }), error => record({ event: 'late-loopback-close-error', error: String(error) }));
    return value;
  });
  await boundedStep(() => opening, 5000); assert.equal(new URL(server.baseUrl).hostname, '127.0.0.1');
  record({ event: 'loopback-open', baseUrl: server.baseUrl });
  for (const selection of plan.rows) await run(selection);
} catch (error) { failures.push(String(error.stack ?? error)); }
finally {
  controller.abort('coordinator finalization fence');
  const steps = [...active].map(entry => [`child-${entry.identity.sequence}`, () => boundedStep(() => closeChild(entry), 6500)]);
  steps.push(['network-evidence', () => write('network-requests.json', server?.requests ?? { unavailable: true })]);
  steps.push(['loopback-close', async () => {
    serverClosing = true;
    if (!server && opening) await boundedStep(() => opening, 2500);
    if (server) { await boundedStep(closeServer, 2500); record({ event: 'loopback-closed' }); }
    else record({ event: 'loopback-unavailable-at-close' });
  }]);
  steps.push(['integrity-after', () => write('integrity-after.json', checkClosure(verified, observersPresent))]);
  const finalization = await finalizeSteps(steps, record, 7000);
  failures.push(...finalization.filter(step => !step.success).map(step => `${step.name}: ${step.error}`));
  if (journalFailure) failures.push(`journal: ${journalFailure}`);
  const counts = accounting(events);
  if (counts.launchedChildren !== 8 || counts.requestSendCalls !== 8 || counts.requestSettlements !== 8 || counts.responseObservations !== 8 || counts.successfulSendCallbacks !== 8 || counts.failedSendCallbacks || counts.cleanupSignals || counts.timeoutSettlements || active.size || globalExpired) failures.push('incomplete counts or exceptional lifecycle');
  const requests = plan.rows.map(row => {
    const history = events.filter(event => event.sequence === row.sequence);
    return { sequence: row.sequence, profile: row.profile, id: row.id, launched: history.some(event => event.event === 'child-launched'), sendCalled: history.some(event => event.event === 'request-send-called'), settlement: history.find(event => event.event === 'request-settlement')?.kind ?? null, observationReceived: history.some(event => event.event === 'response-received' && event.observation), lifecycle: history.filter(event => event.event === 'child-cleanup-settlement').at(-1) ?? null, unlaunchedOrIncompleteIsNotPass: true };
  });
  try { write('summary.json', { completedAt: new Date().toISOString(), counts, requests, failures, finalization, globalExpired, activeChildren: active.size, actualGuestExecCount: 'not inferred from IPC send; only returned observation/engine protocol evidence', plannedObservations: 8, noNew224Score: true, noPerformanceEvidence: true }); }
  catch (error) { failures.push(`summary publication: ${error}`); record({ event: 'summary-write-error', error: String(error) }); }
  clearTimeout(deadline); process.removeListener('SIGTERM', onTerm);
}
process.exitCode = failures.length ? 1 : 0;
