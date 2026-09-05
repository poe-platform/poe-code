import { FsError, toByteSource } from "../contracts/index.js";
import type { ByteSource, FileSystem } from "../contracts/index.js";
import { yieldTurn } from "../contracts/yield.js";
import { Budget, interruptible } from "./runtime.js";
import { shellValueBytes, shellValueFromBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue, ValueReservation } from "../contracts/value.js";
import type { ValueScope } from "./value-state.js";

export async function fileInput(fs: FileSystem, path: string, maxBytes: number, signal: AbortSignal): Promise<ByteSource> {
  signal.throwIfAborted();
  async function bufferedInput(): Promise<ByteSource> {
    signal.throwIfAborted();
    const bytes = await interruptible(fs.readFile(path, { signal, maxBytes }), signal);
    signal.throwIfAborted();
    if (bytes.byteLength > maxBytes) throw new FsError("EFBIG", { syscall: "readFile", path });
    return toByteSource(bytes);
  }
  const readStream = fs.readStream;
  if (!readStream || fs.capabilities.streamingRead === false) return bufferedInput();
  let iterator: AsyncIterator<Uint8Array>;
  try { iterator = readStream.call(fs, path, { signal })[Symbol.asyncIterator](); }
  catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
    return bufferedInput();
  }
  let size = 0;
  let buffered = false;
  let closed = false;
  let returned: Promise<IteratorResult<Uint8Array>> | undefined;
  function closeIterator(): Promise<IteratorResult<Uint8Array>> {
    returned ??= Promise.resolve().then(() => iterator.return?.() ?? { done: true, value: undefined });
    return returned;
  }
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        signal.throwIfAborted();
        if (closed) return { done: true, value: undefined };
        let result: IteratorResult<Uint8Array>;
        try { result = await interruptible(Promise.resolve(iterator.next()), signal); }
        catch (error) {
          signal.throwIfAborted();
          if (buffered || size > 0 || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
          await interruptible(closeIterator(), signal);
          signal.throwIfAborted();
          if (closed) return { done: true, value: undefined };
          const source = await bufferedInput();
          if (closed) return { done: true, value: undefined };
          iterator = source[Symbol.asyncIterator]();
          buffered = true;
          returned = undefined;
          result = await iterator.next();
        }
        signal.throwIfAborted();
        if (!result.done) {
          if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
          if (result.value.byteLength > maxBytes - size) throw new FsError("EFBIG", { syscall: "readFile", path });
          size += result.value.byteLength;
        }
        return result;
      },
      return() {
        closed = true;
        return closeIterator();
      },
    }),
  };
}

class InputCursor {
  readonly #iterator: AsyncIterator<Uint8Array>;
  remainder: Uint8Array | undefined;
  #read: Promise<IteratorResult<Uint8Array>> | undefined;
  #readSettled = false;
  #readFailed = false;
  #turn = Promise.resolve();
  #returned: Promise<void> | undefined;
  #ended = false;
  #closed = false;

  constructor(source: ByteSource) {
    this.#iterator = source[Symbol.asyncIterator]();
  }

  async consume<Value>(signal: AbortSignal, operation: () => Promise<Value>): Promise<Value> {
    signal.throwIfAborted();
    const previous = this.#turn;
    let release!: () => void;
    const completed = new Promise<void>((resolve) => { release = resolve; });
    this.#turn = previous.then(() => completed);
    try {
      await interruptible(previous, signal);
      signal.throwIfAborted();
      return await operation();
    } finally { release(); }
  }

