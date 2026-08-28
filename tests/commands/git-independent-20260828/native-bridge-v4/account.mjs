import { LIMITS, need, exact, failureState } from './finite.mjs';

export function account(clock) {
  const started = clock(), failure = failureState(), children = [], perWorkflow = [];
  let current, lastNow = started, totalBytes = 0;
  const now = () => {
    const value = clock();
    need(Number.isSafeInteger(value) && value >= lastNow, 'monotonic integer clock');
    lastNow = value;
    return value;
  };
  const check = () => {
    need(now() - started <= LIMITS.overallMs, 'overall deadline includes cleanup and publication');
    if (current) need(now() - current.started <= LIMITS.workflowMs + LIMITS.cleanupMs, 'workflow plus cleanup cap');
  };
  return {
    failure,
    begin(id) {
      failure.throwIfFailed(); check();
      need(!current && perWorkflow.length < 6 && LIMITS.overallMs - (now() - started) >= 15000, 'reserve cleanup inside overall');
      current = { id, started: now(), bytes: 0, observers: 0, children: 0 };
      perWorkflow.push(current);
    },
    admit(role, identity, handle) {
      if (role !== 'observer') failure.throwIfFailed();
      check();
      need(current && ['target-wrapper', 'observer'].includes(role), 'finite child role');
      const descriptors = Object.getOwnPropertyDescriptors(identity);
      need(Reflect.ownKeys(descriptors).length === 3 && ['pid', 'born', 'pgid'].every(key => Object.hasOwn(descriptors[key] ?? {}, 'value')), 'identity own data');
      need(Number.isSafeInteger(identity.pid) && identity.pid > 0 && Number.isSafeInteger(identity.pgid) && identity.pgid > 0 && typeof identity.born === 'string' && identity.born.length > 0 && identity.born.length <= 64, 'PID/birth/PGID');
      need(handle && typeof handle.kill === 'function', 'owned child handle before receipt');
      need(!children.some(child => child.pid === identity.pid && child.born === identity.born), 'duplicate child identity');
      if (role === 'observer') need(++current.observers <= LIMITS.observerCalls, 'finite observer count');
      else need(!children.some(child => child.workflow === current.id && child.role === role), 'one wrapper only');
      need(++current.children <= LIMITS.children, 'all children counted');
      const child = { workflow: current.id, role, ...identity, handle, closed: false, status: null };
      children.push(child);
      return child;
    },
    charge(child, bytes) {
      check(); need(current && children.includes(child) && !child.closed && child.workflow === current.id, 'owned stream before publication');
      need(Number.isSafeInteger(bytes) && bytes >= 0, 'raw byte count');
      current.bytes += bytes;
      totalBytes += bytes;
      need(current.bytes <= LIMITS.bytes && totalBytes <= LIMITS.bytes, '65536 combined target/wrapper/observer/helper bytes, also whole cohort');
    },
    close(child, status, signal) {
      need(children.includes(child) && !child.closed, 'one owned close');
      need(Number.isInteger(status) || status === null, 'exact child status');
      child.closed = true; child.status = status; child.signal = signal;
      if (status !== 0 || signal !== null) failure.record(new Error('child nonzero/signal; late PASS ignored'));
    },
    finish() {
      check(); need(current, 'active workflow');
      need(children.filter(child => child.workflow === current.id).every(child => child.closed), 'all admitted children closed');
      need(children.some(child => child.workflow === current.id && child.role === 'target-wrapper'), 'target admitted');
      current.elapsedMs = now() - current.started;
      current = undefined;
      failure.throwIfFailed();
    },
    check,
    remaining() { check(); return LIMITS.overallMs - (now() - started); },
    remainingBytes() { return LIMITS.bytes - totalBytes; },
    closure() { check(); need(children.every(child => child.closed), 'unknown child closure'); },
    receipt() {
      return { started, elapsedMs: now() - started, totalBytes, limits: { ...LIMITS }, workflows: perWorkflow.map(row => ({ ...row })), children: children.map(({ handle, ...row }) => row) };
    },
    children,
  };
}
export function acceptH11(receipt) {
  for (const key of ['clean', 'closed', 'captureClosed', 'survivorsKnown', 'teardownAttempted']) exact(receipt[key], true, key);
  for (const key of ['timedOut', 'outputExceeded']) exact(receipt[key], false, key);
  exact(receipt.status, 0, 'nonzero overrides late PASS'); exact(receipt.signal, null);
  exact(receipt.observability, 'FINAL_SNAPSHOT_OBSERVED');
  exact(receipt.faultCount, 0); exact(receipt.faults, []); exact(receipt.survivors, []); exact(receipt.signals, []);
  exact(receipt.spawnError, undefined); exact(receipt.observerError, undefined);
  exact(receipt.cleanupAllowanceMs, 5000);
  exact(receipt.captures, [{ label: 'stdout', closed: true }, { label: 'stderr', closed: true }]);
  need(Number.isSafeInteger(receipt.outputBytes) && receipt.outputBytes >= 0 && receipt.outputBytes <= 65536, 'target capture bound');
}
