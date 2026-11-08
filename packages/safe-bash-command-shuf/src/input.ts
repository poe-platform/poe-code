import { FsError, readBytes, type InputByteBudget, type ByteSource, type CommandContext, type FileReadHandle, type FileStat } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { Diagnostic } from "./args.js";

export function virtualPath(cwd: string, name: string): string {
  if (name === "") throw new FsError("ENOENT");
  let decoded: string;
  try { decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(name, character => character.charCodeAt(0))); }
  catch { throw new FsError("ENOENT"); }
  return decoded.startsWith("/") ? decoded : `${cwd.endsWith("/") ? cwd : `${cwd}/`}${decoded}`;
}

/** Own only acquisition and reads; a capability or pathname query owns no reader. */
export class FileInput {
  stat: FileStat | undefined;
  private handle: FileReadHandle | undefined;
  private source: AsyncGenerator<Uint8Array> | undefined;
  private opening: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;

  constructor(private readonly context: CommandContext, private readonly maxBytes: number) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
  }

  async open(name: string): Promise<void> {
    const { fs } = this.context;
    const signal = this.signal;
    signal.throwIfAborted();
    const path = virtualPath(this.context.cwd, name);
    const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
    signal.throwIfAborted();
    const retained = fs.openReadFile !== undefined && capabilities.retainedRead !== false;
    if (!retained) {
      if (capabilities.stat !== false) this.stat = await fs.stat(path, { signal });
      signal.throwIfAborted();
    }
    if (this.closed) throw new FsError("EBADF");
    this.opening = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      let input: ByteSource;
      if (retained) {
        this.handle = await fs.openReadFile!(path, { signal });
        signal.throwIfAborted();
        this.stat = await this.handle.stat({ signal });
        signal.throwIfAborted();
        const handle = this.handle;
        const maximum = Math.min(65536, this.maxBytes);
        input = { async *[Symbol.asyncIterator]() {
          let position = 0;
          while (true) {
            const bytes = await handle.read(position, maximum, { signal });
            signal.throwIfAborted();
            if (!bytes.length) return;
            position += bytes.length;
            yield new Uint8Array(bytes);
          }
        } };
      } else if (fs.readStream && capabilities.streamingRead !== false) {
        input = fs.readStream(path, { signal, chunkSize: Math.min(65536, this.maxBytes) });
      } else {
        throw new FsError("ENOTSUP", { path, message: "input requires streaming or retained range reads" });
      }
      this.source = ownedBytes(input, signal);
      signal.throwIfAborted();
    });
    await this.opening;
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    this.signal.throwIfAborted();
    return this.source!.next();
  }

  close(): Promise<void> {
    this.closed = true;
    this.controller.abort(new Error("shuf input is closed"));
    return this.closing ??= Promise.resolve().then(async () => {
      await this.opening?.catch(() => {});
      try { await this.source?.return(undefined); }
      finally { await this.handle?.close(); }
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return { next: () => this.next(), return: async () => { await this.close(); return { done: true, value: undefined }; } };
  }
}

export function ownedBytes(source: ByteSource, signal: AbortSignal, budget?: InputByteBudget): AsyncGenerator<Uint8Array> & AsyncDisposable {
  const iterator = source[Symbol.asyncIterator]();
  const controller = new AbortController();
  const readingSignal = AbortSignal.any([signal, controller.signal]);
  let finished = false;
  let failed = false;
  let failure: unknown;
  let closing: Promise<IteratorResult<Uint8Array>> | undefined;
  const close = (): Promise<IteratorResult<Uint8Array>> => {
    controller.abort(new Error("shuf input is closed"));
    return closing ??= Promise.resolve().then(async () => {
      if (!finished && iterator.return) return iterator.return();
      return { done: true, value: undefined };
    });
  };
  const tracked: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          try {
            const next = await iterator.next();
            finished = next.done === true;
            return next;
          } catch (error) { failed = true; failure = error; throw error; }
        },
        return: close,
      };
    },
  };
  const stream = (async function* () {
    let chunks = 0;
    try {
      for await (const chunk of readBytes(tracked, readingSignal)) {
        budget?.charge(chunk.byteLength);
        yield chunk;
        if (++chunks % 1024 === 0) await yieldTurn(readingSignal);
      }
    } catch (error) {
      if (failed) throw failure;
      throw error;
    } finally {
      await close().catch(error => { if (!failed) throw error; });
    }
  })();
  return {
    [Symbol.asyncIterator]() { return this; },
    async [Symbol.asyncDispose]() { await close(); await stream.return(undefined); },
    next: stream.next.bind(stream),
    async return(value) { await close(); return stream.return(value); },
    async throw(reason) { controller.abort(reason); await close(); return stream.throw(reason); },
  };
}

