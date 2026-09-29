import type { HttpTransport } from "safe-bash-contracts/http";
export type { HttpHeaders, HttpRequest, HttpResponse, HttpTransport } from "safe-bash-contracts/http";

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
