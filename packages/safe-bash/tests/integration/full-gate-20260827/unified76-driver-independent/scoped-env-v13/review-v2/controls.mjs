import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

export function exactArgv(actual, expected) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected));
  assert.equal(actual.length, expected.length);
  const normalized = [];
  for (let index = 0; index < expected.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(actual, String(index));
    assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
    assert.equal(typeof descriptor.value, 'string');
    assert.equal(typeof expected[index], 'string');
    assert.equal(descriptor.value, expected[index]);
    assert.ok(Buffer.from(descriptor.value).equals(Buffer.from(expected[index])));
    normalized.push(descriptor.value);
  }
  return normalized;
}

export function successful(receipt) {
  return receipt.status === 0 && receipt.signal === null && receipt.closed === true &&
    receipt.error === null && receipt.timedOut === false && receipt.outputExceeded === false &&
    receipt.signals.length === 0;
}

export function collectChild(executable, args, {cwd, env, timeoutMs, maxOutputBytes}) {
  return new Promise(resolve => {
    const stdout = [], stderr = [], signals = [];
    let bytes = 0, error = null, timedOut = false, outputExceeded = false, escalation;
    const child = spawn(executable, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
    const stop = () => {
      if (signals.length) return;
      signals.push({signal: 'SIGTERM', sent: child.kill('SIGTERM')});
      escalation = setTimeout(() => signals.push({signal: 'SIGKILL', sent: child.kill('SIGKILL')}), 2000);
    };
    const capture = chunks => chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {outputExceeded = true; stop(); return;}
      chunks.push(Buffer.from(chunk));
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.on('error', value => {error = {message: value.message, code: value.code ?? null};});
    const timer = setTimeout(() => {timedOut = true; stop();}, timeoutMs);
    child.on('close', (status, signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      resolve({pid: child.pid ?? null, status, signal, closed: true, error, timedOut, outputExceeded,
        signals, observedBytes: bytes, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr)});
    });
  });
}
