import { createHash, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto";
import { importJWK, jwtVerify, SignJWT, type JWK } from "jose";

export interface OAuthClientRecord {
  id: string;
  redirectUris: readonly string[];
  createdAt: number;
}

export interface AuthorizationTransactionRecord {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: readonly string[];
  state?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthorizationCodeRecord {
  tokenHash: string;
  grantId: string;
  clientId: string;
  subject: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: readonly string[];
  expiresAt: number;
}

export interface AuthorizationGrantRecord {
  id: string;
  clientId: string;
  subject: string;
  resource: string;
  scopes: readonly string[];
  createdAt: number;
  revokedAt?: number;
}

export interface RefreshTokenRecord {
  tokenHash: string;
  familyId: string;
  grantId: string;
  clientId: string;
  subject: string;
  resource: string;
  scopes: readonly string[];
  createdAt: number;
  expiresAt: number;
  status: "active" | "rotated" | "revoked";
}

export interface AccessTokenRecord {
  tokenHash: string;
  tokenId: string;
  grantId: string;
  subject: string;
  clientId: string;
  resource: string;
  expiresAt: number;
  revokedAt?: number;
}

export type RefreshTokenRotationResult =
  | { status: "rotated"; previous: RefreshTokenRecord }
  | { status: "replay"; grant?: AuthorizationGrantRecord }
  | { status: "invalid" };

export interface AuthorizationServerStore {
  putClient(client: OAuthClientRecord): Promise<void>;
  getClient(clientId: string): Promise<OAuthClientRecord | undefined>;
  putAuthorizationTransaction(transaction: AuthorizationTransactionRecord): Promise<void>;
  takeAuthorizationTransaction(
    transactionId: string
  ): Promise<AuthorizationTransactionRecord | undefined>;
  putAuthorizationCode(code: AuthorizationCodeRecord): Promise<void>;
  takeAuthorizationCode(tokenHash: string): Promise<AuthorizationCodeRecord | undefined>;
  putGrant(grant: AuthorizationGrantRecord): Promise<void>;
  getGrant(grantId: string): Promise<AuthorizationGrantRecord | undefined>;
  putAccessToken(token: AccessTokenRecord): Promise<void>;
  getAccessToken(tokenHash: string): Promise<AccessTokenRecord | undefined>;
  putRefreshToken(token: RefreshTokenRecord): Promise<void>;
  rotateRefreshToken(
    tokenHash: string,
    replacementTokenHash: string,
    now: number,
    expiresAt: number
  ): Promise<RefreshTokenRotationResult>;
  revokeToken(
    tokenHash: string,
    now: number
  ): Promise<void | AuthorizationGrantRecord>;
  revokeGrant(grantId: string, now: number): Promise<void>;
}

export interface AuthorizationInteractionStartContext {
  request: Request;
  transaction: AuthorizationTransactionRecord;
}

export interface AuthorizationInteraction {
  start(context: AuthorizationInteractionStartContext): Promise<Response> | Response;
}

export interface OAuthAuthorizationServerSigningKey {
  algorithm: "ES256" | "RS256";
  keyId: string;
  privateKey: KeyObject;
  publicJwk: JWK;
}

export interface OAuthAuthorizationServerOptions {
  issuer: string;
  resources: readonly string[];
  scopesSupported?: readonly string[];
  defaultScopes?: readonly string[];
  signingKey: OAuthAuthorizationServerSigningKey;
  additionalPublicJwks?: readonly JWK[];
  store: AuthorizationServerStore;
  interaction: AuthorizationInteraction;
  accessTokenTtlSeconds?: number;
  authorizationCodeTtlSeconds?: number;
  authorizationTransactionTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  maxRequestBodyBytes?: number;
  now?: () => number;
  randomToken?: () => string;
  onGrantRevoked?(grant: AuthorizationGrantRecord): Promise<void> | void;
}

export interface CompleteAuthorizationInput {
  transactionId: string;
  subject: string;
  scopes?: readonly string[];
}

export interface CompleteAuthorizationResult {
  redirectUrl: URL;
  grantId: string;
}

export interface AuthorizationInteractionSecurity {
  csrfToken: string;
  state: string;
  nonce: string;
  setCookie: string;
}

export interface AuthorizationInteractionSecurityOptions {
  cookieName?: string;
  maxAgeSeconds?: number;
  randomToken?: () => string;
}

export interface VerifyAuthorizationInteractionCsrfInput {
  cookieHeader: string | null;
  submittedToken: string;
  cookieName?: string;
}

export interface OAuthAuthorizationServer {
  issuer: string;
  handle(request: Request): Promise<Response>;
  completeAuthorization(input: CompleteAuthorizationInput): Promise<CompleteAuthorizationResult>;
  denyAuthorization(transactionId: string, error?: string): Promise<URL>;
  revokeGrant(grantId: string): Promise<void>;
  verifyAccessToken(token: string, resource: string): Promise<VerifiedAuthorizationServerToken>;
}

export interface VerifiedAuthorizationServerToken {
  subject: string;
  clientId: string;
  resource: string;
  scopes: readonly string[];
  tokenId: string;
  expiresAt: number;
}

class OAuthProtocolError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createAuthorizationInteractionSecurity(
  options: AuthorizationInteractionSecurityOptions = {}
): AuthorizationInteractionSecurity {
  const randomToken = options.randomToken ?? opaqueToken;
  const cookieName = options.cookieName ?? "__Host-mcp_oauth_csrf";
  const maxAgeSeconds = options.maxAgeSeconds ?? 600;
  if (!cookieName.startsWith("__Host-") || cookieName.includes(";") || cookieName.includes("=")) {
    throw new Error("CSRF cookie name must use the __Host- prefix.");
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("CSRF cookie max age must be a positive integer.");
  }
  const csrfToken = randomToken();
  return {
    csrfToken,
    state: randomToken(),
    nonce: randomToken(),
    setCookie: `${cookieName}=${csrfToken}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`
  };
}

export function verifyAuthorizationInteractionCsrf(
  input: VerifyAuthorizationInteractionCsrfInput
): boolean {
  const cookieName = input.cookieName ?? "__Host-mcp_oauth_csrf";
  const cookieValue = input.cookieHeader
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (cookieValue === undefined) return false;
  const cookieBuffer = Buffer.from(cookieValue);
  const submittedBuffer = Buffer.from(input.submittedToken);
  return (
    cookieBuffer.length === submittedBuffer.length && timingSafeEqual(cookieBuffer, submittedBuffer)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function parseAbsoluteUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthProtocolError("invalid_request", `${label} must be an absolute URL.`);
  }
  if (url.hash.length > 0) {
    throw new OAuthProtocolError("invalid_request", `${label} must not contain a fragment.`);
  }
  return url.href;
}

function validateIssuer(value: string): string {
  const issuer = new URL(parseAbsoluteUrl(value, "issuer"));
  if (
    issuer.protocol !== "https:" &&
    issuer.hostname !== "localhost" &&
    issuer.hostname !== "127.0.0.1"
  ) {
    throw new Error("issuer must use HTTPS unless it is loopback.");
  }
  if (issuer.pathname !== "/" || issuer.search.length > 0) {
    throw new Error("issuer must be an origin URL without a path or query.");
  }
  return issuer.href.replace(/\/$/, "");
}

function validateResources(values: readonly string[]): Set<string> {
  if (values.length === 0) {
    throw new Error("At least one protected resource is required.");
  }
  return new Set(values.map((value) => parseAbsoluteUrl(value, "resource")));
}

function parseScopes(value: string | null): string[] {
  if (value === null || value.length === 0) return [];
  const scopes = value.split(" ");
  if (scopes.some((scope) => scope.length === 0 || /[\u0000-\u0020\u007f]/u.test(scope))) {
    throw new OAuthProtocolError("invalid_scope", "scope contains an invalid value.");
  }
  return [...new Set(scopes)];
}

function formResponse(payload: Record<string, unknown>, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache"
    }
  });
}

