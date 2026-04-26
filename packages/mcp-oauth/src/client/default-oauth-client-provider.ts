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
  StoredOAuthTokens,
} from "./types.js";
import {
  createAuthStoreClientStore,
  createAuthStoreSessionStore,
  type OAuthClientStore,
} from "./auth-store-session-store.js";
import { createLoopbackAuthorizationSession } from "./loopback-authorization.js";
import { createAuthorizationState } from "./authorization-state.js";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce.js";
import {
  exchangeAuthorizationCode,
  OAuthError,
  refreshAccessToken,
  isRetryableOAuthError,
  readOAuthJsonObjectResponse,
} from "./token-endpoint.js";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";

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
  const sessionStore = options.sessionStore ?? createAuthStoreSessionStore(options.authStore);
  const clientStore = options.authStore === undefined ? null : createAuthStoreClientStore(options.authStore);
  const now = options.now ?? Date.now;
  const sessions = new Map<string, StoredOAuthSession | null>();
  const registeredClients = new Map<string, StoredOAuthSession["client"] | null>();
  const refreshPromises = new Map<string, Promise<StoredOAuthSession | null>>();
  const authorizationPromises = new Map<string, Promise<StoredOAuthSession>>();

  return {
    async authorizeRequest(input): Promise<void> {
      assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
      const requestUrl = canonicalizeResourceIndicator(input.requestUrl);
      const session = await ensureAuthorizedSession(requestUrl, undefined, input.fetch, false);
      const accessToken = session?.tokens?.accessToken;
      if (session === null || accessToken === undefined) {
        return;
      }

      assertRequestMatchesResource(requestUrl, session.resource);

      input.headers.set("Authorization", `Bearer ${accessToken}`);
    },

    async handleUnauthorized(input) {
      try {
        assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
        const requestUrl = canonicalizeResourceIndicator(input.requestUrl);
        const resource = canonicalizeResourceIndicator(input.discovery.resource);
        assertRequestMatchesResource(requestUrl, resource);
        const forceRefresh =
          hasCachedAccessToken(await loadSession(resource))
          && input.challenge?.params.error === "invalid_token";
        const session = await ensureAuthorizedSession(
          resource,
          {
            ...input.discovery,
            resource,
          },
          input.fetch,
          true,
          forceRefresh
        );

        if (session?.tokens?.accessToken === undefined) {
          return { action: "fail" } as const;
        }

        return { action: "retry" } as const;
      } catch (error) {
        return {
          action: "fail",
          error: error instanceof Error ? error : new Error(String(error)),
        } as const;
      }
    },
  };

  async function ensureAuthorizedSession(
    resource: string,
    discovery: OAuthDiscoveryResult | undefined,
    fetch: OAuthMetadataFetch,
    allowInteractive: boolean,
    forceRefresh = false
  ): Promise<StoredOAuthSession | null> {
    const canonicalResource = canonicalizeResourceIndicator(resource);
    let session = await loadSession(canonicalResource);
    const sessionDiscovery = resolveDiscovery(discovery, session);

    if (session?.tokens !== undefined && !forceRefresh && !isExpired(session.tokens, now)) {
      return session;
    }

    if (
      session?.tokens?.refreshToken !== undefined
      && sessionDiscovery !== undefined
      && (forceRefresh || isExpired(session.tokens, now))
    ) {
      session = await refreshSession(canonicalResource, session, sessionDiscovery, fetch);
      if (session?.tokens !== undefined && !isExpired(session.tokens, now)) {
        return session;
      }
    }

    if (!allowInteractive || sessionDiscovery === undefined) {
      return session;
    }

    if (forceRefresh && session?.tokens !== undefined) {
      return session;
    }

    return authorizeSession(canonicalResource, session, sessionDiscovery, fetch);
  }

  async function refreshSession(
    resource: string,
    session: StoredOAuthSession,
    discovery: OAuthDiscoveryResult,
    fetch: OAuthMetadataFetch
  ): Promise<StoredOAuthSession | null> {
    assertSecureOAuthFlowEndpoints(discovery.authorizationServerMetadata);

    const inFlight = refreshPromises.get(resource);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        if (session.tokens?.refreshToken === undefined) {
          return session;
        }

        let refreshAttempted = false;
        let refreshedTokens: StoredOAuthTokens;

        while (true) {
          try {
            refreshedTokens = await refreshAccessToken({
              tokenEndpoint: discovery.authorizationServerMetadata.token_endpoint,
              clientId: session.client.clientId,
              clientSecret: session.client.clientSecret,
              refreshToken: session.tokens.refreshToken,
              resource,
              fetch,
              now,
            });
            break;
          } catch (error) {
            if (error instanceof OAuthError && error.error === "invalid_grant") {
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

            throw error;
          }
        }

        const updatedSession: StoredOAuthSession = {
          ...session,
          tokens: refreshedTokens,
          discovery: toStoredDiscovery(discovery),
        };
        await saveSession(resource, updatedSession);
        return updatedSession;
      } finally {
        refreshPromises.delete(resource);
      }
    })();

    refreshPromises.set(resource, promise);
    return promise;
  }

  async function authorizeSession(
    resource: string,
    existingSession: StoredOAuthSession | null,
    discovery: OAuthDiscoveryResult,
    fetch: OAuthMetadataFetch
  ): Promise<StoredOAuthSession> {
    const inFlight = authorizationPromises.get(resource);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const promise = (async () => {
      assertS256PkceSupport(discovery.authorizationServerMetadata);
      assertSecureOAuthFlowEndpoints(discovery.authorizationServerMetadata);
      let currentSession = existingSession;
      let transientRetryAttempted = false;
      let reRegistrationAttempted = false;

      while (true) {
        const loopback = await createLoopbackAuthorizationSession({
          openBrowser: options.browser.openBrowser,
          readLine: options.browser.readLine,
          createServer: options.browser.createServer,
          landingPage: options.browser.landingPage,
        });
        let resolvedClient: ResolvedOAuthClient | null = null;

        try {
          resolvedClient = await resolveClient(currentSession, discovery, loopback.redirectUri, fetch);
          const sessionWithoutTokens: StoredOAuthSession = {
            resource,
            authorizationServer: discovery.authorizationServer,
            client: resolvedClient.client,
            discovery: toStoredDiscovery(discovery),
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
            clientMetadata: getClientMetadata(options.client),
          });
          const code = await loopback.waitForCode(authorizationUrl);
          const tokens = await exchangeAuthorizationCode({
            tokenEndpoint: discovery.authorizationServerMetadata.token_endpoint,
            clientId: resolvedClient.client.clientId,
            clientSecret: resolvedClient.client.clientSecret,
            code,
            codeVerifier: verifier,
            redirectUri: loopback.redirectUri,
            resource,
            fetch,
            now,
          });

          const session: StoredOAuthSession = {
            ...sessionWithoutTokens,
            tokens,
          };

          await saveSession(resource, session);
          return session;
        } catch (error) {
          if (
            shouldReRegisterStoredDynamicClient(error, resolvedClient, reRegistrationAttempted)
          ) {
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
    })();

    const finalPromise = promise.finally(() => {
      authorizationPromises.delete(resource);
    });
    authorizationPromises.set(resource, finalPromise);
    return finalPromise;
  }

  async function resolveClient(
    existingSession: StoredOAuthSession | null,
    discovery: OAuthDiscoveryResult,
    redirectUri: string,
    fetch: OAuthMetadataFetch
  ): Promise<ResolvedOAuthClient> {
    if (options.client.mode === "static") {
      return {
        kind: "static",
        fromStoredRegistration: false,
        client: {
          clientId: options.client.clientId,
          clientSecret: options.client.clientSecret,
        },
      };
    }

    const registrationEndpoint = discovery.authorizationServerMetadata.registration_endpoint;
    if (registrationEndpoint === undefined && options.client.clientId !== undefined) {
      return {
        kind: "static",
        fromStoredRegistration: false,
        client: {
          clientId: options.client.clientId,
          clientSecret: options.client.clientSecret,
        },
      };
    }

    const storedClient = await loadRegisteredClient(discovery.authorizationServer);
    if (storedClient !== null) {
      return {
        kind: "dynamic",
        fromStoredRegistration: true,
        client: storedClient,
      };
    }

    if (registrationEndpoint === undefined) {
      if (existingSession !== null && existingSession.client.clientId.length > 0) {
        return {
          kind: "dynamic",
          fromStoredRegistration: true,
          client: existingSession.client,
        };
      }

      throw new Error("Authorization server metadata is missing registration_endpoint");
    }

    if (existingSession !== null && existingSession.client.clientId.length > 0) {
      const isConfiguredStaticFallback =
        options.client.clientId !== undefined
        && existingSession.client.clientId === options.client.clientId
        && existingSession.client.clientSecret === options.client.clientSecret;

      if (!isConfiguredStaticFallback) {
        await saveRegisteredClient(discovery.authorizationServer, existingSession.client);
        return {
          kind: "dynamic",
          fromStoredRegistration: true,
          client: existingSession.client,
        };
      }
    }

    const registrationBody = buildClientRegistrationBody(
      getClientMetadata(options.client),
      redirectUri
    );
    const response = await fetch(registrationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(registrationBody),
    });
    const payload = await readOAuthJsonObjectResponse(response);

    if (
      typeof payload.client_id !== "string" ||
      payload.client_id.length === 0
    ) {
      throw new Error("OAuth client registration response missing client_id");
    }

    const registeredClient = {
      clientId: payload.client_id,
      clientSecret:
        typeof payload.client_secret === "string" && payload.client_secret.length > 0
          ? payload.client_secret
          : undefined,
    };
    await saveRegisteredClient(discovery.authorizationServer, registeredClient);

    return {
      kind: "dynamic",
      fromStoredRegistration: false,
      client: registeredClient,
    };
  }

  async function loadSession(resource: string): Promise<StoredOAuthSession | null> {
    if (sessions.has(resource)) {
      return sessions.get(resource) ?? null;
    }

    const session = await sessionStore.load(resource);
    sessions.set(resource, session);
    return session;
  }

  async function saveSession(resource: string, session: StoredOAuthSession): Promise<void> {
    sessions.set(resource, session);
    await sessionStore.save(resource, session);
  }

  async function clearSession(resource: string): Promise<void> {
    sessions.delete(resource);
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
    registeredClients.set(issuer, client);
    return client;
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
  return "provider" in options;
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
      resource: canonicalizeResourceIndicator(discovery.resource),
    };
  }

  if (session === null) {
    return undefined;
  }

  const metadata = session.discovery.authorizationServerMetadata;
  if (
    typeof metadata.issuer !== "string" ||
    typeof metadata.authorization_endpoint !== "string" ||
    typeof metadata.token_endpoint !== "string" ||
    !Array.isArray(metadata.code_challenge_methods_supported) ||
    !metadata.code_challenge_methods_supported.includes("S256")
  ) {
    return undefined;
  }

  return {
    resource: canonicalizeResourceIndicator(session.resource),
    resourceMetadataUrl: session.discovery.resourceMetadataUrl,
    resourceMetadata: session.discovery.resourceMetadata as OAuthDiscoveryResult["resourceMetadata"],
    authorizationServer: session.authorizationServer,
    authorizationServerMetadataUrl: "",
    authorizationServerMetadata: metadata as OAuthAuthorizationServerMetadata,
  };
}

