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
import { createAuthStoreSessionStore } from "./auth-store-session-store.js";
import { createLoopbackAuthorizationSession } from "./loopback-authorization.js";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce.js";
import {
  exchangeAuthorizationCode,
  OAuthError,
  refreshAccessToken,
} from "./token-endpoint.js";

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
  const now = options.now ?? Date.now;
  const sessions = new Map<string, StoredOAuthSession | null>();
  const requestResourceMap = new Map<string, string>();
  const refreshPromises = new Map<string, Promise<StoredOAuthSession | null>>();
  const authorizationPromises = new Map<string, Promise<StoredOAuthSession>>();

  return {
    async authorizeRequest(input): Promise<void> {
      const resource = requestResourceMap.get(input.requestUrl.toString());
      if (resource === undefined) {
        return;
      }

      const session = await ensureAuthorizedSession(resource, undefined, input.fetch, false);
      const accessToken = session?.tokens?.accessToken;
      if (accessToken === undefined) {
        return;
      }

      input.headers.set("Authorization", `Bearer ${accessToken}`);
    },

    async handleUnauthorized(input) {
      requestResourceMap.set(input.requestUrl.toString(), input.discovery.resource);

      try {
        const forceRefresh =
          hasCachedAccessToken(await loadSession(input.discovery.resource))
          && input.challenge?.params.error === "invalid_token";
        const session = await ensureAuthorizedSession(
          input.discovery.resource,
          input.discovery,
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
    let session = await loadSession(resource);
    const sessionDiscovery = resolveDiscovery(discovery, session);

    if (session?.tokens !== undefined && !forceRefresh && !isExpired(session.tokens, now)) {
      return session;
    }

    if (
      session?.tokens?.refreshToken !== undefined
      && sessionDiscovery !== undefined
      && (forceRefresh || isExpired(session.tokens, now))
    ) {
      session = await refreshSession(resource, session, sessionDiscovery, fetch);
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

    return authorizeSession(resource, session, sessionDiscovery, fetch);
  }

  async function refreshSession(
    resource: string,
    session: StoredOAuthSession,
    discovery: OAuthDiscoveryResult,
    fetch: OAuthMetadataFetch
  ): Promise<StoredOAuthSession | null> {
    const inFlight = refreshPromises.get(resource);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        if (session.tokens?.refreshToken === undefined) {
          return session;
        }

        const refreshedTokens = await refreshAccessToken({
          tokenEndpoint: discovery.authorizationServerMetadata.token_endpoint,
          clientId: session.client.clientId,
          clientSecret: session.client.clientSecret,
          refreshToken: session.tokens.refreshToken,
          resource,
          fetch,
          now,
        });

        const updatedSession: StoredOAuthSession = {
          ...session,
          tokens: refreshedTokens,
          discovery: toStoredDiscovery(discovery),
        };
        await saveSession(resource, updatedSession);
        return updatedSession;
      } catch (error) {
        if (error instanceof OAuthError && error.error === "invalid_grant") {
          const clearedSession = clearSessionTokens(session);
          await saveSession(resource, clearedSession);
          return clearedSession;
        }

        throw error;
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
      const loopback = await createLoopbackAuthorizationSession({
        openBrowser: options.browser.openBrowser,
        readLine: options.browser.readLine,
        createServer: options.browser.createServer,
        landingPage: options.browser.landingPage,
      });

      try {
        const client = await resolveClient(existingSession, discovery, loopback.redirectUri, fetch);
        const sessionWithoutTokens: StoredOAuthSession = {
          resource,
          authorizationServer: discovery.authorizationServer,
          client,
          discovery: toStoredDiscovery(discovery),
        };
        await saveSession(resource, sessionWithoutTokens);

        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        const authorizationUrl = buildAuthorizationUrl({
          metadata: discovery.authorizationServerMetadata,
          resource,
          clientId: client.clientId,
          redirectUri: loopback.redirectUri,
          codeChallenge: challenge,
          clientMetadata: getClientMetadata(options.client),
        });
        const code = await loopback.waitForCode(authorizationUrl);
        const tokens = await exchangeAuthorizationCode({
          tokenEndpoint: discovery.authorizationServerMetadata.token_endpoint,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
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
      } finally {
        loopback.close();
        authorizationPromises.delete(resource);
      }
    })();

    authorizationPromises.set(resource, promise);
    return promise;
  }

  async function resolveClient(
    existingSession: StoredOAuthSession | null,
    discovery: OAuthDiscoveryResult,
    redirectUri: string,
    fetch: OAuthMetadataFetch
  ): Promise<StoredOAuthSession["client"]> {
    if (options.client.mode === "static") {
      return {
        clientId: options.client.clientId,
        clientSecret: options.client.clientSecret,
      };
    }

    if (existingSession !== null && existingSession.client.clientId.length > 0) {
      return existingSession.client;
    }

    const registrationEndpoint = discovery.authorizationServerMetadata.registration_endpoint;
    if (registrationEndpoint === undefined) {
      throw new Error("Authorization server metadata is missing registration_endpoint");
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
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(`OAuth client registration failed (${response.status})`);
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload.client_id !== "string" ||
      payload.client_id.length === 0
    ) {
      throw new Error("OAuth client registration response missing client_id");
    }

    return {
      clientId: payload.client_id,
      clientSecret:
        typeof payload.client_secret === "string" && payload.client_secret.length > 0
          ? payload.client_secret
          : undefined,
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
    return discovery;
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
    resource: session.resource,
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
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);

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
