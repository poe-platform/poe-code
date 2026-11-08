import type { ByteSource } from "./io.js";
import type { InvocationCleanup } from "./command.js";

export type HttpHeaders = readonly (readonly [string, string])[];

export interface HttpRequest {
  /** Explicit VFS PEM trust for this request; replaces transport-default CAs. */
  readonly ca?: Uint8Array;
  /** Explicitly disable certificate verification, only on capable host transports. */
  readonly insecure?: true;
  readonly httpVersion?: "1.0" | "1.1";
  /** Read until EOF rather than using Content-Length; host transport must opt in. */
  readonly ignoreContentLength?: true;
  /** Validated HTTP(S) origin with curl request-target spelling; transports must preserve it. */
  readonly url: string;
  readonly method: string;
  readonly headers: HttpHeaders;
  readonly body?: ByteSource;
  /** Consumer body intent, independent of method. Omitted means "read".
   * "omit" permits an empty body; "omit-on-http-error" permits it only for
   * status >= 400. Neither changes the HTTP request or response status/headers. */
  readonly responseBodyMode?: "omit" | "omit-on-http-error" | "read";
  readonly signal: AbortSignal;
  /** Deadline for DNS, TCP and TLS setup only; absent means no separate connection deadline. */
  readonly connectTimeoutMs?: number;
  /** Deadline until response headers arrive, including connection setup and server delay.
   * Separate from connectTimeoutMs because Fetch cannot observe connection completion. */
  readonly responseHeaderTimeoutMs?: number;
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
  readonly denyPrivateNetworks?: true;
}

export interface HttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: HttpHeaders;
  readonly httpVersion?: string;
  readonly body: ByteSource;
  /** True when the host already decoded Content-Encoding; encoded length is then unavailable. */
  readonly contentDecoded?: boolean;
  dispose(): Promise<void>;
}

export type HttpTransport = ((request: HttpRequest) => Promise<HttpResponse>) & {
  readonly supportsRequestCa?: true;
  readonly supportsInsecureTls?: true;
  readonly supportedHttpVersions?: readonly ("1.0" | "1.1")[];
  readonly supportsIgnoreContentLength?: true;
  readonly supportsPrivateNetworkDeny?: true;
  readonly supportsConnectTimeout?: true;
  readonly supportsResponseHeaderTimeout?: true;
};