function clearSessionTokens(session: StoredOAuthSession): StoredOAuthSession {
  const nextSession = { ...session };
  delete nextSession.tokens;
  return nextSession;
}

function hasCachedAccessToken(
  session: StoredOAuthSession | null
): session is StoredOAuthSession & { tokens: StoredOAuthTokens } {
  return session?.tokens?.accessToken !== undefined;
}

function getClientMetadata(
  client: DefaultOAuthClientProviderOptions["client"]
): OAuthClientMetadata | undefined {
  return client.metadata;
}

function buildAuthorizationUrl(input: {
  metadata: OAuthAuthorizationServerMetadata;
  resource: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  clientMetadata: OAuthClientMetadata | undefined;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  const resource = canonicalizeResourceIndicator(input.resource);
  const state = createAuthorizationState({
    issuer: input.metadata.issuer,
    requireIssuer: input.metadata.authorization_response_iss_parameter_supported === true,
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
  if (!metadata.code_challenge_methods_supported.includes("S256")) {
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
  return normalizedHostname === "localhost"
    || normalizedHostname === "::1"
    || normalizedHostname.startsWith("127.");
}

function assertSecureUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return;
  }

  throw new Error(`${label} must use https unless it targets a loopback host`);
}

function assertSecureOAuthFlowEndpoints(metadata: OAuthAuthorizationServerMetadata): void {
  assertNoAccessTokenInUrl(metadata.authorization_endpoint, "Authorization endpoint");
  assertNoAccessTokenInUrl(metadata.token_endpoint, "Token endpoint");
  assertSecureUrl(metadata.authorization_endpoint, "Authorization endpoint");
  assertSecureUrl(metadata.token_endpoint, "Token endpoint");

  if (metadata.registration_endpoint !== undefined) {
    assertNoAccessTokenInUrl(metadata.registration_endpoint, "Registration endpoint");
    assertSecureUrl(metadata.registration_endpoint, "Registration endpoint");
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

function buildClientRegistrationBody(
  metadata: OAuthClientMetadata | undefined,
  redirectUri: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  if (metadata?.clientName !== undefined && metadata.clientName.length > 0) {
    body.client_name = metadata.clientName;
  }

  if (metadata?.scope !== undefined && metadata.scope.length > 0) {
    body.scope = metadata.scope;
  }

  if (metadata?.softwareId !== undefined && metadata.softwareId.length > 0) {
    body.software_id = metadata.softwareId;
  }

  if (metadata?.softwareVersion !== undefined && metadata.softwareVersion.length > 0) {
    body.software_version = metadata.softwareVersion;
  }

  return body;
}

function toStoredDiscovery(discovery: OAuthDiscoveryResult): StoredOAuthSession["discovery"] {
  return {
    resourceMetadataUrl: discovery.resourceMetadataUrl,
    resourceMetadata: discovery.resourceMetadata,
    authorizationServerMetadata: discovery.authorizationServerMetadata,
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

  return true;
}
