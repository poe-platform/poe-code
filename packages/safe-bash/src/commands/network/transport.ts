import { request as httpRequest, validateHeaderName, validateHeaderValue, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import { readBytes, type ByteSource } from "../../contracts/index.js";
import { CurlError, type HttpTransport } from "./types.js";
import { withSignal } from "./shared.js";
import { privateHostname } from "./private-address.js";

export interface NodeHttpTransportOptions {
  readonly ca?: string | Buffer | readonly (string | Buffer)[];
  readonly maxHeaderBytes?: number;
  readonly resolveAddress?: (hostname: string, signal: AbortSignal) => Promise<{ address: string; family: 4 | 6 }>;
}

export function createNodeHttpTransport(options: NodeHttpTransportOptions = {}): HttpTransport {
  const maxHeaderSize = options.maxHeaderBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(maxHeaderSize) || maxHeaderSize < 1) throw new RangeError("Invalid header limit");
  const ca = Array.isArray(options.ca) ? [...options.ca] : options.ca;
  const resolveAddress = options.resolveAddress ?? (async (hostname: string) => lookup(hostname, { all: false }));
  const transport: HttpTransport = async input => {
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
    let request: ClientRequest | undefined;
    let finish: (() => void) | undefined;
    const closed = new Promise<void>(resolve => { finish = resolve; });
    let cleanup: Promise<void> | undefined;
    const dispose = (): Promise<void> => {
      stopped.abort();
      cleanup ??= Promise.resolve().then(async () => {
        if (request) { request.destroy(); await closed; }
      });
      return cleanup;
    };
    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    let pinned: { lookup: LookupFunction; family: 4 | 6; autoSelectFamily: false } | undefined;
    try {
      input.registerCleanup?.(dispose);
      signal.throwIfAborted();
      if (input.denyPrivateNetworks === true) {
        if (privateHostname(url.hostname)) throw new CurlError(7, "Private network destination denied");
        const literalFamily = isIP(hostname);
        const candidate = literalFamily ? { address: hostname, family: literalFamily } : await withSignal(() => {
          signal.throwIfAborted();
          return resolveAddress(hostname, signal);
        }, signal);
        signal.throwIfAborted();
        const address = candidate?.address;
        const family = candidate?.family;
        if (typeof address !== "string" || (family !== 4 && family !== 6) || isIP(address) !== family) {
          throw new CurlError(7, "Invalid resolved network address");
        }
        const canonical = new URL(`http://${family === 6 ? `[${address}]` : address}/`).hostname;
        if (privateHostname(canonical)) throw new CurlError(7, "Private network destination denied");
        const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        };
        pinned = { lookup: pinnedLookup, family, autoSelectFamily: false };
      }
      signal.throwIfAborted();
    } catch (error) {
      await dispose();
      throw error;
    }
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: input.method,
        headers: pinned && headers.host?.length === 1 ? { ...headers, host: headers.host[0]! } : headers,
        signal, maxHeaderSize, agent: false,
        ...(ca === undefined ? {} : { ca: ca as string | Buffer | (string | Buffer)[] }),
        ...pinned,
        ...(pinned && url.protocol === "https:" ? {
          servername: isIP(hostname) ? "" : hostname,
          rejectUnauthorized: true,
          checkServerIdentity: (_servername: string, certificate: PeerCertificate) => checkServerIdentity(hostname, certificate),
        } : {}),
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
          } finally { response.destroy(); await dispose(); }
        })();
        resolve({
          status: response.statusCode ?? 0, statusText: response.statusMessage ?? "",
          httpVersion: response.httpVersion, headers: responseHeaders, body,
          async dispose() { response.destroy(); await dispose(); },
        });
      });
      request.on("error", reject);
      request.on("close", () => { stopped.abort(); finish?.(); });
      const upload = async (): Promise<void> => {
        signal.throwIfAborted();
        if (input.body) for await (const chunk of readBytes(input.body, signal)) {
          await withSignal(() => new Promise<void>((done, failed) => {
            signal.throwIfAborted();
            request!.write(chunk, error => error ? failed(error) : done());
          }), signal);
        }
        signal.throwIfAborted();
        request!.end();
      };
      void upload().catch(error => request!.destroy(error instanceof Error ? error : new Error("Upload canceled")));
    });
  };
  Object.defineProperty(transport, "supportsPrivateNetworkDeny", { value: true });
  return transport;
}
