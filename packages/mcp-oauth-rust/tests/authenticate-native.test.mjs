import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/provider.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api"),
  original = await tsImport(
    "../../mcp-oauth/src/client/default-oauth-client-provider.ts",
    import.meta.url
  );
const resource = "https://resource.example/mcp",
  issuer = "https://auth.example";
function fixture(api, session, extra = {}) {
  return api.createDefaultOAuthClientProvider({
    client: { mode: "static", clientId: "c" },
    browser: {},
    allowInteractive: false,
    now: () => 1000,
    sessionStore: {
      async load() {
        return session;
      },
      async save() {
        throw Error("must not save cache");
      },
      async clear() {
        throw Error("must not clear cache");
      }
    },
    ...extra
  });
}
test("explicit authentication reuses owned cached/imported grants without lazy discovery", async () => {
  for (const api of [original, own]) {
    const tokens = { accessToken: "cached", tokenType: "Bearer", expiresAt: null },
      session = {
        resource,
        authorizationServer: issuer,
        client: { clientId: "c" },
        tokens,
        discovery: {
          resourceMetadataUrl: resource + "/meta",
          resourceMetadata: {},
          authorizationServerMetadata: {
            issuer,
            authorization_endpoint: issuer + "/authorize",
            token_endpoint: issuer + "/token",
            code_challenge_methods_supported: ["S256"]
          }
        }
      };
    const input = {
      requestUrl: new URL(resource),
      fetch: async () => {
        throw Error("must not fetch cache");
      },
      discover: async () => {
        throw Error("must not discover cache");
      }
    };
    const provider = fixture(api, session),
      snapshot = await provider.authenticate(input);
    assert.deepEqual(snapshot, tokens);
    assert.notEqual(snapshot, tokens);
    snapshot.accessToken = "changed";
    assert.equal((await provider.authenticate(input)).accessToken, "cached");
    const imported = fixture(api, null, { initialGrant: { resource, tokens } });
    assert.deepEqual(await imported.authenticate(input), tokens);
    assert.equal(
      await fixture(api, null).authenticate({ ...input, discover: undefined }),
      undefined
    );
  }
});
test("explicit authentication cancellation precedes persistence and discovery", async () => {
  for (const api of [original, own]) {
    const controller = new AbortController(),
      reason = Symbol("cancelled");
    controller.abort(reason);
    const provider = fixture(api, null, {
      sessionStore: {
        async load() {
          throw Error("must not load cancellation");
        },
        async save() {},
        async clear() {}
      }
    });
    await assert.rejects(
      provider.authenticate({
        requestUrl: new URL(resource),
        fetch: async () => {},
        signal: controller.signal,
        discover: async () => {
          throw Error("must not discover cancellation");
        }
      }),
      (error) => error === reason
    );
  }
});
