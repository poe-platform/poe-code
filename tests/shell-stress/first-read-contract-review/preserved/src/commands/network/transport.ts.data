import { request as httpRequest, validateHeaderName, validateHeaderValue } from "node:http";
import { request as httpsRequest } from "node:https";
import { readBytes, type ByteSource } from "../../contracts/index.js";
import { CurlError, type HttpTransport } from "./types.js";
import { withSignal } from "./shared.js";

export interface NodeHttpTransportOptions {
  readonly ca?: string | Buffer | readonly (string | Buffer)[];
  readonly maxHeaderBytes?: number;
}

export function createNodeHttpTransport(options: NodeHttpTransportOptions = {}): HttpTransport {
  const maxHeaderSize = options.maxHeaderBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(maxHeaderSize) || maxHeaderSize < 1) throw new RangeError("Invalid header limit");
  const ca = Array.isArray(options.ca) ? [...options.ca] : options.ca;
  return async input => {
    input.signal.throwIfAborted();
    const url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new CurlError(1, "Unsupported protocol");
    const headers: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
    for (const [name, value] of input.headers) {
      validateHeaderName(name);
      validateHeaderValue(name, value);
      (headers[name.toLowerCase()] ??= []).push(value);
    }
    const stopped = new AbortController();
    const signal = AbortSignal.any([input.signal, stopped.signal]);
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: input.method, headers, signal, maxHeaderSize, agent: false,
        ...(ca === undefined ? {} : { ca: ca as string | Buffer | (string | Buffer)[] }),
      }, response => {
        const responseHeaders: [string, string][] = [];
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          responseHeaders.push([response.rawHeaders[index]!, response.rawHeaders[index + 1]!]);
        }
        const body: ByteSource = (async function* () {
          try {
            for await (const chunk of response) {
              input.signal.throwIfAborted();
              yield new Uint8Array(chunk as Buffer);
            }
          } finally { response.destroy(); request.destroy(); stopped.abort(); }
        })();
        resolve({
          status: response.statusCode ?? 0, statusText: response.statusMessage ?? "",
          httpVersion: response.httpVersion, headers: responseHeaders, body,
          async dispose() { response.destroy(); request.destroy(); stopped.abort(); },
        });
      });
      request.on("error", reject);
      request.on("close", () => stopped.abort());
      const upload = async (): Promise<void> => {
        if (input.body) for await (const chunk of readBytes(input.body, signal)) {
          await withSignal(() => new Promise<void>((done, failed) => {
            request.write(chunk, error => error ? failed(error) : done());
          }), signal);
        }
        request.end();
      };
      void upload().catch(error => request.destroy(error instanceof Error ? error : new Error("Upload canceled")));
    });
  };
}
