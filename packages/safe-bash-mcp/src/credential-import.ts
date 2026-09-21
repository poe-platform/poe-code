import { createResourceBoundOAuthStores, normalizeOAuthScope, normalizeStoredOAuthClient, parseOAuthClientRegistration, parseOAuthTokenGrant,
  type OAuthTokenGrantImportOptions, type StoredOAuthSession } from "mcp-oauth";
import { discoverOAuthMetadata } from "tiny-mcp-client";
import { isJsonValue } from "toolcraft-schema";
import { credentialEnvironmentReader } from "./credential-environment.js";
import { parseArgumentJson } from "./json-input.js";
import { parseRemoteMcpConfiguration, type ConfigurationOptions, type RemoteMcpServerConfiguration } from "./configuration.js";
import type { ConfigurationBindingOptions } from "./runtime-configuration.js";
import type { SchemaFetchOptions } from "./schema.js";

export interface RemoteMcpCredentialImportOptions extends ConfigurationOptions {
  readonly binding?: ConfigurationBindingOptions;
  readonly signal?: AbortSignal;
  readonly fetch?: SchemaFetchOptions["fetch"];
  readonly oauthDiscoveryCache?: SchemaFetchOptions["oauthDiscoveryCache"];
  /** Bounds discovery and the complete persistence operation. Default 30000. */
  readonly requestTimeoutMs?: number;
  /** Maximum native transaction lock wait. Default 30000. */
  readonly timeoutMs?: number;
  readonly maxImportBytes?: number;
}
export interface RemoteMcpCredentialImportResult {
  readonly name: string;
  readonly url: string;
  readonly imported: true;
}

/** Install a raw token response with its original app under validated discovery. */
export async function importRemoteMcpAuthentication(
  value: RemoteMcpServerConfiguration,
  payload: unknown,
  options: RemoteMcpCredentialImportOptions = {}
): Promise<RemoteMcpCredentialImportResult> {
  options = { ...options };
  options.signal?.throwIfAborted();
  const [server] = parseRemoteMcpConfiguration({ version: 1, servers: [value] }, options).servers;
  if (server.auth?.type !== "oauth") throw new Error("Credential import requires managed OAuth");
  const binding = options.binding ?? { env: {} }, oauth = binding.oauth;
  const importSession = oauth?.importSession;
  if (oauth?.sessionStore !== undefined && importSession === undefined)
    throw new Error("Host-owned OAuth persistence requires an explicit atomic import hook");
  const timeoutMs = options.timeoutMs ?? oauth?.sessionLockTimeoutMs ?? 30_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  for (const [name, duration] of [["timeoutMs", timeoutMs], ["requestTimeoutMs", requestTimeoutMs]] as const)
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 2_147_483_647) throw new Error(`${name} must be a positive supported timer interval`);
  const maxBytes = options.maxImportBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxImportBytes must be a positive safe integer");
  let input: Record<string, unknown>;
  try {
    if (typeof payload === "string") {
      if (Buffer.byteLength(payload, "utf8") > maxBytes) throw new Error("Limit");
      payload = parseArgumentJson(payload);
    }
    if (!isJsonValue(payload, { maxNodes: maxBytes, maxDepth: 64 }) || Buffer.byteLength(JSON.stringify(payload), "utf8") > maxBytes ||
      typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("Invalid JSON");
    input = structuredClone(payload) as Record<string, unknown>;
    if (!Object.hasOwn(input, "tokens") || Object.keys(input).some(key => !["tokens", "clientInfo", "issuedAt", "issuer"].includes(key)) ||
      (Object.hasOwn(input, "issuer") && (typeof input.issuer !== "string" || input.issuer === ""))) throw new Error("Invalid shape");
  } catch { throw new Error("Invalid OAuth credential import payload"); }
  const tokens = parseOAuthTokenGrant(input.tokens, { now: oauth?.now, issuedAt: input.issuedAt as OAuthTokenGrantImportOptions["issuedAt"] });
  const registration = Object.hasOwn(input, "clientInfo") ? parseOAuthClientRegistration(input.clientInfo) : undefined;
  const read = credentialEnvironmentReader(binding), refs = server.auth.credentials;
  const id = read(refs.clientId, server.auth.clientMode === "static")?.trim();
  const secret = read(refs.clientSecret)?.trim();
  if ((id !== undefined && registration !== undefined && id !== registration.client_id.trim()) ||
    (secret !== undefined && registration !== undefined && secret !== registration.client_secret?.trim()))
    throw new Error("Imported OAuth registration conflicts with the configured client identity");
  const clientId = id ?? registration?.client_id.trim();
  if (clientId === undefined || clientId === "") throw new Error("OAuth credential import requires the original client ID");
  const original = registration ?? { client_id: clientId, ...(secret === undefined ? {} : { client_secret: secret }) };
  const client = normalizeStoredOAuthClient({ clientId, clientSecret: secret ?? (typeof original.client_secret === "string" ? original.client_secret : undefined),
    registration: original, registrationOwnership: "caller", tokenEndpointAuthMethod: server.auth.tokenEndpointAuthMethod });
  if (client === null) throw new Error("Invalid OAuth credential import client identity");
  const rawScope = read(refs.scope) ?? refs.scope.fallback;
  const scope = normalizeOAuthScope(rawScope);
  if (scope !== undefined && tokens.scope !== scope) throw new Error("Imported OAuth grant does not match the requested OAuth scope");
  const nativeStores = importSession === undefined
    ? createResourceBoundOAuthStores(oauth?.authStore ?? {}, server.auth.persistenceNamespace, server.name) : undefined;
  const deadline = AbortSignal.timeout(requestTimeoutMs);
  const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
  const discovery = await discoverOAuthMetadata(server.url, { fetch: options.fetch, cache: options.oauthDiscoveryCache, signal });
  signal.throwIfAborted();
  if ((input.issuer !== undefined && input.issuer !== discovery.authorizationServer) ||
    (client.registration?.issuer !== undefined && client.registration.issuer !== null && client.registration.issuer !== discovery.authorizationServer))
    throw new Error("Imported OAuth issuer does not match validated discovery");
  const method = client.tokenEndpointAuthMethod ?? (client.clientSecret === undefined ? "none" : "client_secret_post");
  const supported = discovery.authorizationServerMetadata.token_endpoint_auth_methods_supported;
  if ((method !== "none" && client.clientSecret === undefined) ||
    (supported !== undefined && (!Array.isArray(supported) || supported.length > 128 || supported.some(entry => typeof entry !== "string") || !supported.includes(method))))
    throw new Error("Imported OAuth client authentication is not supported by the authorization server");
  const session: StoredOAuthSession = { resource: discovery.resource, authorizationServer: discovery.authorizationServer, client, tokens,
    ...(scope === undefined ? {} : { requestedScope: scope }),
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata,
      authorizationServerMetadata: discovery.authorizationServerMetadata } };
  if (importSession !== undefined) await importSession.call(oauth, server, session, { signal, timeoutMs });
  else await nativeStores!.importSession(session, { signal, timeoutMs });
  signal.throwIfAborted();
  return { name: server.name, url: server.url, imported: true };
}
