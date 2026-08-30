import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { errorRecord, settled } from './safety.mjs';
import { parseTransport } from '../executor-v3/transport.mjs';

function absent(identifier) {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
export async function supervise(node, args, cwd, { legacy = false, deadline = 30000, onSpawn = () => {} } = {}) {
  const receipt = { pid: null, exit: null, close: null, reaped: false, failures: [], signals: [], records: [], captureBytes: { stdout: 0, stderr: 0, records: 0 } };
  const chunks = { stdout: [], stderr: [], records: [] };
  const clocks = [];
  let child;
  let stopping = false;
  let release;
  const finished = new Promise(resolve => { release = resolve; });
  const signal = name => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, name); receipt.signals.push(name); }
    catch (error) { if (error.code !== 'ESRCH') receipt.failures.push(errorRecord(error)); }
  };
  const stop = code => {
    receipt.failures.push({ code });
    if (stopping) return;
    stopping = true; signal('SIGTERM');
    clocks.push(setTimeout(() => signal('SIGKILL'), 2000));
    clocks.push(setTimeout(() => { signal('SIGKILL'); receipt.failures.push({ code: 'REAP_DEADLINE' }); for (const stream of child?.stdio ?? []) stream?.destroy(); release(); }, 3000));
  };
  try {
    child = spawn(node, args, { cwd, detached: true, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: cwd, TMPDIR: cwd }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    receipt.pid = child.pid ?? null;
    onSpawn(child, receipt);
    for (const [index, name] of [[1, 'stdout'], [2, 'stderr'], [3, 'records']]) {
      child.stdio[index].on('data', bytes => {
        const old = receipt.captureBytes[name];
        receipt.captureBytes[name] += bytes.length;
        const cap = name === 'records' ? 262144 : legacy ? 8388608 : 65536;
        if (old < cap) chunks[name].push(Buffer.from(bytes.subarray(0, cap - old)));
        if (receipt.captureBytes[name] > cap || (legacy && receipt.captureBytes.stdout + receipt.captureBytes.stderr > 8388608)) stop('CAPTURE_LIMIT');
      });
      child.stdio[index].on('error', error => { receipt.failures.push(errorRecord(error)); stop('PIPE_ERROR'); });
    }
    child.once('error', error => { receipt.failures.push(errorRecord(error)); stop('SPAWN_ERROR'); });
    child.once('exit', (code, signalName) => { receipt.exit = { code, signal: signalName }; });
    child.once('close', (code, signalName) => { receipt.close = { code, signal: signalName }; release(); });
    clocks.push(setTimeout(() => stop('NATURAL_DEADLINE'), deadline));
    await finished;
    if (child.pid) {
      for (let attempt = 0; attempt < 20 && !(absent(child.pid) && absent(-child.pid)); attempt++) await delay(25);
      receipt.reaped = absent(child.pid) && absent(-child.pid);
      if (!receipt.reaped) { stop('GROUP_REMAINS'); signal('SIGKILL'); for (let attempt = 0; attempt < 20 && !(absent(child.pid) && absent(-child.pid)); attempt++) await delay(25); receipt.reaped = absent(child.pid) && absent(-child.pid); }
    }
  } catch (error) {
    receipt.failures.push(errorRecord(error)); stop('SUPERVISION_EXCEPTION'); signal('SIGKILL');
    if (child?.pid) { for (let attempt = 0; attempt < 20 && !(absent(child.pid) && absent(-child.pid)); attempt++) await delay(25); receipt.reaped = absent(child.pid) && absent(-child.pid); }
  } finally { for (const clock of clocks) clearTimeout(clock); }
  receipt.stdout = Buffer.concat(chunks.stdout).toString('base64');
  receipt.stderr = Buffer.concat(chunks.stderr).toString('base64');
  receipt.rawRecords = Buffer.concat(chunks.records).toString('base64');
  try { receipt.records = parseTransport(Buffer.concat(chunks.records)); }
  catch (error) { receipt.failures.push(errorRecord(error)); }
  receipt.natural = settled(receipt);
  return receipt;
}
