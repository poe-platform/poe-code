import { createResourceBoundOAuthStores } from "./resource-bound-store.js";
import { normalizeStoredOAuthClient, parseOAuthClientRegistration, registrationMatchesRedirect } from "./client-registration.js";
import { normalizeOAuthScope } from "./scope.js";
import { normalizeOAuthTokenEndpointAuthMethod } from "./token-auth-method.js";
import { isIP } from "node:net";
import { fetchMcpResponse } from "../http-fetch.js";
import { URL } from "node:url";
import type {
  DefaultOAuthClientProviderOptions,
  OAuthAuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthClientProviderOptions,
  OAuthDiscoveryResult,
  OAuthMetadataFetch,
  StoredOAuthSession,
  StoredOAuthTokens
} from "./types.js";
import {
  createAuthStoreClientStore,
  createAuthStoreSessionStore,
  assertPersistenceNamespace
} from "./auth-store-session-store.js";
import { createLoopbackAuthorizationSession, loopbackTarget } from "./loopback-authorization.js";
import { createAuthorizationState } from "./authorization-state.js";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce.js";
import {
  exchangeAuthorizationCode,
  OAuthError,
  refreshAccessToken,
  isRetryableOAuthError,
  readOAuthJsonObjectResponse
} from "./token-endpoint.js";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";
import { withOAuthSessionTransaction } from "./session-transaction.js";

const MAX_JS_DATE_MS = 8_640_000_000_000_000;

export function createOAuthClientProvider(
  options: OAuthClientProviderOptions
): OAuthClientProvider {
  if (isProviderOptions(options)) {
    return options.provider;
  }

  return createDefaultOAuthClientProvider(options);
}

