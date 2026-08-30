import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const flags = ['--unhandled-rejections=strict', '--max-old-space-size=64', '--max-semi-space-size=1', '--stack-size=512'];
if (process.argv.length !== 2 || process.env.NODE_OPTIONS
  || process.execArgv.length !== flags.length
  || !flags.every((flag, index) => process.execArgv[index] === flag)) {
  throw new Error('Only the documented fixed invocation is accepted');
}
const startedAt = performance.now();
const elapsed = () => Number((performance.now() - startedAt).toFixed(3));
const record = {
  utc: new Date().toISOString(), node: process.version, v8: process.versions.v8,
  pid: null, events: [], reason: null, killAccepted: null,
  exit: null, close: null, stdout: '', stderr: '', bytes: [0, 0],
  cleanupWarning: false, cleanup: [false, false, false, false, false],
  activechildren: 1, outcome: null,
};
const child = spawn(process.execPath, [...flags, '--experimental-strip-types', '--no-warnings',
  fileURLToPath(new URL('./child.mjs', import.meta.url))], {
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
    cleanupTimer = setTimeout(() => { record.cleanupWarning = true; }, 1000);
  };
  const interrupt = () => terminate('parent-SIGINT');
  const terminateSignal = () => terminate('parent-SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminateSignal);
  const startupTimer = setTimeout(() => terminate('startup-deadline'), 1000);
  for (const [index, name] of ['stdout', 'stderr'].entries()) {
    const chunks = [];
    let retained = 0;
    child[name].on('data', chunk => {
      record.bytes[index] += chunk.byteLength;
      const captured = Buffer.from(chunk.subarray(0, Math.max(0, 1024 - retained)));
      if (captured.byteLength > 0) chunks.push(captured);
      retained += captured.byteLength;
      if (record.bytes[index] > 1024) terminate(`${name}-limit`);
    });
    child[name].on('error', () => terminate(`${name}-error`));
    child[name].on('close', () => {
      record[name] = Buffer.concat(chunks).toString('utf8');
      record.cleanup[index + 2] = true;
      finish();
    });
  }
  child.on('message', message => {
    messageCount += 1;
    if (record.reason) return;
    if (typeof message !== 'string' || Buffer.byteLength(message) > 16 || messageCount > 5) {
      terminate('ipc-limit');
      return;
    }
    if (phase === 'startup' && message === 'ready') {
      event('ready');
      clearTimeout(startupTimer);
      phase = 'execution';
      event('start');
      executionTimer = setTimeout(() => { event('deadline'); terminate('execution-deadline'); }, 200);
      child.send('start', error => { if (error) terminate('ipc-send'); });
    } else if (phase === 'execution' && message === 'enter' && !entered && !cancelled) {
      entered = true;
      event(message);
    } else if (phase === 'execution' && message === 'leave' && entered && !left && !cancelled) {
      left = true;
      event(message);
    } else if (phase === 'execution' && message === 'cancel' && entered && left && !cancelled) {
      cancelled = true;
      event(message);
    } else if (phase === 'execution' && message === 'done' && left && cancelled && !done) {
      done = true;
      phase = 'done';
      event(message);
    } else terminate('ipc-order');
  });
  child.on('error', () => {
    if (record.pid === null) record.cleanup[0] = true;
    terminate('child-error');
  });
  child.on('disconnect', () => { record.cleanup[1] = true; finish(); });
  child.on('exit', (code, signal) => {
    record.exit = [code, signal];
    record.cleanup[0] = true;
    event('exit');
    finish();
  });
  child.on('close', (code, signal) => {
    record.close = [code, signal];
    record.cleanup[4] = true;
    if (record.pid === null && !child.connected) record.cleanup[1] = true;
    event('close');
    finish();
  });
  function finish() {
    if (finished || !record.cleanup.every(Boolean)) return;
    finished = true;
    clearTimeout(startupTimer);
    clearTimeout(executionTimer);
    clearTimeout(cleanupTimer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminateSignal);
    record.activechildren = 0;
    record.outcome = record.cleanupWarning ? 'harness-failure'
      : record.reason === 'execution-deadline' && entered && !left && record.killAccepted
        && record.exit[1] === 'SIGKILL' ? 'parent-terminated-with-entry-marker'
      : record.reason === null && done && record.exit[0] === 0 && record.close[0] === 0
        && record.stderr === '' ? 'completed'
      : !entered && (record.reason === null || record.reason === 'startup-deadline')
        ? 'import/setup-failure' : 'harness-failure';
    resolve();
  }
});
const output = JSON.stringify(record) + '\n';
if (Buffer.byteLength(output) > 1024) {
  process.stdout.write(JSON.stringify({ outcome: 'harness-failure', reason: 'parent-output-limit', activechildren: record.activechildren }) + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(output);
  process.exitCode = record.outcome === 'completed' || record.outcome === 'parent-terminated-with-entry-marker' ? 0 : 1;
}
