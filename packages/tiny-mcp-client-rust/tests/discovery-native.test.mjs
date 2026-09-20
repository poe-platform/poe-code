import assert from "node:assert/strict";
import { test } from "node:test";
import * as actual from "../dist/oauth-discovery.js";
import * as root from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport("../../tiny-mcp-client/src/oauth-discovery.ts", import.meta.url);
function outcome(callback) { try { return { value: callback() }; } catch (error) { return { name: error.name, error: error.message }; } }

test("metadata URL admission and exact issuer spelling match the reference", () => {
  const urls = ["https://Auth.example:443/issuer/", "https://auth.example/a%2Fb?x=1", "https://auth.example/#", "https://auth.example/#f", "https://user:pass@auth.example/a", "http://localhost./mcp", "http://127.1/mcp", "http://0x7f000001/mcp", "http://127.255.0.1/mcp", "http://127.attacker.example/mcp", "http://127.999.0.1/mcp", "http://[::1]/mcp", "http://[::ffff:127.0.0.1]/mcp", "ftp://localhost/mcp", "invalid", "https://例え.test/a", "https://a.test/a\\b", "https://a.test/a?x=1#f"];
  for (const url of urls) {
    assert.deepEqual(outcome(() => actual.resolveAuthorizationServerMetadataUrl(url)), outcome(() => reference.resolveAuthorizationServerMetadataUrl(url)), url);
    for (const override of [undefined, "/metadata", "../metadata?q=1", "https://metadata.test/a", "http://evil.test/m", "#fragment", "https://user@meta.test/a", new URL("https://meta.test/a")]) {
      assert.deepEqual(outcome(() => actual.resolveProtectedResourceMetadataUrl(url, override)), outcome(() => reference.resolveProtectedResourceMetadataUrl(url, override)), `${url}, ${override}`);
    }
  }
});

function fixtureFetch(calls, overrides = {}) {
  return async (input, init) => {
    const url = String(input); calls.push({ url, method: init.method, accept: new Headers(init.headers).get("accept"), redirect: init.redirect });
    if (Object.hasOwn(overrides, url)) return new Response(JSON.stringify(overrides[url]), { headers: { "Content-Type": "application/json" } });
    if (url.includes("oauth-protected-resource")) return new Response(JSON.stringify({ resource: "https://resource.test/mcp", authorization_servers: ["https://AUTH.test:443/issuer"] }));
    return new Response(JSON.stringify({ issuer: "https://AUTH.test:443/issuer", authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], extra: { useful: true } }));
  };
}
test("native discovery isolates network, external cache and returned snapshots", async () => {
  async function run(Discovery) {
    const calls = []; const writes = [];
    const discovery = new Discovery({ fetch: fixtureFetch(calls), cache: { get: () => null, set: (key, value) => { writes.push({ key, value }); value.authorizationServerMetadata.extra.useful = false; } } });
    const first = await discovery.discover("https://resource.test/mcp#fragment");
    const pristine = structuredClone(first);
    first.authorizationServerMetadata.extra.useful = "mutated";
    const second = await discovery.discover(new URL("https://resource.test/mcp"));
    return { calls, writes, pristine, second };
  }
  assert.deepEqual(await run(actual.OAuthMetadataDiscovery), await run(reference.OAuthMetadataDiscovery));
});

test("discovery ignores unrelated serialization hooks in shared cached metadata", async () => {
  const cached = {
    resource: "https://resource.test/mcp", resourceMetadataUrl: "https://resource.test/metadata",
    resourceMetadata: { resource: "https://resource.test/mcp", authorization_servers: ["https://AUTH.test:443/issuer"] },
    authorizationServer: "https://AUTH.test:443/issuer", authorizationServerMetadataUrl: "https://auth.test/.well-known/oauth-authorization-server/issuer",
    authorizationServerMetadata: { issuer: "https://AUTH.test:443/issuer", authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] }
  };
  cached.resourceMetadata.extra = cached.resourceMetadata;
  cached.authorizationServerMetadata.extra = 1n;
  for (const Discovery of [reference.OAuthMetadataDiscovery, actual.OAuthMetadataDiscovery]) {
    const discovery = new Discovery({ cache: { get: () => cached, set: () => assert.fail("network cache write") }, fetch: () => assert.fail("unexpected network") });
    const result = await discovery.discover(cached.resource);
    assert.equal(result.resourceMetadata.extra.extra, result.resourceMetadata.extra);
    assert.equal(result.authorizationServerMetadata.extra, 1n);
  }
});

