import type {
  OAuthMetadataFetch,
  StoredOAuthTokens,
} from "./types.js";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";

interface OAuthErrorShape {
  error: string;
  error_description?: string;
  error_uri?: string;
}

export class OAuthError extends Error {
  readonly error: string;
  readonly errorDescription: string | undefined;
  readonly errorUri: string | undefined;
  readonly status: number;

  constructor(shape: OAuthErrorShape, status: number) {
    super(shape.error_description ?? shape.error);
    this.name = "OAuthError";
    this.error = shape.error;
    this.errorDescription = shape.error_description;
    this.errorUri = shape.error_uri;
    this.status = status;
  }
}

export async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
  fetch: OAuthMetadataFetch;
  now: () => number;
}): Promise<StoredOAuthTokens> {
  const resource = canonicalizeResourceIndicator(input.resource);

  return requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    params: {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      resource,
    },
    fetch: input.fetch,
    now: input.now,
  });
}

export async function refreshAccessToken(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  resource: string;
  fetch: OAuthMetadataFetch;
  now: () => number;
}): Promise<StoredOAuthTokens> {
  const resource = canonicalizeResourceIndicator(input.resource);

  return requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    params: {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      resource,
    },
    fetch: input.fetch,
    now: input.now,
  });
}

async function requestTokens(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  params: Record<string, string>;
  fetch: OAuthMetadataFetch;
  now: () => number;
}): Promise<StoredOAuthTokens> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    ...input.params,
  });

  if (input.clientSecret !== undefined) {
    body.set("client_secret", input.clientSecret);
  }

  const response = await input.fetch(input.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new OAuthError(readOAuthError(payload), response.status);
  }

  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("OAuth token response missing access_token");
  }

  const tokenType = normalizeBearerTokenType(payload.token_type);
  if (tokenType === null) {
    throw new Error("OAuth token response missing token_type=Bearer");
  }

  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token.length > 0
        ? payload.refresh_token
        : undefined,
    tokenType,
    expiresAt:
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? input.now() + (payload.expires_in * 1000)
        : null,
    scope:
      typeof payload.scope === "string" && payload.scope.length > 0
        ? payload.scope
        : undefined,
  };
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    if (!response.ok) {
      throw new Error(`OAuth request failed (${response.status})`);
    }
  }

  if (!response.ok) {
    throw new Error(`OAuth request failed (${response.status})`);
  }

  throw new Error("OAuth response must be a JSON object");
}

function readOAuthError(payload: Record<string, unknown>): OAuthErrorShape {
  return {
    error: typeof payload.error === "string" ? payload.error : "server_error",
    error_description:
      typeof payload.error_description === "string"
        ? payload.error_description
        : undefined,
    error_uri:
      typeof payload.error_uri === "string"
        ? payload.error_uri
        : undefined,
  };
}

function normalizeBearerTokenType(value: unknown): "Bearer" | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.toLowerCase() === "bearer" ? "Bearer" : null;
}
