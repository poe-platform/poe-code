import { FsError, readBytes, resolvePath, writeBytes, type ByteSource, type CommandContext, type FileStat } from "../../contracts/index.js";
import { integerMaximum, pathQuote, type CmpLimits } from "./options.js";
import { yieldTurn } from "../../contracts/yield.js";

export async function observe<Value>(operation: () => Promise<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

export class InputError extends Error {
  constructor(readonly operand: string, readonly reason: unknown, readonly opening: boolean) { super("cmp input failure"); }
}

const errnoMessages: Readonly<Record<string, string>> = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
  EISDIR: "Is a directory", ENOTDIR: "Not a directory", EIO: "Input/output error", EBADF: "Bad file descriptor",
  ELOOP: "Too many levels of symbolic links", ENAMETOOLONG: "File name too long", ENOSPC: "No space left on device",
  EMFILE: "Too many open files", ENFILE: "Too many open files in system", EPIPE: "Broken pipe",
  EOVERFLOW: "Value too large to be stored in data type", ENOTSUP: "Operation not supported", EFBIG: "File too large",
};

export function errorText(error: unknown): string {
  if (error instanceof FsError) return errnoMessages[error.code] ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

export class Cursor {
  private readonly reader: AsyncGenerator<Uint8Array>;
  private chunk = new Uint8Array();
  private offset = 0;
  private done = false;
  private closed: Promise<void> | undefined;
  private returned: Promise<IteratorResult<Uint8Array>> | undefined;
  private untilYield = 65536;

  constructor(readonly operand: string, source: ByteSource, readonly signal: AbortSignal, readonly maxChunkBytes: number) {
    this.reader = readBytes({
      [Symbol.asyncIterator]: () => {
        const iterator = source[Symbol.asyncIterator]();
        return {
          next: () => iterator.next(),
          return: () => {
            this.returned ??= Promise.resolve().then(() => iterator.return ? iterator.return() : { value: undefined, done: true as const });
            return this.returned;
          },
        };
      },
    }, signal);
  }

  async available(): Promise<Uint8Array> {
    try {
      this.signal.throwIfAborted();
      while (!this.done && this.offset === this.chunk.length) {
        if (this.untilYield <= 0) { await yieldTurn(this.signal); this.untilYield = 65536; }
        const next = await this.reader.next();
        this.done = Boolean(next.done);
        if (next.done) { this.chunk = new Uint8Array(); this.offset = 0; break; }
        if (next.value.byteLength > this.maxChunkBytes) throw new Error("input chunk bytes limit exceeded");
        this.untilYield -= Math.max(64, next.value.byteLength);
        this.chunk = new Uint8Array(next.value);
        this.offset = 0;
      }
      return this.chunk.subarray(this.offset);
    } catch (error) {
      this.signal.throwIfAborted();
      throw new InputError(this.operand, error, false);
    }
  }

  consume(count: number): void { this.offset += count; }

  async block(count: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(count);
    let size = 0;
    while (size < count) {
      const chunk = await this.available();
      if (!chunk.length) break;
      const length = Math.min(count - size, chunk.length);
      bytes.set(chunk.subarray(0, length), size);
      this.consume(length);
      size += length;
    }
    return bytes.subarray(0, size);
  }

  async skip(count: bigint): Promise<void> {
    while (count > 0n) {
      const chunk = await this.available();
      if (!chunk.length) break;
      const amount = Number(count < BigInt(chunk.length) ? count : BigInt(chunk.length));
      this.consume(amount);
      count -= BigInt(amount);
    }
  }

  close(): Promise<void> {
    this.closed ??= (async () => {
      try { await this.reader.return(undefined); await this.returned; }
      catch (error) { throw new InputError(this.operand, error, false); }
      finally { this.chunk = new Uint8Array(); }
    })();
    return this.closed;
  }
}

export interface Input {
  readonly name: string;
  readonly path?: string;
  readonly stat?: FileStat;
}

export class Session {
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  private readonly cursors: Cursor[] = [];
  private closed: Promise<void> | undefined;

  constructor(readonly context: CommandContext, readonly limits: CmpLimits, readonly comparisonBlockBytes: number | undefined) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    context.registerCleanup?.(() => this.close());
  }

  async open(name: string): Promise<Input> {
    this.signal.throwIfAborted();
    if (name === "-") return { name };
    try {
      if (!name) throw new FsError("ENOENT");
      const path = resolvePath(this.context.cwd, name);
      const stat = await observe(() => this.context.fs.stat(path, { signal: this.signal }), this.signal);
      this.signal.throwIfAborted();
      await observe(() => this.context.fs.access(path, 4, { signal: this.signal }), this.signal);
      this.signal.throwIfAborted();
      return { name, path, stat };
    } catch (error) { this.signal.throwIfAborted(); throw new InputError(name, error, true); }
  }

  cursor(input: Input, skip: bigint): Cursor {
    this.signal.throwIfAborted();
    const { context, signal, limits } = this;
    const source = input.path === undefined ? context.stdin : (async function* () {
      if (input.stat?.type === "directory") throw new FsError("EISDIR");
      if (skip > integerMaximum && input.stat?.type === "file") return;
      if (context.fs.readStream) {
        const start = input.stat?.type === "file" && input.stat.size >= 0 ? Number(skip < BigInt(Number.MAX_SAFE_INTEGER) ? skip : BigInt(Number.MAX_SAFE_INTEGER)) : 0;
        yield* context.fs.readStream(input.path!, { signal, start, chunkSize: Math.min(65536, limits.maxChunkBytes) });
      } else {
        if (!input.stat || !Number.isSafeInteger(input.stat.size) || input.stat.size < 0 || input.stat.size > limits.maxFallbackBytes) {
          throw new Error("bounded comparison requires readStream or a file within maxFallbackBytes");
        }
        const bytes = await observe(() => context.fs.readFile(input.path!, { signal, maxBytes: limits.maxFallbackBytes }), signal);
        if (bytes.length > limits.maxFallbackBytes) throw new Error("input fallback bytes limit exceeded");
        for (let offset = Number(skip < BigInt(bytes.length) ? skip : BigInt(bytes.length)); offset < bytes.length; offset += limits.maxChunkBytes) yield bytes.subarray(offset, offset + limits.maxChunkBytes);
      }
    })();
    const cursor = new Cursor(input.name, source, signal, limits.maxChunkBytes);
    this.cursors.push(cursor);
    return cursor;
  }

  async output(text: string, stderr = false): Promise<void> {
    await writeBytes(stderr ? this.context.stderr : this.context.stdout, new TextEncoder().encode(text), this.signal);
  }

  close(cancel = true): Promise<void> {
    if (!this.closed) {
      this.closed = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(this.cursors.map(cursor => cursor.close()));
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      });
      if (cancel) this.controller.abort(new Error("cmp invocation closed"));
    }
    return this.closed;
  }
}

export function inputDiagnostic(error: InputError): string {
  return `cmp: ${pathQuote(error.operand)}: ${errorText(error.reason)}\n`;
}
