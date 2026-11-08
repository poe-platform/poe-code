import { jsonSize } from './json-size.mjs';
import { VERSION, STATES, PHASES, TAGS, request, encode, decode, response, publish, acquire, waitState, stopCheck, text } from './wire.mjs';
import { validateErrorDTO } from './errors.mjs';

export function createSyncBridge(channel, port) {
  let sequence = 0;
  let delivered = 0;
  let lastResult = null;
  const empty = new Uint8Array(0);
  function send(state, phase, tag, total, offset, bytes) {
    const frame = publish(channel, STATES.WORKER, state, sequence, phase, tag, total, offset, bytes);
    port.postMessage({ v: VERSION, session: channel.session, kind: 'doorbell', slot: 0, seq: sequence, frame });
  }
  function receive() {
    waitState(channel, STATES.RESPONSE);
    return acquire(channel, STATES.RESPONSE, STATES.WORKER, sequence);
  }
  function bridge(op, authority, path, flag, body, moduleKey) {
    if (arguments.length !== 6 || [op, authority, path, flag, body, moduleKey].some(value => value !== null && typeof value !== 'string')) throw new Error('primitive tuple only');
    stopCheck(channel);
    if (op === 'delivered') {
      if (authority !== 'postcopy-v1' || path !== String(sequence) || flag !== lastResult?.kind || body !== null || moduleKey !== null || sequence !== delivered + 1) throw new Error('delivery witness');
      delivered = sequence;
      lastResult = null;
      port.postMessage({ v: VERSION, session: channel.session, kind: 'delivered', seq: sequence });
      return undefined;
    }
    if (lastResult !== null || sequence !== delivered) throw new Error('previous result lacks postcopy witness');
    if (body !== null) text(body, 1048576);
    const uploadBytes = body === null ? 0 : Buffer.byteLength(body);
    let upload = empty;
    sequence += 1;
    const metadata = request({ v: VERSION, session: channel.session, slot: 0, seq: sequence, op, authority, path, flag, totalBytes: op === 'readText' ? null : uploadBytes, moduleKey }, channel.session, sequence);
    waitState(channel, STATES.FREE);
    if (Atomics.compareExchange(channel.header, 0, STATES.FREE, STATES.WORKER) !== STATES.FREE) throw new Error('slot claim');
    send(STATES.REQUEST, PHASES.HEADER, TAGS.none, uploadBytes, 0, encode(metadata));
    let frame = receive();
    let uploaded = 0;
    while (frame.phase === PHASES.CREDIT) {
      if (upload.length === 0 && uploadBytes > 0) upload = Buffer.from(body);
      if (frame.tag !== TAGS.upload || frame.total !== upload.length || frame.offset !== uploaded || frame.bytes.length || uploaded >= upload.length) throw new Error('upload credit');
      const chunk = upload.subarray(uploaded, Math.min(uploaded + 65536, upload.length));
      send(STATES.ACK, PHASES.UPLOAD, TAGS.upload, upload.length, uploaded, chunk);
      uploaded += chunk.length;
      frame = receive();
    }
    if (frame.phase !== PHASES.META || frame.offset !== 0) throw new Error('result metadata phase');
    const result = response(decode(frame.bytes));
    if (result.error !== null) validateErrorDTO(result.error, result.kind);
    if (frame.tag !== TAGS[result.kind] || frame.total !== result.totalBytes) throw new Error('result tag/count');
    if (uploaded !== uploadBytes && result.kind !== 'denied') throw new Error('incomplete upload');
    const assembled = new Uint8Array(result.totalBytes);
    let decodedText = result.kind === 'text' ? '' : null;
    let copied = 0;
    if (result.totalBytes > 0) {
      send(STATES.ACK, PHASES.META_ACK, TAGS.text, result.totalBytes, 0, empty);
      while (copied < result.totalBytes) {
        frame = receive();
        const count = Math.min(65536, result.totalBytes - copied);
        if (frame.phase !== PHASES.DATA || frame.tag !== TAGS.text || frame.total !== result.totalBytes || frame.offset !== copied || frame.bytes.length !== count) throw new Error('result data');
        assembled.set(frame.bytes, copied);
        copied += count;
        if (copied === result.totalBytes) decodedText = new TextDecoder('utf-8', { fatal: true }).decode(assembled);
        send(STATES.ACK, copied === result.totalBytes ? PHASES.FINAL_ACK : PHASES.DATA_ACK, TAGS.text, result.totalBytes, copied, empty);
      }
    } else {
      send(STATES.ACK, PHASES.FINAL_ACK, TAGS[result.kind], 0, 0, empty);
    }
    waitState(channel, STATES.FREE);
    stopCheck(channel);
    lastResult = { kind: result.kind };
    const envelope = { seq: sequence, kind: result.kind, text: decodedText, error: result.error, cacheKey: result.cacheKey };
    jsonSize(envelope, 6 * result.totalBytes + 8192);
    upload = empty;
    return JSON.stringify(envelope);
  }
  return { bridge, terminal: kind => ({ v: VERSION, session: channel.session, kind, lastSeq: sequence, finalFrame: channel.lastFrame, deliveredSeq: delivered }) };
}
