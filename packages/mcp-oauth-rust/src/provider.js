import { normalizeOAuthScope } from "./scope.js";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce.js";
import { createAuthStoreSessionStore, createAuthStoreClientStore } from "./session-store.js";
import { createLoopbackAuthorizationSession } from "./loopback.js";
import { canonicalizeResourceIndicator } from "./resource.js";
import { fetchMcpResponse } from "./http.js";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  readOAuthJsonObjectResponse,
  OAuthError
} from "./tokens.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const CLIENT = ["clientId", "clientSecret", "registration", "tokenEndpointAuthMethod"];
const TOKENS = ["accessToken", "tokenType", "expiresAt", "refreshToken", "scope"];
const METADATA = [
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "registration_endpoint",
  "authorization_response_iss_parameter_supported",
  "code_challenge_methods_supported"
];
function scalar(value) {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  return false;
}
function ownEntry(record, key) {
  return record !== null && record !== undefined && Object.hasOwn(record, key)
    ? record[key]
    : undefined;
}
function project(record, keys) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  const result = {};
  for (const key of keys) {
    const value = ownEntry(record, key);
    if (key === "code_challenge_methods_supported" && Array.isArray(value))
      result[key] = value.map(scalar);
    else result[key] = scalar(value);
  }
  return result;
}
function unwrap(result) {
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}
function validateUrl(value, label, secure = false) {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  unwrap(
    native.providerValidateEndpoint(
      JSON.stringify({
        protocol: url.protocol,
        hostname: url.hostname,
        credentials: url.username !== "" || url.password !== "",
        fragment: url.hash !== "",
        accessToken: url.searchParams.has("access_token")
      }),
      label,
      secure
    )
  );
}
function endpoints(metadata, interactive = false) {
  const values = unwrap(
    native.providerEndpoints(JSON.stringify(project(metadata, METADATA)), interactive)
  );
  validateUrl(values.authorization, "Authorization endpoint");
  validateUrl(values.token, "Token endpoint");
  validateUrl(values.authorization, "Authorization endpoint", true);
  validateUrl(values.token, "Token endpoint", true);
  if (Object.hasOwn(values, "registration")) {
    validateUrl(values.registration, "Registration endpoint");
    validateUrl(values.registration, "Registration endpoint", true);
  }
  return values;
}
function clearTokens(session) {
  const result = { ...session };
  delete result.tokens;
  return result;
}
function clientOptions(client) {
  return {
    mode: client.mode,
    clientId: scalar(client.clientId),
    clientSecret: scalar(client.clientSecret)
  };
}
function clientMetadata(client) {
  const metadata = client.metadata;
  if (metadata === undefined) return null;
  return Object.fromEntries(
    ["clientName", "scope", "softwareId", "softwareVersion"].map((key) => [
      key,
      scalar(metadata[key])
    ])
  );
}
export function createOAuthClientProvider(options) {
  return Object.hasOwn(options, "provider")
    ? options.provider
    : createDefaultOAuthClientProvider(options);
}
export function createDefaultOAuthClientProvider(options) {
  const requestedScope = normalizeOAuthScope(options.client.metadata?.scope);
  const sessionStore = options.sessionStore ?? createAuthStoreSessionStore(options.authStore);
  const clientStore =
    options.authStore === undefined ? null : createAuthStoreClientStore(options.authStore);
  const now = options.now ?? Date.now;
  const registeredClients = new native.NativeProviderClientCache();
  const refreshing = new Map(),
    authorizing = new Map();
  function expired(tokens) {
    return (
      tokens.expiresAt !== null && native.isStoredTokenExpired(tokens.expiresAt, Number(now()))
    );
  }
  async function loadSession(resource) {
    const value = await sessionStore.load(resource);
    if (value === null) return null;
    let normalized;
    try {
      normalized = native.providerNormalizeSession(
        JSON.stringify({
          client: project(ownEntry(value, "client"), CLIENT),
          tokens: project(ownEntry(value, "tokens"), TOKENS)
        })
      );
    } catch (error) {
      throw new Error(error.message);
    }
    return {
      ...value,
      client: normalized.client ?? { clientId: "" },
      tokens: normalized.tokens ?? undefined
    };
  }
  async function loadClient(issuer) {
    const cached = registeredClients.find(issuer);
    if (cached.found) {
      if (cached.client !== null && cached.undefinedSecret) cached.client.clientSecret = undefined;
      return cached.client;
    }
    if (clientStore === null) return null;
    const raw = await clientStore.load(issuer);
    const normalized =
      raw === null
        ? null
        : native.providerNormalizeClient(JSON.stringify(project(raw, CLIENT)), false);
    if (raw !== null && normalized === null) {
      await clientStore.clear(issuer);
      return null;
    }
    registeredClients.store(issuer, JSON.stringify(normalized), false);
    return normalized;
  }
  async function saveClient(issuer, client) {
    registeredClients.store(
      issuer,
      JSON.stringify(client),
      Object.hasOwn(client, "clientSecret") && client.clientSecret === undefined
    );
    if (clientStore !== null) await clientStore.save(issuer, client);
  }
  async function clearClient(issuer) {
    registeredClients.remove(issuer);
    if (clientStore !== null) await clientStore.clear(issuer);
  }
  function discoveryFor(discovery, session) {
    if (discovery !== undefined)
      return { ...discovery, resource: canonicalizeResourceIndicator(discovery.resource) };
    if (session === null) return undefined;
    const stored = session.discovery;
    const result = native.providerStoredDiscovery(
      JSON.stringify({
        authorizationServer: scalar(session.authorizationServer),
        discovery: {
          resourceMetadataUrl: scalar(stored.resourceMetadataUrl),
          resourceMetadata: {},
          authorizationServerMetadata: project(stored.authorizationServerMetadata, METADATA)
        }
      }),
      canonicalizeResourceIndicator(session.resource)
    );
    return result === null
      ? undefined
      : {
          ...result,
          resourceMetadata: stored.resourceMetadata,
          authorizationServerMetadata: stored.authorizationServerMetadata
        };
  }
  async function ensure(resource, discovery, fetch, interactive, force = false) {
    resource = canonicalizeResourceIndicator(resource);
    let session = await loadSession(resource);
    const input = {
      configured: clientOptions(options.client),
      session:
        session === null
          ? null
          : {
              resource: canonicalizeResourceIndicator(session.resource),
              authorizationServer: scalar(session.authorizationServer),
              client: session.client,
              tokens: session.tokens,
              discovery: {
                authorizationServerMetadata: project(
                  session.discovery.authorizationServerMetadata,
                  METADATA
                )
              }
            },
      discovery:
        discovery === undefined
          ? null
          : {
              authorizationServer: scalar(discovery.authorizationServer),
              authorizationServerMetadata: project(discovery.authorizationServerMetadata, METADATA)
            }
    };
    if (unwrap(native.providerBindingAction(resource, JSON.stringify(input))) === "clear") {
      await sessionStore.clear(resource);
      session = null;
    }
    const resolved = discoveryFor(discovery, session);
    const flow = new native.NativeSessionFlow(
      JSON.stringify(session?.tokens ?? null),
      resolved !== undefined,
      interactive,
      force
    );
    let clock;
    for (;;) {
      const effect = flow.next(clock);
      clock = undefined;
      switch (effect) {
        case "clock":
          clock = Number(now());
          break;
        case "continue":
          break;
        case "refresh":
          session = await refreshSession(resource, session, resolved, fetch);
          flow.refreshed(JSON.stringify(session?.tokens ?? null));
          break;
        case "clear":
          session = clearTokens(session);
          await sessionStore.save(resource, session);
          break;
        case "authorize":
          return authorizeSession(resource, session, resolved, fetch);
        default:
          return session;
      }
    }
  }
  async function refreshSession(resource, session, discovery, fetch) {
    const urls = endpoints(discovery.authorizationServerMetadata);
    if (refreshing.has(resource)) return refreshing.get(resource);
    const promise = (async () => {
      const retries = new native.NativeOAuthRetryState();
      try {
        let tokens;
        for (;;) {
          try {
            tokens = await refreshAccessToken({
              tokenEndpoint: urls.token,
              clientId: session.client.clientId,
              clientSecret: session.client.clientSecret,
              refreshToken: session.tokens.refreshToken,
              resource,
              fetch,
              now
            });
            break;
          } catch (error) {
            const oauth = error instanceof OAuthError,
              code = oauth ? error.error : "",
              status = oauth ? error.status : 0;
            let action = retries.refresh(oauth, code, status);
            if (action === "load")
              action = retries.refresh(
                oauth,
                code,
                status,
                (await loadClient(discovery.authorizationServer)) !== null
              );
            if (action === "clear") {
              const cleared = clearTokens(session);
              await sessionStore.save(resource, cleared);
              return cleared;
            }
            if (action === "reregister") {
              await clearClient(discovery.authorizationServer);
              await sessionStore.clear(resource);
              return null;
            }
            if (action === "retry") continue;
            throw error;
          }
        }
        const updated = {
          ...session,
          tokens: { ...tokens, refreshToken: tokens.refreshToken ?? session.tokens.refreshToken },
          discovery: {
            resourceMetadataUrl: discovery.resourceMetadataUrl,
            resourceMetadata: discovery.resourceMetadata,
            authorizationServerMetadata: discovery.authorizationServerMetadata
          }
        };
        await sessionStore.save(resource, updated);
        return updated;
      } finally {
        refreshing.delete(resource);
      }
    })();
    refreshing.set(resource, promise);
    return promise;
  }
  async function resolveClient(existing, discovery, redirect, fetch) {
    const metadata = discovery.authorizationServerMetadata;
    const registration = ownEntry(metadata, "registration_endpoint");
    const hasRegistration = typeof registration === "string";
    const configured = clientOptions(options.client);
    const initial = unwrap(
      native.providerInitialClient(JSON.stringify(configured), hasRegistration)
    );
    if (!Object.hasOwn(initial, "action") || initial.action !== "load") return initial;
    const stored = await loadClient(discovery.authorizationServer);
    const plan = unwrap(
      native.providerDynamicClient(
        JSON.stringify({
          options: configured,
          stored,
          existing: existing === null ? null : { client: existing.client }
        }),
        hasRegistration
      )
    );
    // Retain own undefined fields while the Rust policy selects cached clients.
    if (stored !== null && Object.hasOwn(plan, "client")) plan.client = stored;
    if (Object.hasOwn(plan, "action") && plan.action === "cache") {
      await saveClient(discovery.authorizationServer, plan.client);
      return plan;
    }
    if (!Object.hasOwn(plan, "action") || plan.action !== "register") return plan;
    const body = native.providerRegistrationBody(
      JSON.stringify(clientMetadata(options.client)),
      redirect
    );
    const signal = AbortSignal.timeout(30_000);
    const response = await fetchMcpResponse(fetch, registration, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    const payload = await readOAuthJsonObjectResponse(response, signal);
    const client = unwrap(native.providerRegisteredClient(JSON.stringify(payload)));
    await saveClient(discovery.authorizationServer, client);
    return { kind: "dynamic", fromStoredRegistration: false, client };
  }
  async function authorizeSession(resource, existing, discovery, fetch) {
    if (authorizing.has(resource)) return authorizing.get(resource);
    const promise = (async () => {
      const urls = endpoints(discovery.authorizationServerMetadata, true);
      const retries = new native.NativeOAuthRetryState();
      let current = existing;
      for (;;) {
        const loopback = await createLoopbackAuthorizationSession(options.browser);
        let client = null;
        try {
          client = await resolveClient(current, discovery, loopback.redirectUri, fetch);
          const pending = {
            resource,
            authorizationServer: discovery.authorizationServer,
            client: client.client,
            ...(requestedScope === undefined ? {} : { requestedScope }),
            discovery: {
              resourceMetadataUrl: discovery.resourceMetadataUrl,
              resourceMetadata: discovery.resourceMetadata,
              authorizationServerMetadata: discovery.authorizationServerMetadata
            }
          };
          await sessionStore.save(resource, pending);
          const verifier = generateCodeVerifier(),
            challenge = generateCodeChallenge(verifier);
          const plan = unwrap(
            native.providerAuthorizationPlan(
              JSON.stringify({
                metadata: project(discovery.authorizationServerMetadata, METADATA),
                resource,
                clientId: client.client.clientId,
                redirectUri: loopback.redirectUri,
                codeChallenge: challenge,
                clientMetadata: clientMetadata(options.client)
              }),
              randomBytes(16)
            )
          );
          const url = new URL(plan.endpoint);
          for (const [key, value] of Object.entries(plan.params)) url.searchParams.set(key, value);
          const code = await loopback.waitForCode(url.toString());
          const tokens = await exchangeAuthorizationCode({
            tokenEndpoint: urls.token,
            clientId: client.client.clientId,
            clientSecret: client.client.clientSecret,
            code,
            codeVerifier: verifier,
            redirectUri: loopback.redirectUri,
            resource,
            fetch,
            now
          });
          const complete = { ...pending, tokens };
          await sessionStore.save(resource, complete);
          return complete;
        } catch (error) {
          const oauth = error instanceof OAuthError;
          const action = retries.authorization(
            oauth,
            oauth ? error.error : "",
            oauth ? error.status : 0,
            client?.kind === "dynamic" && client.fromStoredRegistration
          );
          if (action === "reregister") {
            await clearClient(discovery.authorizationServer);
            await sessionStore.clear(resource);
            current = null;
            continue;
          }
          if (action === "retry") {
            await sessionStore.clear(resource);
            current = null;
            continue;
          }
          throw error;
        } finally {
          loopback.close();
        }
      }
    })();
    const completed = promise.finally(() => authorizing.delete(resource));
    authorizing.set(resource, completed);
    return completed;
  }
  return {
    async authorizeRequest(input) {
      validateUrl(input.requestUrl, "Protected resource request URL");
      const url = canonicalizeResourceIndicator(input.requestUrl);
      const session = await ensure(url, undefined, input.fetch, false);
      if (session === null || session.tokens === undefined || expired(session.tokens)) return;
      unwrap(native.providerRequestMatches(url, session.resource));
      input.headers.set("Authorization", `Bearer ${session.tokens.accessToken}`);
      return { ...session.tokens };
    },
    async handleUnauthorized(input) {
      try {
        validateUrl(input.requestUrl, "Protected resource request URL");
        const url = canonicalizeResourceIndicator(input.requestUrl),
          resource = canonicalizeResourceIndicator(input.discovery.resource);
        unwrap(native.providerRequestMatches(url, resource));
        const force =
          (await loadSession(resource))?.tokens !== undefined &&
          input.challenge?.params.error === "invalid_token";
        const session = await ensure(
          resource,
          { ...input.discovery, resource },
          input.fetch,
          true,
          force
        );
        return session?.tokens?.accessToken === undefined
          ? { action: "fail" }
          : { action: "retry" };
      } catch (error) {
        return { action: "fail", error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
  };
}
