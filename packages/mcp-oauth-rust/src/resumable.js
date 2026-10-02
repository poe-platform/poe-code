import { exchangeAuthorizationCode } from "./tokens.js";
import { createRequire } from "node:module";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce.js";
import { normalizeOAuthScope } from "./scope.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const responseParameters = ["code", "state", "iss", "error", "error_description", "error_uri"];
function httpsUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.href.includes("#"))
        throw new Error();
    return url;
}
function timestamp(now) {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - 600_000)
        throw new Error();
    return value;
}
/** Prepare consent for a host-owned durable journal; the transaction contains private secrets. */
export async function prepareRemoteMcpAuthorization(options) {
    try {
        const { signal, discover } = options;
        const now = options.now?.bind(options) ?? Date.now;
        const resource = httpsUrl(options.resource).href;
        const redirect = httpsUrl(options.redirectUri);
        if (responseParameters.some(key => redirect.searchParams.has(key)))
            throw new Error();
        const client = structuredClone(options.client);
        if (typeof client.clientId !== "string" || !client.clientId.trim())
            throw new Error();
        const method = client.tokenEndpointAuthMethod ?? (client.clientSecret === undefined ? "none" : "client_secret_post");
        if (client.clientSecret !== undefined && (typeof client.clientSecret !== "string" || !client.clientSecret.trim()))
            throw new Error();
        if (method !== "none" && client.clientSecret === undefined)
            throw new Error();
        if (client.registration !== undefined && (client.registration.client_id !== client.clientId ||
            (client.registration.client_secret != null && client.registration.client_secret !== client.clientSecret) ||
            (client.registration.token_endpoint_auth_method != null && client.registration.token_endpoint_auth_method !== method)))
            throw new Error();
        native.tokenAuthPlan("{}", client.clientId, client.clientSecret, method);
        client.tokenEndpointAuthMethod = method;
        if (client.requestedRedirectUri !== undefined && client.requestedRedirectUri !== redirect.href)
            throw new Error();
        if (client.registration?.redirect_uris != null && !client.registration.redirect_uris.includes(redirect.href))
            throw new Error();
        const statePrefix = options.statePrefix ?? "";
        if (typeof statePrefix !== "string" || statePrefix.length > 32 || [...statePrefix].some(c =>
            !(c >= "a" && c <= "z") && !(c >= "A" && c <= "Z") && !(c >= "0" && c <= "9") && c !== "_" && c !== "-"))
            throw new Error();
        const scope = normalizeOAuthScope(options.scope);
        const ttl = options.ttlMs ?? 600_000;
        if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 600_000)
            throw new Error();
        signal?.throwIfAborted();
        const metadata = structuredClone(await discover(resource, signal));
        signal?.throwIfAborted();
        const server = metadata.authorizationServerMetadata;
        if (httpsUrl(metadata.resource).href !== resource || httpsUrl(metadata.resourceMetadata.resource).href !== resource ||
            server.issuer !== metadata.authorizationServer || !metadata.resourceMetadata.authorization_servers.includes(server.issuer) ||
            !server.response_types_supported.includes("code") || !server.code_challenge_methods_supported.includes("S256"))
            throw new Error();
        httpsUrl(server.issuer);
        httpsUrl(server.token_endpoint);
        const authorization = httpsUrl(server.authorization_endpoint);
        const state = statePrefix + generateCodeVerifier();
        const codeVerifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(codeVerifier);
        const expiresAt = timestamp(now) + ttl;
        const session = { resource, authorizationServer: server.issuer,
            client: { ...client, registrationOwnership: "caller", requestedRedirectUri: redirect.href },
            ...(scope === undefined ? {} : { requestedScope: scope }),
            discovery: { resourceMetadataUrl: metadata.resourceMetadataUrl, resourceMetadata: metadata.resourceMetadata, authorizationServerMetadata: server } };
        for (const [key, value] of Object.entries({ response_type: "code", client_id: client.clientId, redirect_uri: redirect.href,
            resource, state, code_challenge: challenge, code_challenge_method: "S256" }))
            authorization.searchParams.set(key, value);
        authorization.searchParams.delete("scope");
        if (scope !== undefined)
            authorization.searchParams.set("scope", scope);
        signal?.throwIfAborted();
        return { authorizationUrl: authorization.href, transaction: { state, expiresAt, redirectUri: redirect.href, codeVerifier,
            requireIssuer: server.authorization_response_iss_parameter_supported === true, session } };
    }
    catch {
        throw new Error("Unable to prepare MCP authorization");
    }
}
/** Persist prepared consent before returning its public authorization URL. */
export async function beginRemoteMcpAuthorization(options) {
    try {
        const { store, signal } = options;
        const { authorizationUrl, transaction } = await prepareRemoteMcpAuthorization(options);
        signal?.throwIfAborted();
        await store.create(transaction);
        signal?.throwIfAborted();
        return { authorizationUrl, expiresAt: transaction.expiresAt };
    } catch { throw new Error("Unable to begin MCP authorization"); }
}
/** Redeem once after any process restart, then conditionally persist. Returns no tokens or callback secrets. */
export async function completeRemoteMcpAuthorization(options) {
    try {
        const { store, fetch, signal } = options;
        const now = options.now?.bind(options) ?? Date.now;
        const callback = httpsUrl(options.callbackUrl);
        for (const key of responseParameters)
            if (callback.searchParams.getAll(key).length > 1)
                throw new Error();
        const state = callback.searchParams.get("state");
        if (!state || state.length > 256)
            throw new Error();
        signal?.throwIfAborted();
        const stored = await store.consume(state);
        if (stored === null)
            throw new Error();
        const transaction = structuredClone(stored);
        if (transaction.state !== state || !Number.isSafeInteger(transaction.expiresAt) || transaction.expiresAt <= timestamp(now))
            throw new Error();
        const expected = httpsUrl(transaction.redirectUri);
        const issuer = callback.searchParams.get("iss");
        if ((transaction.requireIssuer && issuer === null) || (issuer !== null && issuer !== transaction.session.authorizationServer))
            throw new Error();
        const code = callback.searchParams.get("code");
        if (!code || callback.searchParams.has("error"))
            throw new Error();
        for (const key of responseParameters)
            callback.searchParams.delete(key);
        // Compare query pairs without changing their encoding/order requirements on the registered redirect.
        const actualPairs = [...callback.searchParams].sort(), expectedPairs = [...expected.searchParams].sort();
        if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || JSON.stringify(actualPairs) !== JSON.stringify(expectedPairs))
            throw new Error();
        const session = structuredClone(transaction.session);
        const tokenEndpoint = httpsUrl(String(session.discovery.authorizationServerMetadata.token_endpoint)).href;
        signal?.throwIfAborted();
        session.tokens = await exchangeAuthorizationCode({ tokenEndpoint, clientId: session.client.clientId,
            clientSecret: session.client.clientSecret, tokenEndpointAuthMethod: session.client.tokenEndpointAuthMethod,
            code, codeVerifier: transaction.codeVerifier, redirectUri: transaction.redirectUri, resource: session.resource, fetch, signal, now });
        if (session.tokens.scope === undefined && session.requestedScope !== undefined)
            session.tokens.scope = session.requestedScope;
        signal?.throwIfAborted();
        if (transaction.expiresAt <= timestamp(now) || !await store.commit(transaction, session))
            throw new Error();
        return { resource: session.resource };
    }
    catch {
        throw new Error("Unable to complete MCP authorization");
    }
}
