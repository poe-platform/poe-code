import { createHash } from 'node:crypto';
import { check, Hold, bytes } from './core.mjs';

function eventLog() {
  const events = [];
  Object.defineProperty(events, 'push', { value(event) { check(events.length < 8192, 'HARNESS_EVENT_BOUND'); return Array.prototype.push.call(events, event); } });
  return events;
}

export class Ledger {
  constructor(limit) { check(Number.isSafeInteger(limit) && limit > 0, 'LEDGER_LIMIT'); this.limit = limit; this.used = 0; this.peak = 0; }
  admit(amount) { check(Number.isSafeInteger(amount) && amount >= 0, 'LEDGER_AMOUNT'); check(amount <= this.limit - this.used, 'QUOTA'); this.used += amount; this.peak = Math.max(this.peak, this.used); }
  release(amount) { check(Number.isSafeInteger(amount) && amount >= 0 && amount <= this.used, 'LEDGER_RELEASE'); this.used -= amount; }
}
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
export class Scope {
  constructor() { this.closed = false; this.pending = new Set(); this.resources = []; this.completion = undefined; this.registered = false; }
  register(registerCleanup) { check(!this.registered, 'DOUBLE_REGISTER'); this.registered = true; registerCleanup(() => this.close()); }
  acquire(factory, release) {
    check(this.registered && !this.closed, 'ADMISSION_CLOSED');
    const pending = Promise.resolve().then(factory).then(async resource => {
      if (this.closed) { await release(resource); return undefined; }
      this.resources.push(() => release(resource)); return resource;
    });
    this.pending.add(pending);
    pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    return pending;
  }
  close() {
    if (this.completion) return this.completion;
    this.closed = true;
    this.completion = (async () => {
      const admitted = await Promise.allSettled([...this.pending]);
      const released = await Promise.allSettled(this.resources.splice(0).map(release => Promise.resolve().then(release)));
      const failures = [...admitted, ...released].filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures);
    })();
    this.completion.catch(() => {});
    return this.completion;
  }
}
export function schedule(length, name) {
  if (!length) return [];
  if (name === 'P0') return [length];
  if (name.startsWith('CUT:')) { const cut = Number(name.slice(4)); check(cut > 0 && cut < length, 'CUT'); return [cut, length - cut]; }
  const cycle = { P1: [1], P2: [2, 5, 1, 3], P3: [7, 1, 4, 2] }[name];
  check(cycle, 'SCHEDULE');
  const result = [];
  let remaining = length;
  let count = 0;
  while (remaining) { const size = Math.min(remaining, cycle[count % cycle.length]); result.push(size); remaining -= size; count++; if (name === 'P3' && count % 2 === 0) result.push(0); }
  return result;
}
export function source(input, options = {}) {
  const lengths = options.lengths ?? schedule(input.length, options.schedule ?? 'P0');
  check(lengths.reduce((total, length) => total + length, 0) === input.length, 'SOURCE_LENGTHS');
  const events = eventLog();
  const storage = options.reuse ? Buffer.alloc(Math.max(1, ...lengths)) : null;
  let position = 0;
  let index = 0;
  let last;
  const iterator = {
    async next() {
      events.push('next');
      if (options.signal?.aborted) throw options.signal.reason;
      if (last && options.reuse) last.fill(0x58);
      if (options.poisonNext === index) throw options.poisonReason ?? new Hold('POISON_NEXT');
      if (index === lengths.length) return { done: true };
      const length = lengths[index++];
      last = storage ? storage.subarray(0, length) : new Uint8Array(length);
      last.set(input.subarray(position, position + length)); position += length;
      events.push({ delivered: length });
      return { done: false, value: last };
    },
    async return() { events.push('return'); if (last && options.reuse) last.fill(0x58); return { done: true }; },
    async throw(reason) { events.push('throw'); throw reason; },
  };
  return { events, iterator, [Symbol.asyncIterator]() { events.push('acquire'); if (options.poisonAcquire) throw new Hold('POISON_ACQUIRE'); return iterator; } };
}
export function sink(limit, options = {}) {
  const ledger = new Ledger(limit);
  const hash = createHash('sha256');
  const retained = options.retain ? Buffer.alloc(limit) : null;
  let pending = false;
  let calls = 0;
  const output = {
    ledger,
    get calls() { return calls; },
    async write(chunk) {
      check(chunk instanceof Uint8Array, 'SINK_TYPE');
      check(!pending, 'BACKPRESSURE');
      if (options.signal?.aborted) throw options.signal.reason;
      ledger.admit(chunk.byteLength); calls++; pending = true;
      try {
        if (options.gate) await options.gate.promise;
        if (options.signal?.aborted) throw options.signal.reason;
        hash.update(chunk);
        retained?.set(chunk, ledger.used - chunk.length);
      } finally { pending = false; }
    },
    finish() { check(!pending, 'WRITE_PENDING'); return { bytes: ledger.used, sha256: hash.digest('hex'), ...(retained ? { data: retained.subarray(0, ledger.used) } : {}) }; },
  };
  return output;
}
export function mockFS(initial = {}, options = {}) {
  const scope = {};
  const files = new Map(Object.entries(initial).map(([name, datum], index) => [`/work/${name}`, { data: bytes(datum), ino: index + 1 }]));
  const events = eventLog();
  const streams = [];
  const links = new Map(Object.entries(options.links ?? {}));
  const aliases = new Map(Object.entries(options.aliases ?? {}));
  const error = (code, name) => options.errorFactory ? options.errorFactory(code, name) : Object.assign(new Error(code), { code, path: name });
  function call(method, name, settings) { events.push({ method, path: name, flag: settings?.flag ?? null }); if (settings?.signal?.aborted) throw settings.signal.reason; if (options.poison) throw new Hold('POISON_FS'); }
  function resolve(name) { return aliases.get(name) ?? links.get(name) ?? name; }
  function stat(name, follow = true) {
    if (!follow && links.has(name)) return { type: 'symlink', size: 1, mode: 0o777, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };
    const record = files.get(resolve(name));
    if (!record) throw error('ENOENT', name);
    return { type: 'file', size: record.length ?? record.data.length, mode: 0o644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0, ...(options.unknownIdentity ? {} : { identityScope: scope, dev: 1, ino: record.ino }) };
  }
  function beginWrite(name, settings) {
    check(settings?.mode === undefined, 'UNEXPECTED_MODE');
    check(settings?.flag === 'wx' || settings?.flag === 'w', 'WRITE_FLAG');
    if (options.race) files.set(resolve(name), { data: Buffer.from('raced\n'), ino: 999 });
    if (settings.flag === 'wx' && options.unsupportedWx) throw error('ENOTSUP', name);
    if (settings.flag === 'wx' && (files.has(resolve(name)) || links.has(name))) throw error('EEXIST', name);
    const record = { data: Buffer.alloc(options.fileBytes ?? 65536), length: 0, ino: files.get(resolve(name))?.ino ?? files.size + 1 };
    files.set(resolve(name), record);
    return record;
  }
  function append(record, chunk) {
    check(chunk instanceof Uint8Array && chunk.length <= record.data.length - record.length, 'MOCK_FILE_BOUND');
    record.data.set(chunk, record.length); record.length += chunk.length;
  }
  const fs = {
    capabilities: { permissions: false, streamingRead: true },
    async stat(name, settings) { call('stat', name, settings); return stat(name); },
    async lstat(name, settings) { call('lstat', name, settings); return stat(name, false); },
    async realpath(name, settings) { call('realpath', name, settings); stat(name); return resolve(name); },
    async compareEntry(name, other, otherName, settings) { call('compareEntry', name, settings); if (options.comparison !== undefined) return options.comparison; return other === fs ? (resolve(name) === resolve(otherName) ? 'same' : 'distinct') : 'unknown'; },
    readStream(name, settings) { call('readStream', name, settings); const data = files.get(resolve(name)); if (!data) throw error('ENOENT', name); const stream = source(data.data.subarray(0, data.length ?? data.data.length), { ...options.source, signal: settings?.signal }); streams.push(stream); return stream; },
    async readFile() { throw new Hold('WHOLE_READ_FORBIDDEN'); },
    async writeFile(name, data, settings) { call('writeFile', name, settings); check(data instanceof Uint8Array, 'WRITE_TYPE'); const record = beginWrite(name, settings); append(record, data); },
    async writeStream(name, input, settings) {
      call('writeStream', name, settings); const record = beginWrite(name, settings);
      for await (const chunk of input) {
        if (settings?.signal?.aborted) throw settings.signal.reason;
        append(record, chunk);
        if (options.failAfterPrefix) throw error('ENOSPC', name);
      }
    },
  };
  if (options.noWriteStream) delete fs.writeStream;
  if (options.noReadStream) delete fs.readStream;
  for (const name of ['appendFile', 'mkdir', 'rm', 'rename', 'copyFile', 'chmod', 'truncate', 'access', 'readdir']) fs[name] = async () => { throw new Hold('UNEXPECTED_FS', name); };
  return { fs, events, streams, snapshot() { return Object.fromEntries([...files].map(([name, record]) => [name.slice(6), Buffer.from(record.data.subarray(0, record.length ?? record.data.length))])); } };
}

export function faithfulCSV(data, delimiter = 44) {
  const rows = [];
  let cells = [];
  let cell = [];
  let quoted = false;
  let closed = false;
  let touched = false;
  let cellQuoted = false;
  for (let index = 0; index < data.length; index++) {
    const byte = data[index];
    if (quoted) {
      if (byte === 34 && data[index + 1] === 34) { cell.push(34); index++; }
      else if (byte === 34) { quoted = false; closed = true; }
      else cell.push(byte);
    } else if (byte === 34 && !touched && !closed) { quoted = true; cellQuoted = true; touched = true; }
    else if (byte === delimiter || byte === 10) {
      if (byte === delimiter || touched || cells.length) cells.push(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(cell)));
      cell = []; touched = false; closed = false; cellQuoted = false;
      if (byte === 10) { rows.push(cells); cells = []; }
    } else { check(!closed && byte !== 34 && (cellQuoted || byte !== 13), 'CSV_GRAMMAR'); cell.push(byte); touched = true; }
  }
  check(!quoted && !touched && !cells.length, 'CSV_FINAL_LF');
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) throw new Hold('CSV_LEADING_BOM');
  return rows;
}
