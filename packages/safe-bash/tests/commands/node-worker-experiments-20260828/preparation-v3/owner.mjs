import { stop } from './wire.mjs';
import { latch } from './fixtures.mjs';

export function createOwner(registerCleanup) {
  const cleanups = [];
  const exitActions = [];
  const exitLatch = latch();
  const controller = new AbortController();
  const events = [];
  const failures = [];
  let channel;
  let worker;
  let timer;
  let cleanupPromise;
  let termination;
  let admission = true;
  let acquisition = 'not-attempted';
  let exited = false;
  let exitCode = null;
  let ordinal = 0;
  const owner = {
    signal: controller.signal,
    failures,
    events,
    event(kind, seq = 0, bytes = 0) {
      if (events.length >= 1024) throw new Error('event capture capacity');
      events.push({ kind, seq, bytes });
    },
    registerCleanup(cleanup) {
      if (cleanupPromise) throw new Error('cleanup admission closed');
      const record = { cleanup, completion: null, succeeded: false };
      const run = () => record.completion ??= Promise.resolve().then(() => record.cleanup()).then(() => { record.succeeded = true; }, value => { owner.fail(value, 'cleanup'); throw value; }).finally(() => { record.cleanup = null; });
      record.run = run;
      cleanups.push(record);
      return run;
    },
    afterExit(callback) { exitActions.push(callback); },
    setChannel(value) { channel = value; },
    isOpen() { return admission; },
    admit() {
      if (!admission || ordinal >= 128) throw new Error('effect admission closed');
      ordinal += 1;
      return ordinal;
    },
    cutoff() {
      if (!admission) return;
      admission = false;
      clearTimeout(timer);
      owner.event('cutoff', ++ordinal);
    },
    fail(value, provenance) {
      failures.push({ present: true, value, provenance });
      owner.cutoff();
      if (!controller.signal.aborted) controller.abort(value);
      owner.requestTermination();
    },
    cancel(record) {
      if (record.present !== true || record.provenance !== 'caller') throw new Error('explicit caller presence');
      failures.push(record);
      owner.cutoff();
      if (!controller.signal.aborted) controller.abort(Object.freeze({ role: 'cooperative-cancel-not-raw-reason' }));
      owner.requestTermination();
    },
    requestTermination() {
      if (channel) stop(channel);
      if (worker && !termination) {
        owner.event('termination-requested');
        termination = worker.terminate();
        termination.catch(value => { failures.push({ present: true, value, provenance: 'termination-control' }); });
      }
    },
    beforeConstruct() {
      if (!admission) { acquisition = 'proven-none'; return false; }
      acquisition = 'constructing';
      return true;
    },
    constructionThrew(value) {
      acquisition = 'unconfirmed';
      owner.fail(value, 'construction-control');
    },
    acquired(handle) {
      worker = handle;
      acquisition = 'acquired';
      handle.once('error', value => owner.fail(value, 'worker-control'));
      handle.once('exit', code => {
        exited = true;
        exitCode = code;
        owner.event('worker-exit');
        for (const action of exitActions) action();
        exitLatch.release();
      });
      if (!admission) owner.requestTermination();
    },
    facts() { return { admission, acquisition, exited, exitCode, ordinal, cleanupClosed: false }; },
    async close() {
      return cleanupPromise ??= (async () => {
        owner.cutoff();
        owner.requestTermination();
        if (acquisition === 'not-attempted') acquisition = 'proven-none';
        if (acquisition !== 'proven-none') await exitLatch.promise;
        for (const record of cleanups) {
          await record.run().catch(() => undefined);
        }
        if (termination) await termination.catch(() => undefined);
        owner.event('parent-cleanup-closed');
        return { ...owner.facts(), cleanupSettled: true, cleanupClosed: cleanups.every(record => record.succeeded) };
      })();
    }
  };
  registerCleanup(() => owner.close());
  timer = setTimeout(() => owner.fail(new Error('admission-deadline'), 'private-profile'), 5000);
  return owner;
}
