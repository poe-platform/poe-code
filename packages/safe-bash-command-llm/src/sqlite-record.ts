import { yieldTurn } from 'safe-bash-contracts/yield';
import type { ByteSource } from 'safe-bash-contracts';

/** Known-length field sources are acquired and owned by the storage transaction. */
export type SqliteRecordValue = null | bigint | number | {
  readonly type: 'text' | 'blob';
  readonly size: number;
  readonly bytes: ByteSource;
};

function varint(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError('SQLite varint out of range');
  const bytes: number[] = [];
  if (value > 0x00ffffffffffffffn) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  while (value > 127n) { bytes.unshift(Number(value & 127n) | (bytes.length ? 128 : 0)); value >>= 7n; }
  bytes.unshift(Number(value) | (bytes.length ? 128 : 0));
  return Uint8Array.from(bytes);
}

function scalar(value: null | bigint | number): { serial: bigint; bytes: Uint8Array } {
  if (value === null || typeof value === 'number' && Number.isNaN(value)) return { serial: 0n, bytes: new Uint8Array() };
  if (typeof value === 'number') {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value);
    return { serial: 7n, bytes };
  }
  if (value === 0n || value === 1n) return { serial: value + 8n, bytes: new Uint8Array() };
  if (value < -(1n << 63n) || value >= 1n << 63n) throw new RangeError('SQLite integer out of range');
  const integer = value;
  const sizes = [1, 2, 3, 4, 6, 8];
  const index = sizes.findIndex(size => integer >= -(1n << BigInt(size * 8 - 1)) && integer < 1n << BigInt(size * 8 - 1));
  const bytes = new Uint8Array(sizes[index]!);
  for (let offset = bytes.length - 1; offset >= 0; offset--) { bytes[offset] = Number(value & 255n); value >>= 8n; }
  return { serial: BigInt(index + 1), bytes };
}

function interruptible<Value>(start: () => PromiseLike<Value> | Value, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }).then(
      value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(signal.aborted ? signal.reason : error); },
    );
  });
}

async function* sourceChunks(source: ByteSource, signal: AbortSignal): ByteSource {
  const iterator = source[Symbol.asyncIterator]();
  let done = false;
  try {
    while (true) {
      const result = await interruptible(() => iterator.next(), signal);
      if (result.done) { done = true; return; }
      yield result.value;
    }
  } finally {
    if (!done) {
      const closing = Promise.resolve().then(() => iterator.return?.());
      if (signal.aborted) void closing.catch(() => undefined);
      else await interruptible(() => closing, signal);
    }
  }
}

/** Encode a SQLite record without materializing any variable-length field.
 * Storage must discard the private snapshot if consuming this stream fails. */
export function sqliteRecord(values: readonly SqliteRecordValue[]): {
  readonly size: number;
  bytes(signal: AbortSignal): ByteSource;
} {
  const fields = values.map(value => {
    if (value !== null && typeof value === 'object') {
      if (!Number.isSafeInteger(value.size) || value.size < 0) throw new RangeError('Invalid SQLite field size');
      return { serial: BigInt(value.size) * 2n + (value.type === 'text' ? 13n : 12n), size: value.size, source: value.bytes };
    }
    const encoded = scalar(value);
    return { serial: encoded.serial, size: encoded.bytes.length, source: (async function* () { yield encoded.bytes; })() };
  });
  const serials = fields.map(field => varint(field.serial));
  const serialSize = serials.reduce((sum, bytes) => sum + bytes.length, 0);
  let headerSize = serialSize + 1;
  while (varint(BigInt(headerSize)).length + serialSize !== headerSize) headerSize = varint(BigInt(headerSize)).length + serialSize;
  const size = fields.reduce((sum, field) => sum + field.size, headerSize);
  if (!Number.isSafeInteger(size)) throw new RangeError('SQLite record size out of range');
  return { size, async *bytes(signal) {
    signal.throwIfAborted();
    yield varint(BigInt(headerSize));
    for (const serial of serials) { signal.throwIfAborted(); yield serial.slice(); }
    for (const field of fields) {
      let consumed = 0;
      for await (const chunk of sourceChunks(field.source, signal)) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new TypeError('SQLite field source must yield bytes');
        if (chunk.length > field.size - consumed) throw new RangeError('SQLite field size exceeded');
        for (let offset = 0; offset < chunk.length; offset += 16384) {
          await yieldTurn(signal);
          yield chunk.slice(offset, offset + 16384);
        }
        consumed += chunk.length;
      }
      if (consumed !== field.size) throw new RangeError('SQLite field size mismatch');
    }
    signal.throwIfAborted();
  } };
}