export async function* records(source: ByteSource, delimiter: number, limit: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let pending = new Uint8Array(Math.min(256, limit));
  let used = 0;
  let scanned = 0;
  for await (const rawChunk of source) {
    const chunk = Uint8Array.prototype.slice.call(rawChunk);
    let start = 0;
    while (start < chunk.length) {
      signal.throwIfAborted();
      const boundary = chunk.indexOf(delimiter, start);
      const end = boundary < 0 ? chunk.length : boundary + 1;
      const needed = used + end - start;
      if (needed > limit) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
      if (boundary >= 0 && used === 0) {
        const rec = chunk.subarray(start, end);
        start = end;
        yield rec;
      } else {
        if (pending.length < needed) {
          const grown = new Uint8Array(Math.min(limit, Math.max(needed, pending.length * 2)));
          grown.set(pending.subarray(0, used));
          pending = grown;
        }
        pending.set(chunk.subarray(start, end), used);
        used = needed;
        start = end;
        if (boundary >= 0) {
          yield pending.slice(0, used);
          used = 0;
        }
      }
      if (++scanned % 8192 === 0) {
        await yieldTurn(signal);
      }
    }
  }
  if (used) {
    if (used >= limit) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
    const last = new Uint8Array(used + 1);
    last.set(pending.subarray(0, used));
    last[used] = delimiter;
    yield last;
  }
}

export async function readAllRecords(
  source: ByteSource,
  delimiter: number,
  maxBytes: number,
  maxRecords: number,
  signal: AbortSignal,
  lines: Uint8Array[]
): Promise<number> {
  let pending = new Uint8Array(Math.min(256, maxBytes));
  let used = 0;
  let scanned = 0;
  let totalBytes = 0;
  for await (const rawChunk of source) {
    const chunk = Uint8Array.prototype.slice.call(rawChunk);
    let start = 0;
    while (start < chunk.length) {
      signal.throwIfAborted();
      const boundary = chunk.indexOf(delimiter, start);
      const end = boundary < 0 ? chunk.length : boundary + 1;
      const needed = used + end - start;
      if (needed > maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
      if (boundary >= 0 && used === 0) {
        totalBytes += end - start;
        if (totalBytes > maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
        if (lines.length >= maxRecords) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
        lines.push(chunk.subarray(start, end));
        start = end;
      } else {
        if (pending.length < needed) {
          const grown = new Uint8Array(Math.min(maxBytes, Math.max(needed, pending.length * 2)));
          grown.set(pending.subarray(0, used));
          pending = grown;
        }
        pending.set(chunk.subarray(start, end), used);
        used = needed;
        start = end;
        if (boundary >= 0) {
          totalBytes += used;
          if (totalBytes > maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
          if (lines.length >= maxRecords) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
          lines.push(pending.slice(0, used));
          used = 0;
        }
      }
      if (++scanned % 8192 === 0) {
        await yieldTurn(signal);
      }
    }
  }
  if (used) {
    if (used >= maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
    totalBytes += used + 1;
    if (totalBytes > maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
    if (lines.length >= maxRecords) throw new Diagnostic("shuf: maxSampleSize limit exceeded\n");
    const last = new Uint8Array(used + 1);
    last.set(pending.subarray(0, used));
    last[used] = delimiter;
    lines.push(last);
  }
  return totalBytes;
}
