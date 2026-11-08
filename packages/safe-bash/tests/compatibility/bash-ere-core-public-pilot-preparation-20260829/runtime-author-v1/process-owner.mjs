import assert from 'node:assert/strict';
import { ledger, describeLedger, writer } from './core.mjs';

export async function ownChild(spec, io, ownership, aggregate) {
  assert(Number.isSafeInteger(spec.milliseconds) && spec.milliseconds > 0);
  const failures = ledger();
  const descriptors = [];
  const timers = [];
  let child;
  let receipt = { id: spec.id, pid: null, exit: false, close: false, stdout: false, stderr: false, retired: false, code: null, signal: null, cutoff: false };
  let finish;
  let completed = false;
  const settled = new Promise(resolve => { finish = () => { if (!completed) { completed = true; resolve(); } }; });
  const safe = (phase, body) => { try { return body(); } catch (reason) { failures.add(reason, phase); return undefined; } };
  const reconsider = () => { receipt.retired = receipt.exit && receipt.close && receipt.stdout && receipt.stderr; if (receipt.retired) finish(); };
  const signal = name => { if (child && !receipt.exit) safe(`signal-${name}`, () => child.kill(name)); };
  try {
    descriptors.push(io.open(spec.stdout)); descriptors.push(io.open(spec.stderr));
    const sinks = descriptors.map(descriptor => writer({ maximum: spec.capture, aggregate, write: (bytes, offset, count) => io.write(descriptor, bytes, offset, count) }));
    child = io.spawn(spec.executable, spec.argv, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'] });
    ownership.push({ child, receipt, failures });
    safe('child-identity', () => { receipt.pid = child.pid; });
    timers.push(io.later(() => { failures.add('case deadline', 'timeout'); signal('SIGTERM'); }, spec.milliseconds));
    timers.push(io.later(() => signal('SIGKILL'), spec.milliseconds + 2000));
    timers.push(io.later(() => { if (!receipt.retired) { receipt.cutoff = true; failures.add('UNKNOWN native retirement', 'retirement'); finish(); } }, spec.milliseconds + 3000));
    safe('exit-enrollment', () => child.once('exit', (code, reason) => { receipt.exit = true; receipt.code = code; receipt.signal = reason; reconsider(); }));
    safe('close-enrollment', () => child.once('close', () => { receipt.close = true; reconsider(); }));
    safe('error-enrollment', () => child.on('error', reason => failures.add(reason, 'child-error')));
    for (const [index, channel] of ['stdout', 'stderr'].entries()) safe(`${channel}-enrollment`, () => {
      const stream = child[channel];
      safe(`${channel}-data-enrollment`, () => stream.on('data', bytes => { if (completed) return; try { sinks[index].bytes(bytes); } catch (reason) { failures.add(reason, `${channel}-capture`); signal('SIGTERM'); } }));
      safe(`${channel}-end-enrollment`, () => stream.once('end', () => { receipt[channel] = true; reconsider(); }));
      safe(`${channel}-error-enrollment`, () => stream.on('error', reason => failures.add(reason, `${channel}-error`)));
    });
    if (failures.state.present) signal('SIGTERM');
    await settled;
    receipt.capture = sinks.map(sink => sink.snapshot());
  } catch (reason) {
    failures.add(reason, 'acquisition');
    if (child) { receipt.cutoff = true; signal('SIGTERM'); }
  } finally {
    completed = true;
    for (const timer of timers) safe('timer-cancel', () => io.cancel(timer));
    for (const descriptor of descriptors) safe('capture-close', () => io.close(descriptor));
  }
  receipt.failure = describeLedger(failures.state);
  return receipt;
}
