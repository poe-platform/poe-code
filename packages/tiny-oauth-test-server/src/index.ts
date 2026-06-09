import {
  createECDH,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT } from "jose";

interface ObjectRecord {
  [key: string]: unknown;
}

export interface OAuthTestStaticClient {
  clientId: string;
  redirectUris: string[];
  scopes?: string[];
}

export interface OAuthTestServerOptions {
  issuer?: string;
  signingKey?: string | ObjectRecord;
  signingKeySeed?: string;
  clockSkewSeconds?: number;
  defaultTokenTtlSeconds?: number;
  requireDcr?: boolean;
  staticClients?: OAuthTestStaticClient[];
  defaultAuthorization?: {
    autoApprove?: boolean;
    scopes?: string[];
  };
}

export interface OAuthTestServerListenOptions {
  port?: number;
  hostname?: string;
}

export interface OAuthTestServerListeningHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface OAuthTestServerRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface DirectTokenIssueOptions {
  clientId: string;
  resource: string;
  scopes: string[];
  ttlSeconds?: number;
}

export interface NextAuthorizationOptions {
  autoApprove: boolean;
  scopes?: string[];
}

export interface OAuthTestServer {
  readonly issuer: string;
  readonly requestLog: readonly OAuthTestServerRequest[];
  listen(options?: OAuthTestServerListenOptions): Promise<OAuthTestServerListeningHandle>;
  issueTokenFor(options: DirectTokenIssueOptions): Promise<string>;
  setNextAuthorization(options: NextAuthorizationOptions): void;
  isTokenRevoked(token: string): boolean;
  revoke(token: string): void;
}

interface StoredClient {
  clientId: string;
  redirectUris: string[];
  scopes?: string[];
  grantTypes: string[];
  metadata: ObjectRecord;
}

interface AuthorizationCodeRecord {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  codeChallenge: string;
  issueRefreshToken: boolean;
  expiresAt: number;
  used: boolean;
}

interface RefreshTokenRecord {
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
  used: boolean;
  revoked: boolean;
}

interface AccessTokenRecord {
  token: string;
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
  revoked: boolean;
}

interface AuthorizationDecision {
  autoApprove: boolean;
  scopes?: string[];
}

interface SigningState {
  privateKey: KeyObject;
  publicJwk: ObjectRecord;
  alg: "ES256" | "RS256";
  kid: string;
}

class OAuthRequestError extends Error {
  readonly status: number;
  readonly error: string;

