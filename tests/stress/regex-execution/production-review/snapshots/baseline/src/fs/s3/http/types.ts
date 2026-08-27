import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

export interface S3HttpCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export type S3HttpCredentialProvider = (options: { readonly signal: AbortSignal }) => Promise<S3HttpCredentials>;

export type S3HttpRequestFactory = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

export interface S3HttpTransportOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly credentials: S3HttpCredentials | S3HttpCredentialProvider;
  readonly addressingStyle?: "path" | "virtual-hosted";
  readonly listUrlEncoding?: "percent" | "form";
  readonly clock?: () => Date;
  readonly request?: S3HttpRequestFactory;
  readonly allowInsecureHttp?: boolean;
  readonly maxPutBytes?: number;
  readonly maxGetBytes?: number;
  readonly maxXmlBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly enableCopy?: boolean;
  readonly verifiedConditionalOperations?: {
    readonly put?: boolean;
    readonly copy?: boolean;
    readonly delete?: boolean;
  };
}
