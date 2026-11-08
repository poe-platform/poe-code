import { fetchMcpResponse } from "../http-fetch.js";
import { parseOAuthClientRegistration } from "./client-registration.js";
import { loopbackTarget, validateHostedOAuthRedirect } from "./redirect-target.js";
import { readOAuthJsonObjectResponse } from "./token-endpoint.js";
import { normalizeOAuthTokenEndpointAuthMethod } from "./token-auth-method.js";
import type { OAuthClientMetadata, OAuthClientRegistration, OAuthMetadataFetch, OAuthTokenEndpointAuthMethod } from "./types.js";

export type RegisterOAuthClientOptions = {
  /** Discovered endpoint approved by the host's network and issuer policy. */
  registrationEndpoint: string;
  metadata?: OAuthClientMetadata;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  fetch: OAuthMetadataFetch;
  signal?: AbortSignal;
} & (
  | { redirectUri: string; redirectUris?: never }
  | {
      redirectUri?: never;
      /** One to 32 distinct redirects, transmitted exactly as supplied. */
      redirectUris: readonly string[];
    }
);

/** RFC 7591 registration only: no consent, persistence, or automatic retries.
 * The host owns issuer/redirect binding and private persistence of the returned registration.
 */
export async function registerOAuthClient(input: RegisterOAuthClientOptions): Promise<OAuthClientRegistration> {
  if (input.redirectUri !== undefined && input.redirectUris !== undefined)
    throw new Error("Specify either redirectUri or redirectUris, not both");
  const redirects = input.redirectUris === undefined ? [input.redirectUri] : input.redirectUris;
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 32)
    throw new Error("OAuth registration requires one to 32 redirect URIs");
  const redirectUris: string[] = [];
  const seen = new Set<string>();
  for (const redirectUri of redirects) {
    if (typeof redirectUri !== "string" || redirectUri.length === 0)
      throw new Error("Invalid OAuth registration redirect URI");
    if (seen.has(redirectUri)) throw new Error("Duplicate OAuth registration redirect URI");
    if (new URL(redirectUri).protocol === "https:") validateHostedOAuthRedirect(redirectUri);
    else loopbackTarget({ redirectUri });
    seen.add(redirectUri);
    redirectUris.push(redirectUri);
  }
  const body = JSON.stringify(buildClientRegistrationBody(input.metadata, redirectUris,
    normalizeOAuthTokenEndpointAuthMethod(input.tokenEndpointAuthMethod) ?? "none"));
  if (new TextEncoder().encode(body).byteLength > 65_536) throw new Error("OAuth registration request is too large");
  input.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(30_000);
  const signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);
  const response = await fetchMcpResponse(input.fetch, input.registrationEndpoint, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body, signal
  });
  return parseOAuthClientRegistration(await readOAuthJsonObjectResponse(response, signal));
}

function getOwnString(input: OAuthClientMetadata, key: keyof OAuthClientMetadata): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function buildClientRegistrationBody(
  metadata: OAuthClientMetadata | undefined,
  redirectUris: readonly string[],
  tokenEndpointAuthMethod: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: tokenEndpointAuthMethod
  };
  const clientName = metadata === undefined ? undefined : getOwnString(metadata, "clientName");
  const scope = metadata === undefined ? undefined : getOwnString(metadata, "scope");
  const softwareId = metadata === undefined ? undefined : getOwnString(metadata, "softwareId");
  const softwareVersion =
    metadata === undefined ? undefined : getOwnString(metadata, "softwareVersion");

  if (clientName !== undefined && clientName.length > 0) {
    body.client_name = clientName;
  }

  if (scope !== undefined && scope.length > 0) {
    body.scope = scope;
  }

  if (softwareId !== undefined && softwareId.length > 0) {
    body.software_id = softwareId;
  }

  if (softwareVersion !== undefined && softwareVersion.length > 0) {
    body.software_version = softwareVersion;
  }

  return body;
}

