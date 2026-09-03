import { type ByteSource } from "../../contracts/index.js";
import { CurlError, type HttpTransport } from "./types.js";

export interface FetchTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
}

function requestBody(source: ByteSource | undefined, signal: AbortSignal): ReadableStream<Uint8Array> | undefined {
  if (!source) return undefined;
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await iterator.return?.(reason); },
  });
}

export function createFetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  if (typeof fetchRequest !== "function") throw new TypeError("Fetch is unavailable");
  return async input => {
    input.signal.throwIfAborted();
    const url = new URL(input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new CurlError(1, "Unsupported protocol");
    const stopped = new AbortController();
    const signal = AbortSignal.any([input.signal, stopped.signal]);
    const body = requestBody(input.body, signal);
    const headers = new Headers();
    for (const [name, value] of input.headers) headers.append(name, value);
    const request = new Request(url, {
      method: input.method,
      headers,
      body,
      credentials: "omit",
      redirect: "manual",
      signal,
      ...(body ? { duplex: "half" } : {}),
    } as RequestInit & { duplex?: "half" });
    let response: Response | undefined;
    const dispose = async (): Promise<void> => {
      stopped.abort();
      if (response?.body) await response.body.cancel().catch(() => undefined);
    };
    input.registerCleanup?.(dispose);
    response = await fetchRequest(request);
    const reader = response.body?.getReader();
    const responseBody: ByteSource = reader ? (async function* () {
      try {
        while (true) {
          input.signal.throwIfAborted();
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally { reader.releaseLock(); }
    })() : (async function* () {})();
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: responseBody,
      dispose,
    };
  };
}