export function createDefaultOAuthClientProvider(
  options: DefaultOAuthClientProviderOptions
): OAuthClientProvider {
  const browser = { ...options.browser,
    ...(options.browser.landingPage === undefined ? {} : { landingPage: { ...options.browser.landingPage } }) };
  const clientMode = options.client.mode;
  const interactiveEnabled = options.allowInteractive !== false;
  const sessionLockTimeoutMs = options.sessionLockTimeoutMs;
  loopbackTarget(browser);
  assertPersistenceNamespace(options.persistenceNamespace);
  const clientMetadata = getClientMetadata(options.client);
  const requestedScope = clientMetadata?.scope;
  const configuredClient = normalizeConfiguredClient(options.client);
  const requestedTokenMethod = normalizeOAuthTokenEndpointAuthMethod(options.client.tokenEndpointAuthMethod);
  const configuredTokenMethod = requestedTokenMethod ?? configuredClient?.tokenEndpointAuthMethod;
  if (options.resourceIdentity !== undefined && options.sessionStore !== undefined)
    throw new Error("OAuth resourceIdentity requires native-owned persistence; custom stores own their resource trust policy");
  const resourceStores = options.resourceIdentity === undefined ? undefined :
    createResourceBoundOAuthStores(options.authStore ?? {}, options.persistenceNamespace, options.resourceIdentity);
  const sessionStore = resourceStores?.sessionStore ?? options.sessionStore ?? createAuthStoreSessionStore(options.authStore, options.persistenceNamespace);
  const clientStore = resourceStores?.clientStore ??
    (options.authStore === undefined ? null : createAuthStoreClientStore(options.authStore, options.persistenceNamespace));
  const now = options.now ?? Date.now;
  const registeredClients = new Map<string, StoredOAuthSession["client"] | null>();
  if (options.initialGrant !== undefined) {
    let resource: URL;
    try { resource = new URL(options.initialGrant.resource); }
    catch { throw new Error("OAuth initial grant resource must be an absolute HTTP URL"); }
    if ((resource.protocol !== "http:" && resource.protocol !== "https:") || resource.username || resource.password || resource.hash)
      throw new Error("OAuth initial grant resource must be an HTTP URL without credentials or fragments");
  }
  const initialGrant = options.initialGrant === undefined ? undefined : {
    resource: canonicalizeResourceIndicator(options.initialGrant.resource),
    tokens: normalizeImportedTokens(options.initialGrant.tokens, now),
    client: configuredClient
  };
  if (initialGrant !== undefined && (initialGrant.tokens === undefined || initialGrant.client === null))
    throw new Error("OAuth initial grant requires valid tokens and the original client ID");
  if (initialGrant?.tokens !== undefined) {
    if (requestedScope !== undefined && initialGrant.tokens.scope !== requestedScope)
      throw new Error("OAuth initial grant does not match the requested OAuth scope");
    try { new Headers({ Authorization: `Bearer ${initialGrant.tokens.accessToken}` }); }
    catch { throw new Error("OAuth initial grant access token is not a valid HTTP header value"); }
  }
  let initialGrantConsumed = false;

  return {
    async authenticate(input): Promise<StoredOAuthTokens | void> {
      input.signal?.throwIfAborted();
      assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
      const resource = canonicalizeResourceIndicator(input.requestUrl);
      let session = await ensureAuthorizedSession(resource, undefined, input.fetch, true, false, input.signal);
      if (session?.tokens !== undefined && !isExpired(session.tokens, now)) return { ...session.tokens };
      if (session === null && !initialGrantConsumed && initialGrant?.resource === resource &&
        initialGrant.tokens !== undefined && !isExpired(initialGrant.tokens, now)) return { ...initialGrant.tokens };
      if (input.discover === undefined) return;
      const discovery = await input.discover();
      input.signal?.throwIfAborted();
      assertRequestMatchesResource(resource, canonicalizeResourceIndicator(discovery.resource));
      session = await ensureAuthorizedSession(resource, discovery, input.fetch, true, false, input.signal);
      if (session?.tokens === undefined || isExpired(session.tokens, now)) throw new Error("OAuth authentication did not establish a usable grant");
      return { ...session.tokens };
    },

    async authorizeRequest(input): Promise<StoredOAuthTokens | void> {
      assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
      const requestUrl = canonicalizeResourceIndicator(input.requestUrl);
      const session = await ensureAuthorizedSession(requestUrl, undefined, input.fetch, false, false, input.signal);
      const accessToken = session?.tokens?.accessToken;
      if (session === null && !initialGrantConsumed && initialGrant?.resource === requestUrl &&
        initialGrant.tokens !== undefined && !isExpired(initialGrant.tokens, now)) {
        input.headers.set("Authorization", `Bearer ${initialGrant.tokens.accessToken}`);
        return { ...initialGrant.tokens };
      }
      if (
        session === null ||
        accessToken === undefined ||
        session.tokens === undefined ||
        isExpired(session.tokens, now)
      ) {
        return;
      }

      assertRequestMatchesResource(requestUrl, session.resource);

      input.headers.set("Authorization", `Bearer ${accessToken}`);
      return { ...session.tokens };
    },

    async handleUnauthorized(input) {
      try {
        assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
        const requestUrl = canonicalizeResourceIndicator(input.requestUrl);
        const resource = canonicalizeResourceIndicator(input.discovery.resource);
        assertRequestMatchesResource(requestUrl, resource);
        const cached = await loadSession(resource);
        const currentTokens = cached?.tokens ?? (!initialGrantConsumed && initialGrant?.resource === resource ? initialGrant.tokens : undefined);
        let rejectedCurrentGrant = hasCachedAccessToken(cached) || (!initialGrantConsumed && initialGrant?.resource === resource);
        let presentedTokens = input.presentedTokens;
        if (input.presentedTokens !== undefined) {
          rejectedCurrentGrant = false;
          if (input.presentedTokens !== null) {
            const presented = normalizeStoredTokens(input.presentedTokens);
            const header = input.requestHeaders?.get("Authorization") ?? "";
            const separator = header.indexOf(" ");
            if (presented === undefined || header.slice(0, separator).toLowerCase() !== "bearer" || header.slice(separator + 1).trim() !== presented.accessToken)
              throw new Error("OAuth rejected-request provenance does not match its authorization header");
            presentedTokens = presented;
            rejectedCurrentGrant = currentTokens !== undefined && sameTokenGrant(currentTokens, presented);
          }
        }
        const challengeError = input.challenge?.params.error;
        const forceRefresh = rejectedCurrentGrant && (challengeError === "invalid_token" || (input.presentedTokens !== undefined && challengeError === undefined));
        const session = await ensureAuthorizedSession(
          resource,
          {
            ...input.discovery,
            resource
          },
          input.fetch,
          true,
          forceRefresh,
          input.signal,
          presentedTokens
        );

        if (session?.tokens?.accessToken === undefined) {
          return { action: "fail" } as const;
        }

        return { action: "retry" } as const;
      } catch (error) {
        input.signal?.throwIfAborted();
        return {
          action: "fail",
          error: error instanceof Error ? error : new Error(String(error))
        } as const;
      }
    }
  };

  async function ensureAuthorizedSession(
    resource: string,
    discovery: OAuthDiscoveryResult | undefined,
    fetch: OAuthMetadataFetch,
    allowInteractive: boolean,
    forceRefresh = false,
    signal?: AbortSignal,
    rejectedTokens?: StoredOAuthTokens | null
  ): Promise<StoredOAuthSession | null> {
    signal?.throwIfAborted();
    const canonicalResource = canonicalizeResourceIndicator(resource);
    return withOAuthSessionTransaction(sessionStore, canonicalResource, async () => {
      let session = await loadSession(canonicalResource);
      if (resourceStores !== undefined) {
        registeredClients.clear();
        if (!resourceStores.initialGrantAllowed) initialGrantConsumed = true;
      }
      if (session !== null) assertRegistrationIssuer(session.client, session.authorizationServer);
      if (configuredClient !== null && discovery !== undefined) assertRegistrationIssuer(configuredClient, discovery.authorizationServer);
      if (session !== null && initialGrant?.resource === canonicalResource) initialGrantConsumed = true;
      signal?.throwIfAborted();
      if (discovery !== undefined && getOwnString(
        discovery.authorizationServerMetadata, "issuer"
      ) !== discovery.authorizationServer) {
        throw new Error("OAuth discovery authorization-server issuer mismatch");
      }
      if (session !== null && (
        canonicalizeResourceIndicator(session.resource) !== canonicalResource
        || getOwnString(session.discovery.authorizationServerMetadata, "issuer") !== session.authorizationServer
        || (discovery !== undefined && discovery.authorizationServer !== session.authorizationServer)
      )) {
        await clearSession(canonicalResource);
        session = null;
      }
      if (session === null && discovery !== undefined && !initialGrantConsumed && initialGrant?.resource === canonicalResource &&
        initialGrant.tokens !== undefined && initialGrant.client !== null) {
        assertSecureOAuthFlowEndpoints(discovery.authorizationServerMetadata);
        session = { resource: canonicalResource, authorizationServer: discovery.authorizationServer,
          client: initialGrant.client, tokens: initialGrant.tokens,
          ...(requestedScope === undefined ? {} : { requestedScope }), discovery: toStoredDiscovery(discovery) };
        await saveSession(canonicalResource, session);
        initialGrantConsumed = true;
        signal?.throwIfAborted();
      }
      if (forceRefresh && rejectedTokens !== undefined && (rejectedTokens === null || session?.tokens === undefined || !sameTokenGrant(session.tokens, rejectedTokens)))
        forceRefresh = false;
      const sessionDiscovery = resolveDiscovery(discovery, session);
      if ((clientMode === "static" || configuredClient !== null || initialGrant !== undefined) && session !== null && (session.tokens !== undefined || session.refreshState === "pending")) {
        const configured = configuredClient;
        if (configured === null || configured.clientId !== session.client.clientId || configured.clientSecret !== session.client.clientSecret)
          throw new Error("Stored session belongs to a different OAuth client; use separate persistence or explicitly reset it");
      }
      if (requestedScope !== undefined && session?.tokens !== undefined && normalizeOAuthScope(session.tokens.scope ?? session.requestedScope) !== requestedScope)
        throw new Error("Stored session does not match the requested OAuth scope; authorize again or select separate persistence");
      if (configuredTokenMethod !== undefined && session !== null && (session.tokens !== undefined || session.refreshState === "pending") &&
        (session.client.tokenEndpointAuthMethod ?? (session.client.clientSecret === undefined ? "none" : "client_secret_post")) !== configuredTokenMethod)
        throw new Error("Stored session does not match the requested OAuth token endpoint authentication; select separate persistence or reset it");

      if (session?.refreshState === "pending") {
        if (!allowInteractive || !interactiveEnabled || sessionDiscovery === undefined)
          throw new Error("OAuth refresh outcome is unknown; authorize again before using this resource");
        return authorizeSession(canonicalResource, clearSessionTokens(session), sessionDiscovery, fetch, signal);
      }

      if (session?.tokens !== undefined && !forceRefresh && !isExpired(session.tokens, now)) {
        return session;
      }

      if (
        session?.tokens?.refreshToken !== undefined &&
        sessionDiscovery !== undefined &&
        (forceRefresh || isExpired(session.tokens, now))
      ) {
        if (hasExpiredClientSecret(session.client, now)) {
          if (!allowInteractive || !interactiveEnabled || clientMode === "static" || configuredClient?.registration !== undefined)
            throw new Error("OAuth client secret has expired; authorize again or update the imported registration");
          return authorizeSession(canonicalResource, clearSessionTokens(session), sessionDiscovery, fetch, signal);
        }
        session = await refreshSession(canonicalResource, session, sessionDiscovery, fetch, signal);
        if (session?.tokens !== undefined && !isExpired(session.tokens, now)) {
          return session;
        }
      }

      if (forceRefresh && session?.tokens !== undefined) {
        session = clearSessionTokens(session);
        await saveSession(canonicalResource, session);
      }

      if (!allowInteractive || sessionDiscovery === undefined) {
        return session;
      }

      if (!interactiveEnabled) throw new Error("OAuth interactive authorization is disabled");
      return authorizeSession(canonicalResource, session, sessionDiscovery, fetch, signal);
    }, { signal, timeoutMs: sessionLockTimeoutMs });
  }

  async function refreshSession(
    resource: string,
    session: StoredOAuthSession,
    discovery: OAuthDiscoveryResult,
    fetch: OAuthMetadataFetch,
    signal?: AbortSignal
  ): Promise<StoredOAuthSession | null> {
    signal?.throwIfAborted();
    assertSecureOAuthFlowEndpoints(discovery.authorizationServerMetadata);

    if (session.tokens?.refreshToken === undefined) {
      return session;
    }
    assertTokenEndpointAuthentication(session.client, discovery.authorizationServerMetadata);

    const pendingSession: StoredOAuthSession = { ...clearSessionTokens(session), refreshState: "pending" };
    await saveSession(resource, pendingSession);
    signal?.throwIfAborted();

    let refreshAttempted = false;
    let refreshedTokens: StoredOAuthTokens;

    while (true) {
      try {
        refreshedTokens = await refreshAccessToken({
          tokenEndpoint: requireOwnString(
            discovery.authorizationServerMetadata,
            "token_endpoint",
            "Authorization server metadata"
          ),
          clientId: session.client.clientId,
          clientSecret: session.client.clientSecret,
          tokenEndpointAuthMethod: session.client.tokenEndpointAuthMethod,
          refreshToken: session.tokens.refreshToken,
          resource,
          fetch, signal,
          now
        });
        break;
      } catch (error) {
        signal?.throwIfAborted();
        // Network errors, lost/malformed bodies and gateway failures cannot
        // establish whether a rotating refresh token was already consumed.
        if (!(error instanceof OAuthError) || !error.outcomeKnown) throw error;
        if (error.error === "invalid_grant") {
          const clearedSession = clearSessionTokens(session);
          await saveSession(resource, clearedSession);
          return clearedSession;
        }

        if (
          shouldReRegisterStoredDynamicClient(
            error,
            await loadRegisteredClient(discovery.authorizationServer),
            false
          )
        ) {
          await clearRegisteredClient(discovery.authorizationServer);
          await clearSession(resource);
          return null;
        }

        if (!refreshAttempted && isRetryableOAuthError(error)) {
          refreshAttempted = true;
          continue;
        }

        await saveSession(resource, session);
        throw error;
      }
    }

    const updatedSession: StoredOAuthSession = {
      ...session,
      tokens: {
        ...refreshedTokens,
        refreshToken: refreshedTokens.refreshToken ?? session.tokens.refreshToken,
        scope: refreshedTokens.scope ?? session.tokens.scope
      },
      discovery: toStoredDiscovery(discovery)
    };
    if (requestedScope !== undefined && normalizeOAuthScope(updatedSession.tokens?.scope ?? session.requestedScope) !== requestedScope)
      throw new Error("OAuth refresh response does not match the requested OAuth scope; authorize again");
    await saveSession(resource, updatedSession);
    return updatedSession;
  }

  async function authorizeSession(
    resource: string,
    existingSession: StoredOAuthSession | null,
    discovery: OAuthDiscoveryResult,
    fetch: OAuthMetadataFetch,
    signal?: AbortSignal
  ): Promise<StoredOAuthSession> {
    signal?.throwIfAborted();
    assertS256PkceSupport(discovery.authorizationServerMetadata);
    assertSecureOAuthFlowEndpoints(discovery.authorizationServerMetadata);
    let currentSession = existingSession;
    let transientRetryAttempted = false;
    let reRegistrationAttempted = false;

    while (true) {
      const loopback = await createLoopbackAuthorizationSession({
        ...browser,
        signal: browser.signal === undefined ? signal : signal === undefined ? browser.signal : AbortSignal.any([signal, browser.signal])
      });
      let resolvedClient: ResolvedOAuthClient | null = null;

      try {
        resolvedClient = await resolveClient(
          currentSession,
          discovery,
          loopback.redirectUri,
          fetch,
          signal
        );
        assertTokenEndpointAuthentication(resolvedClient.client, discovery.authorizationServerMetadata);
        const sessionWithoutTokens: StoredOAuthSession = {
          resource,
          authorizationServer: discovery.authorizationServer,
          client: resolvedClient.client,
          ...(requestedScope === undefined ? {} : { requestedScope }),
          discovery: toStoredDiscovery(discovery)
        };
        await saveSession(resource, sessionWithoutTokens);

        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        const authorizationUrl = buildAuthorizationUrl({
          metadata: discovery.authorizationServerMetadata,
          resource,
          clientId: resolvedClient.client.clientId,
          redirectUri: loopback.redirectUri,
          codeChallenge: challenge,
          clientMetadata
        });
        const code = await loopback.waitForCode(authorizationUrl);
        const tokens = await exchangeAuthorizationCode({
          tokenEndpoint: requireOwnString(
            discovery.authorizationServerMetadata,
            "token_endpoint",
            "Authorization server metadata"
          ),
          clientId: resolvedClient.client.clientId,
          clientSecret: resolvedClient.client.clientSecret,
          tokenEndpointAuthMethod: resolvedClient.client.tokenEndpointAuthMethod,
          code,
          codeVerifier: verifier,
          redirectUri: loopback.redirectUri,
          resource,
          fetch, signal,
          now
        });
        if (requestedScope !== undefined && tokens.scope !== undefined && normalizeOAuthScope(tokens.scope) !== requestedScope)
          throw new Error("OAuth authorization response does not match the requested OAuth scope");

        const session: StoredOAuthSession = {
          ...sessionWithoutTokens,
          tokens
        };

        await saveSession(resource, session);
        return session;
      } catch (error) {
        signal?.throwIfAborted();
        if (shouldReRegisterStoredDynamicClient(error, resolvedClient, reRegistrationAttempted)) {
          reRegistrationAttempted = true;
          await clearRegisteredClient(discovery.authorizationServer);
          await clearSession(resource);
          currentSession = null;
          continue;
        }

        if (!transientRetryAttempted && isRetryableOAuthError(error)) {
          transientRetryAttempted = true;
          await clearSession(resource);
          currentSession = null;
          continue;
        }

        throw error;
      } finally {
        loopback.close();
      }
    }
  }

  async function resolveClient(
    existingSession: StoredOAuthSession | null,
    discovery: OAuthDiscoveryResult,
    redirectUri: string,
    fetch: OAuthMetadataFetch,
    parentSignal?: AbortSignal
  ): Promise<ResolvedOAuthClient> {
    parentSignal?.throwIfAborted();

    if (clientMode === "static" || configuredClient?.registration !== undefined) {
      if (configuredClient === null) {
        throw new Error("OAuth client_id must not be blank");
      }
      assertRegistrationIssuer(configuredClient, discovery.authorizationServer);
      if (hasExpiredClientSecret(configuredClient, now))
        throw new Error("OAuth client secret has expired; update the imported registration");

      return {
        kind: "static",
        fromStoredRegistration: false,
        client: configuredClient
      };
    }

    const registrationEndpoint = getOwnString(
      discovery.authorizationServerMetadata,
      "registration_endpoint"
    );
    if (registrationEndpoint === undefined && configuredClient !== null) {
      return {
        kind: "static",
        fromStoredRegistration: false,
        client: configuredClient
      };
    }

    let storedClient = await loadRegisteredClient(discovery.authorizationServer);
    const importedClient = existingSession?.client.registrationOwnership === "caller" ? existingSession.client :
      storedClient?.registrationOwnership === "caller" ? storedClient : undefined;
    if (importedClient !== undefined) {
      assertRegistrationIssuer(importedClient, discovery.authorizationServer);
      if (hasExpiredClientSecret(importedClient, now)) throw new Error("OAuth client secret has expired; update the imported registration");
      if (!registrationMatchesRedirect(importedClient, redirectUri))
        throw new Error("OAuth imported registration does not match the configured redirect URI; update its callback configuration");
      return { kind: "static", fromStoredRegistration: false, client: importedClient };
    }
    if (storedClient !== null) {
      assertRegistrationIssuer(storedClient, discovery.authorizationServer);
      if (hasExpiredClientSecret(storedClient, now) || !registrationMatchesRedirect(storedClient, redirectUri)) {
        await clearRegisteredClient(discovery.authorizationServer);
        storedClient = null;
      }
    }
    if (storedClient !== null) {
      return {
        kind: "dynamic",
        fromStoredRegistration: true,
        client: storedClient
      };
    }

    if (registrationEndpoint === undefined) {
      if (existingSession !== null && existingSession.client.clientId.length > 0 && !hasExpiredClientSecret(existingSession.client, now) && registrationMatchesRedirect(existingSession.client, redirectUri)) {
        return {
          kind: "dynamic",
          fromStoredRegistration: true,
          client: existingSession.client
        };
      }

      throw new Error("Authorization server metadata is missing registration_endpoint");
    }

    if (existingSession !== null && existingSession.client.clientId.length > 0 && !hasExpiredClientSecret(existingSession.client, now) && registrationMatchesRedirect(existingSession.client, redirectUri)) {
      const isConfiguredStaticFallback =
        configuredClient !== null &&
        existingSession.client.clientId === configuredClient.clientId &&
        existingSession.client.clientSecret === configuredClient.clientSecret;

      if (!isConfiguredStaticFallback) {
        await saveRegisteredClient(discovery.authorizationServer, existingSession.client);
        return {
          kind: "dynamic",
          fromStoredRegistration: true,
          client: existingSession.client
        };
      }
    }

    const supported = getSupportedTokenAuthMethods(discovery.authorizationServerMetadata);
    const registrationMethod = requestedTokenMethod ?? (supported === undefined ? "none" :
      ["none", "client_secret_basic", "client_secret_post"].find(method => supported.includes(method)));
    if (registrationMethod === undefined || (supported !== undefined && !supported.includes(registrationMethod)))
      throw new Error("Authorization server does not support the requested OAuth token endpoint authentication");
    const registrationBody = buildClientRegistrationBody(
      clientMetadata,
      redirectUri,
      registrationMethod
    );
    const deadline = AbortSignal.timeout(30_000);
    const signal = parentSignal === undefined ? deadline : AbortSignal.any([parentSignal, deadline]);
    const response = await fetchMcpResponse(fetch, registrationEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(registrationBody),
      signal
    });
    const payload = await readOAuthJsonObjectResponse(response, signal);
    const registration = parseOAuthClientRegistration(payload);
    const registeredSecret = getOwnString(registration, "client_secret");
    const responseMethod = normalizeOAuthTokenEndpointAuthMethod(getOwnEntry(registration, "token_endpoint_auth_method")) ??
      requestedTokenMethod ?? (supported === undefined ? undefined : normalizeOAuthTokenEndpointAuthMethod(registrationMethod));
    const registeredClient = {
      clientId: registration.client_id.trim(),
      ...(registeredSecret === undefined ? {} : { clientSecret: registeredSecret.trim() }),
      ...(responseMethod === undefined ? {} : { tokenEndpointAuthMethod: responseMethod }),
      registration
    };
    assertRegistrationIssuer(registeredClient, discovery.authorizationServer);
    if (hasExpiredClientSecret(registeredClient, now))
      throw new Error("OAuth client secret has expired in the registration response");
    if (!registrationMatchesRedirect(registeredClient, redirectUri, true))
      throw new Error("OAuth registration response does not match the requested redirect URI");
    const clientWithRedirect = { ...registeredClient, requestedRedirectUri: redirectUri };
    await saveRegisteredClient(discovery.authorizationServer, clientWithRedirect);

    return {
      kind: "dynamic",
      fromStoredRegistration: false,
      client: clientWithRedirect
    };
  }

  async function loadSession(resource: string): Promise<StoredOAuthSession | null> {
    return normalizeLoadedSession(await sessionStore.load(resource));
  }

  async function saveSession(resource: string, session: StoredOAuthSession): Promise<void> {
    await sessionStore.save(resource, structuredClone(session));
  }

  async function clearSession(resource: string): Promise<void> {
    await sessionStore.clear(resource);
  }

  async function loadRegisteredClient(
    issuer: string
  ): Promise<StoredOAuthSession["client"] | null> {
    if (registeredClients.has(issuer)) {
      return registeredClients.get(issuer) ?? null;
    }

    if (clientStore === null) {
      return null;
    }

    const client = await clientStore.load(issuer);
    const normalizedClient = client === null ? null : normalizeStoredOAuthClient(client);
    if (client !== null && normalizedClient === null) {
      await clientStore.clear(issuer);
      return null;
    }

    registeredClients.set(issuer, normalizedClient);
    return normalizedClient;
  }

  async function saveRegisteredClient(
    issuer: string,
    client: StoredOAuthSession["client"]
  ): Promise<void> {
    registeredClients.set(issuer, client);
    if (clientStore !== null) {
      await clientStore.save(issuer, client);
    }
  }

  async function clearRegisteredClient(issuer: string): Promise<void> {
    registeredClients.delete(issuer);
    if (clientStore !== null) {
      await clientStore.clear(issuer);
    }
  }
}

