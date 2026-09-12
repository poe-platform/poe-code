import type { ByteSource, InvocationCleanup } from "../../contracts/index.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../network/types.js";

export function openAiAbortable<Value>(pending: PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(pending).then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(signal.aborted ? signal.reason : error);
    });
    if (signal.aborted) abort();
  });
}

export async function* openAiBytes(source: ByteSource, signal: AbortSignal, limit = 64 * 1024 * 1024): ByteSource {
  signal.throwIfAborted();
  const iterator = source[Symbol.asyncIterator]();
  let failed = false, finished = false;
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await openAiAbortable(iterator.next(), signal);
      if (next.done) { finished = true; return; }
      if (!(next.value instanceof Uint8Array)) throw new Error("OpenAI returned a non-byte response chunk");
      size += next.value.byteLength;
      if (size > limit) throw new RangeError("Provider response byte limit exceeded");
      yield Uint8Array.from(next.value);
    }
  } catch (error) {
    failed = true;
    throw signal.aborted ? signal.reason : error;
  } finally {
    if (!finished) {
      const returned = Promise.resolve().then(() => iterator.return?.());
      if (signal.aborted) void returned.catch(() => undefined);
      else await openAiAbortable(returned, signal).catch(error => { if (!failed) throw error; });
    }
  }
}

export async function openAiJson(response: HttpResponse, signal: AbortSignal, maxBytes = 64 * 1024 * 1024): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", length = 0;
  for await (const chunk of openAiBytes(response.body, signal, maxBytes)) {
    length += chunk.byteLength;
    if (length > maxBytes) throw new Error("OpenAI JSON response exceeds buffer limit");
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("OpenAI returned malformed JSON"); }
  if (!openAiRecord(value)) throw new Error("OpenAI returned a non-object JSON response");
  return value;
}

export function openAiRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function openAiError(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value.slice(0, 1024);
  if (openAiRecord(value) && typeof value.message === "string") return value.message.slice(0, 1024);
  return undefined;
}

export async function* openAiResponse(transport: HttpTransport, input: HttpRequest, maxResponseBytes: number): AsyncIterable<HttpResponse> {
  input.signal.throwIfAborted();
  const cleanups = new Map<InvocationCleanup, { run: InvocationCleanup; pending?: Promise<void> }>();
  let closed = false, failed = false;
  const run = (cleanup: { run: InvocationCleanup; pending?: Promise<void> }): Promise<void> => {
    cleanup.pending ??= Promise.resolve().then(cleanup.run);
    return cleanup.pending;
  };
  const register = (cleanup: InvocationCleanup, receiver?: HttpResponse): void => {
    if (cleanups.has(cleanup)) return;
    const entry = { run: () => cleanup.call(receiver) };
    cleanups.set(cleanup, entry);
    if (closed) void run(entry).catch(() => undefined);
  };
  const close = async (): Promise<void> => {
    closed = true;
    const results = await Promise.allSettled([...cleanups.values()].map(run));
    const rejected = results.find(result => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
  };
  const abort = () => { void close().catch(() => undefined); };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    const pending = Promise.resolve().then(() => {
      input.signal.throwIfAborted();
      return transport({ ...input, registerCleanup: register });
    }).then(response => {
      register(response.dispose, response);
      return response;
    });
    const response = await openAiAbortable(pending, input.signal);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      let detail: string | undefined;
      try { detail = openAiError((await openAiJson(response, input.signal, Math.min(64 * 1024, maxResponseBytes))).error); }
      catch { input.signal.throwIfAborted(); }
      throw new Error(`OpenAI HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    yield response;
  } catch (error) {
    failed = true;
    throw input.signal.aborted ? input.signal.reason : error;
  } finally {
    input.signal.removeEventListener("abort", abort);
    await close().catch(error => { if (!failed && !input.signal.aborted) throw error; });
    if (!failed) input.signal.throwIfAborted();
  }
}