  async take(signal: AbortSignal): Promise<IteratorResult<Uint8Array>> {
    signal.throwIfAborted();
    if (this.remainder) {
      const value = this.remainder;
      this.remainder = undefined;
      return { value, done: false };
    }
    if (this.#ended || this.#closed) return { value: undefined, done: true };
    if (!this.#read) {
      this.#readSettled = false;
      this.#read = Promise.resolve().then(() => this.#closed ? { value: undefined, done: true as const } : this.#iterator.next()).then((result) => {
        if (result.done) return { value: undefined, done: true };
        if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
        return { value: result.value, done: false };
      });
      void this.#read.then(() => { this.#readSettled = true; }, () => { this.#readSettled = true; });
    }
    try {
      const result = await interruptible(this.#read, signal);
      signal.throwIfAborted();
      this.#read = undefined;
      if (result.done) this.#ended = true;
      return result;
    } catch (error) {
      if (!signal.aborted) { this.#read = undefined; this.#readFailed = true; this.#closed = true; }
      throw error;
    }
  }

  async close(signal: AbortSignal): Promise<void> {
    if (this.#ended) { signal.throwIfAborted(); return; }
    this.#closed = true;
    this.remainder = undefined;
    const pendingRead = this.#read !== undefined && !this.#readSettled;
    this.#returned ??= Promise.resolve().then(() => this.#iterator.return?.()).then(() => undefined);
    void this.#returned.catch(() => undefined);
    if (!pendingRead) {
      try { await interruptible(this.#returned, signal); }
      catch (error) { if (!this.#readFailed) throw error; }
    }
    signal.throwIfAborted();
  }
}

export interface ReadLineOptions {
  readonly count?: number;
  readonly delimiter?: number;
  readonly byteCount?: boolean;
  readonly exact?: boolean;
}

export interface ReadField {
  readonly start: number;
  readonly end: number;
  readonly value: ShellValue;
}

export interface ReadLine {
  readonly value: string;
  readonly shellValue: ShellValue;
  readonly escaped: ReadonlySet<number>;
  readonly escapedByteOffsets: readonly number[];
  readonly terminated: boolean;
  fields(ifs: ShellValue, maximum?: number): Promise<readonly ReadField[]>;
  release(): Promise<void>;
}

class ReadBuffer {
  #buffer: Uint8Array = new Uint8Array();
  #reservation: ValueReservation | undefined;
  length = 0;

  constructor(readonly scope: ValueScope, readonly maximum: number) {}

  append(byte: number): void {
    if (this.length === this.#buffer.length) {
      const capacity = Math.min(this.maximum, Math.max(64, this.#buffer.length * 2));
      const reservation = this.scope.reserve(capacity + 64, 1);
      try {
        const buffer = new Uint8Array(capacity);
        buffer.set(this.#buffer);
        reservation.commit(buffer);
        this.#reservation?.release();
        this.#reservation = reservation;
        this.#buffer = buffer;
      } catch (error) { reservation.release(); throw error; }
    }
    this.#buffer[this.length++] = byte;
  }

  bytes(): Uint8Array { return this.#buffer.subarray(0, this.length); }
}

function utf8Length(first: number): number {
  return first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
}

function utf8Continuation(first: number, position: number, byte: number): boolean {
  if (byte < 0x80 || byte > 0xbf) return false;
  return position !== 1 || (first !== 0xe0 || byte >= 0xa0) && (first !== 0xed || byte < 0xa0)
    && (first !== 0xf0 || byte >= 0x90) && (first !== 0xf4 || byte < 0x90);
}

function displayWidth(bytes: Uint8Array, offset: number): number {
  const first = bytes[offset]!;
  const width = utf8Length(first);
  let consumed = 1;
  while (consumed < width && offset + consumed < bytes.length && utf8Continuation(first, consumed, bytes[offset + consumed]!)) consumed++;
  return consumed;
}

export class ShellInput implements ByteSource {
  readonly #cursor: InputCursor;
  readonly #owned: boolean;
  readonly #lifetime = new AbortController();
  readonly #cleanupSignal: AbortSignal;
  readonly signal: AbortSignal;
  readonly #reads = new Set<() => Promise<void>>();
  #closing: Promise<void> | undefined;

  constructor(source: ByteSource, readonly budget: Budget, signal = budget.signal) {
    this.#owned = !(source instanceof ShellInput);
    this.#cursor = source instanceof ShellInput ? source.#cursor : new InputCursor(source);
    this.#cleanupSignal = signal;
    this.signal = AbortSignal.any([signal, this.#lifetime.signal]);
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    return this.#cursor.consume(this.signal, () => this.#cursor.take(this.signal));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    return { next: () => this.next(), [Symbol.asyncIterator]() { return this; } };
  }

  sourceLine(): Promise<Uint8Array | undefined> {
    return this.#cursor.consume(this.signal, async () => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      let pulls = 0;
      while (true) {
        if (++pulls % 128 === 0) await yieldTurn(this.signal);
        const result = await this.#cursor.take(this.signal);
        if (result.done) {
          if (!length) return undefined;
          break;
        }
        const newline = result.value.indexOf(10);
        const end = newline < 0 ? result.value.length : newline + 1;
        if (end < result.value.length) this.#cursor.remainder = result.value.subarray(end);
        this.budget.source(end);
        if (end) chunks.push(new Uint8Array(result.value.subarray(0, end)));
        length += end;
        if (newline >= 0) break;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    });
  }

  line(raw: boolean, options: ReadLineOptions = {}): Promise<ReadLine> {
    const { count, delimiter = 10, byteCount = false, exact = false } = options;
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new RangeError("Invalid read count");
    if (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 255) throw new RangeError("Invalid read delimiter");
    return this.#cursor.consume(this.signal, async () => {
      const scope = this.budget.values.scope();
      let active = 1;
      let closed = false;
      let completion: Promise<void> | undefined;
      let resolve!: () => void;
      const finish = (): void => {
        if (!closed || active) return;
        this.#reads.delete(release);
        scope.close();
        resolve();
      };
      const release = (): Promise<void> => {
        if (!completion) {
          completion = new Promise(done => { resolve = done; });
          closed = true;
          finish();
        }
        return completion;
      };
      const assertOpen = (): void => {
        this.signal.throwIfAborted();
        if (closed) throw new Error("Read result is closed");
        scope.assertOpen();
      };
      let chunk: Uint8Array = new Uint8Array();
      let offset = 0;
      try {
        scope.reserve(256, 3);
        this.#reads.add(release);
        const buffer = new ReadBuffer(scope, this.budget.limits.maxOutputBytes);
        const escapedByteOffsets: number[] = [];
        let escaping = false;
        let visible = true;
        let units = 0;
        let consumed = 0;
        let checkpoint = 0;
        let pulls = 0;
        let terminated = count === 0;
        const nextByte = async (): Promise<number | undefined> => {
          while (offset === chunk.length) {
            if (++pulls % 128 === 0) await yieldTurn(this.signal);
            const result = await this.#cursor.take(this.signal);
            if (result.done) return undefined;
            chunk = result.value;
            offset = 0;
          }
          this.signal.throwIfAborted();
          return chunk[offset++]!;
        };
        const account = (): void => {
          if (++consumed > this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
        };
        while (!terminated) {
          if (consumed - checkpoint >= 1024) { checkpoint = consumed; await yieldTurn(this.signal); }
          const first = await nextByte();
          if (first === undefined) {
            if (escaping && visible && !buffer.length) buffer.append(1);
            break;
          }
          const quoted = escaping;
          escaping = false;
          if (quoted && first === 10) { account(); continue; }
          if (!quoted && !raw && first === 92) { account(); escaping = true; continue; }
          if (!quoted && !exact && first === delimiter) { terminated = true; break; }
          account();
          if (!quoted && first === 0) continue;
          if (quoted && visible && first !== 0) {
            scope.reserve(64, 2);
            escapedByteOffsets.push(buffer.length);
          }
          if (visible && first === 0) {
            if (quoted && !buffer.length) buffer.append(1);
            visible = false;
          } else if (visible) buffer.append(first);
          const width = byteCount ? 1 : utf8Length(first);
          for (let position = 1; position < width; position++) {
            const next = await nextByte();
            if (next === undefined) break;
            account();
            if (next === 0) visible = false;
            else if (visible) buffer.append(next);
            if (!utf8Continuation(first, position, next)) break;
          }
          units++;
          if (units === count) terminated = true;
          if (units % 1024 === 0) await yieldTurn(this.signal);
        }
        this.signal.throwIfAborted();
        const bytes = buffer.bytes();
        const shellValue = shellValueFromBytes(bytes, scope);
        const escaped = new Set<number>();
        let escapeIndex = 0;
        let characters = 0;
        for (let start = 0; start < bytes.length; start += displayWidth(bytes, start)) {
          if (escapedByteOffsets[escapeIndex] === start) { escaped.add(characters); escapeIndex++; }
          if (++characters % 1024 === 0) await yieldTurn(this.signal);
        }
        Object.freeze(escapedByteOffsets);
        const result: ReadLine = {
          value: shellValueText(shellValue), shellValue, escaped, escapedByteOffsets, terminated, release,
          fields: async (ifs, maximum) => {
            assertOpen();
            active++;
            try {
            if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid read field count");
            const separators = shellValueBytes(ifs, scope);
            scope.reserve(128, 2);
            const keys = new Set<number>();
            const escapedStart = (start: number): boolean => {
              let lower = 0;
              let upper = escapedByteOffsets.length;
              while (lower < upper) {
                const middle = lower + Math.floor((upper - lower) / 2);
                const offset = escapedByteOffsets[middle]!;
                if (offset === start) return true;
                if (offset < start) lower = middle + 1;
                else upper = middle;
              }
              return false;
            };
            const width = (input: Uint8Array, start: number): number => {
              if (byteCount || input === bytes && escapedStart(start)) return 1;
              const length = displayWidth(input, start);
              return length === utf8Length(input[start]!) ? length : 1;
            };
            const key = (input: Uint8Array, start: number): number => {
              let value = 1;
              for (let position = start, end = start + width(input, start); position < end; position++) value = value * 257 + input[position]!;
              return value;
            };
            let steps = 0;
            for (let start = 0; start < separators.length; start += width(separators, start)) {
              const value = key(separators, start);
              if (!keys.has(value)) { scope.reserve(32, 1); keys.add(value); }
              for (let position = start, end = start + width(separators, start); position < end; position++) {
                const byteKey = 257 + separators[position]!;
                if (!keys.has(byteKey)) { scope.reserve(32, 1); keys.add(byteKey); }
              }
              if (++steps % 1024 === 0) { await yieldTurn(this.signal); assertOpen(); }
            }
            const separator = (start: number): boolean => !escapedStart(start) && keys.has(key(bytes, start));
            const whitespace = (start: number): boolean => (bytes[start] === 32 || bytes[start] === 9 || bytes[start] === 10) && separator(start);
            let end = 0;
            for (let start = 0; start < bytes.length; start += width(bytes, start)) {
              if (!whitespace(start)) end = start + width(bytes, start);
              if (++steps % 1024 === 0) { await yieldTurn(this.signal); assertOpen(); }
            }
            let position = 0;
            const advance = (): Promise<void> | undefined => {
              assertOpen();
              position += width(bytes, position);
              if (++steps % 1024 === 0) return yieldTurn(this.signal);
              return undefined;
            };
            const fields: ReadField[] = [];
            while (position < end && whitespace(position)) { const pending = advance(); if (pending) await pending; }
            while (position < end && fields.length < (maximum ?? Number.MAX_SAFE_INTEGER)) {
              const start = position;
              while (position < end && !separator(position)) { const pending = advance(); if (pending) await pending; }
              let fieldEnd = position;
              while (position < end && whitespace(position)) { const pending = advance(); if (pending) await pending; }
              if (position < end && separator(position)) { const pending = advance(); if (pending) await pending; }
              while (position < end && whitespace(position)) { const pending = advance(); if (pending) await pending; }
              if (maximum !== undefined && fields.length === maximum - 1 && position < end) fieldEnd = end;
              scope.reserve(64, 1);
              fields.push(Object.freeze({ start, end: fieldEnd, value: shellValueFromBytes(bytes.subarray(start, fieldEnd), scope) }));
            }
            assertOpen();
            return Object.freeze(fields);
            } finally { active--; finish(); }
          },
        };
        assertOpen();
        return Object.freeze(result);
      } catch (error) { void release(); throw error; }
      finally {
        if (offset < chunk.length) this.#cursor.remainder = chunk.subarray(offset);
        active--;
        finish();
      }
    });
  }

  close(): Promise<void> {
    if (!this.#closing) {
      this.#lifetime.abort(new Error("Shell input view closed"));
      const pending = [...this.#reads].map(release => release());
      if (this.#owned) pending.push(this.#cursor.close(this.#cleanupSignal));
      this.#closing = Promise.all(pending).then(() => undefined);
    }
    return this.#closing;
  }
}
