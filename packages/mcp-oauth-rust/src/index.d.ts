export declare function generateCodeVerifier(): string;
export declare function generateCodeChallenge(verifier: string): string;
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
