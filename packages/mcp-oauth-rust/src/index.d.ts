import type { CreateSecretStoreInput } from "./auth-store-types.js";
export type OAuthTokenEndpointAuthMethod = "none" | "client_secret_post" | "client_secret_basic";
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
  discovery: {
    resourceMetadataUrl: string;
    resourceMetadata: Record<string, unknown>;
    authorizationServerMetadata: Record<string, unknown>;
  };
}
export interface OAuthSessionStore {
  load(resource: string): Promise<StoredOAuthSession | null>;
  save(resource: string, session: StoredOAuthSession): Promise<void>;
  clear(resource: string): Promise<void>;
  withLock?<T>(
    resource: string,
    operation: () => Promise<T>,
    options: { signal?: AbortSignal; timeoutMs: number }
  ): Promise<T>;
}
export type OAuthMetadataFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export interface OAuthProtectedResourceMetadata extends Record<string, unknown> {
  resource: string;
  authorization_servers: string[];
}
export interface OAuthAuthorizationServerMetadata extends Record<string, unknown> {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  response_types_supported: string[];
  code_challenge_methods_supported: string[];
  authorization_response_iss_parameter_supported?: boolean;
}
export interface OAuthDiscoveryResult {
  resource: string;
  resourceMetadataUrl: string;
  resourceMetadata: OAuthProtectedResourceMetadata;
  authorizationServer: string;
  authorizationServerMetadataUrl: string;
  authorizationServerMetadata: OAuthAuthorizationServerMetadata;
}
export interface OAuthUnauthorizedChallenge {
  scheme: "Bearer";
  params: Record<string, string>;
  raw: string;
}
export interface OAuthClientMetadata {
  clientName?: string;
  scope?: string;
  softwareId?: string;
  softwareVersion?: string;
}
export interface OAuthClientProvider {
  authorizeRequest?(input: {
    requestUrl: URL;
    headers: Headers;
    fetch: OAuthMetadataFetch;
    signal?: AbortSignal;
  }): Promise<StoredOAuthTokens | void> | StoredOAuthTokens | void;
  handleUnauthorized(input: {
    requestUrl: URL;
    response: Response;
    challenge: OAuthUnauthorizedChallenge | null;
    discovery: OAuthDiscoveryResult;
    requestHeaders?: Headers;
    presentedTokens?: StoredOAuthTokens | null;
    fetch: OAuthMetadataFetch;
    signal?: AbortSignal;
  }):
    | Promise<{ action: "retry" } | { action: "fail"; error?: Error }>
    | { action: "retry" }
    | { action: "fail"; error?: Error };
}
export interface DefaultOAuthClientProviderOptions {
  client:
    | { mode: "dynamic"; clientId?: string; clientSecret?: string; metadata?: OAuthClientMetadata }
    | { mode: "static"; clientId: string; clientSecret?: string; metadata?: OAuthClientMetadata };
  allowInteractive?: boolean;
  sessionLockTimeoutMs?: number;
  browser: LoopbackAuthorizationOptions;
  sessionStore?: OAuthSessionStore;
  authStore?: CreateSecretStoreInput;
  now?: () => number;
}
export type OAuthClientProviderOptions =
  { provider: OAuthClientProvider } | DefaultOAuthClientProviderOptions;
export declare function createOAuthClientProvider(
  options: OAuthClientProviderOptions
): OAuthClientProvider;
export declare function createDefaultOAuthClientProvider(
  options: DefaultOAuthClientProviderOptions
): OAuthClientProvider;
export interface JwksTokenVerifierOptions {
  jwksUrl: string | URL;
  clockSkewSeconds?: number;
  allowedAlgorithms?: readonly string[];
  jwksCacheTtlMs?: number;
  jwksFetchTimeoutMs?: number;
  jwksRefreshCooldownMs?: number;
  allowInsecureJwks?: boolean;
  requireAccessTokenType?: boolean;
  fetch?: typeof fetch;
}
export interface JwksVerifiedAccessToken {
  token: string;
  issuer: string;
  audience: string[];
  scopes: string[];
  expiresAt: number;
  claims: Record<string, unknown>;
  subject?: string;
  clientId?: string;
}
export interface JwksTokenVerifier {
  verify(input: {
    token: string;
    resource: string;
    authorizationServers: readonly string[];
    requiredScopes: readonly string[];
  }): Promise<JwksVerifiedAccessToken>;
}
export declare function createJwksTokenVerifier(
  options: JwksTokenVerifierOptions
): JwksTokenVerifier;
export declare function createAuthStoreSessionStore(
  options?: CreateSecretStoreInput
): OAuthSessionStore;
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
  readonly outcomeKnown: boolean;
  constructor(
    shape: { error: string; error_description?: string; error_uri?: string },
    status: number,
    outcomeKnown?: boolean
  );
}
export declare function isRetryableOAuthError(error: unknown): error is OAuthError;
export interface OAuthLandingPage {
  title: string;
  body: string;
}
export interface LoopbackAuthorizationOptions {
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
  createServer?: () => import("node:http").Server;
  landingPage?: OAuthLandingPage;
  callbackPath?: string;
  redirectUri?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface LoopbackAuthorizationSession {
  redirectUri: string;
  waitForCode(authorizationUrl: string): Promise<string>;
  close(): void;
}
export declare function buildSuccessPage(landingPage?: OAuthLandingPage): string;
export declare function extractCodeFromInput(input: string): string | null;
export declare function createLoopbackAuthorizationSession(
  options?: LoopbackAuthorizationOptions
): Promise<LoopbackAuthorizationSession>;
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

export interface OAuthClientRegistration extends Record<string, unknown> {
  client_id: string;
  client_secret?: string | null;
  redirect_uris?: string[] | null;
  grant_types?: string[] | null;
  response_types?: string[] | null;
  contacts?: string[] | null;
  client_id_issued_at?: number | null;
  client_secret_expires_at?: number | null;
  token_endpoint_auth_method?: string | null;
}
export declare function parseOAuthClientRegistration(value: unknown): OAuthClientRegistration;

export interface StoredOAuthClient {
  clientId: string;
  clientSecret?: string;
  registration?: OAuthClientRegistration;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
}
export declare function normalizeStoredOAuthClient(value: unknown): StoredOAuthClient | null;

export declare function withOAuthSessionTransaction<T>(
  store: OAuthSessionStore,
  resource: string,
  operation: () => Promise<T>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<T>;
