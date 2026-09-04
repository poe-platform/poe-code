import { FsError, readBytes, type ByteSource } from "../../contracts/index.js";
import { yieldTurn } from "../../contracts/yield.js";
import { Diagnostic } from "./args.js";

export function virtualPath(cwd: string, name: string): string {
  if (name === "") throw new FsError("ENOENT");
  return name.startsWith("/") ? name : `${cwd.endsWith("/") ? cwd : `${cwd}/`}${name}`;
}

export function ownedBytes(source: ByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array> & AsyncDisposable {
  const iterator = source[Symbol.asyncIterator]();
  const controller = new AbortController();
  const readingSignal = AbortSignal.any([signal, controller.signal]);
  let finished = false;
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
          const next = await iterator.next();
          finished = next.done === true;
          return next;
        },
        return: close,
      };
    },
  };
  const stream = (async function* () {
    let chunks = 0;
    try {
      for await (const chunk of readBytes(tracked, readingSignal)) {
        yield chunk;
        if (++chunks % 1024 === 0) await yieldTurn(readingSignal);
      }
    } finally {
      await close();
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
  for await (const chunk of source) {
    let start = 0;
    while (start < chunk.length) {
      signal.throwIfAborted();
      const boundary = chunk.indexOf(delimiter, start);
      const end = boundary < 0 ? chunk.length : boundary + 1;
      const needed = used + end - start;
      if (needed > limit) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
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
      if (++scanned % 1024 === 0) await yieldTurn(signal);
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