function isProviderOptions(
  options: OAuthClientProviderOptions
): options is { provider: OAuthClientProvider } {
  return Object.prototype.hasOwnProperty.call(options, "provider");
}

function isExpired(tokens: StoredOAuthTokens, now: () => number): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt <= now();
}

function resolveDiscovery(
  discovery: OAuthDiscoveryResult | undefined,
  session: StoredOAuthSession | null
): OAuthDiscoveryResult | undefined {
  if (discovery !== undefined) {
    return {
      ...discovery,
      resource: canonicalizeResourceIndicator(discovery.resource)
    };
  }

  if (session === null) {
    return undefined;
  }

  const metadata = session.discovery.authorizationServerMetadata;
  const issuer = getOwnString(metadata, "issuer");
  const authorizationEndpoint = getOwnString(metadata, "authorization_endpoint");
  const tokenEndpoint = getOwnString(metadata, "token_endpoint");
  const codeChallengeMethodsSupported = getOwnStringArray(
    metadata,
    "code_challenge_methods_supported"
  );
  if (
    issuer === undefined ||
    authorizationEndpoint === undefined ||
    tokenEndpoint === undefined ||
    codeChallengeMethodsSupported === undefined ||
    !codeChallengeMethodsSupported.includes("S256")
  ) {
    return undefined;
  }

  return {
    resource: canonicalizeResourceIndicator(session.resource),
    resourceMetadataUrl: session.discovery.resourceMetadataUrl,
    resourceMetadata: session.discovery
      .resourceMetadata as OAuthDiscoveryResult["resourceMetadata"],
    authorizationServer: session.authorizationServer,
    authorizationServerMetadataUrl: "",
    authorizationServerMetadata: metadata as OAuthAuthorizationServerMetadata
  };
}

