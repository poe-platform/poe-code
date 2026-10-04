import type { BiffRc4Cipher } from "./biff-encryption.js";
import { SsconvertError, type CapabilityContext, type RangeSource, type WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";

export type BiffPropertyInput = Uint8Array | RangeSource;

/** Retained ancillary payloads stay opaque; never reinterpret them as property sets. */
export function appendBiffAncillaryStreams(book: Workbook, streams: Map<string, BiffPropertyInput>,
  handled: Set<UnsupportedRecord>, context: CapabilityContext, ranges: true): void;
export function appendBiffAncillaryStreams(book: Workbook, streams: Map<string, Uint8Array>,
  handled: Set<UnsupportedRecord>, context: CapabilityContext, ranges?: false): void;
export function appendBiffAncillaryStreams(book: Workbook, streams: Map<string, BiffPropertyInput>,
  handled: Set<UnsupportedRecord>, context: CapabilityContext, ranges = false): void {
  let work = 0, nodes = 0, text = 0, size = 0, closed = false;
  const owned: Uint8Array[] = [];
  const cleanup = () => { closed = true; for (const bytes of owned) bytes.fill(0); };
  context.own(cleanup);
  const charge = (amount: number) => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "Encrypted BIFF ancillary writer disposed");
    work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.outputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary work limit exceeded");
  };
  const names = new Set(["\u0005SUMMARYINFORMATION", "\u0005DOCUMENTSUMMARYINFORMATION"]);
  try {
    for (const [name, bytes] of streams) { charge(1); names.add(name.toUpperCase()); size += bytes instanceof Uint8Array ? bytes.length : bytes.size; }
    for (const record of book.unsupportedRecords ?? []) {
      charge(1);
      if (++nodes > (context.limits.workbookNodes ?? context.limits.outputBytes))
        throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary node limit exceeded");
      if (record.source !== "biff" || record.kind !== "encrypted-ancillary" || record.disposition !== "retained") continue;
      const data = record.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const object = data as Readonly<Record<string, ImportedValue>>;
      charge(Object.keys(object).length);
      if (Object.keys(object).some(key => !["stream", "bytes"].includes(key)) ||
        typeof object.stream !== "string" || typeof object.bytes !== "string") continue;
      charge(object.stream.length + object.bytes.length);
      text += object.stream.length * 3 + object.bytes.length;
      if (text > (context.limits.workbookTextBytes ?? context.limits.outputBytes * 2))
        throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary text limit exceeded");
      if (names.has(object.stream.toUpperCase()))
        throw new SsconvertError("unsupported-feature", "Ambiguous encrypted BIFF ancillary stream name");
      names.add(object.stream.toUpperCase());
      if (object.bytes.length % 2) throw new SsconvertError("invalid-request", "Invalid retained BIFF ancillary bytes");
      size += object.bytes.length / 2;
      if (size > context.limits.outputBytes || size > 0xffffffff)
        throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary output bytes limit exceeded");
      const hex = object.bytes, length = hex.length / 2;
      const byte = (at: number) => {
        const high = "0123456789abcdef".indexOf(hex[at * 2]!.toLowerCase());
        const low = "0123456789abcdef".indexOf(hex[at * 2 + 1]!.toLowerCase());
        if (high < 0 || low < 0) throw new SsconvertError("invalid-request", "Invalid retained BIFF ancillary bytes");
        return high * 16 + low;
      };
      const bytes = ranges ? undefined : new Uint8Array(length);
      if (bytes) owned.push(bytes);
      // Validate the entire retained value before requesting any export secret.
      for (let i = 0; i < length; i++) {
        if (!(i % 1024)) charge(1);
        const value = byte(i); if (bytes) bytes[i] = value;
      }
      streams.set(object.stream, bytes ?? { size: length, async read(position, count, options) {
        charge(0); options?.signal?.throwIfAborted();
        if (!Number.isSafeInteger(position) || position < 0 || position > length || !Number.isSafeInteger(count) || count < 0)
          throw new SsconvertError("invalid-request", "Invalid BIFF ancillary range");
        const size = Math.min(16384, count, length - position); charge(size);
        const result = new Uint8Array(size);
        try {
          for (let i = 0; i < size; i++) { if (!(i % 1024)) { charge(0); options?.signal?.throwIfAborted(); } result[i] = byte(position + i); }
          return result;
        } catch (error) { result.fill(0); throw error; }
      } });
      handled.add(record);
    }
  } catch (error) { cleanup(); throw error; }
}

