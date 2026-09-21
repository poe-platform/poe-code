import { normalizeOAuthTokenEndpointAuthMethod } from "./token-auth-method.js";
import type { OAuthMetadataFetch, StoredOAuthTokens, OAuthTokenEndpointAuthMethod } from "./types.js";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";
import { readBoundedResponseText } from "../http-response.js";
import { fetchMcpResponse } from "../http-fetch.js";
import { normalizeOAuthScope } from "./scope.js";

const MAX_JS_DATE_MS = 8_640_000_000_000_000;

interface OAuthErrorShape {
  error: string;
  error_description?: string;
  error_uri?: string;
}

export class OAuthError extends Error {
  readonly error: string;
  readonly errorDescription: string | undefined;
  readonly errorUri: string | undefined;
  readonly error_description: string | undefined;
  readonly error_uri: string | undefined;
  readonly status: number;
  readonly retryable: boolean;
  readonly terminal: boolean;
  /** True only when a complete OAuth error response establishes rejection. */
  readonly outcomeKnown: boolean;

  constructor(shape: OAuthErrorShape, status: number, outcomeKnown = true) {
    const description = Object.hasOwn(shape, "error_description") ? shape.error_description : undefined;
    const uri = Object.hasOwn(shape, "error_uri") ? shape.error_uri : undefined;
    super(description ?? (outcomeKnown ? shape.error : `OAuth HTTP response did not contain a valid error (HTTP ${status})`));
    this.name = "OAuthError";
    this.error = shape.error;
    this.errorDescription = description;
    this.errorUri = uri;
    this.error_description = description;
    this.error_uri = uri;
    this.status = status;
    this.retryable = isRetryableOAuthError(this);
    this.terminal = !this.retryable;
    this.outcomeKnown = outcomeKnown;
  }
}

export function isRetryableOAuthError(error: unknown): error is OAuthError {
  return (
    error instanceof OAuthError &&
    (error.status >= 500 ||
      error.error === "server_error" ||
      error.error === "temporarily_unavailable")
  );
}

export async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
  fetch: OAuthMetadataFetch;
  signal?: AbortSignal;
  now: () => number;
}): Promise<StoredOAuthTokens> {
  const resource = canonicalizeResourceIndicator(input.resource);

  return requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    params: {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      resource
    },
    fetch: input.fetch,
    signal: input.signal,
    now: input.now
  });
}

export async function refreshAccessToken(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  refreshToken: string;
  resource: string;
  fetch: OAuthMetadataFetch;
  signal?: AbortSignal;
  now: () => number;
}): Promise<StoredOAuthTokens> {
  const resource = canonicalizeResourceIndicator(input.resource);

  return requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    params: {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      resource
    },
    fetch: input.fetch,
    signal: input.signal,
    now: input.now
  });
}

async function requestTokens(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  params: Record<string, string>;
  fetch: OAuthMetadataFetch;
  signal?: AbortSignal;
  now: () => number;
}): Promise<StoredOAuthTokens> {
  const method = normalizeOAuthTokenEndpointAuthMethod(input.tokenEndpointAuthMethod) ??
    (input.clientSecret === undefined ? "none" : "client_secret_post");
  if (method !== "none" && (input.clientSecret === undefined || input.clientSecret.trim() === ""))
    throw new Error("OAuth token endpoint authentication requires a client secret");
  const body = new URLSearchParams(input.params);
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" });
  if (method === "client_secret_basic") {
    const encoded = new URLSearchParams({ credential: input.clientId }).toString().slice("credential=".length);
    const encodedSecret = new URLSearchParams({ credential: input.clientSecret! }).toString().slice("credential=".length);
    headers.set("Authorization", `Basic ${Buffer.from(`${encoded}:${encodedSecret}`).toString("base64")}`);
  } else {
    body.set("client_id", input.clientId);
    if (method === "client_secret_post") body.set("client_secret", input.clientSecret!);
  }

  input.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(30_000);
  const signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);
  const response = await fetchMcpResponse(input.fetch, input.tokenEndpoint, {
    method: "POST",
    headers,
    body: body.toString(),
    signal
  });
  const payload = await readOAuthJsonObjectResponse(response, signal);
  const accessToken = getOwnEntry(payload, "access_token");

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new Error("OAuth token response missing access_token");
  }
  const normalizedAccessToken = accessToken.trim();

  const tokenType = normalizeBearerTokenType(getOwnEntry(payload, "token_type"));
  if (tokenType === null) {
    throw new Error("OAuth token response missing token_type=Bearer");
  }

  const expiresIn = getOwnEntry(payload, "expires_in");
  let expiresAt: number | null = null;
  if (expiresIn !== undefined) {
    if (
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      !Number.isInteger(expiresIn) ||
      expiresIn < 0
    ) {
      throw new Error("OAuth token response has invalid expires_in");
    }

    expiresAt = input.now() + expiresIn * 1000;
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt > MAX_JS_DATE_MS ||
      !Number.isFinite(new Date(expiresAt).getTime())
    ) {
      throw new Error("OAuth token response has invalid expires_in");
    }
  }

  const refreshToken = getOwnEntry(payload, "refresh_token");
  const scope = getOwnEntry(payload, "scope");
  const normalizedRefreshToken =
    typeof refreshToken === "string" && refreshToken.trim().length > 0
      ? refreshToken.trim()
      : undefined;
  const normalizedScope = normalizeOAuthScope(scope);
  if (scope !== undefined && normalizedScope === undefined)
    throw new Error("Invalid OAuth scope syntax in token response");
  return {
    accessToken: normalizedAccessToken,
    refreshToken: normalizedRefreshToken === undefined ? undefined : normalizedRefreshToken,
    tokenType,
    expiresAt,
    scope: normalizedScope === undefined ? undefined : normalizedScope
  };
}

export async function readOAuthJsonObjectResponse(
  response: Response,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const fallbackError = createFallbackOAuthError(response.status);
  let payload: unknown;

  try {
    payload = JSON.parse(await readBoundedResponseText(response, 1024 * 1024, undefined, signal));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof Error && error.message.startsWith("HTTP response exceeds ")) throw error;
    if (!response.ok) {
      throw fallbackError;
    }
    throw new Error("OAuth response must be a JSON object");
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    if (!response.ok) {
      throw fallbackError;
    }
    throw new Error("OAuth response must be a JSON object");
  }

  const record = payload as Record<string, unknown>;
  if (!response.ok) {
    const error = getOwnEntry(record, "error");
    if (typeof error !== "string" || error.trim() === "") throw fallbackError;
    throw new OAuthError(readOAuthError(record), response.status);
  }

  return record;
}

function readOAuthError(
  payload: Record<string, unknown>,
  fallbackError = "server_error"
): OAuthErrorShape {
  const error = getOwnEntry(payload, "error");
  const errorDescription = getOwnEntry(payload, "error_description");
  const errorUri = getOwnEntry(payload, "error_uri");
  return {
    error: typeof error === "string" ? error : fallbackError,
    error_description: typeof errorDescription === "string" ? errorDescription : undefined,
    error_uri: typeof errorUri === "string" ? errorUri : undefined
  };
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function createFallbackOAuthError(status: number): OAuthError {
  const error = status === 503 ? "temporarily_unavailable" : status >= 500 ? "server_error" : "invalid_response";
  return new OAuthError({ error }, status, false);
}

function normalizeBearerTokenType(value: unknown): "Bearer" | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.toLowerCase() === "bearer" ? "Bearer" : null;
}
