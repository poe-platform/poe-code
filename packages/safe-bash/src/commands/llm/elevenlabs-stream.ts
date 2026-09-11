import type { HttpRequest, HttpResponse, HttpTransport } from "../network/types.js";
import type { InvocationCleanup } from "../../contracts/index.js";

async function abortable<Result>(operation: () => PromiseLike<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function* streamElevenLabs(transport: HttpTransport, request: HttpRequest, limit = 64 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  const { signal } = request;
  signal.throwIfAborted();
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let finished = false;
  let failed = false;
  let closed = false;
  let size = 0;
  const cleanups = new Map<InvocationCleanup, { run: InvocationCleanup; pending?: Promise<void> }>();
  const runCleanup = (entry: { run: InvocationCleanup; pending?: Promise<void> }): Promise<void> => {
    return entry.pending ??= Promise.resolve().then(entry.run);
  };
  const register = (cleanup: InvocationCleanup, receiver?: HttpResponse): void => {
    if (cleanups.has(cleanup)) return;
    const entry = { run: () => cleanup.call(receiver) };
    cleanups.set(cleanup, entry);
    if (closed) void runCleanup(entry).catch(() => {});
  };
  const dispose = async (): Promise<void> => {
    closed = true;
    let seen = 0;
    const failures: unknown[] = [];
    while (seen < cleanups.size) {
      const entries = [...cleanups.values()].slice(seen);
      seen = cleanups.size;
      const results = await Promise.allSettled(entries.map(runCleanup));
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length) throw failures[0];
  };
  const close = async (): Promise<void> => {
    const failures: unknown[] = [];
    try { await dispose(); } catch (error) { failures.push(error); }
    if (!finished && iterator?.return) {
      const closing = Promise.resolve().then(() => iterator!.return!());
      if (signal.aborted) void closing.catch(() => {});
      else {
        try { await closing; } catch (error) { failures.push(error); }
      }
    }
    if (!failed) {
      signal.throwIfAborted();
      if (failures.length) throw failures[0];
    }
  };
  const onAbort = (): void => { void dispose().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const acquired = await abortable(async () => {
      signal.throwIfAborted();
      const response = await transport({ ...request, registerCleanup: register });
      register(response.dispose, response);
      if (signal.aborted) {
        await dispose();
        signal.throwIfAborted();
      }
      return response;
    }, signal);
    signal.throwIfAborted();
    if (acquired.status < 200 || acquired.status >= 300) throw new Error(`ElevenLabs HTTP ${acquired.status}: ${acquired.statusText}`);
    iterator = acquired.body[Symbol.asyncIterator]();
    while (true) {
      const next = await abortable(() => iterator!.next(), signal);
      signal.throwIfAborted();
      if (next.done) { finished = true; return; }
      if (!(next.value instanceof Uint8Array)) throw new TypeError("ElevenLabs audio stream must yield Uint8Array chunks");
      size += next.value.byteLength;
      if (size > limit) throw new RangeError("Provider response byte limit exceeded");
      yield Uint8Array.from(next.value);
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    await close();
  }
}
