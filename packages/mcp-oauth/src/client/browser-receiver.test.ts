import http from "node:http";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";

class Listener extends EventEmitter {
  listen(_port: number, _host: string, ready: () => void) { queueMicrotask(ready); return this; }
  address() { return { port: 49152, address: "127.0.0.1", family: "IPv4" }; }
  close = vi.fn(() => this);
}

it.each(["createServer", "openBrowser", "readLine"] as const)("keeps the %s receiver and live host state in native consent", async method => {
  const listener = new Listener(), callback = Promise.withResolvers<string>();
  const browser = { marker: "original", createServer: () => listener as unknown as http.Server,
    openBrowser: async (value: string) => {
      const authorization = new URL(value), redirect = new URL(authorization.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("state", authorization.searchParams.get("state")!); redirect.searchParams.set("code", "005930"); callback.resolve(redirect.href);
    }, readLine: async () => callback.promise };
  const original = browser[method];
  const hostMethod = vi.fn(function(this: typeof browser, ...args: unknown[]) {
    expect(this).toBe(browser); expect(this.marker).toBe("updated");
    return Reflect.apply(original, browser, args);
  });
  Object.defineProperty(browser, method, { value: hostMethod, enumerable: false });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original" }, browser,
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
  browser.marker = "updated";
  const resource = "https://resource.example/mcp", issuer = "https://auth.example";
  expect(await provider.authenticate!({ requestUrl: new URL(resource), fetch: async () => Response.json({ access_token: "original", token_type: "Bearer" }),
    discover: async () => ({ resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: { issuer,
        authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } }) })).toMatchObject({ accessToken: "original" });
  expect(hostMethod).toHaveBeenCalledOnce(); expect(listener.close).toHaveBeenCalledOnce();
});
