export { snapshotOAuthPersistenceOptions } from "./client/persistence-options.js";
export { OAuthAuthorizationError } from "./client/authorization-error.js";
export { OAuthError } from "./client/token-endpoint.js";
export { canonicalizeResourceIndicator } from "./resource-indicator.js";
export { readBoundedResponseText } from "./http-response.js";
export { fetchMcpResponse } from "./http-fetch.js";
export type * from "./client/types.js";
import type { OAuthClientProvider, OAuthClientProviderOptions } from "./client/types.js";

/** Remote hosts own credentials and authorization; desktop defaults are unavailable. */
export function createOAuthClientProvider(options: OAuthClientProviderOptions): OAuthClientProvider {
  if ("provider" in options && options.provider !== undefined) return options.provider;
  throw new Error("Worker MCP requires a host-owned OAuth provider or authenticated fetch; desktop OAuth is unavailable");
}
export function createDefaultOAuthClientProvider(): never {
  throw new Error("Desktop OAuth is unavailable in Worker MCP");
}
export function createAuthStoreSessionStore(): never {
  throw new Error("Desktop OAuth persistence is unavailable in Worker MCP");
}

export { beginRemoteMcpAuthorization, completeRemoteMcpAuthorization } from "./client/resumable.js";
export type { RemoteMcpAuthorizationTransaction, RemoteMcpAuthorizationStore, BeginRemoteMcpAuthorizationOptions, CompleteRemoteMcpAuthorizationOptions } from "./client/resumable.js";