function sameTokenGrant(left: StoredOAuthTokens, right: StoredOAuthTokens): boolean {
  return left.accessToken === right.accessToken && left.refreshToken === right.refreshToken &&
    left.tokenType === right.tokenType && left.expiresAt === right.expiresAt && left.scope === right.scope;
}

function clearSessionTokens(session: StoredOAuthSession): StoredOAuthSession {
  const nextSession = { ...session };
  delete nextSession.tokens;
  delete nextSession.refreshState;
  return nextSession;
}

function hasCachedAccessToken(
  session: StoredOAuthSession | null
): session is StoredOAuthSession & { tokens: StoredOAuthTokens } {
  return session?.tokens?.accessToken !== undefined;
}

function normalizeLoadedSession(session: StoredOAuthSession | null): StoredOAuthSession | null {
  if (session === null) {
    return null;
  }
  const refreshState = getOwnEntry(session, "refreshState");
  if (refreshState !== undefined && (refreshState !== "pending" || getOwnEntry(session, "tokens") !== undefined))
    throw new Error("Stored OAuth refresh state is invalid");

  const client = normalizeStoredOAuthClient(getOwnEntry(session, "client"));
  if (client === null) {
    return { ...session, client: { clientId: "" }, tokens: undefined };
  }

  return {
    ...session,
    client,
    tokens: normalizeStoredTokens(getOwnEntry(session, "tokens"))
  };
}


