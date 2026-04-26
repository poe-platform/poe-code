import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

const DEFAULT_ALLOWED_ALGORITHMS = [
  "ES256",
  "ES384",
  "ES512",
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "EdDSA",
] as const;

type FetchLike = typeof fetch;
type BearerChallengeErrorCode = "invalid_token" | "insufficient_scope";

export interface JwksTokenVerifierOptions {
  jwksUrl: string | URL;
  clockSkewSeconds?: number;
  allowedAlgorithms?: readonly string[];
  fetch?: FetchLike;
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

type TokenVerificationErrorShape = Error & {
  error: BearerChallengeErrorCode;
  errorDescription?: string;
  scope?: readonly string[];
};

function isTokenVerificationErrorShape(
  error: unknown
): error is TokenVerificationErrorShape {
  if (!(error instanceof Error)) {
    return false;
  }

  const challengeError = error as { error?: unknown };
  return challengeError.error === "invalid_token"
    || challengeError.error === "insufficient_scope";
}

function isObjectRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function toUrl(value: string | URL, label: string): URL {
  try {
    return value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
}

function normalizeAudience(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  return isStringArray(value) ? [...value] : [];
}

function parseScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") {
    return payload.scope
      .split(" ")
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  if (typeof payload.scopes === "string") {
    return payload.scopes
      .split(" ")
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  return isStringArray(payload.scopes) ? [...payload.scopes] : [];
}

function toVerifiedAccessToken(
  token: string,
  payload: JWTPayload
): JwksVerifiedAccessToken {
  return {
    token,
    issuer: typeof payload.iss === "string" ? payload.iss : "",
    audience: normalizeAudience(payload.aud),
    scopes: parseScopes(payload),
    expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
    claims: { ...payload },
    ...(typeof payload.sub === "string"
      ? {
          subject: payload.sub,
        }
      : {}),
    ...(typeof payload.client_id === "string"
      ? {
          clientId: payload.client_id,
        }
      : {}),
  };
}

function createTokenVerificationError(input: {
  error: BearerChallengeErrorCode;
  errorDescription?: string;
  scope?: readonly string[];
}): TokenVerificationErrorShape {
  return Object.assign(new Error(input.errorDescription ?? input.error), input);
}

function createInvalidTokenError(errorDescription: string): TokenVerificationErrorShape {
  return createTokenVerificationError({
    error: "invalid_token",
    errorDescription,
  });
}

function normalizeVerificationError(error: unknown): TokenVerificationErrorShape {
  if (isTokenVerificationErrorShape(error)) {
    return error;
  }

  if (error instanceof errors.JWTExpired) {
    return createInvalidTokenError("token expired");
  }

  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "aud") {
      return createInvalidTokenError("audience mismatch");
    }

    if (error.claim === "iss") {
      return createInvalidTokenError("issuer mismatch");
    }

    if (error.claim === "nbf") {
      return createInvalidTokenError("token not active yet");
    }

    if (error.claim === "exp") {
      return createInvalidTokenError("token expired");
    }
  }

  if (
    error instanceof errors.JOSEAlgNotAllowed
    || error instanceof errors.JOSENotSupported
  ) {
    return createInvalidTokenError("unsupported token algorithm");
  }

  if (
    error instanceof errors.JWKSNoMatchingKey
    || error instanceof errors.JWKSMultipleMatchingKeys
    || error instanceof errors.JWSSignatureVerificationFailed
  ) {
    return createInvalidTokenError("token signature invalid");
  }

  if (error instanceof errors.JWKSInvalid) {
    return createInvalidTokenError("invalid JWKS document");
  }

  if (error instanceof errors.JWKSTimeout) {
    return createInvalidTokenError("timed out loading JWKS");
  }

  if (error instanceof Error) {
    return createInvalidTokenError(error.message);
  }

  return createInvalidTokenError("token verification failed");
}

async function loadJwks(
  jwksUrl: URL,
  fetchImplementation: FetchLike
): Promise<JSONWebKeySet> {
  const response = await fetchImplementation(jwksUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw createInvalidTokenError(`unable to load JWKS (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  if (!isObjectRecord(payload) || !Array.isArray(payload.keys)) {
    throw createInvalidTokenError("invalid JWKS document");
  }

  return payload as unknown as JSONWebKeySet;
}

function resolveAlgorithm(
  token: string,
  allowedAlgorithms: readonly string[]
): string {
  const alg = decodeProtectedHeader(token).alg;

  if (typeof alg !== "string" || !allowedAlgorithms.includes(alg)) {
    throw createInvalidTokenError("unsupported token algorithm");
  }

  return alg;
}

export function createJwksTokenVerifier(
  options: JwksTokenVerifierOptions
): JwksTokenVerifier {
  const jwksUrl = toUrl(options.jwksUrl, "jwksUrl");
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;
  const allowedAlgorithms = options.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGORITHMS;
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new Error("fetch is not available; pass options.fetch explicitly");
  }

  return {
    async verify(input): Promise<JwksVerifiedAccessToken> {
      resolveAlgorithm(input.token, allowedAlgorithms);

      try {
        const jwks = await loadJwks(jwksUrl, fetchImplementation);
        const verified = await jwtVerify(input.token, createLocalJWKSet(jwks), {
          audience: input.resource,
          issuer: [...input.authorizationServers],
          clockTolerance: clockSkewSeconds,
        });
        const accessToken = toVerifiedAccessToken(input.token, verified.payload);

        if (
          input.requiredScopes.length > 0
          && !accessToken.scopes.some((scope) => input.requiredScopes.includes(scope))
        ) {
          throw createTokenVerificationError({
            error: "insufficient_scope",
            errorDescription: "insufficient scope",
            scope: [...input.requiredScopes],
          });
        }

        return accessToken;
      } catch (error) {
        throw normalizeVerificationError(error);
      }
    },
  };
}