function protocolErrorResponse(error: unknown): Response {
  if (error instanceof OAuthProtocolError) {
    return formResponse({ error: error.error, error_description: error.message }, error.status);
  }
  throw error;
}

function requireFormContentType(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new OAuthProtocolError("invalid_request", "Expected form-encoded request body.");
  }
}

function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new OAuthProtocolError("invalid_request", "Expected JSON request body.");
  }
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/u.test(verifier)) {
    return false;
  }
  const actual = createHash("sha256").update(verifier).digest();
  const expected = Buffer.from(challenge, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function narrowedScopes(requested: readonly string[], approved?: readonly string[]): string[] {
  if (approved === undefined) return [...requested];
  const requestedSet = new Set(requested);
  if (approved.some((scope) => !requestedSet.has(scope))) {
    throw new Error("Approved scopes must be a subset of requested scopes.");
  }
  return [...new Set(approved)];
}

export function createInMemoryAuthorizationServerStore(): AuthorizationServerStore {
  const clients = new Map<string, OAuthClientRecord>();
  const transactions = new Map<string, AuthorizationTransactionRecord>();
  const codes = new Map<string, AuthorizationCodeRecord>();
  const grants = new Map<string, AuthorizationGrantRecord>();
  const accessTokens = new Map<string, AccessTokenRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();

  function revokeFamily(familyId: string, now: number): void {
    for (const [tokenHash, token] of refreshTokens) {
      if (token.familyId === familyId) {
        refreshTokens.set(tokenHash, { ...token, status: "revoked" });
      }
    }
    for (const [grantId, grant] of grants) {
      if (
        grant.revokedAt === undefined &&
        [...refreshTokens.values()].some(
          (token) => token.familyId === familyId && token.grantId === grantId
        )
      ) {
        grants.set(grantId, { ...grant, revokedAt: now });
      }
    }
  }

  return {
    async putClient(client) {
      clients.set(client.id, structuredClone(client));
    },
    async getClient(clientId) {
      const client = clients.get(clientId);
      return client === undefined ? undefined : structuredClone(client);
    },
    async putAuthorizationTransaction(transaction) {
      transactions.set(transaction.id, structuredClone(transaction));
    },
    async takeAuthorizationTransaction(transactionId) {
      const transaction = transactions.get(transactionId);
      transactions.delete(transactionId);
      return transaction === undefined ? undefined : structuredClone(transaction);
    },
    async putAuthorizationCode(code) {
      codes.set(code.tokenHash, structuredClone(code));
    },
    async takeAuthorizationCode(tokenHash) {
      const code = codes.get(tokenHash);
      codes.delete(tokenHash);
      return code === undefined ? undefined : structuredClone(code);
    },
    async putGrant(grant) {
      grants.set(grant.id, structuredClone(grant));
    },
    async getGrant(grantId) {
      const grant = grants.get(grantId);
      return grant === undefined ? undefined : structuredClone(grant);
    },
    async putAccessToken(token) {
      accessTokens.set(token.tokenHash, structuredClone(token));
    },
    async getAccessToken(tokenHash) {
      const token = accessTokens.get(tokenHash);
      return token === undefined ? undefined : structuredClone(token);
    },
    async putRefreshToken(token) {
      refreshTokens.set(token.tokenHash, structuredClone(token));
    },
    async rotateRefreshToken(tokenHash, replacementTokenHash, now, expiresAt) {
      const token = refreshTokens.get(tokenHash);
      if (token === undefined || token.expiresAt <= now || token.status === "revoked") {
        return { status: "invalid" };
      }
      if (token.status === "rotated") {
        revokeFamily(token.familyId, now);
        const grant = grants.get(token.grantId);
        return {
          status: "replay",
          ...(grant === undefined ? {} : { grant: structuredClone(grant) })
        };
      }
      refreshTokens.set(tokenHash, { ...token, status: "rotated" });
      refreshTokens.set(replacementTokenHash, {
        ...token,
        tokenHash: replacementTokenHash,
        createdAt: now,
        expiresAt,
        status: "active"
      });
      return { status: "rotated", previous: structuredClone(token) };
    },
    async revokeToken(tokenHash, now) {
      const refreshToken = refreshTokens.get(tokenHash);
      const accessToken = accessTokens.get(tokenHash);
      const grantId = refreshToken?.grantId ?? accessToken?.grantId;
      const grant = grantId === undefined ? undefined : grants.get(grantId);
      const alreadyRevoked =
        grant?.revokedAt !== undefined ||
        refreshToken?.status === "revoked" ||
        accessToken?.revokedAt !== undefined;
      if (refreshToken !== undefined) {
        revokeFamily(refreshToken.familyId, now);
      }
      if (accessToken !== undefined) {
        accessTokens.set(tokenHash, { ...accessToken, revokedAt: now });
      }
      return grant === undefined || alreadyRevoked ? undefined : structuredClone(grant);
    },
    async revokeGrant(grantId, now) {
      const grant = grants.get(grantId);
      if (grant !== undefined) grants.set(grantId, { ...grant, revokedAt: now });
      for (const [tokenHash, token] of refreshTokens) {
        if (token.grantId === grantId) {
          refreshTokens.set(tokenHash, { ...token, status: "revoked" });
        }
      }
      for (const [tokenHash, token] of accessTokens) {
        if (token.grantId === grantId) {
          accessTokens.set(tokenHash, { ...token, revokedAt: now });
        }
      }
    }
  };
}

export function createOAuthAuthorizationServer(
  options: OAuthAuthorizationServerOptions
): OAuthAuthorizationServer {
  const issuer = validateIssuer(options.issuer);
  const resources = validateResources(options.resources);
  const scopesSupported =
    options.scopesSupported === undefined ? undefined : new Set(options.scopesSupported);
  const defaultScopes = [...new Set(options.defaultScopes ?? [])];
  if (defaultScopes.some((scope) => scope.length === 0 || /[\u0000-\u0020\u007f]/u.test(scope))) {
    throw new Error("default scopes must contain valid scope names.");
  }
  if (scopesSupported !== undefined && defaultScopes.some((scope) => !scopesSupported.has(scope))) {
    throw new Error("default scopes must be included in supported scopes.");
  }
  const now = options.now ?? Date.now;
  const randomToken = options.randomToken ?? opaqueToken;

  async function notifyGrantRevoked(
    grant: AuthorizationGrantRecord | undefined | void
  ): Promise<void> {
    if (grant !== undefined) await options.onGrantRevoked?.(grant);
  }
  const accessTokenTtlMs = (options.accessTokenTtlSeconds ?? 300) * 1000;
  const authorizationCodeTtlMs = (options.authorizationCodeTtlSeconds ?? 60) * 1000;
  const authorizationTransactionTtlMs = (options.authorizationTransactionTtlSeconds ?? 600) * 1000;
  const refreshTokenTtlMs = (options.refreshTokenTtlSeconds ?? 2_592_000) * 1000;
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? 65_536;
  if (!Number.isInteger(maxRequestBodyBytes) || maxRequestBodyBytes <= 0) {
    throw new Error("maxRequestBodyBytes must be a positive integer.");
  }
  const publicJwk = {
    ...options.signingKey.publicJwk,
    kid: options.signingKey.keyId,
    alg: options.signingKey.algorithm,
    use: "sig"
  };
  const publishedJwks = [publicJwk, ...(options.additionalPublicJwks ?? [])];
  const verificationKey = importJWK(publicJwk, options.signingKey.algorithm);

  function endpoint(path: string): string {
    return `${issuer}${path}`;
  }

  function requireResource(value: string | null): string {
    if (value === null) {
      throw new OAuthProtocolError("invalid_target", "resource is required.");
    }
    const normalized = parseAbsoluteUrl(value, "resource");
    if (!resources.has(normalized)) {
      throw new OAuthProtocolError("invalid_target", "resource is not supported.");
    }
    return normalized;
  }

  async function readRequestBody(request: Request): Promise<string> {
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (Number.isFinite(parsedLength) && parsedLength > maxRequestBodyBytes) {
        throw new OAuthProtocolError("invalid_request", "Request body is too large.", 413);
      }
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > maxRequestBodyBytes) {
      throw new OAuthProtocolError("invalid_request", "Request body is too large.", 413);
    }
    return new TextDecoder().decode(body);
  }

  async function handleRegister(request: Request): Promise<Response> {
    requireJsonContentType(request);
    const body = await readRequestBody(request);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new OAuthProtocolError("invalid_client_metadata", "Registration body must be JSON.");
    }
    if (!isObject(payload)) {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "Registration body must be an object."
      );
    }
    const redirectUris = exactStringArray(payload.redirect_uris);
    if (redirectUris === undefined || redirectUris.length === 0) {
      throw new OAuthProtocolError("invalid_redirect_uri", "redirect_uris is required.");
    }
    const normalizedRedirectUris = redirectUris.map((value) =>
      parseAbsoluteUrl(value, "redirect_uri")
    );
    if (
      payload.token_endpoint_auth_method !== undefined &&
      payload.token_endpoint_auth_method !== "none"
    ) {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "Only public clients using token_endpoint_auth_method none are supported."
      );
    }
    const grantTypes = exactStringArray(payload.grant_types) ?? ["authorization_code"];
    if (grantTypes.some((value) => value !== "authorization_code" && value !== "refresh_token")) {
      throw new OAuthProtocolError("invalid_client_metadata", "Unsupported grant type.");
    }
    const responseTypes = exactStringArray(payload.response_types) ?? ["code"];
    if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "Only response_type code is supported."
      );
    }
    const client: OAuthClientRecord = {
      id: randomToken(),
      redirectUris: [...new Set(normalizedRedirectUris)],
      createdAt: now()
    };
    await options.store.putClient(client);
    return formResponse(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: grantTypes,
        response_types: ["code"]
      },
      201
    );
  }

  async function handleAuthorize(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.get("response_type") !== "code") {
      throw new OAuthProtocolError("unsupported_response_type", "response_type must be code.");
    }
    const clientId = url.searchParams.get("client_id");
    if (clientId === null)
      throw new OAuthProtocolError("invalid_request", "client_id is required.");
    const client = await options.store.getClient(clientId);
    if (client === undefined)
      throw new OAuthProtocolError("unauthorized_client", "Unknown client.");
    const redirectUriValue = url.searchParams.get("redirect_uri");
    if (redirectUriValue === null) {
      throw new OAuthProtocolError("invalid_request", "redirect_uri is required.");
    }
    const redirectUri = parseAbsoluteUrl(redirectUriValue, "redirect_uri");
    if (!client.redirectUris.includes(redirectUri)) {
      throw new OAuthProtocolError("invalid_request", "redirect_uri is not registered.");
    }
    const codeChallenge = url.searchParams.get("code_challenge");
    if (codeChallenge === null || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) {
      throw new OAuthProtocolError("invalid_request", "A valid code_challenge is required.");
    }
    if (url.searchParams.get("code_challenge_method") !== "S256") {
      throw new OAuthProtocolError("invalid_request", "code_challenge_method must be S256.");
    }
    const requestedScopes = url.searchParams.has("scope")
      ? parseScopes(url.searchParams.get("scope"))
      : [...defaultScopes];
    if (defaultScopes.length > 0 && requestedScopes.length === 0) {
      throw new OAuthProtocolError("invalid_scope", "scope must not be empty.");
    }
    if (
      scopesSupported !== undefined &&
      requestedScopes.some((scope) => !scopesSupported.has(scope))
    ) {
      throw new OAuthProtocolError(
        "invalid_scope",
        "One or more requested scopes are not supported."
      );
    }
    const transaction: AuthorizationTransactionRecord = {
      id: randomToken(),
      clientId,
      redirectUri,
      codeChallenge,
      resource: requireResource(url.searchParams.get("resource")),
      scopes: requestedScopes,
      ...(url.searchParams.has("state") && { state: url.searchParams.get("state") ?? undefined }),
      createdAt: now(),
      expiresAt: now() + authorizationTransactionTtlMs
    };
    await options.store.putAuthorizationTransaction(transaction);
    return options.interaction.start({ request, transaction });
  }

  async function completeAuthorization(
    input: CompleteAuthorizationInput
  ): Promise<CompleteAuthorizationResult> {
    if (input.subject.length === 0) throw new Error("subject is required.");
    const transaction = await options.store.takeAuthorizationTransaction(input.transactionId);
    const currentTime = now();
    if (transaction === undefined || transaction.expiresAt <= currentTime) {
      throw new Error("Authorization transaction is missing, expired, or already completed.");
    }
    const scopes = narrowedScopes(transaction.scopes, input.scopes);
    const grantId = randomToken();
    await options.store.putGrant({
      id: grantId,
      clientId: transaction.clientId,
      subject: input.subject,
      resource: transaction.resource,
      scopes,
      createdAt: currentTime
    });
    const code = randomToken();
    await options.store.putAuthorizationCode({
      tokenHash: hashToken(code),
      grantId,
      clientId: transaction.clientId,
      subject: input.subject,
      redirectUri: transaction.redirectUri,
      codeChallenge: transaction.codeChallenge,
      resource: transaction.resource,
      scopes,
      expiresAt: currentTime + authorizationCodeTtlMs
    });
    const redirectUrl = new URL(transaction.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (transaction.state !== undefined) redirectUrl.searchParams.set("state", transaction.state);
    redirectUrl.searchParams.set("iss", issuer);
    return { redirectUrl, grantId };
  }

  async function denyAuthorization(transactionId: string, error = "access_denied"): Promise<URL> {
    const transaction = await options.store.takeAuthorizationTransaction(transactionId);
    if (transaction === undefined) {
      throw new Error("Authorization transaction is missing or already completed.");
    }
    const redirectUrl = new URL(transaction.redirectUri);
    redirectUrl.searchParams.set("error", error);
    if (transaction.state !== undefined) redirectUrl.searchParams.set("state", transaction.state);
    redirectUrl.searchParams.set("iss", issuer);
    return redirectUrl;
  }

  async function issueToken(input: {
    grant: AuthorizationGrantRecord;
    familyId?: string;
    includeRefreshToken: boolean;
  }): Promise<Record<string, unknown>> {
    const currentTime = now();
    const expiresAt = currentTime + accessTokenTtlMs;
    const tokenId = randomToken();
    const accessToken = await new SignJWT({
      scope: input.grant.scopes.join(" "),
      client_id: input.grant.clientId
    })
      .setProtectedHeader({
        alg: options.signingKey.algorithm,
        kid: options.signingKey.keyId,
        typ: "at+jwt"
      })
      .setIssuer(issuer)
      .setSubject(input.grant.subject)
      .setAudience(input.grant.resource)
      .setJti(tokenId)
      .setIssuedAt(Math.floor(currentTime / 1000))
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(options.signingKey.privateKey);
    await options.store.putAccessToken({
      tokenHash: hashToken(accessToken),
      tokenId,
      grantId: input.grant.id,
      subject: input.grant.subject,
      clientId: input.grant.clientId,
      resource: input.grant.resource,
      expiresAt
    });
    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(accessTokenTtlMs / 1000),
      scope: input.grant.scopes.join(" ")
    };
    if (input.includeRefreshToken) {
      const refreshToken = randomToken();
      await options.store.putRefreshToken({
        tokenHash: hashToken(refreshToken),
        familyId: input.familyId ?? randomToken(),
        grantId: input.grant.id,
        clientId: input.grant.clientId,
        subject: input.grant.subject,
        resource: input.grant.resource,
        scopes: input.grant.scopes,
        createdAt: currentTime,
        expiresAt: currentTime + refreshTokenTtlMs,
        status: "active"
      });
      response.refresh_token = refreshToken;
    }
    return response;
  }

  async function exchangeAuthorizationCode(body: URLSearchParams): Promise<Response> {
    const codeValue = body.get("code");
    if (codeValue === null) throw new OAuthProtocolError("invalid_request", "code is required.");
    const code = await options.store.takeAuthorizationCode(hashToken(codeValue));
    const currentTime = now();
    if (code === undefined || code.expiresAt <= currentTime) {
      throw new OAuthProtocolError("invalid_grant", "Authorization code is invalid.");
    }
    if (
      body.get("client_id") !== code.clientId ||
      body.get("redirect_uri") !== code.redirectUri ||
      requireResource(body.get("resource")) !== code.resource ||
      !pkceMatches(body.get("code_verifier") ?? "", code.codeChallenge)
    ) {
      throw new OAuthProtocolError("invalid_grant", "Authorization code binding is invalid.");
    }
    const grant = await options.store.getGrant(code.grantId);
    if (grant === undefined || grant.revokedAt !== undefined) {
      throw new OAuthProtocolError("invalid_grant", "Authorization grant is invalid.");
    }
    return formResponse(
      await issueToken({
        grant,
        includeRefreshToken: grant.scopes.includes("offline_access")
      })
    );
  }

  async function rotateRefreshToken(body: URLSearchParams): Promise<Response> {
    const refreshToken = body.get("refresh_token");
    if (refreshToken === null) {
      throw new OAuthProtocolError("invalid_request", "refresh_token is required.");
    }
    const replacementValue = randomToken();
    const currentTime = now();
    const replacementTokenHash = hashToken(replacementValue);
    const requestedResource = requireResource(body.get("resource"));
    const tokenHash = hashToken(refreshToken);
    const existing = await options.store.rotateRefreshToken(
      tokenHash,
      replacementTokenHash,
      currentTime,
      currentTime + refreshTokenTtlMs
    );
    if (existing.status !== "rotated") {
      if (existing.status === "replay") await notifyGrantRevoked(existing.grant);
      throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid or replayed.");
    }
    if (
      existing.previous.clientId !== body.get("client_id") ||
      existing.previous.resource !== requestedResource
    ) {
      const revokedGrant = await options.store.getGrant(existing.previous.grantId);
      await options.store.revokeGrant(existing.previous.grantId, currentTime);
      await notifyGrantRevoked(revokedGrant);
      throw new OAuthProtocolError("invalid_grant", "Refresh token binding is invalid.");
    }
    const grant = await options.store.getGrant(existing.previous.grantId);
    if (grant === undefined || grant.revokedAt !== undefined) {
      throw new OAuthProtocolError("invalid_grant", "Authorization grant is invalid.");
    }
    const response = await issueToken({ grant, includeRefreshToken: false });
    response.refresh_token = replacementValue;
    return formResponse(response);
  }

  async function handleToken(request: Request): Promise<Response> {
    requireFormContentType(request);
    const body = new URLSearchParams(await readRequestBody(request));
    const grantType = body.get("grant_type");
    if (grantType === "authorization_code") return exchangeAuthorizationCode(body);
    if (grantType === "refresh_token") return rotateRefreshToken(body);
    throw new OAuthProtocolError("unsupported_grant_type", "Unsupported grant_type.");
  }

  async function handleRevoke(request: Request): Promise<Response> {
    requireFormContentType(request);
    const body = new URLSearchParams(await readRequestBody(request));
    const token = body.get("token");
    if (token !== null) {
      await notifyGrantRevoked(await options.store.revokeToken(hashToken(token), now()));
    }
    return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  }

  async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
        return formResponse({
          issuer,
          authorization_endpoint: endpoint("/authorize"),
          token_endpoint: endpoint("/token"),
          registration_endpoint: endpoint("/register"),
          revocation_endpoint: endpoint("/revoke"),
          jwks_uri: endpoint("/.well-known/jwks.json"),
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          ...(scopesSupported === undefined ? {} : { scopes_supported: [...scopesSupported] }),
          protected_resources: [...resources]
        });
      }
      if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
        return formResponse({ keys: publishedJwks });
      }
      if (request.method === "POST" && url.pathname === "/register") {
        return await handleRegister(request);
      }
      if (request.method === "GET" && url.pathname === "/authorize") {
        return await handleAuthorize(request);
      }
      if (request.method === "POST" && url.pathname === "/token") {
        return await handleToken(request);
      }
      if (request.method === "POST" && url.pathname === "/revoke") {
        return await handleRevoke(request);
      }
      return formResponse({ error: "not_found" }, 404);
    } catch (error) {
      return protocolErrorResponse(error);
    }
  }

  async function verifyAccessToken(
    token: string,
    resource: string
  ): Promise<VerifiedAuthorizationServerToken> {
    const normalizedResource = parseAbsoluteUrl(resource, "resource");
    if (!resources.has(normalizedResource)) {
      throw new Error("Access token resource is not supported.");
    }
    const storedToken = await options.store.getAccessToken(hashToken(token));
    const currentTime = now();
    if (
      storedToken === undefined ||
      storedToken.revokedAt !== undefined ||
      storedToken.expiresAt <= currentTime
    ) {
      throw new Error("Access token is revoked, expired, or unknown.");
    }
    const verified = await jwtVerify(token, await verificationKey, {
      issuer,
      audience: normalizedResource,
      algorithms: [options.signingKey.algorithm],
      typ: "at+jwt"
    });
    const subject = verified.payload.sub;
    const clientId = verified.payload.client_id;
    const tokenId = verified.payload.jti;
    const scope = verified.payload.scope;
    if (
      typeof subject !== "string" ||
      typeof clientId !== "string" ||
      typeof tokenId !== "string" ||
      typeof scope !== "string" ||
      subject !== storedToken.subject ||
      clientId !== storedToken.clientId ||
      tokenId !== storedToken.tokenId ||
      normalizedResource !== storedToken.resource
    ) {
      throw new Error("Access token claims do not match the authorization record.");
    }
    return {
      subject,
      clientId,
      resource: normalizedResource,
      scopes: parseScopes(scope),
      tokenId,
      expiresAt: Math.floor(storedToken.expiresAt / 1000)
    };
  }

  return {
    issuer,
    handle,
    completeAuthorization,
    denyAuthorization,
    verifyAccessToken,
    async revokeGrant(grantId) {
      const grant = await options.store.getGrant(grantId);
      await options.store.revokeGrant(grantId, now());
      await notifyGrantRevoked(grant?.revokedAt === undefined ? grant : undefined);
    }
  };
}
