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
  createAuthStoreSessionStore
} from "./auth-store-session-store.js";
import { createLoopbackAuthorizationSession } from "./loopback-authorization.js";
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
  const sessionStore = options.sessionStore ?? createAuthStoreSessionStore(options.authStore);
  const clientStore =
    options.authStore === undefined ? null : createAuthStoreClientStore(options.authStore);
  const now = options.now ?? Date.now;
  const registeredClients = new Map<string, StoredOAuthSession["client"] | null>();
  const refreshPromises = new Map<string, Promise<StoredOAuthSession | null>>();
  const authorizationPromises = new Map<string, Promise<StoredOAuthSession>>();

  return {
    async authorizeRequest(input): Promise<void> {
      assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
      const requestUrl = canonicalizeResourceIndicator(input.requestUrl);
      const session = await ensureAuthorizedSession(requestUrl, undefined, input.fetch, false);
      const accessToken = session?.tokens?.accessToken;
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
    },

    async handleUnauthorized(input) {
      try {
        assertNoAccessTokenInUrl(input.requestUrl, "Protected resource request URL");
        const requestUrl = canonicalizeResourceIndicator(input.requestUrl);
        const resource = canonicalizeResourceIndicator(input.discovery.resource);
        assertRequestMatchesResource(requestUrl, resource);
        const forceRefresh =
          hasCachedAccessToken(await loadSession(resource)) &&
          input.challenge?.params.error === "invalid_token";
        const session = await ensureAuthorizedSession(
          resource,
          {
            ...input.discovery,
            resource
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
    forceRefresh = false
  ): Promise<StoredOAuthSession | null> {
    const canonicalResource = canonicalizeResourceIndicator(resource);
    let session = await loadSession(canonicalResource);
    const sessionDiscovery = resolveDiscovery(discovery, session);

    if (session?.tokens !== undefined && !forceRefresh && !isExpired(session.tokens, now)) {
      return session;
    }

    if (
      session?.tokens?.refreshToken !== undefined &&
      sessionDiscovery !== undefined &&
      (forceRefresh || isExpired(session.tokens, now))
    ) {
      session = await refreshSession(canonicalResource, session, sessionDiscovery, fetch);
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
              tokenEndpoint: requireOwnString(
                discovery.authorizationServerMetadata,
                "token_endpoint",
                "Authorization server metadata"
              ),
              clientId: session.client.clientId,
              clientSecret: session.client.clientSecret,
              refreshToken: session.tokens.refreshToken,
              resource,
              fetch,
              now
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
          tokens: {
            ...refreshedTokens,
            refreshToken: refreshedTokens.refreshToken ?? session.tokens.refreshToken
          },
          discovery: toStoredDiscovery(discovery)
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
          landingPage: options.browser.landingPage
        });
        let resolvedClient: ResolvedOAuthClient | null = null;

        try {
          resolvedClient = await resolveClient(
            currentSession,
            discovery,
            loopback.redirectUri,
            fetch
          );
          const sessionWithoutTokens: StoredOAuthSession = {
            resource,
            authorizationServer: discovery.authorizationServer,
            client: resolvedClient.client,
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
            clientMetadata: getClientMetadata(options.client)
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
            code,
            codeVerifier: verifier,
            redirectUri: loopback.redirectUri,
            resource,
            fetch,
            now
          });

          const session: StoredOAuthSession = {
            ...sessionWithoutTokens,
            tokens
          };

          await saveSession(resource, session);
          return session;
        } catch (error) {
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
    const configuredClient = normalizeConfiguredClient(options.client);

    if (options.client.mode === "static") {
      if (configuredClient === null) {
        throw new Error("OAuth client_id must not be blank");
      }

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

    const storedClient = await loadRegisteredClient(discovery.authorizationServer);
    if (storedClient !== null) {
      return {
        kind: "dynamic",
        fromStoredRegistration: true,
        client: storedClient
      };
    }

    if (registrationEndpoint === undefined) {
      if (existingSession !== null && existingSession.client.clientId.length > 0) {
        return {
          kind: "dynamic",
          fromStoredRegistration: true,
          client: existingSession.client
        };
      }

      throw new Error("Authorization server metadata is missing registration_endpoint");
    }

    if (existingSession !== null && existingSession.client.clientId.length > 0) {
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

    const registrationBody = buildClientRegistrationBody(
      getClientMetadata(options.client),
      redirectUri
    );
    const response = await fetch(registrationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(registrationBody)
    });
    const payload = await readOAuthJsonObjectResponse(response);
    const clientId = getOwnString(payload, "client_id");

    if (clientId === undefined || clientId.trim().length === 0) {
      throw new Error("OAuth client registration response missing client_id");
    }

    const clientSecret = getOwnString(payload, "client_secret");
    const registeredClient = {
      clientId: clientId.trim(),
      clientSecret:
        clientSecret !== undefined && clientSecret.trim().length > 0
          ? clientSecret.trim()
          : undefined
    };
    await saveRegisteredClient(discovery.authorizationServer, registeredClient);

    return {
      kind: "dynamic",
      fromStoredRegistration: false,
      client: registeredClient
    };
  }

  async function loadSession(resource: string): Promise<StoredOAuthSession | null> {
    return normalizeLoadedSession(await sessionStore.load(resource));
  }

  async function saveSession(resource: string, session: StoredOAuthSession): Promise<void> {
    await sessionStore.save(resource, session);
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
    const normalizedClient = client === null ? null : normalizeStoredClient(client);
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

function normalizeLoadedSession(session: StoredOAuthSession | null): StoredOAuthSession | null {
  if (session === null) {
    return null;
  }

  const client = normalizeStoredClient(getOwnEntry(session, "client"));
  if (client === null) {
    return { ...session, client: { clientId: "" }, tokens: undefined };
  }

  return {
    ...session,
    client,
    tokens: normalizeStoredTokens(getOwnEntry(session, "tokens"))
  };
}

function normalizeStoredClient(value: unknown): StoredOAuthSession["client"] | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const clientId = getOwnString(value, "clientId");
  if (clientId === undefined || clientId.trim().length === 0) {
    return null;
  }
  const normalizedClientId = clientId.trim();

  const clientSecret = getOwnEntry(value, "clientSecret");
  if (clientSecret === undefined) {
    return { clientId: normalizedClientId };
  }

  if (typeof clientSecret !== "string" || clientSecret.trim().length === 0) {
    return null;
  }
  const normalizedClientSecret = clientSecret.trim();

  return { clientId: normalizedClientId, clientSecret: normalizedClientSecret };
}

function normalizeStoredTokens(value: unknown): StoredOAuthTokens | undefined {
  if (value === undefined || !isObjectRecord(value)) {
    return undefined;
  }

  const accessToken = getOwnString(value, "accessToken");
  const tokenType = getOwnString(value, "tokenType");
  const expiresAt = getOwnEntry(value, "expiresAt");
  const refreshToken = getOwnEntry(value, "refreshToken");
  const scope = getOwnString(value, "scope");
  const normalizedAccessToken = accessToken?.trim();
  const normalizedRefreshToken = typeof refreshToken === "string" ? refreshToken.trim() : undefined;
  const normalizedScope = scope?.trim();

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
    scope: normalizeOptionalOAuthString(client.metadata.scope),
    softwareId: normalizeOptionalOAuthString(client.metadata.softwareId),
    softwareVersion: normalizeOptionalOAuthString(client.metadata.softwareVersion)
  };
}

function normalizeConfiguredClient(
  client: DefaultOAuthClientProviderOptions["client"]
): StoredOAuthSession["client"] | null {
  const clientId = normalizeOptionalOAuthString(client.clientId);
  if (clientId === undefined) {
    return null;
  }

  const clientSecret = normalizeOptionalOAuthString(client.clientSecret);
  return clientSecret === undefined ? { clientId } : { clientId, clientSecret };
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
    normalizedHostname.startsWith("127.")
  );
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

function buildClientRegistrationBody(
  metadata: OAuthClientMetadata | undefined,
  redirectUri: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
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

  return true;
}
