export { normalizeOAuthScope } from "./client/scope.js";
export { parseOAuthTokenGrant } from "./client/token-grant.js";
export type { OAuthTokenGrantImportOptions } from "./client/token-grant.js";
export {
  createAuthStoreSessionStore,
} from "./client/auth-store-session-store.js";
export { createResourceBoundOAuthStores } from "./client/resource-bound-store.js";
export type { ResourceBoundOAuthStores } from "./client/resource-bound-store.js";
export { parseOAuthClientRegistration, normalizeStoredOAuthClient } from "./client/client-registration.js";
export {
  createDefaultOAuthClientProvider,
  createOAuthClientProvider,
} from "./client/default-oauth-client-provider.js";
export {
  buildSuccessPage,
  createLoopbackAuthorizationSession,
  extractCodeFromInput,
} from "./client/loopback-authorization.js";
export {
  generateCodeChallenge,
  generateCodeVerifier,
} from "./client/pkce.js";
export {
  OAuthError,
} from "./client/token-endpoint.js";
export {
  canonicalizeResourceIndicator,
} from "./resource-indicator.js";
export {
  createJwksTokenVerifier,
} from "./server/jwks-token-verifier.js";
export type {
  DefaultOAuthClientProviderOptions,
  OAuthAuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthClientRegistration,
  OAuthClientProvider,
  OAuthClientProviderOptions,
  OAuthDiscoveryResult,
  OAuthMetadataFetch,
  OAuthProtectedResourceMetadata,
  OAuthSessionStore,
  OAuthUnauthorizedChallenge,
  OAuthTokenEndpointAuthMethod,
  StoredOAuthSession,
  StoredOAuthClient,
  StoredOAuthTokens,
  ImportedOAuthTokens,
} from "./client/types.js";
export type {
  JwksTokenVerifier,
  JwksTokenVerifierOptions,
  JwksVerifiedAccessToken,
} from "./server/jwks-token-verifier.js";
export type {
  LoopbackAuthorizationOptions,
  LoopbackAuthorizationSession,
  OAuthLandingPage,
} from "./client/loopback-authorization.js";

export { readBoundedResponseText } from "./http-response.js";
export { fetchMcpResponse } from "./http-fetch.js";
