import assert from 'node:assert/strict';
import { ledger } from './core.mjs';

export function createObserver({ NativeWorker, expectedUrl, emit }) {
  const failures = ledger();
  const owned = [];
  let attempts = 0;
  const safe = (phase, body) => { try { body(); } catch (reason) { failures.add(reason, phase); } };
  function ObservedWorker(...args) {
    assert(new.target, 'Worker requires new');
    assert.equal(args.length, 2);
    assert.equal(args[0].href, expectedUrl);
    assert.equal(attempts, 0, 'one Worker admission per cell');
    attempts++;
    const worker = Reflect.construct(NativeWorker, args, NativeWorker);
    const state = { identity: attempts, threadId: null, exit: false, stdout: false, stderr: false, exitCode: null };
    owned.push({ worker, state });
    safe('worker-identity', () => { state.threadId = worker.threadId; });
    safe('worker-exit-enrollment', () => worker.once('exit', code => { state.exit = true; state.exitCode = code; safe('worker-exit-observation', () => emit({ event: 'worker-exit', identity: state.identity, code })); }));
    safe('worker-error-enrollment', () => worker.on('error', reason => failures.add(reason, 'worker-error')));
    for (const channel of ['stdout', 'stderr']) safe(`${channel}-enrollment`, () => {
      const stream = worker[channel];
      assert(stream, 'expected captured Worker stream');
      const retired = () => { state[channel] = true; };
      safe(`${channel}-end-enrollment`, () => stream.once('end', retired));
      safe(`${channel}-close-enrollment`, () => stream.once('close', retired));
      safe(`${channel}-error-enrollment`, () => stream.on('error', reason => failures.add(reason, `${channel}-error`)));
      if (stream.readableEnded === true || stream.closed === true) retired();
    });
    safe('worker-construction-observation', () => emit({ event: 'worker', identity: state.identity, threadId: state.threadId }));
    return worker;
  }
  return Object.freeze({ Constructor: ObservedWorker, owned, failures, snapshot() { return owned.map(row => ({ ...row.state })); }, assertRetired() { assert.equal(failures.state.present, false, 'observer failure'); for (const { state } of owned) assert(state.exit && state.stdout && state.stderr, 'UNKNOWN Worker retirement'); } });
}
