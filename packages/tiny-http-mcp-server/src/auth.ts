import type { IncomingMessage } from "node:http";

export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";
export const PROTECTED_RESOURCE_METADATA_CACHE_CONTROL = "public, max-age=300";

export interface VerifiedAccessToken {
  token: string;
  issuer: string;
  audience: readonly string[];
  scopes: readonly string[];
  expiresAt: number;
  claims: Record<string, unknown>;
  subject?: string;
  clientId?: string;
}

export interface TokenVerifier {
  verify(input: {
    token: string;
    resource: string;
    authorizationServers: readonly string[];
    requiredScopes: readonly string[];
  }): Promise<VerifiedAccessToken>;
}

export type BearerChallengeErrorCode = "invalid_token" | "insufficient_scope";

export interface BearerChallengeOptions {
  error?: BearerChallengeErrorCode;
  errorDescription?: string;
  scope?: readonly string[];
}

function isBearerChallengeErrorCode(value: unknown): value is BearerChallengeErrorCode {
  return value === "invalid_token" || value === "insufficient_scope";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export class TokenVerificationError extends Error {
  readonly error: BearerChallengeErrorCode;
  readonly errorDescription?: string;
  readonly scope?: readonly string[];

  constructor(input: {
    error: BearerChallengeErrorCode;
    errorDescription?: string;
    scope?: readonly string[];
  }) {
    super(input.errorDescription ?? input.error);
    this.name = "TokenVerificationError";
    this.error = input.error;
    this.errorDescription = input.errorDescription;
    this.scope = input.scope;
  }
}

export interface RequestAuthInfo extends VerifiedAccessToken {
  audience: string[];
  clientId: string;
  scopes: string[];
  resource: URL;
  extra: Record<string, unknown>;
}

export type AuthenticatedIncomingMessage = IncomingMessage & {
  auth?: RequestAuthInfo;
};

export interface BearerAuthOptions {
  resource: string | URL;
  authorizationServers: readonly (string | URL)[];
  protectedResourcePath?: string;
  requiredScopes?: readonly string[];
  trustedProxy?: boolean;
  verifier: TokenVerifier;
}

export type BearerAuthResult =
  | { ok: true; auth: RequestAuthInfo }
  | { ok: false; statusCode: 401 | 403; challenge: string };

function toUrlString(value: string | URL): string {
  return value instanceof URL ? value.toString() : value;
}

function readSingleHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getRequestProtocol(
  req: Pick<IncomingMessage, "headers" | "socket">,
  trustedProxy = false
): string {
  if (trustedProxy) {
    const forwardedProto = readSingleHeaderValue(req.headers["x-forwarded-proto"])
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
    if (forwardedProto === "https" || forwardedProto === "http") {
      return forwardedProto;
    }
  }

  return "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
}

function getRequestHost(
  req: Pick<IncomingMessage, "headers">,
  trustedProxy = false
): string {
  if (trustedProxy) {
    const forwardedHost = readSingleHeaderValue(req.headers["x-forwarded-host"])
      ?.split(",")[0]
      ?.trim();
    if (forwardedHost !== undefined && forwardedHost.length > 0) {
      return forwardedHost;
    }
  }

  return readSingleHeaderValue(req.headers.host) ?? "127.0.0.1";
}

function escapeChallengeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function normalizeProtectedResourcePath(path: string | undefined): string {
  if (path === undefined || path.length === 0 || path === "/") {
    return "";
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    return normalizedPath.slice(0, -1);
  }

  return normalizedPath;
}

function formatScope(scope: readonly string[]): string | undefined {
  if (scope.length === 0) {
    return undefined;
  }

  return scope.join(" ");
}

function readBearerToken(
  req: Pick<IncomingMessage, "headers">
):
  | { kind: "missing" }
  | { kind: "malformed"; errorDescription: string }
  | { kind: "token"; token: string } {
  const authorization = readSingleHeaderValue(req.headers.authorization);
  if (authorization === undefined || authorization.length === 0) {
    return { kind: "missing" };
  }

  const separatorIndex = authorization.indexOf(" ");
  if (separatorIndex <= 0) {
    return {
      kind: "malformed",
      errorDescription: "malformed bearer token",
    };
  }

  const scheme = authorization.slice(0, separatorIndex);
  const token = authorization.slice(separatorIndex + 1).trim();

  if (scheme.toLowerCase() !== "bearer" || token.length === 0 || token.includes(" ")) {
    return {
      kind: "malformed",
      errorDescription: "malformed bearer token",
    };
  }

  return { kind: "token", token };
}

function normalizeTokenVerificationError(
  error: unknown,
  requiredScopes: readonly string[]
): BearerChallengeOptions {
  if (typeof error === "object" && error !== null) {
    const challengeError = error as {
      error?: unknown;
      errorDescription?: unknown;
      scope?: unknown;
    };

    if (
      isBearerChallengeErrorCode(challengeError.error)
      && (challengeError.errorDescription === undefined
        || typeof challengeError.errorDescription === "string")
      && (challengeError.scope === undefined || isStringArray(challengeError.scope))
    ) {
      const scope = challengeError.scope ?? [];

      return {
        error: challengeError.error,
        ...(challengeError.errorDescription === undefined
          ? {}
          : {
              errorDescription: challengeError.errorDescription,
            }),
        scope:
          scope.length > 0
            ? [...scope]
            : challengeError.error === "insufficient_scope"
              ? requiredScopes
              : undefined,
      };
    }
  }

  if (error instanceof TokenVerificationError) {
    return {
      error: error.error,
      errorDescription: error.errorDescription,
      scope:
        error.scope ?? (error.error === "insufficient_scope" ? requiredScopes : undefined),
    };
  }

  if (error instanceof Error) {
    return {
      error: "invalid_token",
      errorDescription: "token verification failed",
    };
  }

  return {
    error: "invalid_token",
    errorDescription: "token verification failed",
  };
}

function toRequestAuthInfo(
  verifiedToken: VerifiedAccessToken,
  resource: string
): RequestAuthInfo {
  const audience = [...verifiedToken.audience];
  const scopes = [...verifiedToken.scopes];
  const claims = { ...verifiedToken.claims };

  return {
    ...verifiedToken,
    audience,
    clientId: verifiedToken.clientId ?? "",
    scopes,
    claims,
    resource: new URL(resource),
    extra: {
      issuer: verifiedToken.issuer,
      audience,
      claims,
      ...(verifiedToken.subject === undefined
        ? {}
        : {
            subject: verifiedToken.subject,
          }),
    },
  };
}

export function getProtectedResourceMetadataUrl(
  req: Pick<IncomingMessage, "headers" | "socket">,
  protectedResourcePath?: string,
  trustedProxy = false
): string {
  return new URL(
    `${PROTECTED_RESOURCE_METADATA_PATH}${normalizeProtectedResourcePath(protectedResourcePath)}`,
    `${getRequestProtocol(req, trustedProxy)}://${getRequestHost(req, trustedProxy)}`
  ).toString();
}

export function createBearerChallenge(
  req: Pick<IncomingMessage, "headers" | "socket">,
  options: BearerChallengeOptions = {},
  protectedResourcePath?: string,
  trustedProxy = false
): string {
  const parts = [
    'Bearer realm="mcp"',
    `resource_metadata="${escapeChallengeValue(getProtectedResourceMetadataUrl(req, protectedResourcePath, trustedProxy))}"`,
  ];

  if (options.error !== undefined) {
    parts.push(`error="${escapeChallengeValue(options.error)}"`);
  }

  if (options.errorDescription !== undefined) {
    parts.push(`error_description="${escapeChallengeValue(options.errorDescription)}"`);
  }

  const scope = options.scope === undefined ? undefined : formatScope(options.scope);
  if (scope !== undefined) {
    parts.push(`scope="${escapeChallengeValue(scope)}"`);
  }

  return parts.join(", ");
}

export async function authorizeBearerRequest(
  req: AuthenticatedIncomingMessage,
  options: BearerAuthOptions
): Promise<BearerAuthResult> {
  const authorization = readBearerToken(req);
  if (authorization.kind === "missing") {
    return {
      ok: false,
      statusCode: 401,
      challenge: createBearerChallenge(
        req,
        {},
        options.protectedResourcePath,
        options.trustedProxy
      ),
    };
  }

  if (authorization.kind === "malformed") {
    return {
      ok: false,
      statusCode: 401,
      challenge: createBearerChallenge(req, {
        error: "invalid_token",
        errorDescription: authorization.errorDescription,
      }, options.protectedResourcePath, options.trustedProxy),
    };
  }

  const requiredScopes = options.requiredScopes ?? [];

  try {
    const verifiedToken = await options.verifier.verify({
      token: authorization.token,
      resource: toUrlString(options.resource),
      authorizationServers: options.authorizationServers.map(toUrlString),
      requiredScopes,
    });
    const auth = toRequestAuthInfo(verifiedToken, toUrlString(options.resource));

    req.auth = auth;

    return {
      ok: true,
      auth,
    };
  } catch (error) {
    const challengeOptions = normalizeTokenVerificationError(error, requiredScopes);
    return {
      ok: false,
      statusCode: challengeOptions.error === "insufficient_scope" ? 403 : 401,
      challenge: createBearerChallenge(
        req,
        challengeOptions,
        options.protectedResourcePath,
        options.trustedProxy
      ),
    };
  }
}