function normalizeImportedTokens(value: unknown, now: () => number): StoredOAuthTokens | undefined {
  if (!isObjectRecord(value)) return undefined;
  const absolute = getOwnEntry(value, "expiresAt");
  const lifetime = getOwnEntry(value, "expiresIn");
  const issuedAt = getOwnEntry(value, "issuedAt");
  if (lifetime !== undefined && (typeof lifetime !== "number" || !Number.isSafeInteger(lifetime) || lifetime < 0))
    throw new Error("OAuth initial grant has invalid relative expiry");
  if (issuedAt !== undefined && (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) ||
    Math.abs(issuedAt) > MAX_JS_DATE_MS))
    throw new Error("OAuth initial grant has invalid issuance time");
  const expiresAt = absolute !== undefined && absolute !== null ? absolute :
    lifetime === undefined ? null : (issuedAt === undefined ? now() : issuedAt as number) + (lifetime as number) * 1000;
  return normalizeStoredTokens({ ...value, expiresAt });
}

function normalizeStoredTokens(value: unknown): StoredOAuthTokens | undefined {
  if (value === undefined || !isObjectRecord(value)) {
    return undefined;
  }

  const accessToken = getOwnString(value, "accessToken");
  const tokenType = getOwnString(value, "tokenType");
  const expiresAt = getOwnEntry(value, "expiresAt");
  const refreshToken = getOwnEntry(value, "refreshToken");
  const scope = getOwnEntry(value, "scope");
  const normalizedAccessToken = accessToken?.trim();
  const normalizedRefreshToken = typeof refreshToken === "string" ? refreshToken.trim() : undefined;
  const normalizedScope = normalizeOAuthScope(scope);

  if (
    accessToken === undefined ||
    normalizedAccessToken === undefined ||
    normalizedAccessToken.length === 0 ||
    tokenType !== "Bearer" ||
    !(
      expiresAt === null ||
      (typeof expiresAt === "number" &&
        Number.isSafeInteger(expiresAt) &&
        expiresAt <= MAX_JS_DATE_MS &&
        Number.isFinite(new Date(expiresAt).getTime()))
    ) ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== "string" ||
        normalizedRefreshToken === undefined ||
        normalizedRefreshToken.length === 0))
  ) {
    return undefined;
  }

  return {
    accessToken: normalizedAccessToken,
    tokenType,
    expiresAt,
    ...(normalizedRefreshToken === undefined ? {} : { refreshToken: normalizedRefreshToken }),
    ...(normalizedScope === undefined || normalizedScope.length === 0
      ? {}
      : { scope: normalizedScope })
  };
}

