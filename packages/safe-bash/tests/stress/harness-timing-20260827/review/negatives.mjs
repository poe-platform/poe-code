import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeDelivery, NativeHarnessError } from './controlled-native.mjs';
import { configure, latest, releaseClose, retire, retireAll, snapshot, spawnControlled } from './control-observer.mjs';
import { withHarnessWatchdog } from '../watchdog.ts';
import { ready, save } from './tools.mjs';

ready();
const attempts = [];
const sentinel = spawnControlled('sentinel');
const specifications = [
  { name: 'calibration', mode: 'complete', settings: {}, expected: null },
  { name: 'suppressed-readiness', mode: 'prefix-stall', settings: { suppressReadiness: true }, expected: 'native readiness deadline' },
  { name: 'startup-without-consumption', mode: 'startup-only', settings: {}, expected: 'native readiness deadline' },
  { name: 'withheld-suffix', mode: 'prefix-stall', settings: { withholdSuffix: true }, expected: 'native completion deadline' },
  { name: 'never-ending-after-delivery', mode: 'prefix-stall', settings: {}, expected: 'native completion deadline' },
  { name: 'timeout-plus-missing-close-ack', mode: 'startup-only', settings: { holdClose: true }, expected: 'native readiness deadline' },
];
try {
  for (const specification of specifications) {
    configure(specification.mode, specification.settings);
    const started = performance.now();
    let caught;
    let evidence;
    let outerTimer;
    let ownOuterFired = false;
    const pending = nativeDelivery({ lineBuffered: true, readinessMs: 1000, completionMs: 200, cleanupMs: 100 });
    const controlled = latest();
    void pending.catch(() => {});
    try {
      evidence = await Promise.race([pending, new Promise((resolve, reject) => {
        outerTimer = setTimeout(() => { ownOuterFired = true; reject(new Error('independent negative outer bound expired')); }, 3000);
      })]);
    } catch (error) { caught = error; evidence = error.evidence; }
    finally { clearTimeout(outerTimer); }
    const beforeRelease = evidence ? JSON.parse(JSON.stringify(evidence)) : null;
    const independentlyClosedBeforeCleanup = controlled.closed;
    if (controlled.deferredClose) releaseClose(controlled);
    const retired = await retire(controlled);
    const result = {
      ...specification, actualFailure: caught ? String(caught) : null, nativeHarnessError: caught instanceof NativeHarnessError,
      durationMs: performance.now() - started, outerDueMs: 3000, ownOuterFired, evidence: beforeRelease,
      independentlyClosedBeforeCleanup, independentlyRetired: retired, assertionFailure: null,
    };
    try {
      assert.equal(ownOuterFired, false, 'tested guard, not independent last resort, must settle');
      assert.equal(independentlyClosedBeforeCleanup, true, 'real controlled child must already close');
      assert.equal(retired.closed, true); assert.equal(retired.exitSeen, true);
      assert.deepEqual(retired.streamDestroyed, [true, true, true]);
      assert.equal(retired.observerListenersRemaining, 0);
      assert.deepEqual(retired.additionalListeners, [], 'helper must remove its listeners after genuine close delivery');
      assert(evidence);
      assert.equal(evidence.activeTimers, 0);
      if (specification.expected === null) {
        assert.equal(caught, undefined);
        assert.equal(evidence.ready, true);
        assert.equal(evidence.stdout, 'foo\nbinary file matches (found "\\0" byte around offset 4)\n');
        assert.equal(evidence.code, 0);
      } else {
        assert(caught instanceof NativeHarnessError);
        assert.equal(caught.message, specification.expected);
        assert(evidence.events.some(event => event.event === 'timer-fired'));
      }
      if (specification.name === 'suppressed-readiness') {
        assert.equal(evidence.ready, false);
        assert.equal(evidence.stdout, 'foo\n');
        assert(evidence.events.some(event => event.event === 'prefix-consumption-evidenced'));
        assert(!evidence.events.some(event => event.event === 'write' && event.detail.end));
      }
      if (specification.name === 'startup-without-consumption' || specification.name === 'timeout-plus-missing-close-ack') {
        assert(evidence.events.some(event => event.event === 'spawn'));
        assert(evidence.stderr.includes('CONTROL_STARTED\n'));
        assert(evidence.events.some(event => event.event === 'write' && event.detail.hex === '666f6f0a'));
        assert.equal(evidence.ready, false);
        assert.equal(evidence.stdout, '');
        assert(!evidence.events.some(event => event.event === 'write' && event.detail.end));
      }
      if (specification.name === 'withheld-suffix') {
        assert.equal(evidence.ready, true);
        assert(evidence.events.some(event => event.event === 'review-suffix-withheld'));
        assert(!evidence.events.some(event => event.event === 'write' && event.detail.end));
      }
      if (specification.name === 'never-ending-after-delivery') {
        assert.equal(evidence.ready, true);
        assert(evidence.events.some(event => event.event === 'write' && event.detail.hex === '000a6e6f0a' && event.detail.end));
      }
      if (specification.name === 'timeout-plus-missing-close-ack') {
        assert.equal(beforeRelease.actualClose, false);
        assert.equal(beforeRelease.closeObserved, false);
        assert(beforeRelease.events.some(event => event.event === 'failure' && event.detail === 'native readiness deadline'));
        assert(beforeRelease.events.some(event => event.event === 'cleanup-deadline' && event.detail.actualClose === false));
        assert(beforeRelease.ownedListenersRemaining > 0, 'missing acknowledgement is reported, not falsified as cleanup');
        assert(retired.events.some(event => event.event === 'test-close-acknowledgement-held'));
        assert(retired.events.some(event => event.event === 'test-real-close-acknowledgement-released'));
      } else {
        assert.equal(beforeRelease.actualClose, true);
        assert.equal(beforeRelease.ownedListenersRemaining, 0);
      }
      for (const event of evidence.events.filter(event => event.event === 'timer-fired')) {
        assert.equal(typeof event.detail.armedMs, 'number');
        assert.equal(typeof event.detail.dueMs, 'number');
        assert.equal(typeof event.detail.firedMs, 'number');
        assert(Math.abs(event.detail.latenessMs - (event.detail.firedMs - event.detail.dueMs)) < 0.001);
      }
      assert.equal(sentinel.child.exitCode, null); assert.equal(sentinel.child.signalCode, null);
      process.kill(sentinel.child.pid, 0);
      result.sentinelAlive = true;
    } catch (error) { result.assertionFailure = String(error); }
    attempts.push(result);
    save(`evidence/negative-${specification.name}.json`, result);
    assert.equal(result.assertionFailure, null, `${specification.name}: stop, preserve attempt, no retries`);
  }
  let observedSignal;
  let aborted = false;
  const watchdogStart = performance.now();
  await assert.rejects(withHarnessWatchdog(20, async signal => {
    observedSignal = signal;
    await new Promise((resolve, reject) => {
      const onAbort = () => { aborted = true; signal.removeEventListener('abort', onAbort); reject(signal.reason); };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }), /semantic harness watchdog after 20ms/u);
  assert(aborted); assert.equal(getEventListeners(observedSignal, 'abort').length, 0);
  const stall = { name: 'jq-watchdog-stall', aborted, remainingAbortListeners: 0, durationMs: performance.now() - watchdogStart };
  attempts.push(stall); save('evidence/negative-jq-watchdog-stall.json', stall);
  let lateRejection = false;
  await assert.rejects(withHarnessWatchdog(20, async () => { await delay(60); lateRejection = true; throw new Error('independent late rejection'); }), /semantic harness watchdog after 20ms/u);
  await delay(80);
  assert(lateRejection);
  const late = { name: 'late-rejection-observed', lateRejection, strictUnhandledRejections: true };
  attempts.push(late); save('evidence/negative-late-rejection.json', late);
} finally {
  const children = await retireAll();
  save('evidence/negative-summary.json', { attempts, children, allChildrenClosed: children.every(child => child.closed && child.exitSeen), maximumDescendants: 3, sentinelFinal: snapshot(sentinel) });
}
console.log(`Independent controls: ${attempts.length} completed, including one positive calibration; all exact controlled children retired.`);
