import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { errorRecord } from './core.mjs';

function absent(identifier) {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
export async function supervise(node, args, cwd, options = {}) {
  const receipt = { args, pid: null, events: [], stdout: '', stderr: '', records: [], failures: [], signals: [], exit: null, close: null, reaped: false, natural: false };
  const limits = { output: options.outputCap ?? 65536, records: 262144, deadline: 30000, grace: 2000, kill: 1000 };
  const child = spawn(node, args, { cwd, detached: true, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: cwd, TMPDIR: cwd }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  receipt.pid = child.pid ?? null;
  const buffers = { stdout: [], stderr: [], records: [] };
  const totals = { stdout: 0, stderr: 0, records: 0 };
  let signalled = false;
  const signal = name => {
    if (!child.pid) return;
    try { process.kill(-child.pid, name); receipt.signals.push(name); }
    catch (error) { if (error.code !== 'ESRCH') receipt.failures.push(errorRecord(error)); }
  };
  const stop = reason => {
    if (signalled) return;
    signalled = true;
    receipt.failures.push({ code: reason });
    signal('SIGTERM');
  };
  for (const [index, name] of [[1, 'stdout'], [2, 'stderr'], [3, 'records']]) {
    child.stdio[index].on('data', chunk => {
      totals[name] += chunk.length;
      const cap = name === 'records' ? limits.records : limits.output;
      const retained = totals[name] - chunk.length;
      if (retained < cap) buffers[name].push(Buffer.from(chunk.subarray(0, cap - retained)));
      if (totals[name] > cap) stop('CAPTURE_LIMIT');
    });
    child.stdio[index].on('error', error => { receipt.failures.push(errorRecord(error)); stop('PIPE_ERROR'); });
  }
  child.on('error', error => { receipt.failures.push(errorRecord(error)); });
  child.on('exit', (code, signalName) => { receipt.exit = { code, signal: signalName }; receipt.events.push('exit'); });
  const closed = new Promise(resolveClose => child.once('close', (code, signalName) => {
    receipt.close = { code, signal: signalName }; receipt.events.push('stdio-close'); resolveClose();
  }));
  const deadline = setTimeout(() => stop('NATURAL_DEADLINE'), limits.deadline);
  const escalation = setTimeout(() => signal('SIGKILL'), limits.deadline + limits.grace);
  const finalGuard = setTimeout(() => {
    receipt.failures.push({ code: 'REAP_DEADLINE' }); signal('SIGKILL');
    for (const stream of child.stdio.filter(Boolean)) stream.destroy();
  }, limits.deadline + limits.grace + limits.kill);
  try {
    await closed;
    if (child.pid) {
      for (let attempt = 0; attempt < 20 && !(absent(child.pid) && absent(-child.pid)); attempt++) await delay(25);
      receipt.reaped = absent(child.pid) && absent(-child.pid);
      if (!receipt.reaped) {
        stop('GROUP_REMAINS'); signal('SIGKILL');
        for (let attempt = 0; attempt < 20 && !(absent(child.pid) && absent(-child.pid)); attempt++) await delay(25);
        receipt.reaped = absent(child.pid) && absent(-child.pid);
      }
    }
  } finally {
    clearTimeout(deadline); clearTimeout(escalation); clearTimeout(finalGuard);
  }
  receipt.stdout = Buffer.concat(buffers.stdout).toString('base64');
  receipt.stderr = Buffer.concat(buffers.stderr).toString('base64');
  receipt.captureBytes = totals;
  const raw = Buffer.concat(buffers.records).toString('utf8');
  receipt.rawRecords = raw;
  for (const line of raw.split('\n').filter(Boolean)) {
    try { receipt.records.push(JSON.parse(line)); }
    catch (error) { receipt.failures.push({ code: 'BAD_RECORD', error: errorRecord(error) }); }
  }
  receipt.natural = receipt.reaped && receipt.signals.length === 0 && receipt.failures.length === 0 && receipt.exit?.signal === null && receipt.close?.signal === null;
  return receipt;
}
