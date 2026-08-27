import { fork } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const owned = resolve('tests/stress/regex-execution/production-review');
const [snapshotName, job, label = job] = process.argv.slice(2);
if (!snapshotName || !job || !/^[a-z0-9-]+$/u.test(label)) throw new Error('snapshot job [unique-label] required');
const risky = job.startsWith('risk-');
const evidence = resolve(owned, 'evidence', snapshotName);
await mkdir(evidence, { recursive: true });
const claim = { snapshotName, job, label, time: new Date().toISOString(), risky, watchdogAfterReadyMs: risky ? 250 : 15000, outputCap: 65536, oldSpaceMb: 128, historical: '12 archived, prior revision 0/6; not rerun', reservation: risky ? 'reviewer one of four, no retry' : 'benign; no risk reservation consumed', harnessSha256: createHash('sha256').update(await readFile(new URL('./child.mjs', import.meta.url))).digest('hex') };
await writeFile(resolve(evidence, `${label}-claim.json`), JSON.stringify(claim, null, 2) + '\n', { flag: 'wx' });
const observation = await new Promise(resolveResult => {
  const child = fork(new URL('./child.mjs', import.meta.url), [snapshotName, job], { execArgv: ['--max-old-space-size=128', '--stack-size=1024'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
  const state = { claim, pid: child.pid, events: [], output: '', error: '', result: null, killed: false };
  let bytes = 0;
  let timer;
  const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
  const startup = setTimeout(() => kill('child startup watchdog'), 10000);
  child.on('message', message => {
    if (JSON.stringify(message).length > 1024 * 1024) return kill('IPC output cap');
    if (message.kind === 'ready') {
      state.events.push({ kind: 'ready', at: Date.now() });
      clearTimeout(startup);
      timer = setTimeout(() => kill('post-ready watchdog'), claim.watchdogAfterReadyMs);
      child.send({ kind: 'run' });
    } else if (message.kind === 'result') state.result = message;
    else state.events.push(message);
  });
  for (const [stream, key] of [[child.stdout, 'output'], [child.stderr, 'error']]) {
    stream.on('data', chunk => { bytes += chunk.length; if (bytes > claim.outputCap) kill('output cap'); else state[key] += chunk; });
    stream.on('close', () => state.events.push({ kind: `${key}-close` }));
  }
  child.on('error', error => { state.spawnError = String(error); });
  child.on('disconnect', () => state.events.push({ kind: 'disconnect' }));
  child.on('exit', (code, signal) => state.events.push({ kind: 'exit', code, signal }));
  child.on('close', (code, signal) => { clearTimeout(startup); clearTimeout(timer); state.code = code; state.signal = signal; resolveResult(state); });
});
await writeFile(resolve(evidence, `${label}.json`), JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ job, label, killed: observation.killed, code: observation.code, pass: observation.result?.pass, details: observation.result?.summary }));
if (observation.killed || observation.code !== 0 || !observation.result?.pass) process.exitCode = 1;
