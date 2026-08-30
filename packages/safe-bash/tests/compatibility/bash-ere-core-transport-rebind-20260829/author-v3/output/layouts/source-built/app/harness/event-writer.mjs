import * as fs from 'node:fs';

export const CELL_EVENT_BYTES = 262144;
export const FINAL_AUDIT_BYTES = 8192;

export function createEventWriter({ descriptor, byteLimit = CELL_EVENT_BYTES, write = fs.writeSync, close = fs.closeSync }) {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0 || !Number.isSafeInteger(byteLimit) || byteLimit < 0 || byteLimit > CELL_EVENT_BYTES || typeof write !== 'function' || typeof close !== 'function') throw new TypeError('event writer configuration');
  let admitted = 0, written = 0, closeAttempted = false, closed = false, failed = false, failure;
  const fail = reason => { if (!failed) { failed = true; failure = reason; } };
  return {
    emit(row) {
      if (failed) throw failure;
      if (closeAttempted) throw new Error('event writer closed');
      try {
        const encoded = JSON.stringify(row);
        if (typeof encoded !== 'string') throw new TypeError('event must serialize to JSON');
        const length = Buffer.byteLength(encoded) + 1;
        if (!Number.isSafeInteger(length) || length > byteLimit - admitted) throw new RangeError('cell event byte cap');
        admitted += length;
        const bytes = Buffer.from(encoded + '\n');
        let offset = 0;
        while (offset < bytes.length) {
          const count = write(descriptor, bytes, offset, bytes.length - offset);
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('event write count');
          offset += count;
          written += count;
        }
        return length;
      } catch (reason) { fail(reason); throw reason; }
    },
    close() {
      if (closeAttempted) return;
      closeAttempted = true;
      try { close(descriptor); closed = true; } catch (reason) { fail(reason); throw reason; }
    },
    snapshot() { return { byteLimit, admitted, written, closeAttempted, closed, failed }; },
  };
}

export function createFailureLedger() {
  let present = false, primary, primaryPhase;
  const secondary = [];
  let omittedSecondary = 0;
  return {
    record(reason, phase) {
      if (!present) { present = true; primary = reason; primaryPhase = phase; }
      else if (secondary.length < 16) secondary.push({ reason, phase });
      else omittedSecondary++;
    },
    snapshot() { return { present, primary, primaryPhase, secondary: secondary.slice(), omittedSecondary }; },
  };
}

export function describeFailures(snapshot) {
  const identities = new Map();
  const describe = reason => {
    const type = reason === null ? 'null' : typeof reason;
    if (type === 'undefined' || type === 'null') return { type };
    if (type === 'boolean') return { type, value: reason };
    if (type === 'number') return { type, value: Object.is(reason, -0) ? '-0' : String(reason) };
    if (type === 'string') return reason.length <= 256 ? { type, value: reason } : { type, length: reason.length, prefix: reason.slice(0, 256), truncated: true };
    if (type === 'bigint') return { type };
    if (!identities.has(reason)) identities.set(reason, identities.size + 1);
    return { type, identity: identities.get(reason), representation: 'identity-local-only-no-object-inspection' };
  };
  return { present: snapshot.present, ...(snapshot.present ? { primary: { phase: snapshot.primaryPhase, reason: describe(snapshot.primary) } } : {}), secondary: snapshot.secondary.map(row => ({ phase: row.phase, reason: describe(row.reason) })), omittedSecondary: snapshot.omittedSecondary };
}
