export const VERSION = 3;
export const SAB_BYTES = 197056;
export const CHUNK = 65536;
export const STATES = Object.freeze({ FREE: 0, WORKER: 1, REQUEST: 2, PARENT: 3, RESPONSE: 4, ACK: 5, RETIRED: 6 });
export const PHASES = Object.freeze({ HEADER: 1, CREDIT: 2, UPLOAD: 3, META: 4, DATA: 5, META_ACK: 6, DATA_ACK: 7, FINAL_ACK: 8 });
export const TAGS = Object.freeze({ none: 0, upload: 1, text: 2, void: 3, fsError: 4, unsupported: 5, denied: 6 });
export const REQUEST_KEYS = ['v', 'session', 'slot', 'seq', 'op', 'authority', 'path', 'flag', 'totalBytes', 'moduleKey'];

export function exact(value, keys) {
  if (value === null || typeof value !== 'object') throw new Error('record required');
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((name, index) => name !== keys[index])) throw new Error('exact own keys/order');
  const result = Object.create(null);
  for (const name of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('own data required');
    result[name] = descriptor.value;
  }
  return result;
}

export function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new Error('integer range');
  return value;
}

export function text(value, maximum) {
  if (typeof value !== 'string' || value.length > maximum || Buffer.byteLength(value) > maximum) throw new Error('text limit/type');
  return value;
}

export function control(value, session) {
  const kind = Object.getOwnPropertyDescriptor(value ?? {}, 'kind');
  if (!kind || !Object.hasOwn(kind, 'value')) throw new Error('control kind');
  const keys = kind.value === 'ready' ? ['v', 'session', 'kind']
    : kind.value === 'doorbell' ? ['v', 'session', 'kind', 'slot', 'seq', 'frame']
      : ['v', 'session', 'kind', 'lastSeq', 'finalFrame', 'deliveredSeq'];
  const record = exact(value, keys);
  if (record.v !== VERSION || record.session !== session || Buffer.byteLength(JSON.stringify(record)) > 256) throw new Error('control identity');
  integer(record.session, 1, 2147483647);
  if (record.kind === 'doorbell') {
    if (record.slot !== 0) throw new Error('inactive slot');
    integer(record.seq, 1, 128);
    integer(record.frame, 1, 4096);
  } else if (record.kind !== 'ready') {
    if (!['entryReturned', 'guestFailure'].includes(record.kind)) throw new Error('terminal kind');
    integer(record.lastSeq, 0, 128);
    integer(record.finalFrame, 0, 4096);
    integer(record.deliveredSeq, 0, record.lastSeq);
  }
  return record;
}

export function cacheHandle(value) {
  const record = exact(value, ['namespace', 'path']);
  integer(record.namespace, 1, 128);
  virtualPath(record.path);
  return record;
}

export function virtualPath(value) {
  text(value, 1024);
  if (!value.startsWith('/') || value.includes('\0') || value.split('/').some(part => part === '.' || part === '..') || value.includes('//')) throw new Error('canonical fixture path');
  return value;
}

export function request(value, session, sequence) {
  const record = exact(value, REQUEST_KEYS);
  if (record.v !== VERSION || record.session !== session || record.seq !== sequence || record.slot !== 0) throw new Error('request identity');
  integer(sequence, 1, 128);
  const read = record.op === 'readText';
  const write = record.op === 'writeText';
  const output = record.op === 'writeOutput';
  const json = record.op === 'authorizeJson';
  const module = record.op === 'authorizeModule';
  if (!(read || write || output || json || module)) throw new Error('operation');
  if (module) {
    if (record.authority !== 'module' || record.path !== null || record.flag !== null || record.totalBytes !== 0 || !['fs', 'path', 'process'].includes(record.moduleKey)) throw new Error('module request');
  } else {
    if (record.moduleKey !== null) throw new Error('nonmodule key');
    if (output) {
      if (!['stdout', 'stderr'].includes(record.authority) || record.path !== null || record.flag !== null) throw new Error('output request');
    } else if (read && record.authority === 'stdin') {
      if (record.path !== null || record.flag !== 'r') throw new Error('stdin request');
    } else {
      virtualPath(record.path);
      if (write ? record.authority !== 'data' || !['w', 'wx'].includes(record.flag)
        : json ? record.authority !== 'json' || record.flag !== 'r'
          : !['data', 'json'].includes(record.authority) || record.flag !== 'r') throw new Error('file request');
    }
    if (read ? record.totalBytes !== null : json ? record.totalBytes !== 0 : false) throw new Error('request count');
    if (write || output) integer(record.totalBytes, 0, 1048576);
  }
  return record;
}

