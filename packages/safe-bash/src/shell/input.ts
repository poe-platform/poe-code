import { FsError, toByteSource } from "../contracts/index.js";
import type { ByteSource, FileSystem } from "../contracts/index.js";
import { yieldTurn } from "../contracts/yield.js";
import { Budget, interruptible } from "./runtime.js";

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
      this.#read = Promise.resolve().then(() => this.#closed ? { value: undefined, done: true as const } : this.#iterator.next()).then((result) => {
        if (result.done) return { value: undefined, done: true };
        if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
        return { value: new Uint8Array(result.value), done: false };
      });
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
    this.#returned ??= Promise.resolve().then(() => this.#iterator.return?.()).then(() => undefined);
    void this.#returned.catch(() => undefined);
    try { await interruptible(this.#returned, signal); }
    catch (error) { if (!this.#readFailed) throw error; }
    signal.throwIfAborted();
  }
}

class ReadText {
  readonly #chunks: string[] = [];
  readonly #pending: string[] = [];

  append(value: string): void {
    if (!value) return;
    this.#pending.push(value);
    if (this.#pending.length === 1024) {
      this.#chunks.push(this.#pending.join(""));
      this.#pending.length = 0;
    }
  }

  finish(): string { return this.#chunks.join("") + this.#pending.join(""); }
}

export class ShellInput implements ByteSource {
  readonly #cursor: InputCursor;
  readonly #owned: boolean;
  readonly #lifetime = new AbortController();
  readonly #cleanupSignal: AbortSignal;
  readonly signal: AbortSignal;
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
        if (end) chunks.push(result.value.subarray(0, end));
        length += end;
        if (newline >= 0) break;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    });
  }

  line(raw: boolean, options?: { count?: number; delimiter?: number; byteCount?: boolean; exact?: boolean }): Promise<{ value: string; escaped: ReadonlySet<number>; terminated: boolean }> {
    return this.#cursor.consume(this.signal, () => options ? this.readBounded(raw, options) : this.readLine(raw));
  }

  private async readBounded(raw: boolean, options: { count?: number; delimiter?: number; byteCount?: boolean; exact?: boolean }): Promise<{ value: string; escaped: ReadonlySet<number>; terminated: boolean }> {
    const text = new ReadText();
    let characters = 0;
    const escaped = new Set<number>();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const delimiter = options.delimiter ?? 10;
    let chunk: Uint8Array = new Uint8Array();
    let offset = 0;
    let length = 0;
    let escaping = false;
    let escapedCharacter = false;
    let units = 0;
    let pulls = 0;
    let terminated = options.count === 0;
    try {
      while (!terminated) {
        if (offset === chunk.length) {
          if (++pulls % 128 === 0) await yieldTurn(this.signal);
          const result = await this.#cursor.take(this.signal);
          if (result.done) {
            break;
          }
          chunk = result.value;
          offset = 0;
          if (!chunk.length) continue;
        }
        const byte = chunk[offset++]!;
        if (!options.exact && !escaping && byte === delimiter) { terminated = true; break; }
        if (++length > this.budget.limits.maxOutputBytes) this.budget.fail("maxOutputBytes");
        if (length % 1024 === 0) {
          await yieldTurn(this.signal);
          this.signal.throwIfAborted();
        }
        if (byte === 0) continue;
        if (!raw && !escaping && byte === 92) { escaping = true; continue; }
        if (escaping) {
          escaping = false;
          if (byte === 10) continue;
          escapedCharacter = true;
        }
        const decoded = decoder.decode(Uint8Array.of(byte), { stream: true });
        let decodedCharacters = 0;
        for (const character of decoded) {
          if (escapedCharacter) {
            escapedCharacter = false;
            escaped.add(characters);
          }
          text.append(character);
          characters++;
          decodedCharacters++;
        }
        units += options.byteCount ? 1 : decodedCharacters;
        if (units === options.count) terminated = true;
      }
      decoder.decode();
      return { value: text.finish(), escaped, terminated };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("encoded data")) throw new Error("read: unsupported non-UTF-8 text boundary");
      throw error;
    } finally {
      if (offset < chunk.length) this.#cursor.remainder = chunk.subarray(offset);
    }
  }

  private async readLine(raw: boolean): Promise<{ value: string; escaped: ReadonlySet<number>; terminated: boolean }> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let terminated = false;
    while (true) {
      const result = await this.#cursor.take(this.signal);
      if (result.done) break;
      const newline = result.value.indexOf(10);
      const chunk = newline < 0 ? result.value : result.value.subarray(0, newline);
      if (chunk.byteLength > this.budget.limits.maxOutputBytes - length) this.budget.fail("maxOutputBytes");
      chunks.push(new Uint8Array(chunk));
      length += chunk.byteLength;
      if (newline >= 0) {
        if (newline + 1 < result.value.length) this.#cursor.remainder = result.value.subarray(newline + 1);
        let slashes = 0;
        if (!raw) {
          for (let chunkIndex = chunks.length - 1; chunkIndex >= 0; chunkIndex--) {
            const bytes = chunks[chunkIndex]!;
            let offset = bytes.length - 1;
            while (offset >= 0 && bytes[offset] === 92) { slashes++; offset--; }
            if (offset >= 0) break;
          }
        }
        if (slashes % 2 === 1) {
          while (chunks.at(-1)?.length === 0) chunks.pop();
          chunks[chunks.length - 1] = chunks.at(-1)!.subarray(0, -1);
          length--;
        } else { terminated = true; break; }
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = new TextDecoder().decode(bytes).replace(/\0/gu, "");
    const escaped = new Set<number>();
    if (raw || !value.includes("\\")) return { value, escaped, terminated };
    const text = new ReadText();
    let characters = 0;
    for (let index = 0; index < value.length;) {
      const slash = value.indexOf("\\", index);
      const span = value.slice(index, slash < 0 ? value.length : slash);
      text.append(span);
      for (let pointOffset = 0; pointOffset < span.length; pointOffset += span.codePointAt(pointOffset)! > 0xffff ? 2 : 1) characters++;
      if (slash < 0 || slash + 1 === value.length) break;
      const character = String.fromCodePoint(value.codePointAt(slash + 1)!);
      escaped.add(characters++);
      text.append(character);
      index = slash + 1 + character.length;
    }
    return { value: text.finish(), escaped, terminated };
  }

  close(): Promise<void> {
    if (!this.#closing) {
      this.#lifetime.abort(new Error("Shell input view closed"));
      this.#closing = this.#owned ? this.#cursor.close(this.#cleanupSignal) : Promise.resolve();
    }
    return this.#closing;
  }
}
