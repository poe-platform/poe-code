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
  }): Promise<void> | void;

  handleUnauthorized(input: {
    requestUrl: URL;
    response: Response;
    challenge: OAuthUnauthorizedChallenge | null;
    discovery: OAuthDiscoveryResult;
    fetch: OAuthMetadataFetch;
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

export interface StoredOAuthSession {
  resource: string;
  authorizationServer: string;
  client: {
    clientId: string;
    clientSecret?: string;
  };
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
}

export interface DefaultOAuthClientProviderOptions {
  client:
    | {
        mode: "dynamic";
        clientId?: string;
        clientSecret?: string;
        metadata?: OAuthClientMetadata;
      }
    | {
        mode: "static";
        clientId: string;
        clientSecret?: string;
        metadata?: OAuthClientMetadata;
      };
  browser: {
    openBrowser(url: string): Promise<void>;
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
