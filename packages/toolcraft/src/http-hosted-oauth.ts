import { createHash, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { exportJWK, type JWK } from "jose";
import {
  createAuthorizationInteractionSecurity,
  createInMemoryAuthorizationServerStore,
  createOAuthAuthorizationServer,
  verifyAuthorizationInteractionCsrf,
  type AuthorizationServerStore,
  type AuthorizationTransactionRecord,
  type OAuthAuthorizationServerSigningKey
} from "mcp-oauth-server";
import type {
  HttpAdditionalRequestHandler,
  TinyHttpMcpServerOAuthOptions
} from "tiny-http-mcp-server/server";

export type HostedOAuthLoginFieldName = "email" | "password" | "apiKey" | (string & {});

export interface HostedOAuthLoginField {
  name: HostedOAuthLoginFieldName;
  label?: string;
  type?: "text" | "email" | "password";
}

export interface HostedOAuthCredentialStore<TCredential = unknown> {
  get(subject: string): Promise<TCredential | undefined>;
  set(subject: string, credential: TCredential): Promise<void>;
  delete(subject: string): Promise<void>;
  update(
    subject: string,
    update: (credential: TCredential) => Promise<TCredential> | TCredential
  ): Promise<TCredential>;
}

export interface HostedOAuthStorageCapabilities {
  durable: boolean;
  encryptedCredentials: boolean;
  stableKeys: boolean;
  shared: boolean;
}

export interface HostedOAuthInteractionStore {
  set(transaction: AuthorizationTransactionRecord): Promise<void>;
  get(transactionId: string): Promise<AuthorizationTransactionRecord | undefined>;
  delete(transactionId: string): Promise<void>;
}

export interface HostedOAuthStorage<TCredential = unknown> {
  authorizationServer: AuthorizationServerStore;
  interactions: HostedOAuthInteractionStore;
  credentials: HostedOAuthCredentialStore<TCredential>;
  capabilities: HostedOAuthStorageCapabilities;
  signingKey(): Promise<OAuthAuthorizationServerSigningKey>;
  resolveSubject(providerName: string, accountId: string): Promise<string>;
  cleanup?(now?: number): Promise<void>;
}

export interface HostedOAuthCredentialAccess<TCredential = unknown> {
  read(): Promise<TCredential>;
  update(
    update: (credential: TCredential) => Promise<TCredential> | TCredential
  ): Promise<TCredential>;
  delete(): Promise<void>;
}

export interface HostedOAuthIdentity {
  issuer: string;
  subject: string;
  clientId: string;
  scopes: readonly string[];
  resource: string;
}

export interface HostedOAuthProvider<TCredential = unknown, TServices extends object = object> {
  name: string;
  login?: {
    fields: readonly (HostedOAuthLoginFieldName | HostedOAuthLoginField)[];
  };
  connect?(
    fields: Readonly<Record<string, string>> & { signal: AbortSignal }
  ): Promise<{ accountId: string; credential: TCredential }>;
  services(input: {
    credentials: HostedOAuthCredentialAccess<TCredential>;
    identity: HostedOAuthIdentity;
  }): Promise<Partial<TServices>> | Partial<TServices>;
}

export interface HostedOAuthInteractionAdapter<TCredential = unknown> {
  paths: readonly string[];
  start(context: {
    request: Request;
    transaction: AuthorizationTransactionRecord;
  }): Promise<Response> | Response;
  handle(context: {
    request: Request;
    complete(input: {
      transactionId: string;
      accountId: string;
      credential: TCredential;
    }): Promise<Response>;
  }): Promise<Response> | Response;
}

export interface HostedOAuthAdvancedOptions<TCredential = unknown> {
  scopes?: readonly string[];
  branding?: {
    title?: string;
  };
  accessTokenTtlSeconds?: number;
  authorizationCodeTtlSeconds?: number;
  authorizationTransactionTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  additionalPublicJwks?: readonly JWK[];
  interaction?: HostedOAuthInteractionAdapter<TCredential>;
}

export interface HostedOAuthOptions<TCredential = unknown, TServices extends object = object> {
  publicUrl: string;
  storage: HostedOAuthStorage<TCredential>;
  provider: HostedOAuthProvider<TCredential, TServices>;
  advanced?: HostedOAuthAdvancedOptions<TCredential>;
}

export interface PreparedHostedOAuth {
  publicUrl: URL;
  issuer: URL;
  scopes: readonly string[];
}

export interface HostedOAuthConfiguration<
  TCredential = unknown,
  TServices extends object = object
> extends HostedOAuthOptions<TCredential, TServices> {
  readonly kind: "hosted";
  prepare(options?: { production?: boolean }): Promise<PreparedHostedOAuth>;
}

export function isHostedOAuthConfiguration(
  value: unknown
): value is HostedOAuthConfiguration<unknown, object> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "hosted";
}

