import assert from 'node:assert/strict';

const reservedRoles = ['publication-preimport', 'publisher', 'git-add', 'git-commit', 'git-receipt'];
function record(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'RECORD');
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), 'OWN_KEYS');
  for (const key of keys) { const item = Object.getOwnPropertyDescriptor(value, key); assert(item && Object.hasOwn(item, 'value') && item.enumerable, 'OWN_DATA'); }
}
function list(value, maximum) {
  assert(Array.isArray(value) && value.length <= maximum, 'LIST_CAP');
  const keys = [...Array(value.length).keys()].map(String);
  assert.deepEqual(Reflect.ownKeys(value).filter(key => key !== 'length').sort(), keys.sort(), 'LIST_KEYS');
  for (const key of keys) { const item = Object.getOwnPropertyDescriptor(value, key); assert(item && Object.hasOwn(item, 'value') && item.enumerable, 'LIST_DATA'); }
}
function positive(value) { assert(Number.isSafeInteger(value) && value > 0, 'PID'); }
export function validateStarts(starts, ownerPid) {
  list(starts, 36); const pids = new Set(), ids = new Set(); let owners = 0;
  for (const row of starts) {
    record(row, ['id', 'role', 'pid', 'startedUTC', 'state', 'startObserved', 'exitObserved', 'closeObserved']);
    positive(row.pid); assert(typeof row.id === 'string' && row.id && typeof row.role === 'string' && row.role && Number.isFinite(Date.parse(row.startedUTC)) && row.startObserved === true);
    assert(!pids.has(row.pid) && !ids.has(row.id), 'DUPLICATE_START'); pids.add(row.pid); ids.add(row.id);
    if (row.role === 'administrative-owner') { owners++; assert(row.pid === ownerPid && row.state === 'LIVE_ADMIN_OWNER' && row.exitObserved === false && row.closeObserved === false, 'LIVE_OWNER_BINDING'); }
    else assert(row.state === 'CLOSED' && row.exitObserved === true && row.closeObserved === true, 'PRIOR_NOT_CLOSED');
  }
  assert.equal(owners, 1, 'ONE_OWNER'); return pids;
}
export function admitPrior(ledger, observed) {
  record(ledger, ['schema', 'authorization', 'owner', 'starts', 'reservations', 'maxKnownOS']);
  assert.equal(ledger.schema, 'B1-live-admin-ledger-v1'); assert.equal(ledger.maxKnownOS, 36);
  assert(typeof ledger.authorization === 'string' && ledger.authorization.trim());
  record(ledger.owner, ['pid', 'role', 'entryPath', 'entrySha256', 'ownership']);
  positive(observed.parentPid); positive(observed.selfPid);
  assert.equal(ledger.owner.pid, observed.parentPid); assert.equal(ledger.owner.role, 'administrative-owner');
  assert.equal(ledger.owner.ownership, 'RETAINED_UNTIL_PUBLICATION_AND_TAIL');
  assert(typeof ledger.owner.entryPath === 'string' && ledger.owner.entryPath.startsWith('/') && /^[a-f0-9]{64}$/.test(ledger.owner.entrySha256));
  const pids = validateStarts(ledger.starts, observed.parentPid); assert(!pids.has(observed.selfPid), 'SELF_ALREADY_COUNTED');
  list(ledger.reservations, 5); assert.deepEqual(ledger.reservations.map(item => { record(item, ['role', 'state']); assert.equal(item.state, 'RESERVED_NOT_STARTED'); return item.role; }), reservedRoles);
  assert(ledger.starts.length + ledger.reservations.length <= 36, 'RESERVATION_OVER_CAP');
  return { schema: 'B1-preimport-admission-v1', authorization: ledger.authorization, owner: structuredClone(ledger.owner), prior: structuredClone(ledger.starts), preimport: { id: `preimport-${observed.selfPid}`, role: 'publication-preimport', pid: observed.selfPid, startedUTC: observed.startedUTC, state: 'LIVE_PREIMPORT', startObserved: true, exitObserved: false, closeObserved: false }, reservations: structuredClone(ledger.reservations.slice(1)), maxKnownOS: 36 };
}
export function completePreimport(admission, observedRow) {
  assert.equal(admission.schema, 'B1-preimport-admission-v1');
  assert.equal(observedRow.pid, admission.preimport.pid); assert.equal(observedRow.role, 'publication-preimport');
  assert(observedRow.startObserved && observedRow.exitObserved && observedRow.closeObserved, 'PREIMPORT_NOT_RETIRED');
  const closed = { ...admission.preimport, state: 'CLOSED', exitObserved: true, closeObserved: true };
  const starts = [...admission.prior, closed]; validateStarts(starts, admission.owner.pid);
  return { schema: 'B1-publisher-owned-admission-v1', authorization: admission.authorization, owner: structuredClone(admission.owner), starts, reservations: structuredClone(admission.reservations), maxKnownOS: 36, ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', knownStartsBeforePublication: starts.length };
}
export function admitPublisher(admission, observed) {
  assert.equal(admission.schema, 'B1-publisher-owned-admission-v1'); assert.equal(admission.maxKnownOS, 36);
  assert.equal(admission.owner.pid, observed.parentPid); assert.equal(admission.ownerDisposition, 'EXIT_PENDING_EXTERNAL_OBSERVATION');
  const pids = validateStarts(admission.starts, observed.parentPid); positive(observed.selfPid); assert(!pids.has(observed.selfPid), 'PUBLISHER_ALREADY_COUNTED');
  assert.equal(admission.knownStartsBeforePublication, admission.starts.length);
  assert.deepEqual(admission.reservations, reservedRoles.slice(1).map(role => ({ role, state: 'RESERVED_NOT_STARTED' })));
  assert(admission.starts.length + admission.reservations.length <= 36, 'PUBLISHER_CAP');
  return { id: `publisher-${observed.selfPid}`, role: 'publisher', pid: observed.selfPid, startedUTC: observed.startedUTC, state: 'LIVE_PUBLISHER', startObserved: true, exitObserved: false, closeObserved: false };
}
export function countPublication(admission, publisher, children) {
  const seen = validateStarts(admission.starts, admission.owner.pid); assert(!seen.has(publisher.pid)); seen.add(publisher.pid);
  assert(children.length <= 3); const roles = new Set();
  for (const child of children) {
    assert(['git-add', 'git-commit', 'git-receipt'].includes(child.role) && !roles.has(child.role), 'GIT_ROLE'); roles.add(child.role);
    if (child.pid === null || child.pid === undefined) continue;
    positive(child.pid); assert(!seen.has(child.pid), 'DUPLICATE_GIT_PID'); seen.add(child.pid);
  }
  assert(seen.size <= 36); return { knownStarts: seen.size, publisher, ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', childRetirement: children.every(row => row.pid && row.exitObserved === true && row.closeObserved === true) ? 'OBSERVED_RECORDED_CHILDREN' : 'UNKNOWN', reservationsAreNotStarts: true };
}
export function ownerLedger(snapshot, authorization, ownerIdentity) {
  return { schema: 'B1-live-admin-ledger-v1', authorization, owner: { pid: snapshot.self.pid, role: 'administrative-owner', entryPath: ownerIdentity.path, entrySha256: ownerIdentity.sha256, ownership: 'RETAINED_UNTIL_PUBLICATION_AND_TAIL' }, starts: [snapshot.self, ...snapshot.starts].map(row => ({ id: row.id, role: row.role, pid: row.pid, startedUTC: row.startUTC, state: row.role === 'administrative-owner' ? 'LIVE_ADMIN_OWNER' : 'CLOSED', startObserved: row.startObserved, exitObserved: row.exitObserved, closeObserved: row.closeObserved })), reservations: reservedRoles.map(role => ({ role, state: 'RESERVED_NOT_STARTED' })), maxKnownOS: 36 };
}
