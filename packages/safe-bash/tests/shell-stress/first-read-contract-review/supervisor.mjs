import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const owned = resolve('tests/shell-stress/first-read-contract-review');
export const candidate = resolve(owned, '.scratch/candidate');
export const cleanEnv = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1' };
const identity = pid => spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart=,command='], { encoding: 'utf8', timeout: 1000 }).stdout.trim();

export async function capture(label, command, args, { cwd = candidate, timeoutMs = 30000, maxBytes = 1024 * 1024, env = cleanEnv } = {}) {
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const initialIdentity = identity(child.pid);
  const signals = [];
  let timedOut = false;
  let oversized = false;
  let size = 0;
  const stdout = [];
  const stderr = [];
  const stop = reason => {
    const current = identity(child.pid);
    if (!current || !initialIdentity || current !== initialIdentity) throw new Error(`Cannot authenticate owned PID ${child.pid} for signal`);
    signals.push({ pid: child.pid, identity: current, reason, signal: 'SIGKILL' });
    process.kill(-child.pid, 'SIGKILL');
  };
  const append = target => chunk => {
    size += chunk.length;
    if (size > maxBytes) { if (!oversized) { oversized = true; stop('output bound'); } return; }
    target.push(chunk);
  };
  child.stdout.on('data', append(stdout));
  child.stderr.on('data', append(stderr));
  const timer = setTimeout(() => { timedOut = true; stop('deadline'); }, timeoutMs);
  const result = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => accept({ status, signal }));
  }).finally(() => clearTimeout(timer));
  let groupExists = false;
  try { process.kill(-child.pid, 0); groupExists = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const report = { label, command, args, cwd, env, startedAt, finishedAt: new Date().toISOString(), durationMs: performance.now() - start,
    timeoutMs, maxBytes, pid: child.pid, initialIdentity, ...result, timedOut, oversized, signals,
    closeEventObserved: true, pidAfterClose: identity(child.pid), groupExistsAfterClose: groupExists,
    stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
  mkdirSync(resolve(owned, 'evidence/runs'), { recursive: true });
  writeFileSync(resolve(owned, `evidence/runs/${label}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(resolve(owned, `evidence/runs/${label}.stdout`), Buffer.concat(stdout), { flag: 'wx' });
  writeFileSync(resolve(owned, `evidence/runs/${label}.stderr`), Buffer.concat(stderr), { flag: 'wx' });
  console.log(JSON.stringify({ label, status: result.status, durationMs: report.durationMs, timedOut, oversized, groupExists,
    counts: report.stdout.split('\n').filter(line => /^# (tests|pass|fail|cancelled|skipped) /.test(line)) }));
  if (groupExists || report.pidAfterClose || timedOut || oversized) throw new Error(`Unsafe/incomplete owned run: ${label}`);
  return report;
}