function getClientMetadata(
  client: DefaultOAuthClientProviderOptions["client"]
): OAuthClientMetadata | undefined {
  if (client.metadata === undefined) {
    return undefined;
  }

  return {
    clientName: normalizeOptionalOAuthString(client.metadata.clientName),
    scope: normalizeOAuthScope(client.metadata.scope),
    softwareId: normalizeOptionalOAuthString(client.metadata.softwareId),
    softwareVersion: normalizeOptionalOAuthString(client.metadata.softwareVersion)
  };
}

function normalizeConfiguredClient(
  client: DefaultOAuthClientProviderOptions["client"]
): StoredOAuthSession["client"] | null {
  const registration = client.registration === undefined ? undefined : parseOAuthClientRegistration(client.registration);
  const clientId = normalizeOptionalOAuthString(client.clientId) ?? registration?.client_id.trim();
  if (clientId === undefined) return null;
  const clientSecret = normalizeOptionalOAuthString(client.clientSecret) ?? (registration === undefined ? undefined : getOwnString(registration, "client_secret")?.trim());
  return normalizeStoredOAuthClient({ clientId, clientSecret, registration,
    ...(registration === undefined ? {} : { registrationOwnership: "caller" }),
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod });
}

function normalizeOptionalOAuthString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}


function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnString(record: object, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}

