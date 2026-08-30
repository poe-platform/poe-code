import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeNew, fingerprint } from '../core.mjs';

export class IntegrityFailure extends Error {}

export async function supervise(spec) {
  assert.ok(Number.isSafeInteger(spec.timeoutMs) && spec.timeoutMs > 0 && spec.timeoutMs <= 60000);
  assert.ok(Number.isSafeInteger(spec.rawBytes) && spec.rawBytes > 0);
  await mkdir(spec.directory);
  await writeNew(path.join(spec.directory, 'START.json'), { executable: await fingerprint(spec.executable), args: spec.args,
    timeoutMs: spec.timeoutMs, rawBytes: spec.rawBytes, logBytes: 16384, kind: spec.kind, started: new Date().toISOString() });
  const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: { PATH: '', LANG: 'C', TZ: 'UTC' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let timeout = false; let overflow = false; let spawnError; let killTimer;
  const kill = () => { child.kill('SIGTERM'); killTimer ??= setTimeout(() => child.kill('SIGKILL'), 100); };
  const timer = setTimeout(() => { timeout = true; kill(); }, spec.timeoutMs);
  const closed = new Promise(resolve => { child.once('error', error => { spawnError = error.code ?? error.name; }); child.once('close', (code, signal) => resolve({ code, signal })); });
  async function spool(stream, filename, bound) {
    const file = await open(path.join(spec.directory, filename), 'wx', 0o644);
    const retained = createHash('sha256'); const full = createHash('sha256');
    let deliveredBytes = 0; let artifactBytes = 0;
    try {
      for await (const chunk of stream) {
        full.update(chunk); deliveredBytes += chunk.length;
        const keep = chunk.subarray(0, Math.max(0, bound - artifactBytes));
        let offset = 0;
        while (offset < keep.length) {
          const { bytesWritten } = await file.write(keep.subarray(offset, Math.min(offset + 65536, keep.length)));
          assert.ok(bytesWritten); retained.update(keep.subarray(offset, offset + bytesWritten)); artifactBytes += bytesWritten; offset += bytesWritten;
        }
        if (deliveredBytes > bound) { overflow = true; kill(); }
      }
      await file.sync();
      return { deliveredBytes, fullDeliveredSha256: full.digest('hex'), artifactBytes, artifactSha256: retained.digest('hex'), truncated: deliveredBytes !== artifactBytes };
    } finally { await file.close(); }
  }
  const streams = Promise.allSettled([spool(child.stdout, 'stdout.raw', spec.rawBytes), spool(child.stderr, 'stderr.raw', 16384)]);
  let reapTimer;
  let outcome;
  try { outcome = await Promise.race([closed, new Promise(resolve => { reapTimer = setTimeout(() => resolve(null), spec.timeoutMs + 3000); })]); }
  finally { clearTimeout(timer); clearTimeout(reapTimer); clearTimeout(killTimer); }
  if (!outcome) {
    child.kill('SIGKILL'); await writeNew(path.join(spec.directory, 'RECEIPT.json'), { reaped: false, timeout, overflow });
    throw new IntegrityFailure('CHILD_NOT_REAPED_STOP_DEPENDENTS');
  }
  const results = await streams;
  const receipt = { ...outcome, pid: child.pid, reaped: true, timeout, overflow, spawnError: spawnError ?? null,
    logs: results.map(result => result.status === 'fulfilled' ? result.value : { error: result.reason.message }), ended: new Date().toISOString() };
  await writeNew(path.join(spec.directory, 'RECEIPT.json'), receipt);
  if (results.some(result => result.status === 'rejected')) throw new IntegrityFailure('RAW_SPOOL_FAILURE');
  return receipt;
}

export async function aggregate(tasks, verify, emit) {
  let failures = 0;
  const phases = new Set();
  for (const task of tasks) {
    const result = await task.run();
    await emit({ stage: 'RAW_RECEIPT', id: task.id, result });
    if (!result.reaped || !result.closed) throw new IntegrityFailure('UNCLOSED_DEPENDENTS_STOP');
    await verify();
    try {
      assert.equal(result.exitCode, 0);
      assert.equal(result.rawBoundExceeded, false);
      assert.ok(result.requiredPhase && result.completedPhase === result.requiredPhase, 'required phase absent');
      await task.assert(result); phases.add(result.requiredPhase);
      await emit({ id: task.id, status: 'ASSERTED' });
    } catch (error) {
      if (error instanceof IntegrityFailure) throw error;
      failures++; await emit({ id: task.id, status: 'ASSERTION_FAILED', error: error.message.slice(0, 1024) });
    }
  }
  return { exitCode: failures ? 1 : 0, failures, phases: [...phases] };
}
