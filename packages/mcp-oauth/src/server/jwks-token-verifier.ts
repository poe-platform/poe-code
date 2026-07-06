import {
  decodeProtectedHeader,
  errors,
  importJWK,
  jwtVerify,
  type JSONWebKeySet,
  type JWK,
  type JWTPayload
} from "jose";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";

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
  "EdDSA"
] as const;

type FetchLike = typeof fetch;
type TokenVerificationErrorCode =
  | "invalid_token"
  | "insufficient_scope"
  | "temporarily_unavailable";

export interface JwksTokenVerifierOptions {
  jwksUrl: string | URL;
  clockSkewSeconds?: number;
  allowedAlgorithms?: readonly string[];
  jwksCacheTtlMs?: number;
  jwksFetchTimeoutMs?: number;
  jwksRefreshCooldownMs?: number;
  allowInsecureJwks?: boolean;
  requireAccessTokenType?: boolean;
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
  error: TokenVerificationErrorCode;
  errorDescription?: string;
  scope?: readonly string[];
};

function isTokenVerificationErrorShape(error: unknown): error is TokenVerificationErrorShape {
  if (!(error instanceof Error)) {
    return false;
  }

  const challengeError = error as { error?: unknown };
  return (
    challengeError.error === "invalid_token" ||
    challengeError.error === "insufficient_scope" ||
    challengeError.error === "temporarily_unavailable"
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

function getOwnString(record: object, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}

function toUrl(value: string | URL, label: string): URL {
  try {
    return new URL(String(value));
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

function normalizeVerifiedAudience(value: unknown, expectedResource: string): string[] {
  const audiences = normalizeAudience(value);
  for (const audience of audiences) {
    try {
      const normalizedAudience = canonicalizeResourceIndicator(audience);
      if (normalizedAudience === expectedResource) {
        return [normalizedAudience];
      }
    } catch {
      continue;
    }
  }

  throw createInvalidTokenError("audience mismatch");
}

function parseScopes(payload: JWTPayload): string[] {
  const scope = getOwnString(payload, "scope");
  const scopes = getOwnEntry(payload, "scopes");
  const raw = scope !== undefined ? scope : typeof scopes === "string" ? scopes : null;

  if (raw !== null) {
    return raw
      .split(" ")
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  return isStringArray(scopes) ? [...scopes] : [];
}

function toVerifiedAccessToken(
  token: string,
  payload: JWTPayload,
  audience = normalizeAudience(getOwnEntry(payload, "aud"))
): JwksVerifiedAccessToken {
  const issuer = getOwnString(payload, "iss");
  const expiresAt = getOwnEntry(payload, "exp");
  const subject = getOwnString(payload, "sub");
  const clientId = getOwnString(payload, "client_id");

  return {
    token,
    issuer: issuer ?? "",
    audience,
    scopes: parseScopes(payload),
    expiresAt: expiresAt as number,
    claims: { ...payload },
    ...(subject !== undefined
      ? {
          subject
        }
      : {}),
    ...(clientId !== undefined
      ? {
          clientId
        }
      : {})
  };
}

function createTokenVerificationError(input: {
  error: TokenVerificationErrorCode;
  errorDescription?: string;
  scope?: readonly string[];
}): TokenVerificationErrorShape {
  return Object.assign(new Error(input.errorDescription ?? input.error), input);
}

function createTemporarilyUnavailableError(): TokenVerificationErrorShape {
  return createTokenVerificationError({
    error: "temporarily_unavailable",
    errorDescription: "token verification temporarily unavailable"
  });
}

function createInvalidTokenError(errorDescription: string): TokenVerificationErrorShape {
  return createTokenVerificationError({
    error: "invalid_token",
    errorDescription
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
      if (error.reason === "missing") {
        return createInvalidTokenError("token missing expiry");
      }

      return createInvalidTokenError("token expired");
    }

    if (error.claim === "typ") {
      return createInvalidTokenError("invalid access token type");
    }
  }

  if (error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JOSENotSupported) {
    return createInvalidTokenError("unsupported token algorithm");
  }

  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof errors.JWSSignatureVerificationFailed
  ) {
    return createInvalidTokenError("token signature invalid");
  }

  if (error instanceof errors.JWKSInvalid || error instanceof errors.JWKSTimeout) {
    return createTemporarilyUnavailableError();
  }

  return createInvalidTokenError("token verification failed");
}

async function loadJwks(
  jwksUrl: URL,
  fetchImplementation: FetchLike,
  timeoutMs: number
): Promise<JSONWebKeySet> {
  try {
    const response = await fetchImplementation(jwksUrl, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      throw createTemporarilyUnavailableError();
    }

    const payload = (await response.json()) as unknown;
    const keys = isObjectRecord(payload) ? getOwnEntry(payload, "keys") : undefined;
    if (!isObjectRecord(payload) || !Array.isArray(keys) || !keys.every(isObjectRecord)) {
      throw createTemporarilyUnavailableError();
    }

    return { keys } as JSONWebKeySet;
  } catch (error) {
    if (isTokenVerificationErrorShape(error)) {
      throw error;
    }

    throw createTemporarilyUnavailableError();
  }
}

function resolveAlgorithm(token: string, allowedAlgorithms: readonly string[]): string {
  const header = decodeProtectedHeader(token);
  const alg = getOwnString(header, "alg");

  if (hasCriticalHeaderClaims(header)) {
    throw createInvalidTokenError("unsupported critical token claims");
  }

  if (
    typeof alg !== "string" ||
    alg === "none" ||
    alg.startsWith("HS") ||
    !allowedAlgorithms.includes(alg)
  ) {
    throw createInvalidTokenError("unsupported token algorithm");
  }

  return alg;
}

function hasCriticalHeaderClaims(header: ReturnType<typeof decodeProtectedHeader>): boolean {
  const criticalClaims = getOwnEntry(header, "crit");
  return Array.isArray(criticalClaims) && criticalClaims.length > 0;
}

function isVerificationCandidate(key: JWK, alg: string, kid: string | undefined): boolean {
  const keyId = getOwnString(key, "kid");
  const keyAlgorithm = getOwnString(key, "alg");
  const keyUse = getOwnString(key, "use");
  const keyOps = getOwnEntry(key, "key_ops");

  if (kid !== undefined && keyId !== kid) {
    return false;
  }

  if (keyAlgorithm !== undefined && keyAlgorithm !== alg) {
    return false;
  }

  if (keyUse !== undefined && keyUse !== "sig") {
    return false;
  }

  if (Array.isArray(keyOps) && !keyOps.includes("verify")) {
    return false;
  }

  return true;
}

function shouldContinueWithNextKey(error: unknown): boolean {
  return error instanceof errors.JWSSignatureVerificationFailed;
}

async function verifyJwtAgainstJwks(input: {
  token: string;
  jwks: JSONWebKeySet;
  alg: string;
  authorizationServers: readonly string[];
  clockSkewSeconds: number;
  requireAccessTokenType: boolean;
}) {
  const protectedHeader = decodeProtectedHeader(input.token);
  const kid = getOwnString(protectedHeader, "kid");
  const candidateKeys = input.jwks.keys.filter((key) =>
    isVerificationCandidate(key, input.alg, kid)
  );

  if (candidateKeys.length === 0) {
    throw new NoMatchingKeyError();
  }

  let lastSignatureError: unknown;
  let hasMalformedKey = false;

  for (const candidate of candidateKeys) {
    let key;
    try {
      key = await importJWK(candidate, input.alg);
    } catch {
      hasMalformedKey = true;
      continue;
    }

    try {
      return await jwtVerify(input.token, key as never, {
        algorithms: [input.alg],
        issuer: [...input.authorizationServers],
        clockTolerance: input.clockSkewSeconds,
        requiredClaims: ["exp"],
        ...(input.requireAccessTokenType ? { typ: "at+jwt" } : {})
      });
    } catch (error) {
      if (shouldContinueWithNextKey(error)) {
        lastSignatureError = error;
        continue;
      }

      throw error;
    }
  }

  if (hasMalformedKey) {
    throw createTemporarilyUnavailableError();
  }

  throw lastSignatureError ?? createInvalidTokenError("token signature invalid");
}

class NoMatchingKeyError extends Error {}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }

  if (hostname === "[::1]" || hostname === "::1") {
    return true;
  }

  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.slice(1).every((part) => {
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    })
  );
}

export function createJwksTokenVerifier(options: JwksTokenVerifierOptions): JwksTokenVerifier {
  const jwksUrl = toUrl(options.jwksUrl, "jwksUrl");
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;
  const allowedAlgorithms = options.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGORITHMS;
  const jwksCacheTtlMs = options.jwksCacheTtlMs ?? 300_000;
  const jwksFetchTimeoutMs = options.jwksFetchTimeoutMs ?? 5_000;
  const jwksRefreshCooldownMs = options.jwksRefreshCooldownMs ?? 30_000;
  const requireAccessTokenType = options.requireAccessTokenType ?? false;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  let cachedJwks: { value: JSONWebKeySet; expiresAt: number } | undefined;
  let pendingJwks: Promise<JSONWebKeySet> | undefined;
  let pendingForcedRefresh: Promise<JSONWebKeySet> | undefined;
  let lastForcedRefreshAt = Number.NEGATIVE_INFINITY;

  if (
    jwksUrl.protocol !== "https:" &&
    !isLoopbackHostname(jwksUrl.hostname) &&
    options.allowInsecureJwks !== true
  ) {
    throw new Error("jwksUrl must use HTTPS for non-loopback hosts");
  }

  if (typeof fetchImplementation !== "function") {
    throw new Error("fetch is not available; pass options.fetch explicitly");
  }

  async function getJwks(forceRefresh = false): Promise<JSONWebKeySet> {
    const now = Date.now();
    if (!forceRefresh && cachedJwks !== undefined && cachedJwks.expiresAt > now) {
      return cachedJwks.value;
    }

    if (pendingJwks !== undefined) {
      return pendingJwks;
    }

    pendingJwks = loadJwks(jwksUrl, fetchImplementation, jwksFetchTimeoutMs)
      .then((jwks) => {
        cachedJwks = {
          value: jwks,
          expiresAt: Date.now() + jwksCacheTtlMs
        };
        return jwks;
      })
      .finally(() => {
        pendingJwks = undefined;
      });

    return pendingJwks;
  }

  function refreshJwksAfterUnknownKey(): Promise<JSONWebKeySet> {
    if (pendingForcedRefresh !== undefined) {
      return pendingForcedRefresh;
    }

    const now = Date.now();
    if (now - lastForcedRefreshAt < jwksRefreshCooldownMs) {
      throw new NoMatchingKeyError();
    }

    lastForcedRefreshAt = now;
    pendingForcedRefresh = getJwks(true).finally(() => {
      pendingForcedRefresh = undefined;
    });
    return pendingForcedRefresh;
  }

  return {
    async verify(input): Promise<JwksVerifiedAccessToken> {
      try {
        const expectedResource = canonicalizeResourceIndicator(input.resource);
        const algorithm = resolveAlgorithm(input.token, allowedAlgorithms);
        let jwks = await getJwks();
        let verified;

        try {
          verified = await verifyJwtAgainstJwks({
            token: input.token,
            jwks,
            alg: algorithm,
            authorizationServers: input.authorizationServers,
            clockSkewSeconds,
            requireAccessTokenType
          });
        } catch (error) {
          if (!(error instanceof NoMatchingKeyError)) {
            throw error;
          }

          jwks = await refreshJwksAfterUnknownKey();
          verified = await verifyJwtAgainstJwks({
            token: input.token,
            jwks,
            alg: algorithm,
            authorizationServers: input.authorizationServers,
            clockSkewSeconds,
            requireAccessTokenType
          });
        }
        const audience = normalizeVerifiedAudience(
          getOwnEntry(verified.payload, "aud"),
          expectedResource
        );
        const accessToken = toVerifiedAccessToken(input.token, verified.payload, audience);

        if (
          input.requiredScopes.length > 0 &&
          !input.requiredScopes.every((scope) => accessToken.scopes.includes(scope))
        ) {
          throw createTokenVerificationError({
            error: "insufficient_scope",
            errorDescription: "insufficient scope",
            scope: [...input.requiredScopes]
          });
        }

        return accessToken;
      } catch (error) {
        if (error instanceof NoMatchingKeyError) {
          throw createInvalidTokenError("token signature invalid");
        }

        throw normalizeVerificationError(error);
      }
    }
  };
}