/** POI CryptoAPIEncryptor.setSummaryEntries / MS-OFFCRYPTO 2.3.5.4.
 * Admit before password acquisition; serialize only while the export key exists.
 * Payload block IDs start at zero. Header and table restart block zero separately. */
export function prepareBiffPropertyContainer(streams: ReadonlyMap<string, Uint8Array>, context: CapabilityContext,
  charge: (amount: number) => void): (keyStream: (block: number, length: number) => Uint8Array,
    createCipher?: (block: number) => BiffRc4Cipher) => Uint8Array {
  const { entries, offset, size, tableSize } = propertyLayout(streams, context, charge);
  let closed = false, output: Uint8Array | undefined;
  const cleanup = () => { closed = true; output?.fill(0); };
  context.own(cleanup);
  const check = () => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "Encrypted BIFF property writer disposed");
  };
  return (keyStream, createCipher) => {
    check(); output = new Uint8Array(size);
    const view = new DataView(output.buffer);
    const encrypt = (at: number, length: number, block: number) => {
      check();
      if (createCipher) {
        const cipher = createCipher(block);
        try {
          check();
          for (let offset = 0; offset < length; offset += 16384) {
            cipher.xor(output!.subarray(at + offset, at + Math.min(length, offset + 16384))); check();
          }
        } finally { cipher.close(); }
        return;
      }
      const key = keyStream(block, length);
      try {
        check();
        for (let i = 0; i < length; i++) { if (!(i % 1024)) check(); output![at + i] = output![at + i]! ^ key[i]!; }
      } finally { key.fill(0); }
    };
    try {
      view.setUint32(0, offset, true); view.setUint32(4, tableSize, true);
      view.setUint32(offset, entries.length, true);
      let payload = 8, descriptor = offset + 4, block = 0;
      for (const [name, bytes] of entries) {
        check(); output.set(bytes, payload);
        view.setUint32(descriptor, payload, true); view.setUint32(descriptor + 4, bytes.length, true);
        view.setUint16(descriptor + 8, block, true); output[descriptor + 10] = name.length; output[descriptor + 11] = 1;
        for (let i = 0; i < name.length; i++) view.setUint16(descriptor + 16 + i * 2, name.charCodeAt(i), true);
        encrypt(payload, bytes.length, block++);
        payload += bytes.length; descriptor += 18 + name.length * 2;
      }
      encrypt(offset, tableSize, 0); encrypt(0, 8, 0);
      return output;
    } catch (error) { cleanup(); throw error; }
  };
}

