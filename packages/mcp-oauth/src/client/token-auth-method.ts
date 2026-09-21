import type { OAuthTokenEndpointAuthMethod } from "./types.js";

export function normalizeOAuthTokenEndpointAuthMethod(value: unknown): OAuthTokenEndpointAuthMethod | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== "none" && value !== "client_secret_post" && value !== "client_secret_basic")
    throw new Error("Unsupported OAuth token endpoint authentication method");
  return value;
}
