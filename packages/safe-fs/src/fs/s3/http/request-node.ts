import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { S3ServiceError } from "../transport.js";
import type { S3HttpRequestFactory } from "./types.js";
import { abortable } from "./request.js";
import type { RequestScope, WireResponse } from "./request.js";

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

