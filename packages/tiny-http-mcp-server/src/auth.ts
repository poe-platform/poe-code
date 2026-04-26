import type { IncomingMessage } from "node:http";

export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

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
  requiredScopes?: readonly string[];
  verifier: TokenVerifier;
}

export type BearerAuthResult =
  | { ok: true; auth: RequestAuthInfo }
  | { ok: false; challenge: string };

function toUrlString(value: string | URL): string {
  return value instanceof URL ? value.toString() : value;
}

function readSingleHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readForwardedHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  const headerValue = readSingleHeaderValue(value);
  if (headerValue === undefined || headerValue.length === 0) {
    return undefined;
  }

  return headerValue.split(",")[0]?.trim() || undefined;
}

function getRequestProtocol(
  req: Pick<IncomingMessage, "headers" | "socket">
): string {
  const forwardedProto = readForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  if (forwardedProto !== undefined) {
    return forwardedProto;
  }

  return "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
}

function getRequestHost(req: Pick<IncomingMessage, "headers">): string {
  const forwardedHost = readForwardedHeaderValue(req.headers["x-forwarded-host"]);
  if (forwardedHost !== undefined) {
    return forwardedHost;
  }

  return readSingleHeaderValue(req.headers.host) ?? "127.0.0.1";
}

function escapeChallengeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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
      errorDescription: error.message,
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
  req: Pick<IncomingMessage, "headers" | "socket">
): string {
  return new URL(
    PROTECTED_RESOURCE_METADATA_PATH,
    `${getRequestProtocol(req)}://${getRequestHost(req)}`
  ).toString();
}

export function createBearerChallenge(
  req: Pick<IncomingMessage, "headers" | "socket">,
  options: BearerChallengeOptions = {}
): string {
  const parts = [
    'Bearer realm="mcp"',
    `resource_metadata="${escapeChallengeValue(getProtectedResourceMetadataUrl(req))}"`,
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
      challenge: createBearerChallenge(req),
    };
  }

  if (authorization.kind === "malformed") {
    return {
      ok: false,
      challenge: createBearerChallenge(req, {
        error: "invalid_token",
        errorDescription: authorization.errorDescription,
      }),
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
    return {
      ok: false,
      challenge: createBearerChallenge(
        req,
        normalizeTokenVerificationError(error, requiredScopes)
      ),
    };
  }
}
