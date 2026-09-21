import type http from "node:http";
import type { CreateSecretStoreInput } from "auth-store";

export type OAuthMetadataFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

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
    fetch: OAuthMetadataFetch;
    signal?: AbortSignal;
    /** Headers actually attached to this rejected request. */
    requestHeaders?: Headers;
    /** Owned snapshot returned when this request was authorized, or null if absent. */
    presentedTokens?: StoredOAuthTokens | null;
  }): Promise<{ action: "retry" } | { action: "fail"; error?: Error }> | { action: "retry" } | { action: "fail"; error?: Error };
}

export interface OAuthClientMetadata {
  clientName?: string;
  scope?: string;
  softwareId?: string;
  softwareVersion?: string;
}

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: "Bearer";
  expiresAt: number | null;
  scope?: string;
}

/** Full RFC 7591 response, including JSON provider extensions. */
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

export interface StoredOAuthClient {
  clientId: string;
  clientSecret?: string;
  registration?: OAuthClientRegistration;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
}

export type OAuthTokenEndpointAuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface StoredOAuthSession {
  resource: string;
  authorizationServer: string;
  client: StoredOAuthClient;
  tokens?: StoredOAuthTokens;
  /** A refresh was begun; its winning response may not have been persisted. */
  refreshState?: "pending";
  /** Canonical explicitly requested scope set when the server omits token scope. */
  requestedScope?: string;
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
  /** Backend-wide lock covering a complete read/redeem/write transaction. */
  withLock?<T>(resource: string, operation: () => Promise<T>, options: { signal?: AbortSignal; timeoutMs: number }): Promise<T>;
}

export interface DefaultOAuthClientProviderOptions {
  client:
    | {
        mode: "dynamic";
        clientId?: string;
        clientSecret?: string;
        metadata?: OAuthClientMetadata;
        /** Import a complete registration owned by the caller. */
        registration?: OAuthClientRegistration;
        tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
      }
    | {
        mode: "static";
        clientId: string;
        clientSecret?: string;
        metadata?: OAuthClientMetadata;
        registration?: OAuthClientRegistration;
        tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
      };
  /** Disable interactive authorization while allowing cached tokens and silent refresh. */
  allowInteractive?: boolean;
  /** Maximum wait to acquire a session transaction lock (default 30,000 ms). */
  sessionLockTimeoutMs?: number;
  /** Isolate native persisted sessions and registrations for a named profile. */
  persistenceNamespace?: string;
  /** Import an existing grant for one resource. Persisted sessions take precedence. */
  initialGrant?: {
    resource: string;
    tokens: StoredOAuthTokens;
  };
  browser: {
    openBrowser?(url: string): Promise<void>;
    /** Exact registered HTTP loopback redirect URI. */
    redirectUri?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    readLine?: () => Promise<string>;
    createServer?: () => http.Server;
    landingPage?: {
      title: string;
      body: string;
    };
  };
  sessionStore?: OAuthSessionStore;
  authStore?: CreateSecretStoreInput;
  now?: () => number;
}

export type OAuthClientProviderOptions =
  | {
      provider: OAuthClientProvider;
    }
  | DefaultOAuthClientProviderOptions;
