import assert from 'node:assert/strict';

export const encoder = new TextEncoder();
export const never = () => new Promise(() => {});
export const turn = () => new Promise(resolve => setImmediate(resolve));

export function gate() {
  let release;
  let reject;
  const promise = new Promise((resolve, rejectPromise) => { release = resolve; reject = rejectPromise; });
  return { promise, release, reject };
}

export function watch(promise) {
  const state = { settled: false };
  state.promise = Promise.resolve(promise).then(
    value => { Object.assign(state, { settled: true, rejected: false, value }); return state; },
    reason => { Object.assign(state, { settled: true, rejected: true, reason }); return state; },
  );
  return state;
}

export async function pending(state, label) {
  await turn();
  await turn();
  assert.equal(state.settled, false, label);
}

export async function resolved(state) {
  await state.promise;
  assert.equal(state.rejected, false, 'unexpected rejection');
  return state.value;
}

export async function rejected(state, reason) {
  await state.promise;
  assert.equal(state.rejected, true, 'expected rejection, not a returned status');
  assert.equal(state.reason, reason, 'exact rejection identity/value');
}

export function result(value, status = 0, stdoutHex = '', stderrHex = '') {
  assert.equal(value.exitCode, status);
  assert.equal(Buffer.from(value.stdoutBytes).toString('hex'), stdoutHex);
  assert.equal(Buffer.from(value.stderrBytes).toString('hex'), stderrHex);
  assert.equal(value.stdout, new TextDecoder('utf-8', { ignoreBOM: true }).decode(value.stdoutBytes));
  assert.equal(value.stderr, new TextDecoder('utf-8', { ignoreBOM: true }).decode(value.stderrBytes));
}

export function register(context, cleanup) {
  assert.equal(typeof context.registerCleanup, 'function', 'Shell must expose the committed optional-host capability');
  assert.equal(context.registerCleanup(cleanup), undefined, 'registration returns no handle');
}

export function closedRegistration(context, cleanup, expectedReason) {
  let threw = false;
  let reason;
  try { context.registerCleanup(cleanup); } catch (error) { threw = true; reason = error; }
  assert.equal(threw, true, 'late registration must synchronously fail');
  if (arguments.length === 3) assert.equal(reason, expectedReason);
  else assert.ok(reason instanceof Error, 'closed normal admission requires Error, without fixing its message/class');
}

export function makeHost(api) {
  const events = [];
  const shells = [];
  const event = (name, details = {}) => events.push({ sequence: events.length, name, ...details });
  const shell = options => {
    const value = new api.Shell({ fs: new api.MemoryFileSystem(), ...options });
    shells.push(value);
    return value;
  };
  const dispose = async value => {
    const outcome = watch(value.dispose());
    await resolved(outcome);
    return outcome;
  };
  return { api, events, shells, event, shell, dispose };
}