test("discovery metadata admission and diagnostics match hostile records", async () => {
  async function run(Discovery, resourceMetadata, serverMetadata) {
    const calls = [];
    try {
      const value = await new Discovery({ fetch: async input => {
        calls.push(String(input));
        return new Response(JSON.stringify(String(input).includes("oauth-protected-resource") ? resourceMetadata : serverMetadata));
      } }).discover("https://resource.test/mcp");
      return { calls, value };
    } catch (error) { return { calls, error: error.message }; }
  }
  const resource = { resource: "https://resource.test/mcp", authorization_servers: ["https://AUTH.test:443/issuer"] };
  const server = { issuer: "https://AUTH.test:443/issuer", authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
  const values = [undefined, null, false, 0, "", "relative", "https://evil.test/", "https://user:pass@evil.test/", "http://evil.test/", "https://evil.test/#fragment", "\ud800", [], {}, [null], ["code"], ["S256"], ["https://AUTH.test:443/issuer"]];
  for (const field of Object.keys(resource)) for (const value of values) {
    const input = { ...resource, [field]: value };
    assert.deepEqual(await run(actual.OAuthMetadataDiscovery, input, server), await run(reference.OAuthMetadataDiscovery, input, server), `${field}: ${JSON.stringify(value)}`);
  }
  for (const field of [...Object.keys(server), "registration_endpoint"]) for (const value of values) {
    const input = { ...server, [field]: value };
    assert.deepEqual(await run(actual.OAuthMetadataDiscovery, resource, input), await run(reference.OAuthMetadataDiscovery, resource, input), `${field}: ${JSON.stringify(value)}`);
  }
  for (const input of [null, false, [], 1, "metadata"]) {
    assert.deepEqual(await run(actual.OAuthMetadataDiscovery, input, server), await run(reference.OAuthMetadataDiscovery, input, server));
    assert.deepEqual(await run(actual.OAuthMetadataDiscovery, resource, input), await run(reference.OAuthMetadataDiscovery, resource, input));
  }
});

test("default discovery fetch resolves the platform implementation at request time", async () => {
  const previous = globalThis.fetch;
  try {
    for (const Discovery of [reference.OAuthMetadataDiscovery, actual.OAuthMetadataDiscovery]) {
      globalThis.fetch = () => assert.fail("stale platform fetch");
      const discovery = new Discovery();
      const calls = [];
      globalThis.fetch = fixtureFetch(calls);
      assert.equal((await discovery.discover("https://resource.test/mcp")).authorizationServer, "https://AUTH.test:443/issuer");
      assert.equal(calls.length, 2);
    }
  } finally { globalThis.fetch = previous; }
});

test("shared cached metadata preserves sparse arrays accepted by the original", async () => {
  const cached = {
    resource: "https://resource.test/mcp", resourceMetadataUrl: "https://resource.test/metadata",
    resourceMetadata: { resource: "https://resource.test/mcp", authorization_servers: [, "https://AUTH.test:443/issuer"] },
    authorizationServer: "https://AUTH.test:443/issuer", authorizationServerMetadataUrl: "https://auth.test/.well-known/oauth-authorization-server/issuer",
    authorizationServerMetadata: { issuer: "https://AUTH.test:443/issuer", authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", response_types_supported: [, "code"], code_challenge_methods_supported: [, "S256"] }
  };
  async function run(Discovery) {
    return new Discovery({ cache: { get: () => cached, set: () => assert.fail("unexpected cache write") }, fetch: () => assert.fail("unexpected network") }).discover(cached.resource);
  }
  assert.deepEqual(await run(actual.OAuthMetadataDiscovery), await run(reference.OAuthMetadataDiscovery));
});

test("public fetch helper rejects redirected responses and releases their bodies", async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({ cancel() { cancelled++; } }));
  Object.defineProperty(response, "redirected", { value: true });
  const inits = [];
  await assert.rejects(root.fetchMcpResponse(async (_input, init) => { inits.push(init); return response; }, "https://resource.test/mcp"), /redirect/);
  assert.equal(inits[0].redirect, "error");
  assert.equal(cancelled, 1);
});
