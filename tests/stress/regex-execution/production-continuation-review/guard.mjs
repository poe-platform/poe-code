import { fork } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const owned = resolve('tests/stress/regex-execution/production-continuation-review');
const [name, job, label = job] = process.argv.slice(2);
if (!['baseline', 'candidate', 'packed'].includes(name) || !['cohort', 'lifecycle', 'globs', 'public', 'errors', 'walker', 'transport', 'benchmark'].includes(job) || !/^[a-z0-9-]+$/u.test(label)) throw new Error('only frozen benign jobs allowed; risk budget zero');
const source = name === 'packed' ? 'candidate' : name;
const snapshot = resolve(owned, 'snapshots', source);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = JSON.parse(await readFile(resolve(owned, `evidence/${source}-freeze.json`)));
const build = JSON.parse(await readFile(resolve(owned, `evidence/${source}/build.json`)));
if (build.status !== 0) throw new Error('isolated build failed');
for (const entry of [...freeze.identities, ...build.emitted]) {
  if (hash(await readFile(resolve(snapshot, entry.path))) !== entry.sha256) throw new Error(`snapshot drift ${entry.path}`);
}
const evidence = resolve(owned, 'evidence', name);
await mkdir(evidence, { recursive: true });
const claim = { time: new Date().toISOString(), name, job, label, sourceHead: freeze.head, sourceManifestSha256: hash(await readFile(resolve(owned, `evidence/${source}-freeze.json`))), childSha256: hash(await readFile(new URL('./child.mjs', import.meta.url))), heapMb: 128, watchdogMs: 20000, outputCap: 65536, ipcCap: 1024 * 1024, strictUnhandled: true, riskConsumed: 0 };
await writeFile(resolve(evidence, `${label}-claim.json`), JSON.stringify(claim, null, 2) + '\n', { flag: 'wx' });
const observation = await new Promise(resolveResult => {
  const entry = name === 'packed' ? resolve(owned, '.temporary/moved/child.mjs') : new URL('./child.mjs', import.meta.url);
  const child = fork(entry, [name, job], { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--stack-size=1024'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
  const state = { claim, pid: child.pid, events: [], stdout: '', stderr: '', result: null, killed: false };
  let bytes = 0;
  const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
  const timer = setTimeout(() => kill('exact child hard watchdog'), claim.watchdogMs);
  child.on('message', message => {
    if (JSON.stringify(message).length > claim.ipcCap) return kill('IPC cap');
    if (message.kind === 'ready') { state.events.push({ kind: 'ready' }); child.send({ kind: 'run' }); }
    else if (message.kind === 'result') state.result = message;
    else kill('unexpected IPC');
  });
  for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    stream.on('data', chunk => { bytes += chunk.length; if (bytes > claim.outputCap) kill('output cap'); else state[key] += chunk; });
    stream.on('close', () => state.events.push({ kind: `${key}-close` }));
  }
  child.on('error', error => { state.spawnError = String(error); });
  child.on('disconnect', () => state.events.push({ kind: 'disconnect' }));
  child.on('exit', (code, signal) => state.events.push({ kind: 'exit', code, signal }));
  child.on('close', (code, signal) => { clearTimeout(timer); state.code = code; state.signal = signal; resolveResult(state); });
});
await writeFile(resolve(evidence, `${label}.json`), JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ name, job, killed: observation.killed, code: observation.code, pass: observation.result?.pass, summary: observation.result?.summary }));
if (observation.killed || observation.code !== 0 || !observation.result?.pass) process.exitCode = 1;