export function encode(record) {
  const encoded = JSON.stringify(record);
  text(encoded, 8192);
  return Buffer.from(encoded);
}

export function decode(bytes) {
  if (bytes.length > 8192) throw new Error('metadata cap');
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(decoded);
  if (JSON.stringify(value) !== decoded) throw new Error('noncanonical metadata');
  return value;
}

export function response(value) {
  const record = exact(value, ['kind', 'totalBytes', 'error', 'cacheKey']);
  if (!Object.hasOwn(TAGS, record.kind) || ['none', 'upload'].includes(record.kind)) throw new Error('result kind');
  integer(record.totalBytes, 0, 1048576);
  if (record.kind !== 'text' && record.totalBytes !== 0) throw new Error('metadata-only length');
  if (record.cacheKey !== null) cacheHandle(record.cacheKey);
  if (['text', 'void'].includes(record.kind) ? record.error !== null : record.error === null) throw new Error('result error');
  return record;
}

export function views(sab, session, initialize = false) {
  if (!(sab instanceof SharedArrayBuffer) || sab.byteLength !== SAB_BYTES) throw new Error('fixed SAB');
  const global = new Int32Array(sab, 0, 16);
  const header = new Int32Array(sab, 64, 32);
  const payload = new Uint8Array(sab, 192, CHUNK);
  if (initialize) { global[2] = session; global[3] = VERSION; }
  if (global[2] !== session || global[3] !== VERSION) throw new Error('SAB identity');
  return { global, header, payload, lastFrame: 0, seen: new Set(), session };
}

export function frameNumber(channel) {
  for (;;) {
    const previous = Atomics.load(channel.global, 4);
    integer(previous, 0, 4095);
    if (Atomics.compareExchange(channel.global, 4, previous, previous + 1) === previous) return previous + 1;
  }
}

export function stopCheck(channel) {
  if (Atomics.load(channel.global, 0) !== 0) throw new Error('transport stopped');
}

export function publish(channel, owner, state, seq, phase, tag, total, offset, bytes) {
  stopCheck(channel);
  if (Atomics.load(channel.header, 0) !== owner) throw new Error('payload not owned');
  const frame = frameNumber(channel);
  integer(bytes.length, 0, CHUNK);
  if (bytes.length) channel.payload.set(bytes);
  channel.header.set([seq, phase, frame, channel.lastFrame, bytes.length, total, tag, offset], 1);
  channel.lastFrame = frame;
  channel.seen.add(frame);
  stopCheck(channel);
  if (Atomics.compareExchange(channel.header, 0, owner, state) !== owner) throw new Error('lost ownership');
  return frame;
}

export function acquire(channel, published, owner, seq) {
  stopCheck(channel);
  if (Atomics.compareExchange(channel.header, 0, published, owner) !== published) throw new Error('unexpected state');
  const words = Array.from(channel.header);
  integer(words[3], 1, 4096);
  integer(words[5], 0, CHUNK);
  integer(words[6], 0, 1048576);
  integer(words[8], 0, words[6]);
  if (words[1] !== seq || words[4] !== channel.lastFrame || channel.seen.has(words[3]) || words.slice(9).some(word => word !== 0)) throw new Error('frame binding');
  if (Array.from(channel.global).slice(5).some(word => word !== 0)) throw new Error('global reserved');
  const inactive = new Uint8Array(channel.payload.buffer, 64 + 128 + CHUNK);
  if (inactive.some(byte => byte !== 0)) throw new Error('inactive slot touched');
  channel.lastFrame = words[3];
  channel.seen.add(words[3]);
  return { phase: words[2], frame: words[3], total: words[6], tag: words[7], offset: words[8], bytes: Uint8Array.from(channel.payload.subarray(0, words[5])) };
}

export function wake(channel, stopping = false) {
  const previous = Atomics.load(channel.global, 1);
  integer(previous, 0, stopping ? 8191 : 8190);
  Atomics.store(channel.global, 1, previous + 1);
  Atomics.notify(channel.global, 1);
}

export function stop(channel) {
  if (Atomics.exchange(channel.global, 0, 1) === 0) wake(channel, true);
}

export function waitState(channel, expected) {
  for (;;) {
    const epoch = Atomics.load(channel.global, 1);
    stopCheck(channel);
    if (Atomics.load(channel.header, 0) === expected) return;
    Atomics.wait(channel.global, 1, epoch);
  }
}
