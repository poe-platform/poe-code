import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = process.argv[2];
if (typeof root !== 'string' || !/^\/private\/tmp\/git-m1b-fca-independent-[A-Za-z0-9-]{8,80}$/.test(root)) throw new Error('TRUSTED_CAPTURE_ROOT_REQUIRED');
await fs.mkdir(root, { mode: 0o700 });
const captureRoot = path.join(root, 'outer');
await fs.mkdir(captureRoot, { mode: 0o700 });
const handles = {};
for (const name of ['stdout', 'stderr', 'events']) handles[name] = await fs.open(path.join(captureRoot, name + '.raw'), 'wx', 0o600);
const counts = { stdout: 0, stderr: 0, events: 0 };
const limits = { stdout: 1048576, stderr: 1048576, events: 524288 };
let failure = null;
let captureFailure = null;
let child;
let closed = false;
let code = null;
let signal = null;
let rootEnd;
let retired;
let stopArmed = false;
let result;
let activePhaseTimer;
let phaseState = { index: 0, next: 'BODY', active: null };
let chain = Promise.resolve();
let totalStarts = 1;
let peak = 1;
const known = new Map();
const timers = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function demand(condition, label) { if (!condition) throw new Error(label); }
function fail(reason) { failure ??= String(reason).slice(0, 8192); }
async function append(name, bytes) {
  demand(counts[name] + bytes.length <= limits[name], 'OUTER_CAPTURE_LIMIT');
  counts[name] += bytes.length;
  await handles[name].writeFile(bytes);
  await handles[name].sync();
}
async function event(value) { await append('events', Buffer.from(JSON.stringify(value) + '\n')); }
async function bound(filename, identity, maximum = 1048576) {
  demand(await fs.realpath(filename) === filename, 'OUTER_SOURCE_REALPATH');
  const stat = await fs.lstat(filename);
  demand(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'OUTER_SOURCE_KIND_SIZE');
  if (identity) demand(stat.size === identity.bytes && (stat.mode & 0o777) === identity.mode, 'OUTER_SOURCE_MODE_SIZE');
  const body = await fs.readFile(filename);
  if (identity) demand(sha(body) === identity.sha256, 'OUTER_SOURCE_HASH');
  return body;
}
function stop(reason) {
  fail(reason);
  if (child && !closed && !stopArmed) {
    stopArmed = true;
    const left = rootEnd ? Math.max(0, Number(rootEnd - process.hrtime.bigint()) / 1000000) : 5000;
    const window = Math.min(5000, left);
    timers.push(setTimeout(() => { if (!closed) child.kill('SIGTERM'); }, Math.max(1, window - 2000)));
    timers.push(setTimeout(() => {
      if (!closed) child.kill('SIGKILL');
      for (const pid of known.keys()) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') fail('OWNED_KILL_FAILURE'); } }
    }, Math.max(1, window - 1000)));
    timers.push(setTimeout(() => { if (!closed || known.size) fail('UNKNOWN_OWNED_RETIREMENT'); retired?.(); }, Math.max(1, window)));
  }
  if (child?.connected) child.send({ role: 'ROOT_CANCEL', reason: String(reason).slice(0, 128) }, error => { if (error) fail('OUTER_CANCEL_DELIVERY'); });
  for (const pid of known.keys()) { try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') fail('OWNED_TERM_FAILURE'); } }
}
try {
  await event({ role: 'TRUSTED_OUTER_STARTUP_CAPTURE_ESTABLISHED', argv: process.argv.slice(2), pid: process.pid, targetStarts: 0, captureReservationBytes: 4194304 });
  demand(process.argv.length === 6 && process.execArgv.length === 0 && !process.env.NODE_OPTIONS && !process.env.NODE_PATH && process.umask() === 0o022, 'OUTER_EXACT_INVOCATION');
  const [, , , routePath, routeHash, originNs] = process.argv;
  demand(/^[a-f0-9]{64}$/.test(routeHash) && /^[0-9]{1,24}$/.test(originNs), 'ROOT_ROUTE_IDENTITY');
  const origin = BigInt(originNs);
  rootEnd = origin + 7200000000000n;
  demand(process.hrtime.bigint() >= origin && process.hrtime.bigint() < rootEnd - 5000000000n, 'ROOT_ORIGIN');
  const routeStat = await fs.lstat(routePath);
  demand((routeStat.mode & 0o777) === 0o600 && routeStat.size <= 65536, 'ROOT_ROUTE_MODE_SIZE');
  const routeBytes = await bound(routePath, undefined, 65536);
  demand(sha(routeBytes) === routeHash, 'ROOT_ROUTE_HASH');
  const route = JSON.parse(routeBytes.toString('utf8'));
  demand(route.outputRoot === root && route.originHrtimeNs === originNs, 'ROOT_CAPTURE_ROUTE_BINDING');
  const scope = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const recipePath = path.join(scope, 'RECIPE-v7.json');
  const recipeBytes = await bound(recipePath);
  demand(sha(recipeBytes) === route.recipeSha256, 'OUTER_RECIPE_HASH');
  const recipe = JSON.parse(recipeBytes.toString('utf8'));
  demand(recipe.state === 'COMPLETE_PRESEAL' && recipe.caps.outerCaptureBytes === 4194304, 'OUTER_RECIPE_STATE');
  for (const row of recipe.bootstrapFiles) await bound(path.join(scope, row.path), row);
  const { acceptPhaseMessage } = await import(new URL('./batch-phases.mjs', import.meta.url));
  await bound(process.execPath, recipe.bootstrapNode, 134217728);
  demand(process.execPath === recipe.bootstrapNode.origin, 'OUTER_NODE_PATH');
  const launch = path.join(scope, 'runner/v7/launch.mjs');
  const remaining = () => Math.max(0, Number(rootEnd - process.hrtime.bigint()) / 1000000);
  const retirement = new Promise(resolve => { retired = resolve; });
  demand(remaining() > 5000, 'OUTER_ADMISSION_DEADLINE');
  child = spawn(process.execPath, [launch, '--root-receipt', routePath, '--expect-root', routeHash], {
    cwd: recipe.repo, env: { PATH: '', HOME: root, TMPDIR: root, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', M1B_OUTER_ROOT: root },
    shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json'
  });
  totalStarts++;
  peak = 2;
  chain = chain.then(() => event({ role: 'COORDINATOR_START', pid: child.pid ?? null, totalStartsIncludingOuter: totalStarts })).catch(error => stop(error));
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    child[stream].pause();
    chain = chain.then(() => append(stream, bytes)).catch(error => { captureFailure ??= String(error); stop('OUTER_CAPTURE_FAILURE'); }).finally(() => child[stream].resume());
  });
  child.on('message', message => {
    chain = chain.then(async () => {
      demand(Buffer.byteLength(JSON.stringify(message)) <= 65536, 'OUTER_IPC_BOUND');
      await event({ role: 'COORDINATOR_IPC_RAW', message });
      if (message.role === 'OWNED_CHILD_START') {
        demand(Number.isSafeInteger(message.pid) && message.pid > 0 && !known.has(message.pid) && ++totalStarts <= 169, 'OUTER_OWNED_START');
        known.set(message.pid, message.id);
        peak = Math.max(peak, known.size + 2);
        demand(peak <= 4, 'OUTER_PEAK');
      } else if (message.role === 'OWNED_CHILD_CLOSE') {
        demand(known.get(message.pid) === message.id, 'OUTER_RETIREMENT_IDENTITY');
        known.delete(message.pid);
        if (message.code !== 0 || message.signal !== null) fail('OWNED_CHILD_NONZERO_OR_SIGNAL');
      } else if (message.role === 'BATCH_PHASE_START' || message.role === 'BATCH_PHASE_END') {
        const nowOffsetMs = Number(process.hrtime.bigint() - origin) / 1000000;
        phaseState = acceptPhaseMessage(message, phaseState, recipe, nowOffsetMs);
        clearTimeout(activePhaseTimer);
        if (phaseState.active) {
          const phase = phaseState.active;
          activePhaseTimer = setTimeout(() => stop(phase.kind + '_PHASE_WATCHDOG'), Math.max(1, phase.deadlineOffsetMs - nowOffsetMs - 5000));
          timers.push(activePhaseTimer);
        }
      } else if (message.role === 'COORDINATOR_RESULT') {
        demand(result === undefined, 'DUPLICATE_COORDINATOR_RESULT');
        result = message.result;
      } else throw new Error('UNKNOWN_OUTER_MESSAGE');
    }).catch(error => { stop(error); });
  });
  child.on('error', error => { fail(error); });
  child.on('close', (exitCode, exitSignal) => { closed = true; code = exitCode; signal = exitSignal; retired(); });
  timers.push(setTimeout(() => stop('ROOT_DEADLINE'), Math.max(1, remaining() - 5000)));
  timers.push(setTimeout(() => { if (!closed) child.kill('SIGTERM'); }, Math.max(1, remaining() - 2000)));
  timers.push(setTimeout(() => {
    if (!closed) child.kill('SIGKILL');
    for (const pid of known.keys()) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') fail('OWNED_KILL_FAILURE'); } }
  }, Math.max(1, remaining() - 1000)));
  timers.push(setTimeout(() => { if (!closed || known.size) fail('UNKNOWN_OWNED_RETIREMENT'); retired(); }, Math.max(1, remaining())));
  await retirement;
  for (const timer of timers) clearTimeout(timer);
  let drained = false;
  let captureTimer;
  await Promise.race([chain.then(() => { drained = true; }), new Promise(resolve => { captureTimer = setTimeout(resolve, Math.max(1, remaining())); })]);
  clearTimeout(captureTimer);
  demand(drained, 'OUTER_CAPTURE_RETIREMENT_UNKNOWN');
  demand(closed && code === 0 && signal === null && known.size === 0 && result?.active === 0 && result?.unsafe === null && result?.status === 'PASS_SCOPED_ONLY', 'OUTER_RESULT_NOT_PASS');
} catch (error) { fail(error); }
finally {
  for (const timer of timers) clearTimeout(timer);
  if (child && !closed) {
    child.kill('SIGKILL');
    let timer;
    await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => { timer = setTimeout(resolve, Math.max(1, Math.min(5000, rootEnd ? Number(rootEnd - process.hrtime.bigint()) / 1000000 : 1))); })]);
    clearTimeout(timer);
    if (!closed) fail('UNKNOWN_COORDINATOR_RETIREMENT');
  }
  if (known.size) fail('UNKNOWN_OWNED_CLEANUP');
  try {
    let drained = false;
    let timer;
    await Promise.race([chain.then(() => { drained = true; }), new Promise(resolve => { timer = setTimeout(resolve, Math.max(1, rootEnd ? Number(rootEnd - process.hrtime.bigint()) / 1000000 : 1)); })]);
    clearTimeout(timer);
    if (!drained) fail('OUTER_CAPTURE_CHAIN_UNKNOWN');
  } catch { fail('OUTER_CAPTURE_CHAIN'); }
  for (const handle of Object.values(handles)) { try { await handle.sync(); await handle.close(); } catch { fail('OUTER_CAPTURE_CLOSE'); } }
  let actualBytes = 0;
  let entries = 0;
  try {
    const walk = async directory => {
      for (const name of await fs.readdir(directory)) {
        demand(++entries <= 20000, 'OUTER_FINAL_MEMBERSHIP_CAP');
        const filename = path.join(directory, name);
        const stat = await fs.lstat(filename);
        demand(!stat.isSymbolicLink(), 'OUTER_FINAL_SYMLINK');
        if (stat.isDirectory()) await walk(filename);
        else { demand(stat.isFile(), 'OUTER_FINAL_KIND'); actualBytes += stat.size; }
      }
    };
    await walk(root);
    demand(actualBytes <= 1072693248, 'OUTER_FINAL_WORK_HEADROOM');
    if (rootEnd && process.hrtime.bigint() > rootEnd) fail('OUTER_FINALIZATION_DEADLINE');
    const receipt = { status: failure || captureFailure ? 'FAIL' : 'PASS_SCOPED_ONLY', failure, captureFailure, coordinator: { pid: child?.pid ?? null, code, signal, closed }, knownOutstanding: [...known], totalStartsIncludingOuter: totalStarts, peak, counts, actualFileBytesBeforeReceipt: actualBytes, result: result ?? null };
    const body = Buffer.from(JSON.stringify(receipt) + '\n');
    demand(body.length <= 1048576 && Object.values(counts).reduce((total, bytes) => total + bytes, 0) + body.length <= 4194304, 'OUTER_TERMINAL_RESERVE');
    const handle = await fs.open(path.join(captureRoot, 'FINAL.json'), 'wx', 0o600);
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    actualBytes += body.length;
    demand(actualBytes <= 1073741824 && (!rootEnd || process.hrtime.bigint() <= rootEnd), 'OUTER_FINAL_ACTUAL_BOUND');
  } catch { fail('OUTER_FINALIZATION_FAILURE'); }
  process.exitCode = failure || captureFailure ? 1 : 0;
}
