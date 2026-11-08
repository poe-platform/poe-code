import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export const childBounds = Object.freeze({ timeoutMs: 300000, killGraceMs: 5000, maxCaptureBytes: 8388608 });

export async function series(rows, execute) {
  const results = [];
  for (const row of rows) {
    const result = await execute(row);
    assert.equal(result.id, row.id);
    assert(['public-pass-design-pending', 'public-pass', 'assertion-failure', 'cleanup-failure', 'adaptation-pending'].includes(result.status));
    results.push(result);
    if (result.cleanup !== 'clean' || result.status === 'cleanup-failure') return { results, stopped: true, reason: 'cleanup-failure' };
    if (result.status === 'adaptation-pending') return { results, stopped: true, reason: 'adaptation-pending' };
  }
  return { results, stopped: false };
}

export async function dispatchModes(execute) {
  const results = [];
  for (const mode of ['source', 'installed', 'moved']) {
    const result = await execute(mode);
    results.push({ mode, ...result });
    if (!result.naturalSettlement || !result.cleanupClean) break;
  }
  return results;
}

export function child(executable, args, options = {}) {
  const limits = { ...childBounds, ...options.bounds };
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const processChild = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let stopReason;
    let error;
    let killTimer;
    const groupAlive = () => {
      if (!processChild.pid) return false;
      try { process.kill(-processChild.pid, 0); return true; }
      catch (failure) { return failure.code !== 'ESRCH'; }
    };
    const killGroup = signal => {
      if (!processChild.pid) return;
      try { process.kill(-processChild.pid, signal); }
      catch (failure) { if (failure.code !== 'ESRCH') error = String(failure); }
    };
    const stop = reason => {
      if (stopReason) return;
      stopReason = reason;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), limits.killGraceMs);
    };
    const timer = setTimeout(() => stop('harness-timeout'), limits.timeoutMs);
    const capture = destination => chunk => {
      if (chunk.length > limits.maxCaptureBytes - bytes) { stop('capture-bound'); return; }
      bytes += chunk.length;
      destination.push(Buffer.from(chunk));
    };
    processChild.stdout.on('data', capture(stdout));
    processChild.stderr.on('data', capture(stderr));
    processChild.once('error', failure => { error = String(failure); });
    processChild.once('close', async (status, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const survivingGroup = groupAlive();
      if (survivingGroup) {
        stopReason ??= 'surviving-child-process-group';
        killGroup('SIGTERM');
        await new Promise(done => setTimeout(done, limits.killGraceMs));
        killGroup('SIGKILL');
      }
      resolve({ startedAt, finishedAt: new Date().toISOString(), status, signal, error, stopReason,
        stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), bytes,
        survivingGroup, groupStillPresent: groupAlive(),
        naturalSettlement: !stopReason && !signal && !error, cleanupClean: !stopReason && !signal && !error });
    });
  });
}
