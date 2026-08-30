import { spawn } from 'node:child_process';

export function ownership(id, role) {
  return { id, role, spawnAttempted: false, spawnReturned: false, spawnEvent: false, spawnThrew: false, spawnThrowReason: undefined, spawnErrorReason: undefined, child: undefined, pid: null, closeObserved: false, code: null, signal: null, groupAbsent: null, supervisorSettled: false, run: undefined, receipt: undefined };
}
export function retired(owner) {
  if (!owner.spawnAttempted) return true;
  if (owner.spawnThrew && !owner.spawnReturned) return true;
  if (!owner.supervisorSettled || !owner.closeObserved) return false;
  if (owner.pid !== null) return owner.groupAbsent === true;
  return !owner.spawnEvent && owner.spawnErrorReason !== undefined;
}
export async function supervise(executable, args, options, owner, clock, hooks = {}) {
  const started = new Date().toISOString(), startedElapsedMs = clock.elapsed();
  const timeoutMs = options.timeoutMs, maxBytes = options.maxBytes;
  let child, timer, killTimer, hardTimer, fault = null, failureReason, hasFailureReason = false, bytes = 0;
  const chunks = { stdout: [], stderr: [] };
  const fail = (label, reason) => { fault ??= label; if (!hasFailureReason) { hasFailureReason = true; failureReason = reason; } };
  const kill = signal => {
    if (owner.pid === null) return;
    try { process.kill(-owner.pid, signal); }
    catch (reason) { if (reason.code !== 'ESRCH') fail(`group-${signal}-failed`, reason); }
  };
  const terminate = label => {
    fault ??= label; kill('SIGTERM');
    killTimer ??= setTimeout(() => kill('SIGKILL'), Math.max(0, Math.min(200, clock.remaining())));
  };
  let closed;
  owner.spawnAttempted = true;
  try {
    child = (hooks.spawn ?? spawn)(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore','pipe','pipe'] });
    owner.child = child; owner.pid = child.pid ?? null; owner.spawnReturned = true;
  } catch (reason) {
    owner.spawnThrew = true; owner.spawnThrowReason = reason; fail('spawn-threw', reason);
  }
  try {
    if (child) {
      closed = new Promise(resolve => {
        child.once('close', (code, signal) => { owner.closeObserved = true; owner.code = code; owner.signal = signal; resolve(); });
        child.on('error', reason => { owner.spawnErrorReason = reason; fail('child-error', reason); });
        child.once('spawn', () => { owner.spawnEvent = true; owner.pid = child.pid ?? owner.pid; });
        hardTimer = setTimeout(() => { terminate('close-not-observed'); resolve(); }, Math.max(0, Math.min(timeoutMs + 2000, clock.remaining())));
      });
      for (const channel of ['stdout','stderr']) child[channel].on('data', chunk => {
        bytes += chunk.length;
        if (bytes <= maxBytes) chunks[channel].push(Buffer.from(chunk)); else terminate('output-ceiling');
      });
      timer = setTimeout(() => terminate('deadline'), Math.max(0, Math.min(timeoutMs, clock.remaining())));
      try { hooks.afterSpawn?.(owner); clock.check('after-spawn'); }
      catch (reason) { fail('after-spawn-hook', reason); terminate('after-spawn-hook'); }
      await closed;
    }
  } catch (reason) {
    fail('supervisor-setup', reason); terminate('supervisor-setup');
    if (closed) await closed;
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); clearTimeout(hardTimer);
    if (owner.pid !== null) {
      owner.groupAbsent = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { process.kill(-owner.pid, 0); }
        catch (reason) {
          if (reason.code === 'ESRCH') { owner.groupAbsent = true; break; }
          fail('group-probe-failed', reason); break;
        }
        fault ??= 'survived-close'; kill('SIGKILL');
        if (clock.remaining() <= 0) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(0, clock.remaining()))));
      }
    }
    owner.supervisorSettled = true;
  }
  const run = { executable, args, started, finished: new Date().toISOString(), startedElapsedMs, finishedElapsedMs: clock.elapsed(), pid: owner.pid, spawnAttempted: owner.spawnAttempted, spawnReturned: owner.spawnReturned, spawnEvent: owner.spawnEvent, spawnThrew: owner.spawnThrew, code: owner.code, signal: owner.signal, closeObserved: owner.closeObserved, groupAbsent: owner.groupAbsent, spawnError: owner.spawnErrorReason === undefined ? null : String(owner.spawnErrorReason), fault, bytes, stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') };
  owner.run = run;
  if (hasFailureReason) { owner.failureReason = failureReason; owner.hasFailureReason = true; }
  return run;
}
