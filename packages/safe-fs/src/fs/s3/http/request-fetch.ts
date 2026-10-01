import type { RequestOptions } from "node:http";
import { S3ServiceError } from "../transport.js";
import { abortable } from "./request.js";
import type { RequestScope, WireResponse } from "./request.js";
import type { S3HttpRequestFactory } from "./types.js";

export async function sendRequest(
  options: RequestOptions,
  body: Uint8Array,
  scope: RequestScope,
  factory?: S3HttpRequestFactory,
): Promise<WireResponse> {
  const { signal } = scope;
  signal.throwIfAborted();
  if (factory) throw new S3ServiceError("InvalidArgument", 400, "Node request factories are unavailable in fetch runtimes");
  const hostname = String(options.hostname);
  const authority = `${hostname.includes(":") ? `[${hostname}]` : hostname}${options.port ? `:${options.port}` : ""}`;
  const target = `${options.protocol}//${authority}${options.path}`;
  const url = new URL(target);
  // Fetch normalizes dot segments. Never sign one key and send another.
  if (`${url.pathname}${url.search}` !== options.path) throw new S3ServiceError("InvalidArgument", 400, "object key cannot be represented by fetch without normalization");
  const response = await abortable(fetch(target, {
    method: options.method!, headers: options.headers as Record<string, string>,
    ...(options.method === "PUT" ? { body: new Uint8Array(body) } : {}),
    signal, redirect: "manual",
  }), signal);
  const reader = response.body?.getReader();
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    scope.finish();
    void reader?.cancel().catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) { close(); signal.throwIfAborted(); }
  const headersDistinct: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  response.headers.forEach((value, name) => { headersDistinct[name] = [value]; });
  let claimed = false;
  return {
    message: { statusCode: response.status, headersDistinct }, close,
    body: {
      [Symbol.asyncIterator]() {
        if (claimed) throw new S3ServiceError("InvalidResponse", 502, "response body is single-use");
        claimed = true;
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            try {
              signal.throwIfAborted();
              if (closed || !reader) { close(); return { done: true, value: undefined }; }
              const result = await abortable(reader.read(), signal);
              signal.throwIfAborted();
              if (result.done) { close(); return { done: true, value: undefined }; }
              return { done: false, value: result.value };
            } catch (error) { close(); throw error; }
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            close();
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}
