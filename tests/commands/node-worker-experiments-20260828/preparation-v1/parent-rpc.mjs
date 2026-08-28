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
  async function finishEffect() {
    const active = current;
    if (!owner.isOpen()) return;
    active.ordinal = owner.admit();
    owner.event('effect-admitted', sequence, active.uploaded);
    let operation;
    let settle;
    const settled = new Promise(resolve => { settle = resolve; });
    active.close = owner.registerCleanup(async () => {
      await settled;
      if (operation) await operation.close();
      if (ledger.entries.has(active.reservation)) ledger.release(active.reservation);
      active.closed = true;
      owner.event('operation-cleanup-closed', active.seq);
    });
    try {
      operation = fixture.start(active.request, active.upload, owner.signal);
      const value = await operation.result;
      active.settled = true;
      let resultBytes = empty;
      if (active.request.op === 'readText') {
        if (!(value instanceof Uint8Array) || value.byteLength > 1048576) throw new Error('cooperative read bound/type');
        ledger.charge('read', value.byteLength);
        const owned = Uint8Array.from(value);
        resultBytes = Buffer.from(new TextDecoder().decode(owned));
        if (resultBytes.byteLength > 1048576) throw new Error('replacement UTF8 expansion');
      }
      active.resultBytes = resultBytes;
      const cacheKey = active.request.authority === 'json' ? { namespace: fixture.namespace, path: active.request.path } : null;
      active.metadata = response({ kind: active.request.op === 'readText' ? 'text' : 'void', totalBytes: resultBytes.length, error: null, cacheKey });
      outcomes.set(sequence, { kind: active.metadata.kind, settled: true, closed: false, finalAck: false, delivered: false });
    } catch (value) {
      active.settled = true;
      if (typedOrigin && owner.isOpen()) {
        try {
          const dto = typedErrorDTO(value, typedOrigin);
          active.resultBytes = empty;
          active.metadata = response({ kind: 'fsError', totalBytes: 0, error: dto, cacheKey: null });
          outcomes.set(sequence, { kind: 'fsError', original: value, settled: true, closed: false, finalAck: false, delivered: false });
        } catch (original) { owner.fail(original, 'escaping-parent'); }
      } else if (owner.isOpen()) owner.fail(value, 'escaping-parent');
      else owner.fail(value, 'late-parent-secondary');
    } finally {
      settle();
    }
    if (owner.isOpen() && active.metadata) send(PHASES.META, TAGS[active.metadata.kind], active.metadata.totalBytes, 0, encode(active.metadata));
  }
  function sendData(offset) {
    const chunk = current.resultBytes.subarray(offset, Math.min(offset + 65536, current.resultBytes.length));
    current.sent = offset + chunk.length;
    send(PHASES.DATA, TAGS.text, current.resultBytes.length, offset, chunk);
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
        if (frame.phase !== PHASES.HEADER || frame.tag !== TAGS.none || frame.offset !== 0 || frame.bytes.length > 8192) throw new Error('request phase');
        const metadata = request(decode(frame.bytes), channel.session, sequence);
        const total = metadata.totalBytes ?? 0;
        if (total !== frame.total) throw new Error('upload total');
        const reservation = 'operation-' + sequence;
        ledger.reserve(reservation, 12 * 1048576);
        const admitted = fixture.authorize(metadata);
        current = { seq: sequence, request: metadata, reservation, upload: admitted ? new Uint8Array(total) : empty, uploaded: 0, sent: 0, closed: false, settled: false, close: null, metadata: null, resultBytes: empty };
        const staged = current;
        owner.registerCleanup(async () => {
          if (staged.close) await staged.close();
          if (ledger.entries.has(reservation)) ledger.release(reservation);
        });
        if (!admitted) {
          current.metadata = { kind: 'denied', totalBytes: 0, error: { name: 'Error', code: 'ERR_VNODE_DENIED', message: 'fixture grant denied' }, cacheKey: null };
          current.settled = true;
          outcomes.set(sequence, { kind: 'denied', settled: true, closed: false, finalAck: false, delivered: false });
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
        if (current.uploaded === current.upload.length) {
          ledger.charge(current.request.op === 'writeOutput' ? 'output' : 'write', current.uploaded);
          await finishEffect();
        } else send(PHASES.CREDIT, TAGS.upload, current.upload.length, current.uploaded, empty);
        return;
      }
      if (!current.metadata || frame.bytes.length !== 0 || frame.tag !== TAGS[current.metadata.kind] || frame.total !== current.metadata.totalBytes) throw new Error('ACK metadata');
      if (frame.phase === PHASES.META_ACK) {
        if (frame.tag !== TAGS.text || frame.total === 0 || frame.offset !== 0 || current.sent !== 0) throw new Error('META_ACK transition');
        sendData(0);
      } else if (frame.phase === PHASES.DATA_ACK) {
        if (frame.tag !== TAGS.text || frame.offset !== current.sent || frame.offset === 0 || frame.offset >= frame.total) throw new Error('DATA_ACK transition');
        sendData(frame.offset);
      } else if (frame.phase === PHASES.FINAL_ACK) {
        if (frame.offset !== frame.total || current.sent !== frame.total) throw new Error('FINAL_ACK transition');
        const outcome = outcomes.get(sequence);
        outcome.finalAck = true;
        if (current.close) await current.close();
        else { ledger.release(current.reservation); current.closed = true; }
        outcome.closed = true;
        owner.event('final-ack-not-delivery', sequence);
        if (!owner.isOpen()) return;
        current = null;
        Atomics.store(channel.header, 0, STATES.FREE);
        wake(channel);
      } else throw new Error('ACK phase');
    } finally { busy = false; }
  }
  function terminal(record) {
    if (busy || current !== null || record.lastSeq !== sequence || record.finalFrame !== channel.lastFrame) throw new Error('terminal predecessor');
    for (const [seq, outcome] of outcomes) {
      if (!outcome.finalAck || !outcome.closed) throw new Error('terminal before transport cleanup');
      outcome.delivered = seq <= record.deliveredSeq;
      if (outcome.kind === 'fsError' && !outcome.delivered) owner.fail(outcome.original, 'undelivered-parent');
    }
    owner.cutoff();
    owner.requestTermination();
  }
  return { doorbell, terminal, outcomes };
}
