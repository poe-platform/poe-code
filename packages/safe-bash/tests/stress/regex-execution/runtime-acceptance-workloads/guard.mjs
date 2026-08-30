import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { open, readFile, writeFile, unlink, mkdir, symlink, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owned, hash, prepared, authorize } from './binding.mjs';

const [job, approvalPath] = process.argv.slice(2);
const risks = ['grep-default', 'rg-default', 'grep-abort', 'rg-abort'];
assert.ok(['controls', 'benchmark', ...risks].includes(job), 'declared job required');
const preparation = await prepared();
const binding = job === 'controls' ? undefined : await authorize(job, approvalPath, preparation);
const lockPath = resolve(owned, 'evidence/active.lock');
const lock = await open(lockPath, 'wx');
let activeChild;
let interrupted;
const interrupt = signal => { interrupted = signal; activeChild?.kill('SIGKILL'); };
const onInt = () => interrupt('SIGINT');
const onTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onInt);
process.on('SIGTERM', onTerm);
async function run(control) {
  const watchdogMs = job === 'benchmark' ? 30000 : 6000;
  const entry = resolve(owned, '.temporary/compiled', job === 'benchmark' ? 'benchmark.mjs' : 'child.mjs');
  const args = job === 'benchmark' ? [binding.packageRoot, binding.baselineRoot] : [control ?? job, ...(binding ? [binding.packageRoot] : [])];
  const started = performance.now();
  return new Promise(resolveResult => {
    const child = fork(entry, args, { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--stack-size=1024'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
    activeChild = child;
    const state = { job: control ?? job, pid: child.pid, watchdogMs, events: [], stdout: '', stderr: '', result: null, killed: false };
    let bytes = 0;
    let ipcBytes = 0;
    let ready = false;
    let ownedTimer;
    const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; state.killSent = child.kill('SIGKILL'); } };
    const watchdog = setTimeout(() => kill('fixed parent watchdog'), watchdogMs);
    child.on('message', message => {
      ipcBytes += Buffer.byteLength(JSON.stringify(message));
      if (ipcBytes > 65536) return kill('cumulative IPC cap');
      if (message.kind === 'ready' && !ready) {
        ready = true;
        state.readyMs = performance.now() - started;
        state.events.push('ready');
        if (control === 'owned-timeout') ownedTimer = setTimeout(() => kill('benign owned timeout'), 75);
        child.send({ kind: 'run' }, error => { if (error) { state.sendError = String(error); kill('send error'); } });
      } else if (message.kind === 'result' && ready && !state.result) state.result = message;
      else kill('unexpected IPC');
    });
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => { bytes += chunk.length; if (bytes > 16384) kill('combined output cap'); else state[key] += chunk; });
      stream.on('close', () => state.events.push(`${key}-close`));
    }
    child.on('error', error => { state.spawnError = String(error); });
    child.on('disconnect', () => state.events.push('disconnect'));
    child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      clearTimeout(ownedTimer);
      activeChild = undefined;
      resolveResult({ ...state, code, signal, closeAwaited: true, childElapsedMs: performance.now() - started, outputBytes: bytes, ipcBytes });
    });
  });
}
try {
  if (binding) {
    const modules = resolve(owned, '.temporary/compiled/node_modules');
    await mkdir(modules, { recursive: true });
    const link = resolve(modules, 'virtual-bash');
    try { await symlink(binding.packageRoot, link); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    assert.equal(await realpath(link), binding.packageRoot);
  }
  await writeFile(resolve(owned, 'evidence', `${job}-claim.json`), JSON.stringify({ job, time: new Date().toISOString(), approvalSha256: binding?.approvalSha256, preparationSha256: hash(await readFile(resolve(owned, 'evidence/prepared.json'))), riskReserved: risks.includes(job) ? 1 : 0, noRetry: true, watchdogMs: job === 'benchmark' ? 30000 : 6000 }, null, 2) + '\n', { flag: 'wx' });
  const runs = [];
  if (job === 'controls') for (const control of ['success', 'already-aborted', 'owned-timeout', 'late-rejection']) { if (interrupted) break; runs.push(await run(control)); }
  else runs.push(await run());
  const pass = !interrupted && runs.length === (job === 'controls' ? 4 : 1) && runs.every(result => {
    if (!result.closeAwaited || !['ready', 'stdout-close', 'stderr-close', 'disconnect'].every(event => result.events.includes(event)) || result.spawnError || result.sendError) return false;
    if (result.job === 'late-rejection') return result.code === 1 && !result.killed && result.result === null && result.stderr.includes('standalone preserved late rejection');
    if (result.stderr !== '') return false;
    if (result.job === 'owned-timeout') return result.killed && result.killSent && result.killReason === 'benign owned timeout' && result.signal === 'SIGKILL' && result.result === null;
    return result.code === 0 && !result.killed && result.result?.pass;
  });
  const evidence = { job, pass, time: new Date().toISOString(), preparedSha256: hash(await readFile(resolve(owned, 'evidence/prepared.json'))), binding, interrupted, runs, riskConsumed: risks.includes(job) ? 1 : 0, activeChildren: activeChild ? 1 : 0 };
  await writeFile(resolve(owned, 'evidence', `${job}.json`), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ job, pass, children: runs.length, activeChildren: evidence.activeChildren, riskConsumed: evidence.riskConsumed }));
  if (!pass) process.exitCode = 1;
} finally {
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
  await lock.close();
  await unlink(lockPath);
}
