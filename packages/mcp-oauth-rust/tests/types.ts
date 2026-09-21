import {
  generateCodeVerifier,
  generateCodeChallenge,
  fetchMcpResponse,
  readBoundedResponseText,
  OAuthError,
  isRetryableOAuthError
} from "../dist/index.js";
const verifier: string = generateCodeVerifier();
const challenge: string = generateCodeChallenge(verifier);
void challenge;
const reply: Promise<Response> = fetchMcpResponse(fetch, new URL("https://example.test"), {
  method: "POST"
});
const text: Promise<string> = readBoundedResponseText(
  new Response(null),
  1024,
  new Set(),
  new AbortController().signal
);
void reply;
void text;
const error: unknown = new OAuthError({ error: "server_error" }, 503);
if (isRetryableOAuthError(error)) {
  const retryable: boolean = error.retryable;
  void retryable;
}
import {
  buildSuccessPage,
  extractCodeFromInput,
  createLoopbackAuthorizationSession,
  type LoopbackAuthorizationSession
} from "../dist/index.js";
const page: string = buildSuccessPage({ title: "Connected", body: "Return to the terminal" });
const code: string | null = extractCodeFromInput("code");
const loopback: Promise<LoopbackAuthorizationSession> = createLoopbackAuthorizationSession({
  callbackPath: "/oauth/callback",
  readLine: async () => "code",
  openBrowser: async () => undefined
});
void page;
void code;
void loopback;
import {
  createAuthStoreSessionStore,
  canonicalizeResourceIndicator,
  type OAuthSessionStore
} from "../dist/index.js";
const sessions: OAuthSessionStore = createAuthStoreSessionStore({
  backend: "file",
  fileStore: { salt: "example" }
});
const resource: string = canonicalizeResourceIndicator(
  new URL("https://example.test/mcp#fragment")
);
void sessions;
void resource;
import {
  createDefaultOAuthClientProvider,
  createOAuthClientProvider,
  type DefaultOAuthClientProviderOptions,
  type OAuthClientProvider
} from "../dist/index.js";
import type {
  OAuthClientProvider as ReferenceProvider,
  DefaultOAuthClientProviderOptions as ReferenceOptions
} from "../../mcp-oauth/dist/index.js";
const providerOptions: DefaultOAuthClientProviderOptions = {
  client: { mode: "static", clientId: "client" },
  browser: { openBrowser: async () => undefined },
  sessionStore: sessions,
  now: () => 1000
};
const provider: ReferenceProvider = createDefaultOAuthClientProvider(providerOptions);
const referenceOptions: ReferenceOptions = providerOptions;
const supplied: OAuthClientProvider = createOAuthClientProvider({ provider });
const ownReferenceOptions: DefaultOAuthClientProviderOptions = referenceOptions;
void supplied;
void referenceOptions;
void ownReferenceOptions;
import {
  createJwksTokenVerifier,
  type JwksTokenVerifierOptions,
  type JwksVerifiedAccessToken
} from "../dist/index.js";
import type {
  JwksTokenVerifier as ReferenceVerifier,
  JwksTokenVerifierOptions as ReferenceJwksOptions
} from "../../mcp-oauth/dist/index.js";
const jwksOptions: JwksTokenVerifierOptions = {
  jwksUrl: new URL("https://example.test/keys"),
  fetch,
  allowedAlgorithms: ["ES256"],
  clockSkewSeconds: 0.5,
  requireAccessTokenType: true
};
const referenceJwksOptions: ReferenceJwksOptions = jwksOptions;
const tokenVerifier: ReferenceVerifier = createJwksTokenVerifier(jwksOptions);
const verified: Promise<JwksVerifiedAccessToken> = tokenVerifier.verify({
  token: "token",
  resource: "https://example.test/mcp",
  authorizationServers: ["https://example.test"],
  requiredScopes: ["read"]
});
void referenceJwksOptions;
void verified;
import { parseOAuthClientRegistration, type OAuthClientRegistration } from "../dist/index.js";
import type { OAuthClientRegistration as ReferenceRegistration } from "../../mcp-oauth/dist/index.js";
const registration: ReferenceRegistration = parseOAuthClientRegistration({ client_id: "c" });
const ownRegistration: OAuthClientRegistration = registration;
void ownRegistration;

import { normalizeStoredOAuthClient, type StoredOAuthClient } from "../dist/index.js";
import type { StoredOAuthClient as ReferenceClient } from "../../mcp-oauth/dist/index.js";
const storedClient: ReferenceClient | null = normalizeStoredOAuthClient({ clientId: "c" });
const ownStoredClient: StoredOAuthClient | null = storedClient;
void ownStoredClient;

import { withOAuthSessionTransaction } from "../dist/index.js";
import { withOAuthSessionTransaction as referenceTransaction } from "../../mcp-oauth/src/client/session-transaction.js";
const transactionA: typeof referenceTransaction = withOAuthSessionTransaction;
const transactionB: typeof withOAuthSessionTransaction = referenceTransaction;
void transactionA;
void transactionB;

const importedRegistrationOptions: DefaultOAuthClientProviderOptions = {
  client: {
    mode: "dynamic",
    registration: { client_id: "c" },
    tokenEndpointAuthMethod: "client_secret_basic"
  },
  browser: {}
};
const pendingRegistrationSession: import("../dist/index.js").StoredOAuthSession = {
  resource: "https://resource.example/mcp",
  authorizationServer: "https://auth.example",
  client: {
    clientId: "c",
    registration: { client_id: "c" },
    tokenEndpointAuthMethod: "client_secret_basic"
  },
  refreshState: "pending",
  requestedScope: "read",
  discovery: {
    resourceMetadataUrl: "https://resource.example/meta",
    resourceMetadata: {},
    authorizationServerMetadata: {}
  }
};
void [importedRegistrationOptions, pendingRegistrationSession];

const explicitGrant: Promise<import("../dist/index.js").StoredOAuthTokens | void> | undefined =
  supplied.authenticate?.({ requestUrl: new URL("https://resource.example/mcp"), fetch });
void explicitGrant;

import { parseOAuthTokenGrant } from "../dist/index.js";
import { parseOAuthTokenGrant as referenceTokenGrant } from "../../mcp-oauth/src/client/token-grant.js";
const grantImportA: typeof referenceTokenGrant = parseOAuthTokenGrant;
const grantImportB: typeof parseOAuthTokenGrant = referenceTokenGrant;
void [grantImportA, grantImportB];

import { createResourceBoundOAuthStores } from "../dist/index.js";
const identityStores = createResourceBoundOAuthStores({ backend: "file" }, "profile", "catalog");
const identityReset: Promise<void> = identityStores.reset("https://resource.example/mcp", { timeoutMs: 1000 });
void [identityStores.initialGrantAllowed, identityReset];

import { createResourceBoundOAuthStores as referenceResourceStores } from "../../mcp-oauth/src/client/resource-bound-store.js";
const resourceStoreA: typeof referenceResourceStores = createResourceBoundOAuthStores;
const resourceStoreB: typeof createResourceBoundOAuthStores = referenceResourceStores;
const importedIdentitySession: Promise<void> = identityStores.importSession(pendingRegistrationSession, { timeoutMs: 1000 });
void [resourceStoreA, resourceStoreB, importedIdentitySession];
