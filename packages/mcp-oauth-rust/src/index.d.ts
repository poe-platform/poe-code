export declare function generateCodeVerifier(): string;
export declare function generateCodeChallenge(verifier: string): string;
export declare class OAuthError extends Error {
  readonly error: string;
  readonly errorDescription: string | undefined;
  readonly errorUri: string | undefined;
  readonly error_description: string | undefined;
  readonly error_uri: string | undefined;
  readonly status: number;
  readonly retryable: boolean;
  readonly terminal: boolean;
  constructor(shape: { error: string; error_description?: string; error_uri?: string }, status: number);
}
export declare function isRetryableOAuthError(error: unknown): error is OAuthError;
export declare function fetchMcpResponse(
  fetchImplementation: (input: string | URL, init?: RequestInit) => Promise<Response>,
  input: string | URL,
  init?: RequestInit
): Promise<Response>;
export declare function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  readers?: Set<ReadableStreamDefaultReader<Uint8Array>>,
  signal?: AbortSignal
): Promise<string>;
