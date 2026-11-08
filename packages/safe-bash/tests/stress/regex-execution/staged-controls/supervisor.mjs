import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const limits = Object.freeze({
  startupMs: 1000,
  executionMs: 200,
  cleanupWarningMs: 1000,
  oldSpaceMiB: 16,
  semiSpaceMiB: 1,
  stackKiB: 256,
  stdoutBytes: 1024,
  stderrBytes: 1024,
  childMessages: 2,
  messageBytes: 16,
  parentMessages: 1,
});

const childFiles = new Map([
  ['benign', new URL('./benign.mjs', import.meta.url)],
  ['waiting', new URL('./waiting.mjs', import.meta.url)],
]);
let activeChild;

export function superviseControl(mode) {
  if (!childFiles.has(mode)) throw new TypeError('Only benign and waiting controls are allowed');
  if (activeChild) throw new Error('An owned child is still active');
  const childFile = fileURLToPath(childFiles.get(mode));
  const flags = [
    '--unhandled-rejections=strict',
    `--max-old-space-size=${limits.oldSpaceMiB}`,
    `--max-semi-space-size=${limits.semiSpaceMiB}`,
    `--stack-size=${limits.stackKiB}`,
  ];
  const startedAt = performance.now();
  const elapsed = () => Number((performance.now() - startedAt).toFixed(3));
  const result = {
    mode,
    startedAtUtc: new Date().toISOString(),
    executable: process.execPath,
    argv: [...flags, childFile],
    shell: false,
    detached: false,
    environment: { LANG: 'C', LC_ALL: 'C' },
    limits,
    pid: null,
    readyMs: null,
    startSentMs: null,
    executionDeadlineMs: null,
    deadlineFiredMs: null,
    killRequestedMs: null,
    killAccepted: null,
    killError: null,
    exitMs: null,
    closeMs: null,
    terminationReason: null,
    cleanupWarning: false,
    stdout: '',
    stderr: '',
    stdoutObservedBytes: 0,
    stderrObservedBytes: 0,
    stdoutCapturedBytes: 0,
    stderrCapturedBytes: 0,
    messages: [],
    childMessageCount: 0,
    parentMessageCount: 0,
    error: null,
    exitCode: null,
    exitSignal: null,
    closeCode: null,
    closeSignal: null,
    exitObserved: false,
    closeObserved: false,
    ipcDisconnected: false,
    stdoutClosed: false,
    stderrClosed: false,
    activeOwnedChildren: 1,
    pass: false,
  };
  const child = spawn(process.execPath, result.argv, {
    shell: false,
    detached: false,
    env: result.environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
  });
  activeChild = child;
  result.pid = child.pid ?? null;
  return new Promise((resolve) => {
    let startupTimer;
    let executionTimer;
    let cleanupTimer;
    let phase = 'startup';
    const chunks = { stdout: [], stderr: [] };
    const terminate = (reason) => {
      if (result.terminationReason || result.closeObserved) return;
      result.terminationReason = reason;
      clearTimeout(startupTimer);
      clearTimeout(executionTimer);
      result.killRequestedMs = elapsed();
      try {
        result.killAccepted = child.kill('SIGKILL');
      } catch (error) {
        result.killError = String(error.message).slice(0, 160);
      }
      cleanupTimer = setTimeout(() => {
        result.cleanupWarning = true;
        process.stderr.write('Owned child close overdue; no further child may start.\n');
      }, limits.cleanupWarningMs);
    };
    const onInterrupt = () => terminate('parent-SIGINT');
    const onTerminate = () => terminate('parent-SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    startupTimer = setTimeout(() => terminate('startup-deadline'), limits.startupMs);
    for (const streamName of ['stdout', 'stderr']) {
      child[streamName].on('data', (chunk) => {
        const observedKey = `${streamName}ObservedBytes`;
        const capturedKey = `${streamName}CapturedBytes`;
        result[observedKey] += chunk.byteLength;
        const remaining = limits[`${streamName}Bytes`] - result[capturedKey];
        if (remaining > 0) {
          const captured = Buffer.from(chunk.subarray(0, remaining));
          chunks[streamName].push(captured);
          result[capturedKey] += captured.byteLength;
        }
        if (result[observedKey] > limits[`${streamName}Bytes`]) terminate(`${streamName}-limit`);
      });
      child[streamName].on('close', () => {
        result[`${streamName}Closed`] = true;
        finish();
      });
      child[streamName].on('error', () => terminate(`${streamName}-error`));
    }
    child.on('message', (message) => {
      result.childMessageCount += 1;
      if (result.terminationReason) return;
      if (result.childMessageCount > limits.childMessages || typeof message !== 'string'
        || Buffer.byteLength(message) > limits.messageBytes) {
        terminate('ipc-limit-or-shape');
        return;
      }
      if (phase === 'startup' && message === 'ready') {
        result.messages.push({ message, atMs: elapsed() });
        result.readyMs = elapsed();
        clearTimeout(startupTimer);
        phase = 'execution';
        result.startSentMs = elapsed();
        result.executionDeadlineMs = Number((result.startSentMs + limits.executionMs).toFixed(3));
        executionTimer = setTimeout(() => {
          result.deadlineFiredMs = elapsed();
          terminate('execution-deadline');
        }, limits.executionMs);
        result.parentMessageCount += 1;
        child.send('start', (error) => {
          if (error) terminate('ipc-send-error');
        });
      } else if (phase === 'execution' && message === (mode === 'benign' ? 'done' : 'started')) {
        result.messages.push({ message, atMs: elapsed() });
        phase = 'acknowledged';
      } else {
        terminate('ipc-order-or-shape');
      }
    });
    child.on('error', (error) => {
      result.error = String(error.message).slice(0, 160);
      terminate('child-error');
    });
    child.on('disconnect', () => { result.ipcDisconnected = true; });
    child.on('exit', (code, signal) => {
      result.exitObserved = true;
      result.exitMs = elapsed();
      result.exitCode = code;
      result.exitSignal = signal;
    });
    child.on('close', (code, signal) => {
      result.closeObserved = true;
      result.closeMs = elapsed();
      result.closeCode = code;
      result.closeSignal = signal;
      finish();
    });
    function finish() {
      if (!result.closeObserved || !result.stdoutClosed || !result.stderrClosed
        || result.activeOwnedChildren === 0) return;
      clearTimeout(startupTimer);
      clearTimeout(executionTimer);
      clearTimeout(cleanupTimer);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      activeChild = undefined;
      result.activeOwnedChildren = 0;
      result.stdout = Buffer.concat(chunks.stdout).toString('utf8');
      result.stderr = Buffer.concat(chunks.stderr).toString('utf8');
      result.postStartCloseMs = result.startSentMs === null ? null
        : Number((result.closeMs - result.startSentMs).toFixed(3));
      result.killToCloseMs = result.killRequestedMs === null ? null
        : Number((result.closeMs - result.killRequestedMs).toFixed(3));
      const cleanupComplete = result.exitObserved && result.ipcDisconnected
        && result.stdoutClosed && result.stderrClosed && !result.cleanupWarning;
      const protocolComplete = phase === 'acknowledged' && result.childMessageCount === 2
        && result.parentMessageCount === 1;
      const outputMatches = result.stdout === (mode === 'benign' ? 'benign-ok\n' : '')
        && result.stderr === '' && result.stdoutObservedBytes === result.stdoutCapturedBytes
        && result.stderrObservedBytes === 0;
      const expectedEnd = mode === 'benign'
        ? result.closeCode === 0 && result.closeSignal === null && result.exitCode === 0
          && result.exitSignal === null && result.terminationReason === null
          && result.postStartCloseMs < limits.executionMs
        : result.closeCode === null && result.closeSignal === 'SIGKILL' && result.exitSignal === 'SIGKILL'
          && result.terminationReason === 'execution-deadline' && result.killAccepted === true
          && result.deadlineFiredMs - result.startSentMs >= 150
          && result.deadlineFiredMs - result.startSentMs <= 250;
      result.pass = cleanupComplete && protocolComplete && outputMatches && expectedEnd
        && result.error === null && result.killError === null;
      resolve(result);
    }
  });
}