  constructor(status: number, error: string, message: string) {
    super(message);
    this.name = "OAuthRequestError";
    this.status = status;
    this.error = error;
  }
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getOwnEntry(record: ObjectRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnString(record: ObjectRecord, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function parseAbsoluteUrl(value: string, label: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new OAuthRequestError(400, "invalid_request", `${label} must be an absolute URL`);
  }

  if (url.hash.length > 0) {
    throw new OAuthRequestError(400, "invalid_request", `${label} must not include a fragment`);
  }

  return url.toString();
}

function normalizeHostForComparison(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

function formatAuthorityHostname(hostname: string): string {
  if (hostname.includes(":") && !(hostname.startsWith("[") && hostname.endsWith("]"))) {
    return `[${hostname}]`;
  }

  return hostname;
}

function isLoopbackRedirectUri(value: string): boolean {
  const url = new URL(value);
  const hostname = normalizeHostForComparison(url.hostname).toLowerCase();

  if (url.protocol !== "http:") {
    return false;
  }

  if (hostname === "::1") {
    return true;
  }

  const octets = hostname.split(".");
  if (octets.length !== 4) {
    return false;
  }

  const numericOctets = octets.map((octet) => Number(octet));
  return numericOctets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && numericOctets[0] === 127;
}

function stripUrlPort(value: string): string {
  const url = new URL(value);
  url.port = "";
  return url.toString();
}

function matchesRegisteredRedirectUri(registeredRedirectUri: string, requestedRedirectUri: string): boolean {
  return stripUrlPort(registeredRedirectUri) === stripUrlPort(requestedRedirectUri);
}

function isPkceVerifierCharacter(value: string): boolean {
  return (
    (value >= "A" && value <= "Z")
    || (value >= "a" && value <= "z")
    || (value >= "0" && value <= "9")
    || value === "-"
    || value === "."
    || value === "_"
    || value === "~"
  );
}

function isValidPkceVerifier(value: string): boolean {
  return (
    value.length >= 43
    && value.length <= 128
    && [...value].every(isPkceVerifierCharacter)
  );
}

function isValidPkceChallenge(value: string): boolean {
  return value.length === 43 && [...value].every(isPkceVerifierCharacter);
}

function parseScope(value: string | null): string[] {
  if (value === null || value.trim().length === 0) {
    return [];
  }

  return value
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function formatScope(scope: readonly string[]): string | undefined {
  return scope.length === 0 ? undefined : scope.join(" ");
}

function validateConfiguredScopes(scopes: readonly string[] | undefined): void {
  if (scopes === undefined) {
    return;
  }

  for (const scope of scopes) {
    if (scope.length === 0 || parseScope(scope).length !== 1 || parseScope(scope)[0] !== scope) {
      throw new Error("scope entries must not contain spaces");
    }
  }
}

function createRandomToken(): string {
  return randomBytes(24).toString("base64url");
}

function createDeterministicEcPrivateKey(seed: string): KeyObject {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const digest = createHash("sha256")
      .update(seed)
      .update(":")
      .update(String(attempt))
      .digest();
    const ecdh = createECDH("prime256v1");

    try {
      ecdh.setPrivateKey(digest);
      const publicKey = ecdh.getPublicKey();

      return createPrivateKey({
        key: {
          kty: "EC",
          crv: "P-256",
          d: digest.toString("base64url"),
          x: publicKey.subarray(1, 33).toString("base64url"),
          y: publicKey.subarray(33, 65).toString("base64url"),
        },
        format: "jwk",
      });
    } catch {
      continue;
    }
  }

  throw new Error("Unable to derive a deterministic ES256 key from the supplied seed");
}

function createSigningState(options: OAuthTestServerOptions): SigningState {
  const privateKey = resolvePrivateKey(options);
  const publicKey = createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: "jwk" }) as ObjectRecord;
  const alg = resolveSigningAlgorithm(privateKey);
  const kid = createHash("sha256")
    .update(JSON.stringify(sortJwkForThumbprint(publicJwk)))
    .digest("base64url");

  return {
    privateKey,
    publicJwk: {
      ...publicJwk,
      use: "sig",
      alg,
      kid,
    },
    alg,
    kid,
  };
}

function sortJwkForThumbprint(jwk: ObjectRecord): ObjectRecord {
  return Object.fromEntries(
    Object.entries(jwk)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function resolvePrivateKey(options: OAuthTestServerOptions): KeyObject {
  if (options.signingKey !== undefined) {
    if (typeof options.signingKey === "string") {
      return createPrivateKey(options.signingKey);
    }

    if (isObjectRecord(options.signingKey)) {
      return createPrivateKey({
        key: options.signingKey as never,
        format: "jwk",
      });
    }

    throw new Error("signingKey must be a PEM string or a JWK object");
  }

  if (options.signingKeySeed !== undefined) {
    return createDeterministicEcPrivateKey(options.signingKeySeed);
  }

  return generateKeyPairSync("ec", {
    namedCurve: "P-256",
  }).privateKey;
}

function resolveSigningAlgorithm(privateKey: KeyObject): "ES256" | "RS256" {
  if (privateKey.asymmetricKeyType === "rsa") {
    return "RS256";
  }

  if (privateKey.asymmetricKeyType === "ec") {
    const namedCurve = privateKey.asymmetricKeyDetails?.namedCurve;
    if (namedCurve !== undefined && namedCurve !== "prime256v1") {
      throw new Error("EC signingKey must use the P-256 curve for ES256");
    }

    return "ES256";
  }

  throw new Error("signingKey must be an RSA or P-256 EC private key");
}

function joinBasePath(basePath: string, suffix: string): string {
  if (basePath === "/") {
    return suffix;
  }

  if (suffix === "/") {
    return basePath;
  }

  return `${basePath}${suffix}`;
}

function normalizeIssuerPathname(issuer: string): string {
  const pathname = new URL(issuer).pathname;
  if (pathname === "" || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function getEndpointPaths(issuer: string): {
  metadataPaths: string[];
  authorizePaths: string[];
  tokenPaths: string[];
  registerPaths: string[];
  jwksPaths: string[];
  issueTokenPaths: string[];
  authorizeUrl: string;
  tokenUrl: string;
  registerUrl: string;
  jwksUrl: string;
  issueTokenUrl: string;
} {
  const basePath = normalizeIssuerPathname(issuer);
  const authorizePath = joinBasePath(basePath, "/authorize");
  const tokenPath = joinBasePath(basePath, "/token");
  const registerPath = joinBasePath(basePath, "/register");
  const jwksPath = joinBasePath(basePath, "/.well-known/jwks.json");
  const metadataPath =
    basePath === "/"
      ? "/.well-known/oauth-authorization-server"
      : `/.well-known/oauth-authorization-server${basePath}`;

  const rootIssueTokenPath = "/testing/issue-token";
  const issueTokenPath = joinBasePath(basePath, "/testing/issue-token");

  return {
    metadataPaths:
      metadataPath === "/.well-known/oauth-authorization-server"
        ? [metadataPath]
        : [metadataPath],
    authorizePaths: [authorizePath],
    tokenPaths: [tokenPath],
    registerPaths: [registerPath],
    jwksPaths: [jwksPath],
    issueTokenPaths:
      issueTokenPath === rootIssueTokenPath
        ? [issueTokenPath]
        : [issueTokenPath, rootIssueTokenPath],
    authorizeUrl: new URL(authorizePath, issuer).toString(),
    tokenUrl: new URL(tokenPath, issuer).toString(),
    registerUrl: new URL(registerPath, issuer).toString(),
    jwksUrl: new URL(jwksPath, issuer).toString(),
    issueTokenUrl: new URL(issueTokenPath, issuer).toString(),
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  response.end(html);
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  response.end();
}

function sendOAuthError(
  response: ServerResponse,
  error: OAuthRequestError | Error
): void {
  if (error instanceof OAuthRequestError) {
    sendJson(response, error.status, {
      error: error.error,
      error_description: error.message,
    });
    return;
  }

  sendJson(response, 500, {
    error: "server_error",
    error_description: error.message,
  });
}

function cloneRequestLog(
  requestLog: readonly OAuthTestServerRequest[]
): OAuthTestServerRequest[] {
  return requestLog.map((request) => ({
    ...request,
    headers: { ...request.headers },
  }));
}

function readRequestHeaders(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).flatMap(([name, value]) => {
      if (typeof value === "string") {
        return [[name, value]];
      }

      if (Array.isArray(value)) {
        return [[name, value.join(", ")]];
      }

      return [];
    })
  );
}

function sanitizeLoggedBody(
  body: string,
  headers: Record<string, string>
): string {
  const contentType = headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return body;
  }

  const params = new URLSearchParams(body);
  if (params.has("code_verifier")) {
    params.set("code_verifier", "[redacted]");
  }
  if (params.has("refresh_token")) {
    params.set("refresh_token", "[redacted]");
  }
  return params.toString();
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonObjectBody(body: string): ObjectRecord {
  if (body.length === 0) {
    throw new OAuthRequestError(400, "invalid_request", "request body must be a JSON object");
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isObjectRecord(parsed)) {
      throw new Error("not-object");
    }

    return parsed;
  } catch {
    throw new OAuthRequestError(400, "invalid_request", "request body must be a JSON object");
  }
}

function requireJsonContentType(headers: Record<string, string>): void {
  const contentType = headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new OAuthRequestError(
      400,
      "invalid_request",
      "Content-Type must be application/json"
    );
  }
}

function normalizeRegistrationStringArray(
  value: unknown,
  field: string,
  fallback: string[]
): string[] {
  if (value === undefined) {
    return [...fallback];
  }

  if (!isStringArray(value) || value.length === 0) {
    throw new OAuthRequestError(
      400,
      "invalid_client_metadata",
      `${field} must be a non-empty array of strings`
    );
  }

  return [...value];
}

function readSingleParam(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  if (values.length === 0) {
    return null;
  }

  if (values.length > 1) {
    throw new OAuthRequestError(400, "invalid_request", `${name} must appear only once`);
  }

  return values[0] ?? null;
}

function requireParam(params: URLSearchParams, name: string): string {
  const value = readSingleParam(params, name);
  if (value === null || value.length === 0) {
    throw new OAuthRequestError(400, "invalid_request", `${name} is required`);
  }

  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function withUpdatedSearchParam(url: URL, name: string, value: string): string {
  const nextUrl = new URL(url.toString());
  nextUrl.searchParams.set(name, value);
  return nextUrl.toString();
}

function assertAllowedScopes(requestedScopes: readonly string[], client: StoredClient): void {
  if (client.scopes === undefined) {
    return;
  }

  const allowed = new Set(client.scopes);
  for (const scope of requestedScopes) {
    if (!allowed.has(scope)) {
      throw new OAuthRequestError(400, "invalid_scope", `scope ${scope} is not allowed`);
    }
  }
}

function normalizeStaticClient(input: OAuthTestStaticClient): StoredClient {
  if (input.clientId.length === 0) {
    throw new Error("staticClients[].clientId must be non-empty");
  }

  if (input.redirectUris.length === 0) {
    throw new Error("staticClients[].redirectUris must be a non-empty array");
  }

  validateConfiguredScopes(input.scopes);

  return {
    clientId: input.clientId,
    redirectUris: input.redirectUris.map((redirectUri) =>
      parseAbsoluteUrl(redirectUri, "staticClients[].redirectUris[]")
    ),
    scopes: input.scopes === undefined ? undefined : [...input.scopes],
    grantTypes: ["authorization_code", "refresh_token"],
    metadata: {},
  };
}

export function createOAuthTestServer(
  options: OAuthTestServerOptions = {}
): OAuthTestServer {
  const clockSkewSeconds = options.clockSkewSeconds ?? 0;
  const defaultTokenTtlSeconds = options.defaultTokenTtlSeconds ?? 60;
  if (!Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw new Error("clockSkewSeconds must be a non-negative finite number");
  }
  if (!Number.isInteger(defaultTokenTtlSeconds) || defaultTokenTtlSeconds <= 0) {
    throw new Error("defaultTokenTtlSeconds must be a positive integer");
  }
  validateConfiguredScopes(options.defaultAuthorization?.scopes);
  const requireDcr = options.requireDcr ?? true;
  const signing = createSigningState(options);
  const staticClients = new Map<string, StoredClient>();
  for (const client of options.staticClients ?? []) {
    const normalized = normalizeStaticClient(client);
    if (staticClients.has(normalized.clientId)) {
      throw new Error("staticClients[].clientId must be unique");
    }
    staticClients.set(normalized.clientId, normalized);
  }
  const registeredClients = new Map<string, StoredClient>();
  const authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  const accessTokens = new Map<string, AccessTokenRecord>();
  const usedCodeVerifiers = new Set<string>();
  const revokedTokens = new Set<string>();
  const requestLog: OAuthTestServerRequest[] = [];
  const consentApprovals = new Set<string>();

  let nextClientId = 1;
  let server: http.Server | null = null;
  let currentHandle: OAuthTestServerListeningHandle | null = null;
  let listenPending = false;
  let runtimeIssuer = options.issuer ? normalizeIssuer(options.issuer) : null;
  let nextAuthorization: AuthorizationDecision | null = null;

  const defaultAuthorization: AuthorizationDecision = {
    autoApprove: options.defaultAuthorization?.autoApprove ?? false,
    scopes: options.defaultAuthorization?.scopes,
  };

  return {
    get issuer(): string {
      if (runtimeIssuer === null) {
        throw new Error("issuer is not available until the server starts listening");
      }

      return runtimeIssuer;
    },

    get requestLog(): readonly OAuthTestServerRequest[] {
      return cloneRequestLog(requestLog);
    },

    async listen(listenOptions: OAuthTestServerListenOptions = {}) {
      if (server !== null || currentHandle !== null || listenPending) {
        throw new Error("OAuth test server is already listening");
      }

      listenPending = true;

      const hostname = listenOptions.hostname ?? "127.0.0.1";
      const requestedPort = listenOptions.port ?? 0;
      const sockets = new Set<import("node:net").Socket>();
      const httpServer = http.createServer((request, response) => {
        void handleRequest(request, response);
      });

      httpServer.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => {
          sockets.delete(socket);
        });
      });

      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.once("error", reject);
          httpServer.listen(requestedPort, hostname, () => resolve());
        });
      } catch (error) {
        listenPending = false;
        throw error;
      }

      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected OAuth test server to bind to a TCP port");
      }

      const port = (address as AddressInfo).port;
      const url = `http://${formatAuthorityHostname(hostname)}:${port}`;
      server = httpServer;
      listenPending = false;
      if (options.issuer === undefined) {
        runtimeIssuer = normalizeIssuer(url);
      }

      currentHandle = {
        url,
        port,
        close: async () => {
          if (server === null) {
            return;
          }

          const activeServer = server;
          await new Promise<void>((resolve, reject) => {
            activeServer.close((error) => {
              if (error !== undefined) {
                reject(error);
                return;
              }

              resolve();
            });

            for (const socket of sockets) {
              socket.destroy();
            }

            activeServer.closeIdleConnections?.();
            activeServer.closeAllConnections?.();
          });

          server = null;
          currentHandle = null;
          if (options.issuer === undefined) {
            runtimeIssuer = null;
          }
        },
      };

      return currentHandle;
    },

    async issueTokenFor(input: DirectTokenIssueOptions): Promise<string> {
      const issuer = getIssuer();
      const resource = parseAbsoluteUrl(input.resource, "resource");
      const ttlSeconds = input.ttlSeconds ?? defaultTokenTtlSeconds;
      if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error("ttlSeconds must be a positive integer");
      }
      const token = await issueAccessToken({
        issuer,
        clientId: input.clientId,
        resource,
        scopes: [...input.scopes],
        ttlSeconds,
      });

      return token;
    },

    setNextAuthorization(input: NextAuthorizationOptions): void {
      nextAuthorization = {
        autoApprove: input.autoApprove,
        scopes: input.scopes === undefined ? undefined : [...input.scopes],
      };
    },

    isTokenRevoked(token: string): boolean {
      return revokedTokens.has(token);
    },

    revoke(token: string): void {
      revokedTokens.add(token);
      const refresh = refreshTokens.get(token);
      if (refresh !== undefined) {
        refresh.revoked = true;
      }

      const access = accessTokens.get(token);
      if (access !== undefined) {
        access.revoked = true;
      }
    },
  };

  function normalizeIssuer(issuer: string): string {
    const normalized = parseAbsoluteUrl(issuer, "issuer");
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("issuer must use http or https");
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.hash = "";
    return url.pathname === "/" && url.search.length === 0 ? url.origin : url.toString();
  }

  function getIssuer(): string {
    if (runtimeIssuer === null) {
      throw new Error("issuer is not available until the server starts listening");
    }

    return runtimeIssuer;
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      const issuer = getIssuer();
      const serverUrl = currentHandle?.url ?? "http://127.0.0.1";
      const url = new URL(request.url ?? "/", serverUrl);
      const method = request.method ?? "GET";
      const paths = getEndpointPaths(issuer);
      const requestHeaders = readRequestHeaders(request);

      const appendRequestLog = (body?: string): void => {
        requestLog.push({
          method,
          url: url.toString(),
          headers: requestHeaders,
          ...(body === undefined ? {} : { body: sanitizeLoggedBody(body, requestHeaders) }),
        });
      };

      if (method === "GET" && paths.metadataPaths.includes(url.pathname)) {
        appendRequestLog();
        sendJson(response, 200, createMetadataDocument(issuer));
        return;
      }

      if (method === "GET" && paths.jwksPaths.includes(url.pathname)) {
        appendRequestLog();
        sendJson(response, 200, { keys: [signing.publicJwk] });
        return;
      }

      if (method === "POST" && paths.registerPaths.includes(url.pathname)) {
        const body = await readBody(request);
        appendRequestLog(body);
        requireJsonContentType(requestHeaders);
        const payload = parseJsonObjectBody(body);
        sendJson(response, 201, handleRegister(payload), {
          Location: paths.registerUrl,
        });
        return;
      }

      if (method === "GET" && paths.authorizePaths.includes(url.pathname)) {
        appendRequestLog();
        await handleAuthorize(url, response);
        return;
      }

      if (method === "POST" && paths.tokenPaths.includes(url.pathname)) {
        const body = await readBody(request);
        appendRequestLog(body);
        await handleToken(new URLSearchParams(body), response);
        return;
      }

      if (method === "POST" && paths.issueTokenPaths.includes(url.pathname)) {
        const body = await readBody(request);
        appendRequestLog(body);
        const payload = parseJsonObjectBody(body);
        sendJson(response, 200, await handleIssueToken(payload));
        return;
      }

      appendRequestLog();
      sendJson(response, 404, {
        error: "not_found",
        error_description: "endpoint not found",
      });
    } catch (error) {
      sendOAuthError(response, error instanceof Error ? error : new Error(String(error)));
    }
  }

  function createMetadataDocument(issuer: string): ObjectRecord {
    const paths = getEndpointPaths(issuer);

    return {
      issuer,
      authorization_endpoint: paths.authorizeUrl,
      token_endpoint: paths.tokenUrl,
      registration_endpoint: paths.registerUrl,
      jwks_uri: paths.jwksUrl,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    };
  }

  function handleRegister(payload: ObjectRecord): ObjectRecord {
    const redirectUrisValue = getOwnEntry(payload, "redirect_uris");
    const redirectUris = isStringArray(redirectUrisValue) ? redirectUrisValue : null;
    if (redirectUris === null || redirectUris.length === 0) {
      throw new OAuthRequestError(
        400,
        "invalid_redirect_uri",
        "redirect_uris must be a non-empty array"
      );
    }

    const normalizedRedirectUris = redirectUris.map((redirectUri) =>
      parseAbsoluteUrl(redirectUri, "redirect_uris[]")
    );
    if (normalizedRedirectUris.some((redirectUri) => !isLoopbackRedirectUri(redirectUri))) {
      throw new OAuthRequestError(
        400,
        "invalid_redirect_uri",
        "redirect_uris must use loopback HTTP origins"
      );
    }
    const grantTypes = normalizeRegistrationStringArray(
      getOwnEntry(payload, "grant_types"),
      "grant_types",
      ["authorization_code", "refresh_token"]
    );
    const responseTypes = normalizeRegistrationStringArray(
      getOwnEntry(payload, "response_types"),
      "response_types",
      ["code"]
    );
    const tokenEndpointAuthMethodValue = getOwnEntry(payload, "token_endpoint_auth_method");
    if (
      tokenEndpointAuthMethodValue !== undefined
      && typeof tokenEndpointAuthMethodValue !== "string"
    ) {
      throw new OAuthRequestError(
        400,
        "invalid_client_metadata",
        "token_endpoint_auth_method must be a string"
      );
    }
    const tokenEndpointAuthMethod =
      typeof tokenEndpointAuthMethodValue === "string" ? tokenEndpointAuthMethodValue : "none";
    if (tokenEndpointAuthMethod !== "none") {
      throw new OAuthRequestError(
        400,
        "invalid_client_metadata",
        `token_endpoint_auth_method ${tokenEndpointAuthMethod} is not supported`
      );
    }

    for (const grantType of grantTypes) {
      if (grantType !== "authorization_code" && grantType !== "refresh_token") {
        throw new OAuthRequestError(
          400,
          "invalid_client_metadata",
          `grant_types ${grantType} is not supported`
        );
      }
    }

    for (const responseType of responseTypes) {
      if (responseType !== "code") {
        throw new OAuthRequestError(
          400,
          "invalid_client_metadata",
          `response_types ${responseType} is not supported`
        );
      }
    }

    const scopeValue = getOwnEntry(payload, "scope");
    if (scopeValue !== undefined && typeof scopeValue !== "string") {
      throw new OAuthRequestError(400, "invalid_client_metadata", "scope must be a string");
    }
    const scope = scopeValue === undefined ? undefined : parseScope(scopeValue);
    const rawClientName = getOwnString(payload, "client_name");
    const rawSoftwareId = getOwnString(payload, "software_id");
    const rawSoftwareVersion = getOwnString(payload, "software_version");
    const clientName =
      rawClientName !== undefined && rawClientName.length > 0 ? rawClientName : undefined;
    const softwareId =
      rawSoftwareId !== undefined && rawSoftwareId.length > 0 ? rawSoftwareId : undefined;
    const softwareVersion =
      rawSoftwareVersion !== undefined && rawSoftwareVersion.length > 0
        ? rawSoftwareVersion
        : undefined;
    const clientId = `client_${nextClientId.toString().padStart(6, "0")}`;
    const clientIdIssuedAt = nowInSeconds();
    nextClientId += 1;

    registeredClients.set(clientId, {
      clientId,
      redirectUris: normalizedRedirectUris,
      scopes: scope,
      grantTypes,
      metadata: {
        ...(clientName === undefined ? {} : { client_name: clientName }),
        ...(scope === undefined ? {} : { scope: formatScope(scope) }),
        ...(softwareId === undefined ? {} : { software_id: softwareId }),
        ...(softwareVersion === undefined ? {} : { software_version: softwareVersion }),
      },
    });

    return {
      client_id: clientId,
      client_id_issued_at: clientIdIssuedAt,
      ...(clientName === undefined ? {} : { client_name: clientName }),
      redirect_uris: normalizedRedirectUris,
      ...(scope === undefined ? {} : { scope: formatScope(scope) }),
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      grant_types: grantTypes,
      response_types: responseTypes,
      ...(softwareId === undefined ? {} : { software_id: softwareId }),
      ...(softwareVersion === undefined ? {} : { software_version: softwareVersion }),
    };
  }

  async function handleAuthorize(
    url: URL,
    response: ServerResponse
  ): Promise<void> {
    const clientId = requireParam(url.searchParams, "client_id");
    const redirectUri = parseAbsoluteUrl(
      requireParam(url.searchParams, "redirect_uri"),
      "redirect_uri"
    );
    const responseType = requireParam(url.searchParams, "response_type");
    const codeChallenge = requireParam(url.searchParams, "code_challenge");
    const codeChallengeMethod = requireParam(url.searchParams, "code_challenge_method");
    const resource = parseAbsoluteUrl(requireParam(url.searchParams, "resource"), "resource");
    const state = readSingleParam(url.searchParams, "state");
    const requestedScopes = parseScope(readSingleParam(url.searchParams, "scope"));
    const client = resolveClientForAuthorization(clientId, redirectUri);

    if (!isLoopbackRedirectUri(redirectUri)) {
      throw new OAuthRequestError(
        400,
        "invalid_request",
        "redirect_uri must use a loopback HTTP origin"
      );
    }

    if (responseType !== "code") {
      throw new OAuthRequestError(
        400,
        "unsupported_response_type",
        "response_type must be code"
      );
    }

    if (codeChallengeMethod !== "S256") {
      throw new OAuthRequestError(
        400,
        "invalid_request",
        "code_challenge_method must be S256"
      );
    }

    if (!isValidPkceChallenge(codeChallenge)) {
      throw new OAuthRequestError(
        400,
        "invalid_request",
        "code_challenge must be a valid S256 value"
      );
    }

    assertAllowedScopes(requestedScopes, client);

    const decision = nextAuthorization ?? defaultAuthorization;
    const approvalToken = readSingleParam(url.searchParams, "approval_token");
    const autoApprove =
      decision.autoApprove || (approvalToken !== null && consentApprovals.delete(approvalToken));
    const grantedScopes = decision.scopes === undefined ? requestedScopes : [...decision.scopes];
    assertAllowedScopes(grantedScopes, client);

    if (!autoApprove) {
      sendHtml(response, 200, renderConsentPage(url, clientId, resource, grantedScopes));
      return;
    }

    nextAuthorization = null;

    const code = createRandomToken();
    authorizationCodes.set(code, {
      clientId,
      redirectUri,
      resource,
      scopes: grantedScopes,
      codeChallenge,
      issueRefreshToken: client.grantTypes.includes("refresh_token"),
      expiresAt: nowInSeconds() + 300,
      used: false,
    });

    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("code", code);
    if (state !== null) {
      callbackUrl.searchParams.set("state", state);
    }
    callbackUrl.searchParams.set("iss", getIssuer());

    sendRedirect(response, callbackUrl.toString());
  }

  function renderConsentPage(
    url: URL,
    clientId: string,
    resource: string,
    scopes: readonly string[]
  ): string {
    const approvalToken = createRandomToken();
    consentApprovals.add(approvalToken);
    const approvalUrl = withUpdatedSearchParam(url, "approval_token", approvalToken);
    const scopeSummary = formatScope(scopes) ?? "(no scopes requested)";

    return [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<meta charset="utf-8">',
      "<title>Tiny OAuth Test Server</title>",
      "</head>",
      "<body>",
      "<main>",
      "<h1>Authorize test client</h1>",
      `<p><strong>Client:</strong> ${escapeHtml(clientId)}</p>`,
      `<p><strong>Resource:</strong> ${escapeHtml(resource)}</p>`,
      `<p><strong>Scopes:</strong> ${escapeHtml(scopeSummary)}</p>`,
      `<p><a href="${escapeHtml(approvalUrl)}">Approve</a></p>`,
      "</main>",
      "</body>",
      "</html>",
    ].join("");
  }

  function resolveClientForAuthorization(
    clientId: string,
    redirectUri: string
  ): StoredClient {
    const client = staticClients.get(clientId) ?? registeredClients.get(clientId);
    if (client !== undefined) {
      if (!client.redirectUris.some((candidate) => matchesRegisteredRedirectUri(candidate, redirectUri))) {
        throw new OAuthRequestError(
          400,
          "invalid_request",
          "redirect_uri must exactly match a registered redirect URI"
        );
      }

      return client;
    }

    if (requireDcr) {
      throw new OAuthRequestError(
        400,
        "unauthorized_client",
        "client_id must be registered before authorization"
      );
    }

    return {
      clientId,
      redirectUris: [redirectUri],
      grantTypes: ["authorization_code", "refresh_token"],
      metadata: {},
    };
  }

  async function handleToken(
    body: URLSearchParams,
    response: ServerResponse
  ): Promise<void> {
    const grantType = requireParam(body, "grant_type");

    if (grantType === "authorization_code") {
      sendJson(response, 200, await exchangeCode(body));
      return;
    }

    if (grantType === "refresh_token") {
      sendJson(response, 200, await rotateRefreshToken(body));
      return;
    }

    throw new OAuthRequestError(
      400,
      "unsupported_grant_type",
      `grant_type ${grantType} is not supported`
    );
  }

  async function handleIssueToken(payload: ObjectRecord): Promise<ObjectRecord> {
    const clientId = getOwnEntry(payload, "client_id");
    const resource = getOwnEntry(payload, "resource");
    const ttlSeconds = getOwnEntry(payload, "ttl_seconds");
    const scopes = getOwnEntry(payload, "scopes");

    if (typeof clientId !== "string" || clientId.length === 0) {
      throw new OAuthRequestError(400, "invalid_request", "client_id is required");
    }

    if (typeof resource !== "string" || resource.length === 0) {
      throw new OAuthRequestError(400, "invalid_request", "resource is required");
    }

    if (scopes !== undefined && typeof scopes !== "string" && !isStringArray(scopes)) {
      throw new OAuthRequestError(400, "invalid_request", "scopes must be a string or array");
    }
    const parsedScopes = typeof scopes === "string" ? parseScope(scopes) : scopes ?? [];
    if (
      ttlSeconds !== undefined
      && (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0)
    ) {
      throw new OAuthRequestError(
        400,
        "invalid_request",
        "ttl_seconds must be a positive integer"
      );
    }
    const parsedTtlSeconds = typeof ttlSeconds === "number" ? ttlSeconds : defaultTokenTtlSeconds;

    const accessToken = await issueAccessToken({
      issuer: getIssuer(),
      clientId,
      resource: parseAbsoluteUrl(resource, "resource"),
      scopes: parsedScopes,
      ttlSeconds: parsedTtlSeconds,
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: parsedTtlSeconds,
      ...(parsedScopes.length === 0 ? {} : { scope: parsedScopes.join(" ") }),
    };
  }

  async function exchangeCode(body: URLSearchParams): Promise<ObjectRecord> {
    const code = requireParam(body, "code");
    const clientId = requireParam(body, "client_id");
    const codeVerifier = requireParam(body, "code_verifier");
    const redirectUri = parseAbsoluteUrl(
      requireParam(body, "redirect_uri"),
      "redirect_uri"
    );
    const resource = parseAbsoluteUrl(requireParam(body, "resource"), "resource");
    const record = authorizationCodes.get(code);

    if (record === undefined || record.used) {
      throw new OAuthRequestError(400, "invalid_grant", "authorization code is invalid");
    }

    if (isExpired(record.expiresAt)) {
      authorizationCodes.delete(code);
      throw new OAuthRequestError(400, "invalid_grant", "authorization code has expired");
    }

    if (record.clientId !== clientId) {
      throw new OAuthRequestError(400, "invalid_grant", "client_id does not match the code");
    }

    if (record.redirectUri !== redirectUri) {
      throw new OAuthRequestError(
        400,
        "invalid_grant",
        "redirect_uri does not match the code"
      );
    }

    if (record.resource !== resource) {
      throw new OAuthRequestError(400, "invalid_grant", "resource does not match the code");
    }

    if (!isValidPkceVerifier(codeVerifier)) {
      throw new OAuthRequestError(
        400,
        "invalid_grant",
        "PKCE verifier must be 43-128 unreserved characters"
      );
    }

    if (usedCodeVerifiers.has(codeVerifier)) {
      throw new OAuthRequestError(400, "invalid_grant", "PKCE verifier has already been used");
    }

    const actualChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    if (actualChallenge !== record.codeChallenge) {
      throw new OAuthRequestError(400, "invalid_grant", "PKCE verifier mismatch");
    }

    record.used = true;
    authorizationCodes.delete(code);
    usedCodeVerifiers.add(codeVerifier);

    return createTokenResponse({
      clientId,
      resource,
      scopes: record.scopes,
      ttlSeconds: defaultTokenTtlSeconds,
      issueRefreshToken: record.issueRefreshToken,
    });
  }

  async function rotateRefreshToken(body: URLSearchParams): Promise<ObjectRecord> {
    const refreshToken = requireParam(body, "refresh_token");
    const clientId = requireParam(body, "client_id");
    const resource = parseAbsoluteUrl(requireParam(body, "resource"), "resource");
    const record = refreshTokens.get(refreshToken);

    if (record === undefined || record.used || record.revoked || revokedTokens.has(refreshToken)) {
      throw new OAuthRequestError(400, "invalid_grant", "refresh token is invalid");
    }

    if (isExpired(record.expiresAt)) {
      refreshTokens.delete(refreshToken);
      throw new OAuthRequestError(400, "invalid_grant", "refresh token has expired");
    }

    if (record.clientId !== clientId) {
      throw new OAuthRequestError(400, "invalid_grant", "client_id does not match");
    }

    if (record.resource !== resource) {
      throw new OAuthRequestError(400, "invalid_grant", "resource does not match");
    }

    record.used = true;
    refreshTokens.delete(refreshToken);

    return createTokenResponse({
      clientId,
      resource,
      scopes: record.scopes,
      ttlSeconds: defaultTokenTtlSeconds,
      issueRefreshToken: true,
    });
  }

  function isExpired(expiresAt: number): boolean {
    return nowInSeconds() >= expiresAt + clockSkewSeconds;
  }

  async function createTokenResponse(input: {
    clientId: string;
    resource: string;
    scopes: string[];
    ttlSeconds: number;
    issueRefreshToken: boolean;
  }): Promise<ObjectRecord> {
    const accessToken = await issueAccessToken({
      issuer: getIssuer(),
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      ttlSeconds: input.ttlSeconds,
    });
    const refreshToken = input.issueRefreshToken ? createRandomToken() : undefined;
    if (refreshToken !== undefined) {
      refreshTokens.set(refreshToken, {
        clientId: input.clientId,
        resource: input.resource,
        scopes: [...input.scopes],
        expiresAt: nowInSeconds() + 3_600,
        used: false,
        revoked: false,
      });
    }

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: input.ttlSeconds,
      ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
      ...(input.scopes.length === 0 ? {} : { scope: input.scopes.join(" ") }),
    };
  }

  async function issueAccessToken(input: {
    issuer: string;
    clientId: string;
    resource: string;
    scopes: string[];
    ttlSeconds: number;
  }): Promise<string> {
    const issuedAt = nowInSeconds();
    const expiresAt = issuedAt + input.ttlSeconds;
    const token = await new SignJWT({
      client_id: input.clientId,
      scope: input.scopes.join(" "),
    })
      .setProtectedHeader({
        alg: signing.alg,
        kid: signing.kid,
        typ: "JWT",
      })
      .setIssuer(input.issuer)
      .setAudience(input.resource)
      .setSubject(input.clientId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(createRandomToken())
      .sign(signing.privateKey);

    accessTokens.set(token, {
      token,
      clientId: input.clientId,
      resource: input.resource,
      scopes: [...input.scopes],
      expiresAt,
      revoked: false,
    });

    return token;
  }
}
