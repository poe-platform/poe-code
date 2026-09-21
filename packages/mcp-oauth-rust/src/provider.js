import {
  normalizeStoredOAuthClient,
  parseOAuthClientRegistration,
  registrationMatchesRedirect
} from "./registration.js";
import { createResourceBoundOAuthStores } from "./resource-store.js";
import { withOAuthSessionTransaction } from "./transaction.js";
import { normalizeOAuthScope } from "./scope.js";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce.js";
import {
  createAuthStoreSessionStore,
  createAuthStoreClientStore,
  assertPersistenceNamespace
} from "./session-store.js";
import { createLoopbackAuthorizationSession, loopbackTarget } from "./loopback.js";
import { canonicalizeResourceIndicator } from "./resource.js";
import { fetchMcpResponse } from "./http.js";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  readOAuthJsonObjectResponse,
  OAuthError
} from "./tokens.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const TOKENS = ["accessToken", "tokenType", "expiresAt", "refreshToken", "scope"];
const METADATA = [
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "registration_endpoint",
  "authorization_response_iss_parameter_supported",
  "code_challenge_methods_supported",
  "token_endpoint_auth_methods_supported"
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
    if (
      (key === "code_challenge_methods_supported" ||
        key === "token_endpoint_auth_methods_supported") &&
      Array.isArray(value)
    )
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
  delete result.refreshState;
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
  if (client.metadata === undefined) return null;
  const normalize = (value) => (value === undefined ? undefined : value.trim() || undefined);
  return {
    clientName: normalize(client.metadata.clientName),
    scope: normalizeOAuthScope(client.metadata.scope),
    softwareId: normalize(client.metadata.softwareId),
    softwareVersion: normalize(client.metadata.softwareVersion)
  };
}
export function createOAuthClientProvider(options) {
  return Object.hasOwn(options, "provider")
    ? options.provider
    : createDefaultOAuthClientProvider(options);
}
export function createDefaultOAuthClientProvider(options) {
  assertPersistenceNamespace(options.persistenceNamespace);
  loopbackTarget(options.browser);
  const resolvedClientMetadata = clientMetadata(options.client);
  const requestedScope = resolvedClientMetadata?.scope;
  const requestedTokenMethod =
    unwrap(
      native.providerTokenMethod(
        JSON.stringify({ method: scalar(options.client.tokenEndpointAuthMethod) })
      )
    ) ?? undefined;
  if (options.resourceIdentity !== undefined && options.sessionStore !== undefined)
    throw new Error("OAuth resourceIdentity requires native-owned persistence; custom stores own their resource trust policy");
  const resourceStores = options.resourceIdentity === undefined ? undefined :
    createResourceBoundOAuthStores(options.authStore ?? {}, options.persistenceNamespace, options.resourceIdentity);
  const sessionStore =
    resourceStores?.sessionStore ?? options.sessionStore ??
    createAuthStoreSessionStore(options.authStore, options.persistenceNamespace);
  const clientStore = resourceStores?.clientStore ??
    (options.authStore === undefined ? null : createAuthStoreClientStore(options.authStore, options.persistenceNamespace));
  const now = options.now ?? Date.now;
  const registration =
    options.client.registration === undefined
      ? undefined
      : parseOAuthClientRegistration(options.client.registration);
  const optionalString = (value) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  const configuredClient = normalizeStoredOAuthClient({
    clientId: optionalString(options.client.clientId) ?? registration?.client_id.trim(),
    clientSecret:
      optionalString(options.client.clientSecret) ?? optionalString(registration?.client_secret),
    registration,
    ...(registration === undefined ? {} : { registrationOwnership: "caller" }),
    tokenEndpointAuthMethod: options.client.tokenEndpointAuthMethod
  });
  const configuredTokenMethod = requestedTokenMethod ?? configuredClient?.tokenEndpointAuthMethod;
  let initialGrant;
  if (options.initialGrant !== undefined) {
    let url;
    try {
      url = new URL(options.initialGrant.resource);
    } catch {
      throw new Error("OAuth initial grant resource must be an absolute HTTP URL");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(
        "OAuth initial grant resource must be an HTTP URL without credentials or fragments"
      );
    let tokens;
    try {
      tokens = native.providerNormalizeImportedTokens(
        JSON.stringify(project(options.initialGrant.tokens, [...TOKENS, "expiresIn", "issuedAt"])),
        Number(now())
      );
    } catch {
      throw new Error("OAuth initial grant has invalid tokens or expiry");
    }
    if (tokens === null || configuredClient === null)
      throw new Error("OAuth initial grant requires valid tokens and the original client ID");
    if (requestedScope !== undefined && tokens.scope !== requestedScope)
      throw new Error("OAuth initial grant does not match the requested OAuth scope");
    try {
      new Headers({ Authorization: `Bearer ${tokens.accessToken}` });
    } catch {
      throw new Error("OAuth initial grant access token is not a valid HTTP header value");
    }
    initialGrant = {
      resource: canonicalizeResourceIndicator(url),
      tokens,
      client: configuredClient
    };
  }
  let initialGrantConsumed = false;
  const registeredClients = new native.NativeProviderClientCache();
  const refreshing = new Map(),
    authorizing = new Map();
  function expired(tokens) {
    return (
      tokens.expiresAt !== null && native.isStoredTokenExpired(tokens.expiresAt, Number(now()))
    );
  }
  function secretExpired(client) {
    const text = JSON.stringify(client);
    return (
      native.providerSecretNeedsClock(text) && native.providerSecretExpired(text, Number(now()))
    );
  }
  async function loadSession(resource) {
    const value = await sessionStore.load(resource);
    if (value === null) return null;
    const refreshState = ownEntry(value, "refreshState");
    if (
      refreshState !== undefined &&
      (refreshState !== "pending" || ownEntry(value, "tokens") !== undefined)
    )
      throw new Error("Stored OAuth refresh state is invalid");
    let normalized;
    try {
      normalized = native.providerNormalizeSession(
        JSON.stringify({
          client: normalizeStoredOAuthClient(ownEntry(value, "client")),
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
    const normalized = raw === null ? null : normalizeStoredOAuthClient(raw);
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
  async function ensure(
    resource,
    discovery,
    fetch,
    interactive,
    force = false,
    signal,
    rejectedTokens
  ) {
    resource = canonicalizeResourceIndicator(resource);
    return withOAuthSessionTransaction(
      sessionStore,
      resource,
      async () => {
        let session = await loadSession(resource);
        if (resourceStores !== undefined) {
          registeredClients.clear();
          if (!resourceStores.initialGrantAllowed) initialGrantConsumed = true;
        }
        if (session !== null)
          unwrap(
            native.providerAssertRegistrationIssuer(
              JSON.stringify(session.client),
              session.authorizationServer
            )
          );
        if (configuredClient !== null && discovery !== undefined)
          unwrap(
            native.providerAssertRegistrationIssuer(
              JSON.stringify(configuredClient),
              discovery.authorizationServer
            )
          );
        if (session !== null && initialGrant?.resource === resource) initialGrantConsumed = true;
        const input = {
          configured: {
            ...clientOptions(options.client),
            ...configuredClient,
            mode:
              initialGrant === undefined && configuredClient?.registration === undefined
                ? options.client.mode
                : "static"
          },
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
                  authorizationServerMetadata: project(
                    discovery.authorizationServerMetadata,
                    METADATA
                  )
                }
        };
        if (unwrap(native.providerBindingAction(resource, JSON.stringify(input))) === "clear") {
          await sessionStore.clear(resource);
          session = null;
        }
        if (
          session === null &&
          discovery !== undefined &&
          !initialGrantConsumed &&
          initialGrant?.resource === resource
        ) {
          endpoints(discovery.authorizationServerMetadata);
          session = {
            resource,
            authorizationServer: discovery.authorizationServer,
            client: initialGrant.client,
            tokens: initialGrant.tokens,
            ...(requestedScope === undefined ? {} : { requestedScope }),
            discovery: {
              resourceMetadataUrl: discovery.resourceMetadataUrl,
              resourceMetadata: discovery.resourceMetadata,
              authorizationServerMetadata: discovery.authorizationServerMetadata
            }
          };
          await sessionStore.save(resource, session);
          initialGrantConsumed = true;
        }
        if (
          force &&
          rejectedTokens !== undefined &&
          !native.rejectedGrantMatches(
            JSON.stringify({ current: session?.tokens, rejected: rejectedTokens })
          )
        )
          force = false;
        const resolved = discoveryFor(discovery, session);
        if (session?.tokens !== undefined)
          unwrap(
            native.providerAssertScope(
              JSON.stringify({
                granted: session.tokens.scope ?? session.requestedScope,
                requested: requestedScope
              }),
              0
            )
          );
        if (
          session !== null &&
          (session.tokens !== undefined || session.refreshState === "pending")
        )
          unwrap(
            native.providerAssertSessionMethod(
              JSON.stringify({ client: session.client, method: configuredTokenMethod })
            )
          );
        if (session?.refreshState === "pending") {
          if (!interactive || options.allowInteractive === false || resolved === undefined)
            throw new Error(
              "OAuth refresh outcome is unknown; authorize again before using this resource"
            );
          return authorizeSession(resource, clearTokens(session), resolved, fetch, signal);
        }
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
              if (secretExpired(session.client)) {
                if (
                  !interactive ||
                  options.allowInteractive === false ||
                  options.client.mode === "static" ||
                  configuredClient?.registration !== undefined
                )
                  throw new Error(
                    "OAuth client secret has expired; authorize again or update the imported registration"
                  );
                return authorizeSession(resource, clearTokens(session), resolved, fetch, signal);
              }
              session = await refreshSession(resource, session, resolved, fetch, signal);
              flow.refreshed(JSON.stringify(session?.tokens ?? null));
              break;
            case "clear":
              session = clearTokens(session);
              await sessionStore.save(resource, session);
              break;
            case "authorize":
              if (options.allowInteractive === false)
                throw new Error("OAuth authorization requires interactive consent");
              return authorizeSession(resource, session, resolved, fetch, signal);
            default:
              return session;
          }
        }
      },
      { signal, timeoutMs: options.sessionLockTimeoutMs }
    );
  }
  async function refreshSession(resource, session, discovery, fetch, signal) {
    const urls = endpoints(discovery.authorizationServerMetadata);
    unwrap(
      native.providerAssertTokenMethod(
        JSON.stringify({
          client: session.client,
          metadata: project(discovery.authorizationServerMetadata, METADATA)
        })
      )
    );
    if (refreshing.has(resource)) return refreshing.get(resource);
    const promise = (async () => {
      const retries = new native.NativeOAuthRetryState();
      await sessionStore.save(resource, { ...clearTokens(session), refreshState: "pending" });
      try {
        let tokens;
        for (;;) {
          try {
            tokens = await refreshAccessToken({
              tokenEndpoint: urls.token,
              clientId: session.client.clientId,
              clientSecret: session.client.clientSecret,
              tokenEndpointAuthMethod: session.client.tokenEndpointAuthMethod,
              refreshToken: session.tokens.refreshToken,
              resource,
              fetch,
              signal,
              now
            });
            break;
          } catch (error) {
            signal?.throwIfAborted();
            if (!(error instanceof OAuthError) || !error.outcomeKnown) throw error;
            const oauth = error instanceof OAuthError,
              code = oauth ? error.error : "",
              status = oauth ? error.status : 0;
            let action = retries.refresh(oauth, code, status);
            if (action === "load") {
              const registered = await loadClient(discovery.authorizationServer);
              action = retries.refresh(
                oauth,
                code,
                status,
                registered !== null && !native.providerCallerOwned(JSON.stringify(registered))
              );
            }
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
            await sessionStore.save(resource, session);
            throw error;
          }
        }
        const updated = {
          ...session,
          tokens: {
            ...tokens,
            refreshToken: tokens.refreshToken ?? session.tokens.refreshToken,
            scope: tokens.scope ?? session.tokens.scope
          },
          discovery: {
            resourceMetadataUrl: discovery.resourceMetadataUrl,
            resourceMetadata: discovery.resourceMetadata,
            authorizationServerMetadata: discovery.authorizationServerMetadata
          }
        };
        unwrap(
          native.providerAssertScope(
            JSON.stringify({
              granted: updated.tokens.scope ?? session.requestedScope,
              requested: requestedScope
            }),
            1
          )
        );
        await sessionStore.save(resource, updated);
        return updated;
      } finally {
        refreshing.delete(resource);
      }
    })();
    refreshing.set(resource, promise);
    return promise;
  }
  async function resolveClient(existing, discovery, redirect, fetch, parentSignal) {
    const metadata = discovery.authorizationServerMetadata;
    const registration = ownEntry(metadata, "registration_endpoint");
    const hasRegistration = typeof registration === "string";
    const configured = {
      ...clientOptions(options.client),
      ...configuredClient,
      mode: configuredClient?.registration === undefined ? options.client.mode : "static"
    };
    const initial = unwrap(
      native.providerInitialClient(JSON.stringify(configured), hasRegistration)
    );
    if (!Object.hasOwn(initial, "action") || initial.action !== "load") {
      unwrap(
        native.providerAssertRegistrationIssuer(
          JSON.stringify(initial.client),
          discovery.authorizationServer
        )
      );
      if (secretExpired(initial.client))
        throw new Error("OAuth client secret has expired; update the imported registration");
      return initial;
    }
    let stored = await loadClient(discovery.authorizationServer);
    const importedIndex = native.providerImportedClient(
      JSON.stringify({ existing: existing?.client, stored })
    );
    const imported =
      importedIndex === 1 ? existing.client : importedIndex === 2 ? stored : undefined;
    if (imported !== undefined) {
      unwrap(
        native.providerAssertRegistrationIssuer(
          JSON.stringify(imported),
          discovery.authorizationServer
        )
      );
      if (secretExpired(imported))
        throw new Error("OAuth client secret has expired; update the imported registration");
      if (!registrationMatchesRedirect(imported, redirect))
        throw new Error(
          "OAuth imported registration does not match the configured redirect URI; update its callback configuration"
        );
      return { kind: "static", fromStoredRegistration: false, client: imported };
    }
    if (stored !== null) {
      unwrap(
        native.providerAssertRegistrationIssuer(
          JSON.stringify(stored),
          discovery.authorizationServer
        )
      );
      if (secretExpired(stored) || !registrationMatchesRedirect(stored, redirect)) {
        await clearClient(discovery.authorizationServer);
        stored = null;
      }
    }
    const usableExisting =
      stored === null &&
      existing !== null &&
      !secretExpired(existing.client) &&
      registrationMatchesRedirect(existing.client, redirect)
        ? existing
        : null;
    const plan = unwrap(
      native.providerDynamicClient(
        JSON.stringify({
          options: configured,
          stored,
          existing: usableExisting === null ? null : { client: usableExisting.client }
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
    const body = native.providerRegistrationBody(JSON.stringify(resolvedClientMetadata), redirect);
    const registrationMethod = unwrap(
      native.providerRegistrationMethod(
        JSON.stringify({ metadata: project(metadata, METADATA), method: requestedTokenMethod })
      )
    );
    body.token_endpoint_auth_method = registrationMethod;
    const deadline = AbortSignal.timeout(30_000);
    const signal =
      parentSignal === undefined ? deadline : AbortSignal.any([parentSignal, deadline]);
    const response = await fetchMcpResponse(fetch, registration, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    const payload = await readOAuthJsonObjectResponse(response, signal);
    const registrationValue = parseOAuthClientRegistration(payload);
    const normalized = unwrap(native.providerRegisteredClient(JSON.stringify(registrationValue)));
    const responseMethod =
      unwrap(
        native.providerTokenMethod(
          JSON.stringify({ method: registrationValue.token_endpoint_auth_method })
        )
      ) ??
      requestedTokenMethod ??
      (ownEntry(metadata, "token_endpoint_auth_methods_supported") === undefined
        ? undefined
        : registrationMethod);
    if (responseMethod !== undefined) normalized.tokenEndpointAuthMethod = responseMethod;
    unwrap(
      native.providerAssertRegistrationIssuer(
        JSON.stringify(normalized),
        discovery.authorizationServer
      )
    );
    if (secretExpired(normalized))
      throw new Error("OAuth client secret has expired in the registration response");
    if (!registrationMatchesRedirect(normalized, redirect, true))
      throw new Error("OAuth client registration does not match the requested redirect URI");
    const client = { ...normalized, requestedRedirectUri: redirect };
    await saveClient(discovery.authorizationServer, client);
    return { kind: "dynamic", fromStoredRegistration: false, client };
  }
  async function authorizeSession(resource, existing, discovery, fetch, signal) {
    if (authorizing.has(resource)) return authorizing.get(resource);
    const promise = (async () => {
      const urls = endpoints(discovery.authorizationServerMetadata, true);
      const retries = new native.NativeOAuthRetryState();
      let current = existing;
      for (;;) {
        const loopback = await createLoopbackAuthorizationSession({
          ...options.browser,
          signal:
            signal === undefined
              ? options.browser.signal
              : options.browser.signal === undefined
                ? signal
                : AbortSignal.any([signal, options.browser.signal])
        });
        let client = null;
        try {
          client = await resolveClient(current, discovery, loopback.redirectUri, fetch, signal);
          unwrap(
            native.providerAssertTokenMethod(
              JSON.stringify({
                client: client.client,
                metadata: project(discovery.authorizationServerMetadata, METADATA)
              })
            )
          );
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
                clientMetadata: resolvedClientMetadata
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
            tokenEndpointAuthMethod: client.client.tokenEndpointAuthMethod,
            code,
            codeVerifier: verifier,
            redirectUri: loopback.redirectUri,
            resource,
            fetch,
            signal,
            now
          });
          unwrap(
            native.providerAssertScope(
              JSON.stringify({ granted: tokens.scope, requested: requestedScope }),
              2
            )
          );
          const complete = { ...pending, tokens };
          await sessionStore.save(resource, complete);
          return complete;
        } catch (error) {
          signal?.throwIfAborted();
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
    async authenticate(input) {
      input.signal?.throwIfAborted();
      validateUrl(input.requestUrl, "Protected resource request URL");
      const resource = canonicalizeResourceIndicator(input.requestUrl);
      let session = await ensure(resource, undefined, input.fetch, true, false, input.signal);
      if (session?.tokens !== undefined && !expired(session.tokens)) return { ...session.tokens };
      if (
        session === null &&
        !initialGrantConsumed &&
        initialGrant?.resource === resource &&
        !expired(initialGrant.tokens)
      )
        return { ...initialGrant.tokens };
      if (input.discover === undefined) return;
      const discovery = await input.discover();
      input.signal?.throwIfAborted();
      unwrap(
        native.providerRequestMatches(resource, canonicalizeResourceIndicator(discovery.resource))
      );
      session = await ensure(resource, discovery, input.fetch, true, false, input.signal);
      if (session?.tokens === undefined || expired(session.tokens))
        throw new Error("OAuth authentication did not establish a usable grant");
      return { ...session.tokens };
    },
    async authorizeRequest(input) {
      validateUrl(input.requestUrl, "Protected resource request URL");
      const url = canonicalizeResourceIndicator(input.requestUrl);
      const session = await ensure(url, undefined, input.fetch, false, false, input.signal);
      if (
        session === null &&
        !initialGrantConsumed &&
        initialGrant?.resource === url &&
        !expired(initialGrant.tokens)
      ) {
        input.headers.set("Authorization", `Bearer ${initialGrant.tokens.accessToken}`);
        return { ...initialGrant.tokens };
      }
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
        const cached = await loadSession(resource);
        const currentTokens =
          cached?.tokens ??
          (!initialGrantConsumed && initialGrant?.resource === resource
            ? initialGrant.tokens
            : undefined);
        let rejectedCurrent = currentTokens !== undefined;
        let presented = input.presentedTokens;
        if (presented !== undefined) {
          rejectedCurrent = false;
          if (presented !== null) {
            try {
              presented = native.providerNormalizeTokens(
                JSON.stringify(project(presented, TOKENS))
              );
            } catch (error) {
              throw new Error(error.message);
            }
            const header = input.requestHeaders?.get("Authorization") ?? "";
            const separator = header.indexOf(" ");
            if (
              presented === null ||
              header.slice(0, separator).toLowerCase() !== "bearer" ||
              header.slice(separator + 1).trim() !== presented.accessToken
            )
              throw new Error(
                "OAuth rejected-request provenance does not match its authorization header"
              );
            rejectedCurrent = native.rejectedGrantMatches(
              JSON.stringify({ current: currentTokens, rejected: presented })
            );
          }
        }
        const challenge = input.challenge?.params.error;
        const force =
          rejectedCurrent &&
          (challenge === "invalid_token" ||
            (input.presentedTokens !== undefined && challenge === undefined));
        const session = await ensure(
          resource,
          { ...input.discovery, resource },
          input.fetch,
          true,
          force,
          input.signal,
          presented
        );
        return session?.tokens?.accessToken === undefined
          ? { action: "fail" }
          : { action: "retry" };
      } catch (error) {
        input.signal?.throwIfAborted();
        return { action: "fail", error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
  };
}