function requireOwnString(record: object, key: string, label: string): string {
  const value = getOwnString(record, key);
  if (value === undefined) {
    throw new Error(`${label} is missing ${key}`);
  }

  return value;
}

function getOwnStringArray(record: object, key: string): string[] | undefined {
  const value = getOwnEntry(record, key);
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function buildAuthorizationUrl(input: {
  metadata: OAuthAuthorizationServerMetadata;
  resource: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  clientMetadata: OAuthClientMetadata | undefined;
}): string {
  const authorizationEndpoint = requireOwnString(
    input.metadata,
    "authorization_endpoint",
    "Authorization server metadata"
  );
  const issuer = requireOwnString(input.metadata, "issuer", "Authorization server metadata");
  const url = new URL(authorizationEndpoint);
  const resource = canonicalizeResourceIndicator(input.resource);
  const state = createAuthorizationState({
    issuer,
    requireIssuer:
      getOwnEntry(input.metadata, "authorization_response_iss_parameter_supported") === true
  });
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", resource);
  url.searchParams.set("state", state);

  if (input.clientMetadata?.scope !== undefined && input.clientMetadata.scope.length > 0) {
    url.searchParams.set("scope", input.clientMetadata.scope);
  }

  return url.toString();
}

function assertS256PkceSupport(metadata: OAuthAuthorizationServerMetadata): void {
  if (!getOwnStringArray(metadata, "code_challenge_methods_supported")?.includes("S256")) {
    throw new Error(
      "Authorization server metadata must advertise code_challenge_methods_supported including S256"
    );
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1).toLowerCase() : hostname.toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]" ||
    (isIP(normalizedHostname) === 4 && normalizedHostname.startsWith("127."))
  );
}

function assertSecureUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error(`${label} must not include credentials or fragment`);
  }
  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return;
  }

  throw new Error(`${label} must use https unless it targets a loopback host`);
}

