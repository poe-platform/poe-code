import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { S3ServiceError } from "../transport.js";
import type { S3HttpRequestFactory } from "./types.js";

export interface RequestScope {
  readonly signal: AbortSignal;
  readonly finish: () => void;
}

export function scopeFor(signal: AbortSignal | undefined, timeout: number): RequestScope {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new S3ServiceError("RequestTimeout", 408)), timeout);
  return {
    signal: controller.signal,
    finish: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}

export async function abortable<Value>(pending: Promise<Value>, signal: AbortSignal): Promise<Value> {
  let abort: (() => void) | undefined;
  try {
    return await new Promise<Value>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      pending.then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export interface WireResponse {
  readonly message: IncomingMessage;
  readonly body: AsyncIterable<Uint8Array>;
  readonly close: () => void;
}

export async function sendRequest(
  options: RequestOptions,
  body: Uint8Array,
  scope: RequestScope,
  factory?: S3HttpRequestFactory,
): Promise<WireResponse> {
  const signal = scope.signal;
  signal.throwIfAborted();
  return new Promise<WireResponse>((resolve, reject) => {
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let headersReceived = false;
    let finished = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", abort);
      scope.finish();
    };
    const close = (): void => {
      if (finished) return;
      finished = true;
      cleanup();
      response?.destroy();
      request?.destroy();
    };
    const fail = (error: unknown): void => {
      reject(signal.aborted ? signal.reason : error);
      close();
    };
    const abort = (): void => fail(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const create = factory ?? (options.protocol === "https:" ? httpsRequest : httpRequest);
      request = create(options, message => {
        response = message;
        message.on("error", () => {});
        if (finished || signal.aborted) { close(); message.destroy(); return; }
        headersReceived = true;
        message.once("close", cleanup);
        let claimed = false;
        const source: AsyncIterable<Uint8Array> = {
          [Symbol.asyncIterator]() {
            if (claimed) throw new S3ServiceError("InvalidResponse", 502, "response body is single-use");
            claimed = true;
            const iterator = message[Symbol.asyncIterator]();
            let ended = false;
            return {
              async next(): Promise<IteratorResult<Uint8Array>> {
                try {
                  signal.throwIfAborted();
                  if (ended) return { done: true, value: undefined };
                  const result = await abortable(iterator.next(), signal);
                  signal.throwIfAborted();
                  if (result.done) {
                    ended = true;
                    if (!message.complete) throw new S3ServiceError("InvalidResponse", 502, "incomplete HTTP response");
                    close();
                    return { done: true, value: undefined };
                  }
                  if (!(result.value instanceof Uint8Array)) throw new S3ServiceError("InvalidResponse", 502, "nonbinary HTTP body");
                  return { done: false, value: new Uint8Array(result.value) };
                } catch (error) { ended = true; close(); throw signal.aborted ? signal.reason : error; }
              },
              async return(): Promise<IteratorResult<Uint8Array>> {
                ended = true;
                close();
                return { done: true, value: undefined };
              },
            };
          },
        };
        resolve({ message, body: source, close });
      });
      request.on("error", fail);
      request.once("close", () => {
        if (!headersReceived) fail(new S3ServiceError("InvalidResponse", 502, "connection closed before response headers"));
      });
      if (signal.aborted || finished) { abort(); request.destroy(); return; }
      void (async () => {
        for (let offset = 0; offset < body.length; offset += 64 * 1024) {
          signal.throwIfAborted();
          if (!request!.write(body.subarray(offset, offset + 64 * 1024))) await once(request!, "drain", { signal });
        }
        signal.throwIfAborted();
        request!.end();
      })().catch(fail);
    } catch (error) { fail(error); }
  });
}

export function limitedBody(response: WireResponse, maximum: number, expected?: number): AsyncIterable<Uint8Array> {
  if (expected !== undefined && expected > maximum) {
    response.close();
    throw new S3ServiceError("EntityTooLarge", 413, "response exceeds byte limit");
  }
  let claimed = false;
  return {
    [Symbol.asyncIterator]() {
      if (claimed) throw new S3ServiceError("InvalidResponse", 502, "response body is single-use");
      claimed = true;
      const iterator = response.body[Symbol.asyncIterator]();
      let count = 0;
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          try {
            const result = await iterator.next();
            if (result.done) {
              if (expected !== undefined && count !== expected) throw new S3ServiceError("InvalidResponse", 502, "response content length mismatch");
            } else {
              count += result.value.length;
              if (count > maximum) throw new S3ServiceError("EntityTooLarge", 413, "response exceeds byte limit");
              if (expected !== undefined && count > expected) throw new S3ServiceError("InvalidResponse", 502, "response content length mismatch");
            }
            return result;
          } catch (error) { response.close(); throw error; }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          response.close();
          await iterator.return?.();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export async function collect(response: WireResponse, maximum: number, expected?: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for await (const chunk of limitedBody(response, maximum, expected)) { chunks.push(chunk); count += chunk.length; }
    return Buffer.concat(chunks, count);
  } finally { response.close(); }
}
