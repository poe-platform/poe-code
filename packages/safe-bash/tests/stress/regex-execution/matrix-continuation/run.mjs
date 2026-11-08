import { spawn } from 'node:child_process';
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { flags, limits } from '../bounded-matrix/cases.mjs';
import { base, original, root, remaining, read, same, snapshot, guard, schedule, expected, cleanEnv } from './guard.mjs';

const selected = remaining.find(item => item.id === process.argv[2]);
if (!selected || process.argv.length !== 3 || !same(process.execArgv, flags)
  || !same(Object.fromEntries(Object.entries(process.env).sort()), cleanEnv)) {
  throw new Error('Only the documented fixed invocation is accepted');
}
const frozen = read(base + 'frozen.json');
const before = snapshot();
guard(frozen, before);
const oldRecord = read(original + 'evidence/' + selected.id + '.json');
if (oldRecord.caseExecuted !== false || oldRecord.pid !== null) throw new Error('Original launched case cannot repeat');
const familyStopped = schedule(selected);
const lock = new URL(base + '.active/', root);
mkdirSync(lock);
mkdirSync(new URL(base + 'claims/', root), { recursive: true });
mkdirSync(new URL(base + 'evidence/', root), { recursive: true });
writeFileSync(new URL(base + 'claims/' + selected.id + '.json', root), JSON.stringify({ id: selected.id,
  utc: new Date().toISOString(), launchAttempt: !familyStopped }) + '\n', { flag: 'wx' });
if (familyStopped) {
  const after = snapshot();
  guard(frozen, after);
  rmdirSync(lock);
  emit({ id: selected.id, tool: selected.tool, kind: selected.kind, outcome: 'skipped',
    reason: 'family-execution-watchdog', caseExecuted: false, pid: null, activechildren: 0,
    executionStable: true, observationDrift: observationDrift(before, after) });
} else {
const startedAt = performance.now();
const elapsed = () => Number((performance.now() - startedAt).toFixed(3));
const record = { id: selected.id, tool: selected.tool, kind: selected.kind,
  utc: new Date().toISOString(), node: process.version, v8: process.versions.v8,
  pid: null, events: [], messages: [], deadlineDue: null, deadlineActual: null,
  reason: null, killAccepted: null, exit: null, close: null,
  stdout: '', stderr: '', bytes: [0, 0], cleanupWarning: false,
  cleanup: [false, false, false, false, false], activechildren: 1, outcome: null, executionStable: null };
const child = spawn(process.execPath, [...flags, '--experimental-strip-types', '--no-warnings',
  fileURLToPath(new URL('../bounded-matrix/child.mjs', import.meta.url)), selected.id], {
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
const after = snapshot();
record.executionStable = true;
try { guard(frozen, after); } catch (error) {
  record.executionStable = false;
  record.guardError = String(error.message).slice(0, 160);
}
record.observationDrift = observationDrift(before, after);
if (record.outcome === 'completed' && !expected(record, selected)) record.outcome = 'command-unexpected';
rmdirSync(lock);
emit(record);
process.exitCode = record.executionStable && ['completed', 'parent-terminated-with-entry-marker'].includes(record.outcome) ? 0 : 1;
}
function observationDrift(before, after) {
  return Object.keys(frozen.observationHashes).filter(name =>
    frozen.originalObservationHashes[name] !== before.observationHashes[name]
    || frozen.observationHashes[name] !== before.observationHashes[name]
    || before.observationHashes[name] !== after.observationHashes[name]).map(name => ({ path: name,
      original: frozen.originalObservationHashes[name], frozen: frozen.observationHashes[name],
      before: before.observationHashes[name], after: after.observationHashes[name] }));
}
function emit(record) {
  const output = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(output) > 4096) throw new Error('Parent output limit');
  process.stdout.write(output);
}
