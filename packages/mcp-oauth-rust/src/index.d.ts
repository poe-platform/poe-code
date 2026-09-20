import type { CreateSecretStoreInput } from "./auth-store-types.js";
export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: "Bearer";
  expiresAt: number | null;
  scope?: string;
}
export interface StoredOAuthSession {
  resource: string;
  authorizationServer: string;
  client: { clientId: string; clientSecret?: string };
  tokens?: StoredOAuthTokens;
  discovery: { resourceMetadataUrl: string; resourceMetadata: Record<string,unknown>; authorizationServerMetadata: Record<string,unknown> };
}
export interface OAuthSessionStore {
  load(resource: string): Promise<StoredOAuthSession | null>;
  save(resource: string, session: StoredOAuthSession): Promise<void>;
  clear(resource: string): Promise<void>;
}
export declare function createAuthStoreSessionStore(options?: CreateSecretStoreInput): OAuthSessionStore;
export declare function canonicalizeResourceIndicator(value: string | URL): string;
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
export interface OAuthLandingPage { title: string; body: string; }
export interface LoopbackAuthorizationOptions {
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
  createServer?: () => import("node:http").Server;
  landingPage?: OAuthLandingPage;
  callbackPath?: string;
}
export interface LoopbackAuthorizationSession {
  redirectUri: string;
  waitForCode(authorizationUrl: string): Promise<string>;
  close(): void;
}
export declare function buildSuccessPage(landingPage?: OAuthLandingPage): string;
export declare function extractCodeFromInput(input: string): string | null;
export declare function createLoopbackAuthorizationSession(options?: LoopbackAuthorizationOptions): Promise<LoopbackAuthorizationSession>;
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
