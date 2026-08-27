import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const [label, job = 'registration', runLabel = job] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]*$/u.test(label ?? '') || !/^[a-z][a-z0-9-]*$/u.test(runLabel) || !['registration', 'runtime', 'throughput'].includes(job)) throw new Error('static benign job required');
const snapshot = resolve(owned, '.temporary', label);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-freeze.json`)));
if (job !== 'registration' && freeze.mode !== 'runtime-handoff') throw new Error('runtime controls require explicit root-relayed frozen handoff');
const build = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-build.json`)));
if (build.status !== 0) throw new Error('build prerequisite failed');
for (const entry of [...freeze.identities, ...build.emitted]) if (hash(await readFile(resolve(snapshot, entry.path))) !== entry.sha256) throw new Error(`snapshot drift: ${entry.path}`);
if (job === 'throughput') {
  const baseline = JSON.parse(await readFile(resolve(owned, 'evidence/baseline-freeze.json')));
  const baselineBuild = JSON.parse(await readFile(resolve(owned, 'evidence/baseline-build.json')));
  for (const entry of [...baseline.identities, ...baselineBuild.emitted]) if (hash(await readFile(resolve(owned, '.temporary/baseline', entry.path))) !== entry.sha256) throw new Error(`baseline drift: ${entry.path}`);
}
const entry = resolve(owned, `${job}.mjs`);
const claim = { label, job, time: new Date().toISOString(), source: freeze.commit, sourceManifestSha256: hash(await readFile(resolve(owned, 'evidence', `${label}-freeze.json`))), harnessSha256: hash(await readFile(entry)), heapMb: 128, watchdogMs: 20000, outputCap: 65536, ipcCap: 1024 * 1024, strictUnhandled: true, riskConsumed: 0 };
const result = await new Promise(resolveResult => {
  const child = fork(entry, [snapshot], { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
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
await writeFile(resolve(owned, 'evidence', `${label}-${runLabel}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ label, job, code: result.code, killed: result.killed, pass: result.result?.pass, counts: result.result?.counts }));
if (result.code !== 0 || result.killed || !result.result?.pass) process.exitCode = 1;