function propertyLayout<T extends BiffPropertyInput>(streams: ReadonlyMap<string, T>, context: CapabilityContext,
  charge: (amount: number) => void) {
  context.signal.throwIfAborted();
  if (streams.size > 65536 || streams.size > (context.limits.workbookNodes ?? context.limits.outputBytes))
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property node limit exceeded");
  let payloadSize = 0, tableSize = 4, textSize = 0;
  const names = new Set<string>(), entries = [...streams];
  for (const [name, bytes] of entries) {
    charge(1 + name.length);
    if (!name.length || name.length > 31 || [...name].some(character =>
      ["\0", "/", "\\", ":", "!"].includes(character) || character.codePointAt(0)! >= 0xd800 && character.codePointAt(0)! <= 0xdfff) ||
      names.has(name.toUpperCase()))
      throw new SsconvertError("unsupported-feature", "Invalid encrypted BIFF property stream name");
    names.add(name.toUpperCase()); textSize += name.length * 3;
    const length = bytes instanceof Uint8Array ? bytes.length : bytes.size;
    if (!Number.isSafeInteger(length) || length < 0) throw new SsconvertError("invalid-request", "Invalid BIFF property input size");
    payloadSize += length; tableSize += 18 + name.length * 2;
  }
  if (textSize > (context.limits.workbookTextBytes ?? context.limits.outputBytes))
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property text limit exceeded");
  const offset = 8 + payloadSize, size = offset + tableSize;
  if (size > 0xffffffff || size > context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property output bytes limit exceeded");
  charge(size * 2 + (entries.length + 2) * 320);
  return { entries, offset, size, tableSize };
}

export interface BiffPropertySource extends RangeSource {
  close(): Promise<void>;
}

/** Prepare before acquiring secrets; fully await staging before erasing the export key. */
export function prepareBiffPropertySource(streams: ReadonlyMap<string, BiffPropertyInput>, context: CapabilityContext,
  charge: (amount: number) => void): (createCipher: (block: number) => BiffRc4Cipher) => Promise<BiffPropertySource> {
  context.signal.throwIfAborted();
  if (streams.size > 65536 || streams.size > (context.limits.workbookNodes ?? context.limits.outputBytes))
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property node limit exceeded");
  const captured = new Map([...streams].map(([name, value]) => [name, value instanceof Uint8Array ? value : {
    size: value.size, read: value.read.bind(value)
  }] as const));
  const { entries, offset, size, tableSize } = propertyLayout(captured, context, charge); captured.clear();
  const acquire = context.createWorkingStorage?.bind(context);
  if (!acquire) throw new SsconvertError("capability-denied", "BIFF properties require caller working storage");
  let store: WorkingStorage | undefined, start = 0, closed = false, started = false;
  let pending: Promise<unknown> = Promise.resolve(), closing: Promise<void> | undefined;
  const check = () => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "BIFF property output is closed");
  };
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  };
  const source: BiffPropertySource = {
    size,
    read(position, count, options) {
      return serial(async () => {
        options?.signal?.throwIfAborted();
        if (!Number.isSafeInteger(position) || position < 0 || position > size || !Number.isSafeInteger(count) || count < 0)
          throw new SsconvertError("invalid-request", "Invalid BIFF property output range");
        const amount = Math.min(16384, count, size - position);
        const bytes = await store!.read(start + position, amount); check(); options?.signal?.throwIfAborted();
        if (bytes.length !== amount) throw new SsconvertError("io", "Truncated BIFF property storage");
        return new Uint8Array(bytes);
      });
    },
    close() {
      closed = true;
      return closing ??= pending.then(async () => { entries.length = 0; await store?.close(); });
    }
  };
  context.own(() => source.close());
  return createCipher => {
    if (started) return Promise.reject(new SsconvertError("invalid-request", "BIFF property output already started"));
    started = true;
    return serial(async () => {
      store = acquire(); check(); start = store.allocate(size); check();
      const buffer = new Uint8Array(16384); let buffered = 0, written = 0;
      const flush = async () => {
        if (!buffered) return;
        await store!.write(start + written, buffer.subarray(0, buffered)); check();
        written += buffered; buffered = 0;
      };
      const emit = async (bytes: Uint8Array, cipher: BiffRc4Cipher) => {
        check();
        for (let at = 0; at < bytes.length;) {
          const count = Math.min(buffer.length - buffered, bytes.length - at);
          buffer.set(bytes.subarray(at, at + count), buffered);
          cipher.xor(buffer.subarray(buffered, buffered + count)); check();
          buffered += count; at += count;
          if (buffered === buffer.length) await flush();
        }
      };
      try {
        const header = new Uint8Array(8), view = new DataView(header.buffer);
        view.setUint32(0, offset, true); view.setUint32(4, tableSize, true);
        let cipher = createCipher(0);
        try { await emit(header, cipher); } finally { cipher.close(); header.fill(0); }
        let block = 0;
        for (const [, bytes] of entries) {
          check(); cipher = createCipher(block++);
          try {
            if (bytes instanceof Uint8Array) await emit(bytes, cipher);
            else for (let at = 0; at < bytes.size;) {
              const count = Math.min(16384, bytes.size - at);
              const borrowed = await bytes.read(at, count, { signal: context.signal }); check();
              if (!borrowed.length || borrowed.length > count) throw new SsconvertError("io", "Truncated BIFF property input");
              const owned = new Uint8Array(borrowed);
              try { await emit(owned, cipher); at += owned.length; } finally { owned.fill(0); }
            }
          } finally { cipher.close(); }
        }
        cipher = createCipher(0);
        try {
          const count = new Uint8Array(4); new DataView(count.buffer).setUint32(0, entries.length, true);
          await emit(count, cipher);
          let payload = 8; block = 0;
          for (const [name, bytes] of entries) {
            const descriptor = new Uint8Array(18 + name.length * 2), view = new DataView(descriptor.buffer);
            view.setUint32(0, payload, true); view.setUint32(4, bytes instanceof Uint8Array ? bytes.length : bytes.size, true); view.setUint16(8, block++, true);
            descriptor[10] = name.length; descriptor[11] = 1;
            for (let i = 0; i < name.length; i++) view.setUint16(16 + i * 2, name.charCodeAt(i), true);
            try { await emit(descriptor, cipher); } finally { descriptor.fill(0); }
            payload += bytes instanceof Uint8Array ? bytes.length : bytes.size;
          }
        } finally { cipher.close(); }
        await flush(); return source;
      } finally { buffer.fill(0); entries.length = 0; }
    }).catch(async error => {
      try { await source.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "BIFF property cleanup failed"); }
      throw error;
    });
  };
}
