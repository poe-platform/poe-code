import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { check, Hold, CHUNK, writeNew, fingerprint } from './core.mjs';

export async function supervise(spec) {
  check(Number.isSafeInteger(spec.timeoutMs) && spec.timeoutMs > 0 && spec.timeoutMs <= 60000, 'TIME_BOUND');
  check(Number.isSafeInteger(spec.logBytes) && spec.logBytes > 0, 'LOG_BOUND');
  await mkdir(spec.directory, { recursive: false });
  const started = new Date().toISOString();
  await writeNew(path.join(spec.directory, 'START.json'), { started, executable: spec.executable, args: spec.args, timeoutMs: spec.timeoutMs, logBytes: spec.logBytes, traceBytes: spec.traceBytes ?? null, tool: await fingerprint(spec.executable), kind: spec.kind });
  const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: { PATH: '', LANG: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let timedOut = false;
  let outputExceeded = false;
  let killTimer;
  const kill = () => {
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 250);
  };
  const timeout = setTimeout(() => { timedOut = true; kill(); }, spec.timeoutMs);
  let spawnError;
  const closed = new Promise(resolve => {
    child.once('error', error => { spawnError = { code: error.code ?? null, name: error.name }; });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  async function spool(stream, name, maximum) {
    const handle = await open(path.join(spec.directory, name), 'wx', 0o644);
    const hash = createHash('sha256');
    let delivered = 0;
    let retained = 0;
    try {
      for await (const chunk of stream) {
        delivered += chunk.length;
        const keep = chunk.subarray(0, Math.max(0, maximum - retained));
        for (let offset = 0; offset < keep.length;) {
          const part = keep.subarray(offset, Math.min(offset + CHUNK, keep.length));
          const { bytesWritten } = await handle.write(part);
          check(bytesWritten > 0, 'SPOOL_SHORT');
          hash.update(part.subarray(0, bytesWritten)); offset += bytesWritten; retained += bytesWritten;
        }
        if (delivered > maximum) { outputExceeded = true; kill(); }
      }
      await handle.sync();
      return { delivered, bytes: retained, sha256: hash.digest('hex') };
    } finally { await handle.close(); }
  }
  const logs = Promise.allSettled([spool(child.stdout, 'stdout.raw', spec.traceBytes ?? spec.logBytes), spool(child.stderr, 'stderr.raw', spec.logBytes)]);
  let reapTimer;
  let outcome;
  try {
    outcome = await Promise.race([closed, new Promise(resolve => { reapTimer = setTimeout(() => resolve(null), spec.timeoutMs + 3000); })]);
  } finally { clearTimeout(timeout); clearTimeout(reapTimer); clearTimeout(killTimer); }
  if (!outcome) {
    child.kill('SIGKILL');
    await writeNew(path.join(spec.directory, 'RECEIPT.json'), { started, ended: new Date().toISOString(), reaped: false, timedOut, outputExceeded });
    throw new Hold('REAP_UNPROVED');
  }
  const completed = await logs;
  const receipt = { started, ended: new Date().toISOString(), pid: child.pid ?? null, ...outcome, spawnError: spawnError ?? null, reaped: true, timedOut, outputExceeded, logs: completed.map(result => result.status === 'fulfilled' ? result.value : { error: result.reason.code ?? result.reason.name }) };
  await writeNew(path.join(spec.directory, 'RECEIPT.json'), receipt);
  check(completed.every(result => result.status === 'fulfilled'), 'SPOOL_FAILURE');
  return receipt;
}

export async function gitBytes(args, maximum, cwd) {
  const child = spawn('/usr/bin/git', args, { cwd, env: { PATH: '', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const output = Buffer.alloc(maximum);
  let used = 0;
  let excess = false;
  let spawnError;
  const closed = new Promise(resolve => { child.on('error', error => { spawnError = error; }); child.on('close', code => resolve(code)); });
  const timer = setTimeout(() => { excess = true; child.kill('SIGKILL'); }, 10000);
  const stdout = (async () => { for await (const part of child.stdout) { if (part.length > maximum - used) { excess = true; child.kill('SIGKILL'); } else { part.copy(output, used); used += part.length; } } })();
  const stderr = (async () => { let count = 0; for await (const part of child.stderr) { count += part.length; if (count > 4096) { excess = true; child.kill('SIGKILL'); } } })();
  try { const code = await closed; await Promise.all([stdout, stderr]); check(!spawnError && !excess && code === 0, 'GIT_READ'); }
  finally { clearTimeout(timer); }
  return output.subarray(0, used);
}