function normalizePublicUrl(value: string): URL {
  const url = new URL(value);
  if (url.hash.length > 0 || url.search.length > 0) {
    throw new Error("hosted OAuth publicUrl must not contain a query or fragment.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("hosted OAuth publicUrl must not contain credentials.");
  }
  if (url.pathname === "/" || url.pathname.endsWith("/")) {
    throw new Error(
      "hosted OAuth publicUrl must contain a non-root path without a trailing slash."
    );
  }
  return url;
}

function configurationErrors(config: HostedOAuthConfiguration, production: boolean): string[] {
  const errors: string[] = [];
  const scopes = config.advanced?.scopes ?? ["mcp", "offline_access"];
  if (!scopes.includes("mcp")) errors.push("scopes containing required mcp scope");
  if (scopes.some((scope) => scope.length === 0 || scope.trim() !== scope || scope.includes(" "))) {
    errors.push("valid space-free scope names");
  }
  if (production) {
    if (normalizePublicUrl(config.publicUrl).protocol !== "https:") errors.push("HTTPS publicUrl");
    if (!config.storage.capabilities.durable) errors.push("durable storage");
    if (!config.storage.capabilities.encryptedCredentials) errors.push("encrypted credentials");
    if (!config.storage.capabilities.stableKeys) errors.push("stable signing and subject keys");
  }
  return errors;
}

export function hostedOAuth<TCredential = unknown, TServices extends object = object>(
  options: HostedOAuthOptions<TCredential, TServices>
): HostedOAuthConfiguration<TCredential, TServices> {
  if (options.provider.name.trim().length === 0) throw new Error("provider.name is required.");
  if (
    options.advanced?.interaction === undefined &&
    (options.provider.login === undefined || options.provider.connect === undefined)
  ) {
    throw new Error(
      "provider.login and provider.connect are required without an advanced interaction."
    );
  }
  if (options.provider.login !== undefined && options.provider.login.fields.length === 0) {
    throw new Error("provider.login.fields must contain at least one field.");
  }
  const fieldNames = (options.provider.login?.fields ?? []).map((field) =>
    typeof field === "string" ? field : field.name
  );
  if (
    new Set(fieldNames).size !== fieldNames.length ||
    fieldNames.some(
      (name) => name.length === 0 || name === "signal" || name === "csrf" || name === "transaction"
    )
  ) {
    throw new Error("provider.login.fields must have unique, non-reserved names.");
  }
  if (
    options.advanced?.interaction !== undefined &&
    (options.advanced.interaction.paths.length === 0 ||
      new Set(options.advanced.interaction.paths).size !==
        options.advanced.interaction.paths.length ||
      options.advanced.interaction.paths.some(
        (path) =>
          !path.startsWith("/") ||
          [
            "/healthz",
            "/oauth/connect",
            "/authorize",
            "/register",
            "/token",
            "/revoke",
            "/.well-known/oauth-authorization-server",
            "/.well-known/jwks.json",
            normalizePublicUrl(options.publicUrl).pathname
          ].includes(path)
      ))
  ) {
    throw new Error("advanced.interaction.paths must contain unique, non-reserved absolute paths.");
  }
  normalizePublicUrl(options.publicUrl);
  return {
    ...options,
    kind: "hosted",
    async prepare({ production = process.env.NODE_ENV === "production" } = {}) {
      const errors = configurationErrors(this, production);
      if (errors.length > 0) {
        throw new Error(`Hosted OAuth configuration requires: ${errors.join(", ")}.`);
      }
      const publicUrl = normalizePublicUrl(this.publicUrl);
      return {
        publicUrl,
        issuer: new URL(publicUrl.origin),
        scopes: this.advanced?.scopes ?? ["mcp", "offline_access"]
      };
    }
  };
}

export class HostedOAuthLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedOAuthLoginError";
  }
}

