import assert from 'node:assert/strict';
import { owned, output, snapshot, freeze, build, verification } from './verify.mjs';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [runLabel] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]*$/u.test(runLabel ?? '')) throw new Error('new output label required');
const label = 'runtime-r1-verified';
const job = 'runtime';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verificationPath = resolve(output, runLabel + '-verification.json');
await writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
const entry = resolve(owned, `${job}.mjs`);
const claim = { verification, verificationSha256: hash(await readFile(verificationPath)), runnerSha256: hash(await readFile(new URL(import.meta.url))), label, job, time: new Date().toISOString(), source: freeze.commit, sourceManifestSha256: hash(await readFile(resolve(owned, 'evidence', `${label}-freeze.json`))), harnessSha256: hash(await readFile(entry)), heapMb: 128, watchdogMs: 20000, outputCap: 65536, ipcCap: 1024 * 1024, strictUnhandled: true, riskConsumed: 0 };
const result = await new Promise(resolveResult => {
  const child = fork(entry, [snapshot], { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', resolve(owned, 'runtime-r1-observer.mjs')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
  const state = { claim, pid: child.pid, events: [], stdout: '', stderr: '', result: null, killed: false };
  let bytes = 0;
  const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
  const timer = setTimeout(() => kill('exact child hard watchdog'), claim.watchdogMs);
  child.on('message', message => {
    if (JSON.stringify(message).length > claim.ipcCap) return kill('IPC cap');
    if (message.kind !== 'result') return kill('unexpected IPC');
    state.result = message;
  });
  for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    stream.on('data', chunk => { bytes += chunk.length; if (bytes > claim.outputCap) kill('output cap'); else state[key] += chunk; });
    stream.on('close', () => state.events.push(`${key}-close`));
  }
  child.on('error', error => { state.spawnError = String(error); });
  child.on('disconnect', () => state.events.push('disconnect'));
  child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
  child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ ...state, code, signal }); });
});
try { process.kill(result.pid, 0); result.exactChildAbsent = false; } catch (error) { if (error.code !== 'ESRCH') throw error; result.exactChildAbsent = true; }
await writeFile(resolve(output, `${runLabel}-result.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ label, job, code: result.code, killed: result.killed, pass: result.result?.pass, counts: result.result?.counts }));
assert.equal(result.code, 0);
assert.equal(result.signal, null);
assert.equal(result.killed, false);
assert.equal(result.exactChildAbsent, true);
assert.equal(result.stderr, '');
assert.equal(result.stdout, '');
for (const event of ['disconnect', 'stdout-close', 'stderr-close']) assert.ok(result.events.includes(event));
assert.equal(result.result?.pass, true);
assert.deepEqual(result.result.counts, { controls: 9, passed: 9, failed: 0 });
const observer = result.result.boundaryObserver;
for (const worker of observer.finalWorkers) {
  assert.equal(worker.exited, true);
  assert.equal(worker.terminationAwaited, true);
  assert.ok(Object.values(worker.listeners).every(count => count === 0));
}
for (const boundary of observer.boundaries.filter(item => item.kind === 'exec')) {
  assert.ok(boundary.contexts.every(context => context.abortListeners === 0));
  assert.equal(boundary.callerAbortListeners, boundary.callerAbortListenersBefore);
  for (const worker of boundary.workers.filter(item => item.originExecution === boundary.execution)) {
    assert.equal(worker.exited, true);
    assert.equal(worker.terminationAwaited, true);
    assert.ok(Object.values(worker.listeners).every(count => count === 0));
  }
}
console.log(JSON.stringify({ exactChildAbsent: result.exactChildAbsent, childPid: result.pid, finalWorkers: observer.finalWorkers.length, boundaries: observer.boundaries.length, riskConsumed: 0 }));
