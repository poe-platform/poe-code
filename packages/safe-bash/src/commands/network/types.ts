import type { ByteSource, InvocationCleanup } from "../../contracts/index.js";

export type HttpHeaders = readonly (readonly [string, string])[];

export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: HttpHeaders;
  readonly body?: ByteSource;
  readonly signal: AbortSignal;
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
}

export interface HttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: HttpHeaders;
  readonly httpVersion?: string;
  readonly body: ByteSource;
  dispose(): Promise<void>;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export interface NetworkAuthorization {
  readonly url: string;
  readonly method: string;
  readonly redirectFrom?: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
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
  readonly limits?: Partial<NetworkLimits>;
  readonly replace?: boolean;
}

export const defaultNetworkLimits: Readonly<NetworkLimits> = Object.freeze({
  maxUploadBytes: 64 * 1024 * 1024,
  maxDownloadBytes: 64 * 1024 * 1024,
  maxBufferBytes: 8 * 1024 * 1024,
  maxHeaderBytes: 64 * 1024,
  maxRedirects: 10,
  maxRetries: 5,
  maxUrls: 32,
  maxTimeMs: 120_000,
  maxTotalTimeMs: 120_000,
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
