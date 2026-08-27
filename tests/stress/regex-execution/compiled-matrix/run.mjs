import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { cases, flags, limits } from '../bounded-matrix/cases.mjs';
import { base, evidence, schedule, verify, save } from './guard.mjs';

const selected = cases.find(item => item.id === process.argv[2]);
if (!selected || process.argv.length !== 3 || process.env.NODE_OPTIONS || process.env.NODE_PATH
  || process.execArgv.length !== flags.length || !flags.every((flag, index) => process.execArgv[index] === flag)) {
  throw new Error('Only the documented fixed invocation is accepted');
}
const familyStopped = schedule(selected);
const before = verify();
mkdirSync(new URL('evidence/', base), { recursive: true });
mkdirSync(new URL('claims/', base), { recursive: true });
save(new URL(`evidence/${selected.id}.proof-before.json`, base), before);
if (familyStopped) {
  const skipped = { id: selected.id, tool: selected.tool, kind: selected.kind, outcome: 'skipped',
    reason: 'family-execution-watchdog', pid: null, activechildren: 0, executionStable: true };
  save(evidence(selected.id), skipped);
  process.stdout.write(JSON.stringify(skipped) + '\n');
  process.exit(0);
}
save(new URL(`claims/${selected.id}.json`, base), { id: selected.id, utc: new Date().toISOString(),
  command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)] });
const startedAt = performance.now();
const elapsed = () => Number((performance.now() - startedAt).toFixed(3));
const record = { id: selected.id, tool: selected.tool, kind: selected.kind,
  utc: new Date().toISOString(), node: process.version, v8: process.versions.v8,
  pid: null, events: [], messages: [], deadlineDue: null, deadlineActual: null,
  reason: null, killAccepted: null, exit: null, close: null,
  stdout: '', stderr: '', bytes: [0, 0], cleanupWarning: false,
  cleanup: [false, false, false, false, false], activechildren: 1, outcome: null, executionStable: null };
const child = spawn(process.execPath, [...flags,
  fileURLToPath(new URL('./child.mjs', import.meta.url)), selected.id], {
  shell: false, detached: false, env: { LANG: 'C', LC_ALL: 'C' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
});
record.pid = child.pid ?? null;
await new Promise(resolve => {
  let executionTimer;
  let cleanupTimer;
  let phase = 'startup';
  let messageCount = 0;
  let entered = false;
  let left = false;
  let cancelled = false;
  let done = false;
  let finished = false;
  const event = name => record.events.push([name, elapsed()]);
  const terminate = reason => {
    if (record.reason || finished) return;
    record.reason = reason;
    clearTimeout(startupTimer);
    clearTimeout(executionTimer);
    if (!record.cleanup[0] && !record.cleanup[4]) {
      event('kill');
      try { record.killAccepted = child.kill('SIGKILL'); }
      catch { record.killAccepted = false; }
    }
    cleanupTimer = setTimeout(() => { record.cleanupWarning = true; }, limits.cleanupMs);
  };
  const interrupt = () => terminate('parent-SIGINT');
  const terminateSignal = () => terminate('parent-SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminateSignal);
  const startupTimer = setTimeout(() => terminate('startup-deadline'), limits.startupMs);
  for (const [index, name] of ['stdout', 'stderr'].entries()) {
    const chunks = [];
    let retained = 0;
    child[name].on('data', chunk => {
      record.bytes[index] += chunk.byteLength;
      const captured = Buffer.from(chunk.subarray(0, Math.max(0, limits.streamBytes - retained)));
      if (captured.byteLength) chunks.push(captured);
      retained += captured.byteLength;
      if (record.bytes[index] > limits.streamBytes) terminate(`${name}-limit`);
    });
    child[name].on('error', () => terminate(`${name}-error`));
    child[name].on('close', () => {
      record[name] = Buffer.concat(chunks).toString('utf8');
      record.cleanup[index + 2] = true;
      finish();
    });
  }
  child.on('message', message => {
    messageCount++;
    if (record.reason) return;
    if (!Array.isArray(message) || Buffer.byteLength(JSON.stringify(message)) > limits.ipcBytes || messageCount > limits.ipcCount) {
      terminate('ipc-limit'); return;
    }
    const [name] = message;
    const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10000;
    if (phase === 'startup' && name === 'ready' && message.length === 1) {
      event('ready'); clearTimeout(startupTimer); phase = 'execution';
      const armed = elapsed();
      record.events.push(['start', armed]);
      record.deadlineDue = Number((armed + limits.executionMs).toFixed(3));
      executionTimer = setTimeout(() => {
        record.deadlineActual = elapsed(); event('deadline'); terminate('execution-deadline');
      }, limits.executionMs);
      child.send('start', error => { if (error) terminate('ipc-send'); });
    } else if (phase === 'execution' && name === 'enter' && !entered && !cancelled && message.length === 6
      && message[1] === 1 && message.slice(2, 5).every(timestamp) && message[5] === false) {
      entered = true; event(name);
    } else if (phase === 'execution' && name === 'leave' && entered && !left && !cancelled && message.length === 4
      && timestamp(message[1]) && ['null', 'match', 'throw'].includes(message[2]) && typeof message[3] === 'boolean') {
      left = true; event(name);
    } else if (phase === 'execution' && name === 'cancel' && entered && left && !cancelled && message.length === 3
      && timestamp(message[1]) && message[2] === true) {
      cancelled = true; event(name);
    } else if (phase === 'execution' && name === 'done' && message.length === 1 && !done) {
      done = true; phase = 'done'; event(name);
    } else { terminate('ipc-order'); return; }
    record.messages.push(message);
  });
  child.on('error', () => {
    if (record.pid === null) record.cleanup[0] = true;
    terminate('child-error');
  });
  child.on('disconnect', () => { record.cleanup[1] = true; finish(); });
  child.on('exit', (code, signal) => {
    record.exit = [code, signal]; record.cleanup[0] = true; event('exit'); finish();
  });
  child.on('close', (code, signal) => {
    record.close = [code, signal]; record.cleanup[4] = true;
    if (record.pid === null && !child.connected) record.cleanup[1] = true;
    event('close'); finish();
  });
  function finish() {
    if (finished || !record.cleanup.every(Boolean)) return;
    finished = true;
    clearTimeout(startupTimer); clearTimeout(executionTimer); clearTimeout(cleanupTimer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminateSignal);
    record.activechildren = 0;
    record.outcome = record.cleanupWarning ? 'harness-failure'
      : record.reason === 'execution-deadline' && entered && !left && record.killAccepted && record.exit[1] === 'SIGKILL'
        ? 'parent-terminated-with-entry-marker'
      : record.reason === null && done && entered && left && cancelled && record.exit[0] === 0 && record.close[0] === 0 && record.stderr === ''
        ? 'completed'
      : !entered && (record.reason === null || record.reason === 'startup-deadline') ? 'import/setup-failure'
      : record.reason === null && done ? 'command-unexpected' : 'harness-failure';
    resolve();
  }
});
try {
  const after = verify();
  save(new URL(`evidence/${selected.id}.proof-after.json`, base), after);
  record.executionStable = true;
} catch (error) {
  record.executionStable = false;
  record.verificationError = String(error.message).slice(0, 160);
}
const output = JSON.stringify(record) + '\n';
if (Buffer.byteLength(output) > 4096) throw new Error('Parent output limit');
writeFileSync(evidence(selected.id), output, { flag: 'wx' });
process.stdout.write(output);
process.exitCode = record.executionStable && ['completed', 'parent-terminated-with-entry-marker'].includes(record.outcome) ? 0 : 1;
