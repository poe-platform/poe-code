import {
  decodeProtectedHeader,
  errors,
  importJWK,
  jwtVerify,
  type JSONWebKeySet,
  type JWK,
  type JWTPayload,
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

function normalizeVerifiedAudience(
  value: unknown,
  expectedResource: string
): string[] {
  const audiences = normalizeAudience(value);
  if (audiences.length !== 1) {
    throw createInvalidTokenError("audience mismatch");
  }

  let normalizedAudience: string;

  try {
    normalizedAudience = canonicalizeResourceIndicator(audiences[0] ?? "");
  } catch {
    throw createInvalidTokenError("audience mismatch");
  }

  if (normalizedAudience !== expectedResource) {
    throw createInvalidTokenError("audience mismatch");
  }

  return [normalizedAudience];
}

function parseScopes(payload: JWTPayload): string[] {
  const scope = getOwnString(payload, "scope");
  const scopes = getOwnEntry(payload, "scopes");
  const raw =
    scope !== undefined
      ? scope
      : typeof scopes === "string"
        ? scopes
        : null;

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
    expiresAt: typeof expiresAt === "number" ? expiresAt : 0,
    claims: { ...payload },
    ...(subject !== undefined
      ? {
          subject,
        }
      : {}),
    ...(clientId !== undefined
      ? {
          clientId,
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
  const keys = isObjectRecord(payload) ? getOwnEntry(payload, "keys") : undefined;
  if (!isObjectRecord(payload) || !Array.isArray(keys)) {
    throw createInvalidTokenError("invalid JWKS document");
  }

  return { ...payload, keys } as unknown as JSONWebKeySet;
}

function resolveAlgorithm(
  token: string,
  allowedAlgorithms: readonly string[]
): string {
  const header = decodeProtectedHeader(token);
  const alg = getOwnString(header, "alg");

  if (hasCriticalHeaderClaims(header)) {
    throw createInvalidTokenError("unsupported critical token claims");
  }

  if (
    typeof alg !== "string"
    || alg === "none"
    || alg.startsWith("HS")
    || !allowedAlgorithms.includes(alg)
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
}) {
  const protectedHeader = decodeProtectedHeader(input.token);
  const kid = getOwnString(protectedHeader, "kid");
  const candidateKeys = input.jwks.keys.filter((key) => isVerificationCandidate(key, input.alg, kid));

  if (candidateKeys.length === 0) {
    throw createInvalidTokenError("token signature invalid");
  }

  let lastSignatureError: unknown;

  for (const candidate of candidateKeys) {
    try {
      const key = await importJWK(candidate, input.alg);
      return await jwtVerify(input.token, key as never, {
        algorithms: [input.alg],
        issuer: [...input.authorizationServers],
        clockTolerance: input.clockSkewSeconds,
      });
    } catch (error) {
      if (shouldContinueWithNextKey(error)) {
        lastSignatureError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastSignatureError ?? createInvalidTokenError("token signature invalid");
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
      const expectedResource = canonicalizeResourceIndicator(input.resource);
      const algorithm = resolveAlgorithm(input.token, allowedAlgorithms);

      try {
        const jwks = await loadJwks(jwksUrl, fetchImplementation);
        const verified = await verifyJwtAgainstJwks({
          token: input.token,
          jwks,
          alg: algorithm,
          authorizationServers: input.authorizationServers,
          clockSkewSeconds,
        });
        const audience = normalizeVerifiedAudience(
          getOwnEntry(verified.payload, "aud"),
          expectedResource
        );
        const accessToken = toVerifiedAccessToken(input.token, verified.payload, audience);

        if (
          input.requiredScopes.length > 0
          && !input.requiredScopes.every((scope) => accessToken.scopes.includes(scope))
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