export interface HostedOAuthRuntime<TServices extends object = object> {
  mcpPath: string;
  oauth: TinyHttpMcpServerOAuthOptions;
  requestHandler: HttpAdditionalRequestHandler;
  requestServices(identity: HostedOAuthIdentity): Promise<Partial<TServices>>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loginField(
  field: HostedOAuthLoginFieldName | HostedOAuthLoginField
): HostedOAuthLoginField {
  if (typeof field !== "string") return field;
  return {
    name: field,
    label: field === "apiKey" ? "API key" : `${field[0]?.toUpperCase() ?? ""}${field.slice(1)}`,
    type:
      field === "password" || field === "apiKey" ? "password" : field === "email" ? "email" : "text"
  };
}

function renderLogin(
  providerName: string,
  fields: readonly HostedOAuthLoginField[],
  transaction: AuthorizationTransactionRecord,
  csrfToken: string,
  error?: string
): string {
  const controls = fields
    .map((field) => {
      const name = escapeHtml(field.name);
      return `<label>${escapeHtml(field.label ?? field.name)}<input name="${name}" type="${field.type ?? "text"}" required autocomplete="${field.type === "password" ? "current-password" : "off"}"></label>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ${escapeHtml(providerName)}</title><style>body{font:16px system-ui;max-width:28rem;margin:10vh auto;padding:1rem;color:#171717}form{display:grid;gap:1rem}label{display:grid;gap:.35rem}input,button{font:inherit;padding:.7rem}button{cursor:pointer}${error === undefined ? "" : ".error{color:#b42318}"}</style></head><body><h1>Connect ${escapeHtml(providerName)}</h1>${error === undefined ? "" : `<p class="error">${escapeHtml(error)}</p>`}<form method="post" action="/oauth/connect"><input type="hidden" name="transaction" value="${escapeHtml(transaction.id)}"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">${controls}<button type="submit">Connect</button></form></body></html>`;
}

function loginContentSecurityPolicy(transaction: AuthorizationTransactionRecord): string {
  const callbackOrigin = new URL(transaction.redirectUri).origin;
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}; base-uri 'none'; frame-ancestors 'none'`;
}

function interactionCookieName(transactionId: string): string {
  const suffix = createHash("sha256").update(transactionId).digest("base64url").slice(0, 22);
  return `__Host-mcp_oauth_csrf_${suffix}`;
}

function writeWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.statusCode = webResponse.status;
  return webResponse.arrayBuffer().then((body) => {
    response.end(Buffer.from(body));
  });
}

async function readBody(request: IncomingMessage, maxBytes = 65_536): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function toWebRequest(request: IncomingMessage, issuer: URL, body?: Buffer): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(new URL(request.url ?? "/", issuer), {
    method: request.method,
    headers,
    ...(body !== undefined && body.length > 0 ? { body: body.toString("utf8") } : {})
  });
}

function credentialsFor<TCredential>(
  storage: HostedOAuthStorage<TCredential>,
  subject: string
): HostedOAuthCredentialAccess<TCredential> {
  return {
    async read() {
      const credential = await storage.credentials.get(subject);
      if (credential === undefined)
        throw new Error("Provider credential is missing; reconnect required.");
      return credential;
    },
    update: (update) => storage.credentials.update(subject, update),
    delete: () => storage.credentials.delete(subject)
  };
}

/** @internal */
export async function prepareHostedOAuthRuntime<TCredential, TServices extends object>(
  config: HostedOAuthConfiguration<TCredential, TServices>
): Promise<HostedOAuthRuntime<TServices>> {
  const prepared = await config.prepare();
  const fields = (config.provider.login?.fields ?? []).map(loginField);
  const customInteraction = config.advanced?.interaction;
  const displayName = config.advanced?.branding?.title ?? config.provider.name;
  const interaction = {
    async start({
      request,
      transaction
    }: {
      request: Request;
      transaction: AuthorizationTransactionRecord;
    }) {
      await config.storage.interactions.set(transaction);
      if (customInteraction !== undefined) {
        return customInteraction.start({ request, transaction });
      }
      const security = createAuthorizationInteractionSecurity({
        cookieName: interactionCookieName(transaction.id)
      });
      return new Response(renderLogin(displayName, fields, transaction, security.csrfToken), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": loginContentSecurityPolicy(transaction),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "set-cookie": security.setCookie
        }
      });
    }
  };
  await config.storage.cleanup?.();
  const authorizationServer = createOAuthAuthorizationServer({
    issuer: prepared.issuer.href,
    resources: [prepared.publicUrl.href],
    scopesSupported: prepared.scopes,
    defaultScopes: prepared.scopes,
    signingKey: await config.storage.signingKey(),
    additionalPublicJwks: config.advanced?.additionalPublicJwks,
    store: config.storage.authorizationServer,
    interaction,
    accessTokenTtlSeconds: config.advanced?.accessTokenTtlSeconds,
    authorizationCodeTtlSeconds: config.advanced?.authorizationCodeTtlSeconds,
    authorizationTransactionTtlSeconds: config.advanced?.authorizationTransactionTtlSeconds,
    refreshTokenTtlSeconds: config.advanced?.refreshTokenTtlSeconds
  });

  const requestHandler: HttpAdditionalRequestHandler = async (request, response) => {
    const url = new URL(request.url ?? "/", prepared.issuer);
    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end('{"ok":true}');
      return true;
    }
    if (customInteraction?.paths.includes(url.pathname) === true) {
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
      const handled = await customInteraction.handle({
        request: toWebRequest(request, prepared.issuer, body),
        async complete({ transactionId, accountId, credential }) {
          const subject = await config.storage.resolveSubject(config.provider.name, accountId);
          const completed = await authorizationServer.completeAuthorization({
            transactionId,
            subject
          });
          await config.storage.credentials.set(subject, credential);
          await config.storage.interactions.delete(transactionId);
          return new Response(null, {
            status: 303,
            headers: {
              location: completed.redirectUrl.href,
              "cache-control": "no-store",
              "content-security-policy": "default-src 'none'",
              "referrer-policy": "no-referrer"
            }
          });
        }
      });
      await writeWebResponse(response, handled);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/oauth/connect") {
      const body = new URLSearchParams((await readBody(request)).toString("utf8"));
      const transactionId = body.get("transaction") ?? "";
      const transaction = await config.storage.interactions.get(transactionId);
      const csrf = body.get("csrf") ?? "";
      if (
        transaction === undefined ||
        !verifyAuthorizationInteractionCsrf({
          cookieHeader: request.headers.cookie ?? null,
          submittedToken: csrf,
          cookieName: interactionCookieName(transactionId)
        }) ||
        transaction.expiresAt <= Date.now()
      ) {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end("This connection has expired or was already used. Restart the connection.");
        return true;
      }
      const controller = new AbortController();
      request.once("aborted", () => controller.abort());
      const values = Object.assign(Object.create(null) as Record<string, string>, {
        signal: controller.signal
      }) as Record<string, string> & { signal: AbortSignal };
      for (const field of fields) values[field.name] = body.get(field.name) ?? "";
      try {
        const connect = config.provider.connect;
        if (connect === undefined) throw new Error("Provider form connection is not configured.");
        const connected = await connect(values);
        if (connected.accountId.trim().length === 0)
          throw new Error("Provider returned an empty accountId.");
        const subject = await config.storage.resolveSubject(
          config.provider.name,
          connected.accountId
        );
        const completed = await authorizationServer.completeAuthorization({
          transactionId,
          subject
        });
        await config.storage.credentials.set(subject, connected.credential);
        await config.storage.interactions.delete(transactionId);
        response.writeHead(303, {
          location: completed.redirectUrl.href,
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'",
          "referrer-policy": "no-referrer"
        });
        response.end();
      } catch (error) {
        const safeError =
          error instanceof HostedOAuthLoginError
            ? error.message
            : "Sign-in failed. Please try again.";
        response.writeHead(400, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": loginContentSecurityPolicy(transaction),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer"
        });
        response.end(renderLogin(displayName, fields, transaction, csrf, safeError));
      }
      return true;
    }
    const oauthPaths = new Set([
      "/.well-known/oauth-authorization-server",
      "/.well-known/jwks.json",
      "/authorize",
      "/register",
      "/token",
      "/revoke"
    ]);
    if (!oauthPaths.has(url.pathname)) return false;
    const body = request.method === "POST" ? await readBody(request) : undefined;
    await writeWebResponse(
      response,
      await authorizationServer.handle(toWebRequest(request, prepared.issuer, body))
    );
    return true;
  };

  return {
    mcpPath: prepared.publicUrl.pathname,
    oauth: {
      resource: prepared.publicUrl.href,
      authorizationServers: [authorizationServer.issuer],
      requiredScopes: ["mcp"],
      scopesSupported: [...prepared.scopes],
      verifier: {
        async verify(input) {
          const verified = await authorizationServer.verifyAccessToken(
            input.token,
            prepared.publicUrl.href
          );
          return {
            token: input.token,
            issuer: authorizationServer.issuer,
            audience: [verified.resource],
            scopes: [...verified.scopes],
            expiresAt: verified.expiresAt,
            claims: { sub: verified.subject, client_id: verified.clientId, jti: verified.tokenId },
            subject: verified.subject,
            clientId: verified.clientId
          };
        }
      }
    },
    requestHandler,
    async requestServices(identity) {
      const credentials = credentialsFor(config.storage, identity.subject);
      await credentials.read();
      return config.provider.services({ credentials, identity });
    }
  };
}

export function createInMemoryHostedOAuthStorage<TCredential = unknown>(options: {
  development: true;
}): HostedOAuthStorage<TCredential> {
  if (options.development !== true) {
    throw new Error("In-memory hosted OAuth storage requires explicit development mode.");
  }
  const credentials = new Map<string, TCredential>();
  const interactions = new Map<string, AuthorizationTransactionRecord>();
  const updates = new Map<string, Promise<unknown>>();
  const subjectSalt = randomBytes(32);
  let signingKeyPromise: Promise<OAuthAuthorizationServerSigningKey> | undefined;

  return {
    authorizationServer: createInMemoryAuthorizationServerStore(),
    interactions: {
      async set(transaction) {
        interactions.set(transaction.id, structuredClone(transaction));
      },
      async get(transactionId) {
        const transaction = interactions.get(transactionId);
        return transaction === undefined ? undefined : structuredClone(transaction);
      },
      async delete(transactionId) {
        interactions.delete(transactionId);
      }
    },
    capabilities: {
      durable: false,
      encryptedCredentials: false,
      stableKeys: false,
      shared: false
    },
    credentials: {
      async get(subject) {
        return credentials.get(subject);
      },
      async set(subject, credential) {
        credentials.set(subject, credential);
      },
      async delete(subject) {
        credentials.delete(subject);
      },
      async update(subject, update) {
        const previous = updates.get(subject) ?? Promise.resolve();
        const next = previous.then(async () => {
          const current = credentials.get(subject);
          if (current === undefined)
            throw new Error("Provider credential is missing; reconnect required.");
          const replacement = await update(current);
          credentials.set(subject, replacement);
          return replacement;
        });
        updates.set(subject, next);
        try {
          return await next;
        } finally {
          if (updates.get(subject) === next) updates.delete(subject);
        }
      }
    },
    async signingKey() {
      signingKeyPromise ??= (async () => {
        const { privateKey, publicKey } = generateKeyPairSync("ec", {
          namedCurve: "prime256v1"
        });
        return {
          algorithm: "ES256" as const,
          keyId: randomBytes(16).toString("base64url"),
          privateKey,
          publicJwk: await exportJWK(publicKey)
        };
      })();
      return await signingKeyPromise;
    },
    async resolveSubject(providerName, accountId) {
      return createHmac("sha256", subjectSalt)
        .update(providerName)
        .update("\0")
        .update(accountId)
        .digest("base64url");
    }
  };
}