function assertSecureOAuthFlowEndpoints(metadata: OAuthAuthorizationServerMetadata): void {
  const authorizationEndpoint = requireOwnString(
    metadata,
    "authorization_endpoint",
    "Authorization server metadata"
  );
  const tokenEndpoint = requireOwnString(
    metadata,
    "token_endpoint",
    "Authorization server metadata"
  );
  const registrationEndpoint = getOwnString(metadata, "registration_endpoint");

  assertNoAccessTokenInUrl(authorizationEndpoint, "Authorization endpoint");
  assertNoAccessTokenInUrl(tokenEndpoint, "Token endpoint");
  assertSecureUrl(authorizationEndpoint, "Authorization endpoint");
  assertSecureUrl(tokenEndpoint, "Token endpoint");

  if (registrationEndpoint !== undefined) {
    assertNoAccessTokenInUrl(registrationEndpoint, "Registration endpoint");
    assertSecureUrl(registrationEndpoint, "Registration endpoint");
  }
}

function assertNoAccessTokenInUrl(value: string | URL, label: string): void {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  if (url.searchParams.has("access_token")) {
    throw new Error(`${label} must not include access_token in the URI`);
  }
}

function assertRequestMatchesResource(requestUrl: string, resource: string): void {
  if (requestUrl !== resource) {
    throw new Error(
      `OAuth request URL ${requestUrl} does not match discovered resource ${resource}`
    );
  }
}

function assertRegistrationIssuer(client: StoredOAuthSession["client"], issuer: string): void {
  const registrationIssuer = client.registration === undefined ? undefined : getOwnString(client.registration, "issuer");
  if (registrationIssuer !== undefined && registrationIssuer !== issuer)
    throw new Error("OAuth client registration issuer does not match the authorization server");
}

function hasExpiredClientSecret(client: StoredOAuthSession["client"], now: () => number): boolean {
  if (client.clientSecret === undefined || client.tokenEndpointAuthMethod === "none" || client.registration === undefined) return false;
  const expiry = getOwnEntry(client.registration, "client_secret_expires_at");
  return typeof expiry === "number" && expiry !== 0 && expiry <= now() / 1000;
}

function getSupportedTokenAuthMethods(metadata: OAuthAuthorizationServerMetadata): string[] | undefined {
  const value = getOwnEntry(metadata, "token_endpoint_auth_methods_supported");
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 128 || value.some(method => typeof method !== "string"))
    throw new Error("Invalid OAuth token endpoint authentication metadata");
  return value as string[];
}

function assertTokenEndpointAuthentication(client: StoredOAuthSession["client"], metadata: OAuthAuthorizationServerMetadata): void {
  const method = client.tokenEndpointAuthMethod ?? (client.clientSecret === undefined ? "none" : "client_secret_post");
  if (method !== "none" && client.clientSecret === undefined)
    throw new Error("OAuth token endpoint authentication requires a client secret");
  const supported = getSupportedTokenAuthMethods(metadata);
  if (supported !== undefined && !supported.includes(method))
    throw new Error("Authorization server does not support the requested OAuth token endpoint authentication");
}

function buildClientRegistrationBody(
  metadata: OAuthClientMetadata | undefined,
  redirectUri: string,
  tokenEndpointAuthMethod: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: tokenEndpointAuthMethod
  };
  const clientName = metadata === undefined ? undefined : getOwnString(metadata, "clientName");
  const scope = metadata === undefined ? undefined : getOwnString(metadata, "scope");
  const softwareId = metadata === undefined ? undefined : getOwnString(metadata, "softwareId");
  const softwareVersion =
    metadata === undefined ? undefined : getOwnString(metadata, "softwareVersion");

  if (clientName !== undefined && clientName.length > 0) {
    body.client_name = clientName;
  }

  if (scope !== undefined && scope.length > 0) {
    body.scope = scope;
  }

  if (softwareId !== undefined && softwareId.length > 0) {
    body.software_id = softwareId;
  }

  if (softwareVersion !== undefined && softwareVersion.length > 0) {
    body.software_version = softwareVersion;
  }

  return body;
}

function toStoredDiscovery(discovery: OAuthDiscoveryResult): StoredOAuthSession["discovery"] {
  return {
    resourceMetadataUrl: discovery.resourceMetadataUrl,
    resourceMetadata: discovery.resourceMetadata,
    authorizationServerMetadata: discovery.authorizationServerMetadata
  };
}

interface ResolvedOAuthClient {
  kind: "dynamic" | "static";
  fromStoredRegistration: boolean;
  client: StoredOAuthSession["client"];
}

function shouldReRegisterStoredDynamicClient(
  error: unknown,
  client: ResolvedOAuthClient | StoredOAuthSession["client"] | null,
  alreadyAttempted: boolean
): boolean {
  if (!(error instanceof OAuthError) || error.error !== "invalid_client" || alreadyAttempted) {
    return false;
  }

  if (client === null) {
    return false;
  }

  if ("kind" in client) {
    return client.kind === "dynamic" && client.fromStoredRegistration;
  }

  return client.registrationOwnership !== "caller";
}
