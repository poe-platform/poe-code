import { STATES, PHASES, TAGS, acquire, publish, wake, request, encode, decode, response } from './wire.mjs';
import { typedErrorDTO } from './errors.mjs';

export function createParentRpc(channel, owner, fixture, ledger, typedOrigin = null) {
  let sequence = 0;
  let current = null;
  let busy = false;
  const outcomes = new Map();
  const empty = new Uint8Array(0);
  function send(phase, tag, total, offset, bytes) {
    if (!owner.isOpen()) return;
    publish(channel, STATES.PARENT, STATES.RESPONSE, sequence, phase, tag, total, offset, bytes);
    wake(channel);
  }
  function retire(active) {
    if (!active.closed) throw new Error('credit requires successful cleanup');
    active.upload = null;
    active.resultBytes = null;
    active.operation = null;
    active.metadata = null;
    active.request = null;
    if (ledger.entries.has(active.reservation)) ledger.release(active.reservation);
  }
  function enroll(metadata) {
    const active = { seq: sequence, request: metadata, reservation: 'operation-' + sequence, upload: null, uploaded: 0, sent: 0, closed: false, settled: false, operation: null, pending: Promise.resolve(), metadata: null, resultBytes: empty, close: null };
    active.close = owner.registerCleanup(async () => {
      await active.pending;
      if (active.operation) await active.operation.close();
      active.operation = null;
      active.upload = null;
      active.resultBytes = null;
      active.closed = true;
      owner.event('operation-cleanup-closed', active.seq);
    });
    owner.registerCleanup(async () => { await active.close(); retire(active); });
    ledger.reserve(active.reservation, 12 * 1048576);
    return active;
  }
  async function finishEffect() {
    const active = current;
    if (!owner.isOpen()) return;
    if (active.upload.length) new TextDecoder('utf-8', { fatal: true }).decode(active.upload);
    active.ordinal = owner.admit();
    owner.event('effect-admitted', sequence, active.uploaded);
    let settle;
    active.pending = new Promise(resolve => { settle = resolve; });
    let failureStage = 'parent';
    const fsOperation = (active.request.op === 'readText' && ['data', 'json'].includes(active.request.authority)) || (active.request.op === 'writeText' && active.request.authority === 'data');
    try {
      failureStage = fsOperation ? 'fs-operation' : 'non-fs-operation';
      active.operation = fixture.start(active.request, active.upload, owner.signal);
      const value = await active.operation.result;
      failureStage = 'parent';
      let resultBytes = empty;
      if (active.request.op === 'readText') {
        if (!(value instanceof Uint8Array) || value.byteLength > 1048576) throw new Error('cooperative read bound/type');
        ledger.charge('read', value.byteLength);
        const decoded = new TextDecoder().decode(value);
        if (Buffer.byteLength(decoded) > 1048576) throw new Error('replacement UTF8 expansion');
        resultBytes = Buffer.from(decoded);
      }
      const journal = 'bridge-journal-' + sequence;
      const journalBytes = 6 * resultBytes.length + 8192;
      owner.registerCleanup(() => { if (ledger.entries.has(journal)) ledger.release(journal); });
      ledger.reserve(journal, journalBytes);
      active.resultBytes = resultBytes;
      const cacheKey = active.request.authority === 'json' ? { namespace: fixture.namespace, path: active.request.path } : null;
      active.metadata = response({ kind: active.request.op === 'readText' ? 'text' : 'void', totalBytes: resultBytes.length, error: null, cacheKey });
      outcomes.set(sequence, { kind: active.metadata.kind, active, settled: true, closed: false, finalAck: false, delivered: false, reconciled: false });
    } catch (value) {
      if (failureStage === 'fs-operation' && typedOrigin && owner.isOpen()) {
        try {
          const dto = typedErrorDTO(value, typedOrigin);
          active.resultBytes = empty;
          active.metadata = response({ kind: 'fsError', totalBytes: 0, error: dto, cacheKey: null });
          outcomes.set(sequence, { kind: 'fsError', original: value, active, settled: true, closed: false, finalAck: false, delivered: false, reconciled: false });
        } catch (original) { owner.fail(original, 'escaping-parent'); }
      } else owner.fail(value, owner.isOpen() ? 'escaping-parent' : 'late-parent-secondary');
    } finally { active.settled = true; settle(); }
    if (owner.isOpen() && active.metadata) send(PHASES.META, TAGS[active.metadata.kind], active.metadata.totalBytes, 0, encode(active.metadata));
  }
  function sendData(offset) {
    const bytes = current.resultBytes.subarray(offset, Math.min(offset + 65536, current.resultBytes.length));
    current.sent = offset + bytes.length;
    send(PHASES.DATA, TAGS.text, current.resultBytes.length, offset, bytes);
  }
  async function doorbell(record) {
    if (busy || !owner.isOpen()) throw new Error('unexpected concurrent/closed doorbell');
    busy = true;
    try {
      const initial = current === null;
      if (record.seq !== (initial ? sequence + 1 : sequence)) throw new Error('doorbell sequence');
      if (initial) sequence += 1;
      const frame = acquire(channel, initial ? STATES.REQUEST : STATES.ACK, STATES.PARENT, sequence);
      if (frame.frame !== record.frame) throw new Error('doorbell frame');
      if (initial) {
        const metadata = request(decode(frame.bytes), channel.session, sequence);
        const total = metadata.totalBytes ?? 0;
        if (frame.phase !== PHASES.HEADER || total !== frame.total) throw new Error('upload total/phase');
        current = enroll(metadata);
        const admitted = fixture.authorize(metadata);
        current.upload = admitted ? new Uint8Array(total) : empty;
        if (!admitted) {
          current.metadata = response({ kind: 'denied', totalBytes: 0, error: { name: 'Error', code: 'ERR_VNODE_DENIED', message: 'fixture grant denied' }, cacheKey: null });
          current.settled = true;
          outcomes.set(sequence, { kind: 'denied', active: current, settled: true, closed: false, finalAck: false, delivered: false, reconciled: false });
          send(PHASES.META, TAGS.denied, 0, 0, encode(current.metadata));
        } else if (total > 0) send(PHASES.CREDIT, TAGS.upload, total, 0, empty);
        else await finishEffect();
        return;
      }
      if (frame.phase === PHASES.UPLOAD) {
        const count = Math.min(65536, current.upload.length - current.uploaded);
        if (current.metadata || frame.tag !== TAGS.upload || frame.total !== current.upload.length || frame.offset !== current.uploaded || frame.bytes.length !== count || count === 0) throw new Error('upload transition');
        current.upload.set(frame.bytes, current.uploaded);
        current.uploaded += count;
        if (current.uploaded === current.upload.length) { ledger.charge(current.request.op === 'writeOutput' ? 'output' : 'write', current.uploaded); await finishEffect(); }
        else send(PHASES.CREDIT, TAGS.upload, current.upload.length, current.uploaded, empty);
        return;
      }
      if (!current.metadata || frame.bytes.length !== 0 || frame.tag !== TAGS[current.metadata.kind] || frame.total !== current.metadata.totalBytes) throw new Error('ACK metadata');
      if (frame.phase === PHASES.META_ACK) {
        if (frame.offset !== 0 || current.sent !== 0) throw new Error('META_ACK transition');
        sendData(0);
      } else if (frame.phase === PHASES.DATA_ACK) {
        if (frame.offset !== current.sent) throw new Error('DATA_ACK transition');
        sendData(frame.offset);
      } else if (frame.phase === PHASES.FINAL_ACK) {
        if (frame.offset !== frame.total || current.sent !== frame.total) throw new Error('FINAL_ACK transition');
        const outcome = outcomes.get(sequence);
        outcome.finalAck = true;
        await current.close();
        outcome.closed = true;
        owner.event('final-ack-not-delivery', sequence);
        if (!owner.isOpen()) return;
        current = null;
        Atomics.store(channel.header, 0, STATES.FREE);
        wake(channel);
      } else throw new Error('ACK phase');
    } finally { busy = false; }
  }
  function delivery(record) {
    const outcome = outcomes.get(record.seq);
    if (!outcome || !outcome.finalAck || !outcome.closed || outcome.delivered) throw new Error('postcopy predecessor');
    outcome.delivered = true;
    retire(outcome.active);
    outcome.active = null;
    owner.event('postcopy-marker-received', record.seq);
  }
  function reconcile() {
    for (const outcome of outcomes.values()) {
      if (outcome.kind === 'fsError' && !outcome.delivered && !outcome.reconciled) { outcome.reconciled = true; owner.fail(outcome.original, 'undelivered-parent'); }
    }
  }
  function terminal(record) {
    if (busy || current !== null || record.lastSeq !== sequence || record.finalFrame !== channel.lastFrame) throw new Error('terminal predecessor');
    for (const [seq, outcome] of outcomes) if (!outcome.finalAck || !outcome.closed || outcome.delivered !== (seq <= record.deliveredSeq)) throw new Error('terminal delivery mismatch');
    reconcile();
    owner.cutoff();
    owner.requestTermination();
  }
  return { doorbell, delivery, terminal, reconcile, outcomes };
}
