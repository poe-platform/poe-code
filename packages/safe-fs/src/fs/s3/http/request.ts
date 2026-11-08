import { concatBytes } from "./bytes.js";
import { S3ServiceError } from "../transport.js";
export { sendRequest } from "#safe-fs-s3-request";

export interface RequestScope {
  readonly signal: AbortSignal;
  readonly finish: () => void;
}

export function scopeFor(signal: AbortSignal | undefined, timeout: number | undefined): RequestScope {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = timeout === undefined ? undefined : setTimeout(() => controller.abort(new S3ServiceError("RequestTimeout", 408)), timeout);
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
  readonly message: { readonly statusCode?: number | undefined; readonly headersDistinct: Record<string, string[] | undefined> };
  readonly body: AsyncIterable<Uint8Array>;
  readonly close: () => void;
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
    return concatBytes(chunks, count);
  } finally { response.close(); }
}
