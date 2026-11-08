import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions, OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

const resource = "https://mcp.example/mcp", issuer = "https://auth.example";
const redirectUri = "https://poe.com/oauth/mcp/callback?app=one";
const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, response_types_supported: ["code"], authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, code_challenge_methods_supported: ["S256"]
  } };
function fixture(transform: (url: URL) => string = url => url.href) {
  let session: StoredOAuthSession | null = null;
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => Response.json(String(url).endsWith('/register')
    ? { client_id: 'client', redirect_uris: JSON.parse(String(init?.body)).redirect_uris }
    : { access_token: 'token', token_type: 'Bearer', scope: '' }));
  const createServer = vi.fn(() => { throw new Error('Hosted callbacks must not open a listener'); });
  const waitForCallback = vi.fn(async ({ authorizationUrl }: { authorizationUrl: string }) => {
    const auth = new URL(authorizationUrl), callback = new URL(auth.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'code'); callback.searchParams.set('state', auth.searchParams.get('state')!);
    return transform(callback);
  });
  const options: DefaultOAuthClientProviderOptions = { client: { mode: 'dynamic' }, browser: { redirectUri, waitForCallback, createServer },
    sessionStore: { load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => { session = null; } } };
  const provider = createDefaultOAuthClientProvider(options);
  return { options, provider, fetch, createServer, waitForCallback, session: () => session,
    run: (signal?: AbortSignal) => provider.authenticate!({ requestUrl: new URL(resource), fetch, discover: async () => discovery, signal }) };
}
it('uses the exact hosted redirect for registration, PKCE authorization, exchange and cached reuse', async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({ accessToken: 'token', scope: '' });
  expect(f.createServer).not.toHaveBeenCalled();
  expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).redirect_uris).toEqual([redirectUri]);
  const auth = new URL(f.waitForCallback.mock.calls[0][0].authorizationUrl);
  expect(auth.searchParams.get('redirect_uri')).toBe(redirectUri);
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  const body = new URLSearchParams(String(f.fetch.mock.calls[1][1]?.body));
  expect(body.get('redirect_uri')).toBe(redirectUri);
  expect(body.get('code_verifier')!.length).toBeGreaterThanOrEqual(43);
  expect(f.session()?.client.requestedRedirectUri).toBe(redirectUri);
  expect(await f.run()).toMatchObject({ accessToken: 'token' });
  expect(f.waitForCallback).toHaveBeenCalledOnce();
});
it.each([
  (url: URL) => { url.hostname = 'attacker.example'; return url.href; },
  (url: URL) => { url.pathname = '/wrong'; return url.href; },
  (url: URL) => { url.searchParams.set('app', 'two'); return url.href; },
  (url: URL) => { url.searchParams.set('state', 'wrong'); return url.href; },
  (url: URL) => { url.searchParams.append('code', 'second'); return url.href; },
  (url: URL) => { url.hash = 'fragment'; return url.href; },
  (url: URL) => { url.searchParams.set('iss', 'https://wrong.example'); return url.href; },
  () => 'bare-code'
])('rejects an unbound hosted callback before token exchange', async transform => {
  const f = fixture(transform);
  await expect(f.run()).rejects.toThrow();
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.session()?.tokens).toBeUndefined();
});
it('aborts a pending host callback and does not exchange a late code', async () => {
  const pending = Promise.withResolvers<string>(), started = Promise.withResolvers<AbortSignal>();
  const f = fixture();
  f.options.browser.waitForCallback = async ({ signal }) => { started.resolve(signal); return pending.promise; };
  const provider = createDefaultOAuthClientProvider(f.options), controller = new AbortController();
  const run = provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch, discover: async () => discovery, signal: controller.signal });
  const rejected = expect(run).rejects.toThrow('cancel host callback');
  const signal = await started.promise;
  controller.abort(new Error('cancel host callback')); await rejected;
  expect(signal.aborted).toBe(true); pending.resolve('late-code');
  await Promise.resolve(); expect(f.fetch).toHaveBeenCalledOnce();
});

it.each(["http://poe.com/cb", "https://user@poe.com/cb", "https://poe.com/cb#", "https://poe.com/cb?code=preselected"])("rejects invalid hosted redirect %s before I/O", redirect => {
  const f = fixture(); f.options.browser.redirectUri = redirect;
  expect(() => createDefaultOAuthClientProvider(f.options)).toThrow();
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.createServer).not.toHaveBeenCalled();
});
it("captures a nonenumerable host callback with its receiver", async () => {
  const f = fixture();
  class Host { marker = "host"; async waitForCallback(request: { authorizationUrl: string }) {
    expect(this.marker).toBe("host"); return f.waitForCallback(request);
  } }
  const host = new Host();
  const options = { ...f.options, browser: Object.assign(host, { redirectUri }) };
  const provider = createDefaultOAuthClientProvider(options);
  host.waitForCallback = async () => { throw new Error("mutated"); };
  expect(await provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch, discover: async () => discovery })).toMatchObject({ accessToken: "token" });
});
