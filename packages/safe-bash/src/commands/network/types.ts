import type { ByteSource, InvocationCleanup } from "../../contracts/index.js";

export type HttpHeaders = readonly (readonly [string, string])[];

export interface HttpRequest {
  /** Explicit VFS PEM trust for this request; replaces transport-default CAs. */
  readonly ca?: Uint8Array;
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
  readonly supportedHttpVersions?: readonly ("1.0" | "1.1")[];
  readonly supportsIgnoreContentLength?: true;
  readonly supportsPrivateNetworkDeny?: true;
  readonly supportsConnectTimeout?: true;
};

export interface NetworkAuthorization {
  /** Validated HTTP(S) origin with curl request-target spelling; transports must preserve it. */
  readonly url: string;
  readonly method: string;
  readonly redirectFrom?: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly requirePrivateNetworkDeny?: () => void;
}

export type NetworkAuthorizer = (request: NetworkAuthorization) => boolean | Promise<boolean>;

export interface NetworkLimits {
  readonly maxUploadBytes: number;
  readonly maxDownloadBytes: number;
  readonly maxBufferBytes: number;
  readonly maxHeaderBytes: number;
  readonly maxRedirects: number;
  readonly maxRetries: number;
  readonly maxUrls: number;
  readonly maxTimeMs: number;
  readonly maxTotalTimeMs: number;
}

export interface NetworkCommandsOptions {
  readonly authorize: NetworkAuthorizer;
  readonly transport?: HttpTransport;
  /** Portable browser/Worker commands require finite maxUrls and maxBufferBytes. */
  readonly limits?: Partial<NetworkLimits>;
  readonly replace?: boolean;
}

/** Infinity denotes an omitted quota internally; callers configure finite limits explicitly. */
export const defaultNetworkLimits: Readonly<NetworkLimits> = Object.freeze({
  maxUploadBytes: Infinity,
  maxDownloadBytes: Infinity,
  maxBufferBytes: Infinity,
  maxHeaderBytes: Infinity,
  maxRedirects: Infinity,
  maxRetries: Infinity,
  maxUrls: Infinity,
  maxTimeMs: Infinity,
  maxTotalTimeMs: Infinity,
});

export const cloudflareWorkerNetworkLimits: Readonly<NetworkLimits> = Object.freeze({
  maxUploadBytes: 4 * 1024 * 1024,
  maxDownloadBytes: 4 * 1024 * 1024,
  maxBufferBytes: 1024 * 1024,
  maxHeaderBytes: 32 * 1024,
  maxRedirects: 2,
  maxRetries: 1,
  maxUrls: 8,
  maxTimeMs: 10_000,
  maxTotalTimeMs: 10_000,
});

export class CurlError extends Error {
  constructor(readonly exitCode: number, message: string) {
    super(message);
    this.name = "CurlError";
  }
}
