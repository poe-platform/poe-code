import { assertBorrowedCollision, borrowedStderr } from './borrowed-boundary.mjs';

function sample() {
  const sentinel = Object.freeze({});
  const local = new AbortController(), caller = new AbortController();
  local.abort(sentinel); caller.abort(sentinel);
  return { localSignal: local.signal, callerSignal: caller.signal, observedOwnReason: sentinel,
    beforeRelease: { handler: { status: 'pending' }, outer: { status: 'pending' } },
    handler: { status: 'rejected', reason: sentinel }, rawInvoke: { status: 'rejected', reason: sentinel },
    dispatch: { timeout: 1, child: 1, outer: 1 },
    outer: { status: 'fulfilled', value: { exitCode: 1, stdout: '', stderr: borrowedStderr, stdoutBytes: new Uint8Array(), stderrBytes: Buffer.from(borrowedStderr) } },
    selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: 0, rejectionsObserved: true };
}

export function boundaryControls() {
  const outcomes = [];
  const controls = [
    ['B01-exact-approved-boundary', 'accept', () => {}],
    ['B02-handler124', 'reject', row => { row.handler = { status: 'fulfilled', value: { exitCode: 124 } }; }],
    ['B03-wrong-handler-identity', 'reject', row => { row.handler.reason = {}; }],
    ['B04-raw-invoke124', 'reject', row => { row.rawInvoke = { status: 'fulfilled', value: { exitCode: 124 } }; }],
    ['B05-wrong-invoke-identity', 'reject', row => { row.rawInvoke.reason = {}; }],
    ['B06-outer-rejects-instead-of-mapping', 'reject', row => { row.outer = { status: 'rejected', reason: row.observedOwnReason }; }],
    ['B07-outer124', 'reject', row => { row.outer.value.exitCode = 124; }],
    ['B08-outer0', 'reject', row => { row.outer.value.exitCode = 0; }],
    ['B09-stdout-bytes-leak', 'reject', row => { row.outer.value.stdoutBytes = Buffer.from('x'); }],
    ['B10-wrong-stderr-text', 'reject', row => { row.outer.value.stderr = 'other failure\n'; }],
    ['B11-wrong-stderr-bytes', 'reject', row => { row.outer.value.stderrBytes = Buffer.from('other failure\n'); }],
    ['B12-missing-child-dispatch', 'reject', row => { row.dispatch.child = 0; }],
    ['B13-early-handler', 'reject', row => { row.beforeRelease.handler.status = 'rejected'; }],
    ['B14-early-outer', 'reject', row => { row.beforeRelease.outer.status = 'fulfilled'; }],
    ['B15-child-unclosed', 'reject', row => { row.selectedChildClosed = false; }],
    ['B16-live-resource', 'reject', row => { row.outstandingOwnedResources = 1; }],
    ['B17-retirement-pending', 'reject', row => { row.retirementSettled = false; }],
    ['B18-wrong-own-sentinel', 'reject', row => { row.observedOwnReason = {}; }],
    ['B19-caller-not-aborted', 'reject', row => { row.callerSignal = new AbortController().signal; }],
    ['B20-unobserved-rejections', 'reject', row => { row.rejectionsObserved = false; }],
  ];
  for (const [id, expected, change] of controls) {
    const receipt = sample(); change(receipt); let error;
    try { assertBorrowedCollision(receipt); } catch (caught) { error = { name: caught.name, code: caught.code, message: caught.message }; }
    outcomes.push({ id, expected, actual: error ? 'reject' : 'accept', error });
  }
  return outcomes;
}
