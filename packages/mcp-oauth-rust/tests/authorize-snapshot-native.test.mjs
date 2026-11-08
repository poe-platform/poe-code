import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/provider.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport(
  "../../mcp-oauth/src/client/default-oauth-client-provider.ts",
  import.meta.url
);
test("authorized requests return owned normalized grant snapshots", async () => {
  for (const api of [original, own]) {
    const session = {
      resource: "https://resource.example/mcp",
      authorizationServer: "https://auth.example",
      client: { clientId: "client" },
      tokens: { accessToken: " token ", tokenType: "Bearer", expiresAt: null },
      discovery: {
        resourceMetadataUrl: "https://resource.example/meta",
        resourceMetadata: {},
        authorizationServerMetadata: {
          issuer: "https://auth.example",
          authorization_endpoint: "https://auth.example/authorize",
          token_endpoint: "https://auth.example/token",
          code_challenge_methods_supported: ["S256"]
        }
      }
    };
    const provider = api.createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      browser: {},
      sessionStore: {
        async load() {
          return session;
        },
        async save() {
          throw Error("must not save valid cache");
        },
        async clear() {
          throw Error("must not clear valid cache");
        }
      }
    });
    const headers = new Headers(),
      input = {
        requestUrl: new URL(session.resource),
        headers,
        fetch: async () => {
          throw Error("must not fetch valid cache");
        }
      };
    const snapshot = await provider.authorizeRequest(input);
    assert.deepEqual(snapshot, { accessToken: "token", tokenType: "Bearer", expiresAt: null });
    assert.equal(headers.get("Authorization"), "Bearer token");
    assert.notEqual(snapshot, session.tokens);
    snapshot.accessToken = "mutated";
    assert.equal((await provider.authorizeRequest(input)).accessToken, "token");
    assert.equal(session.tokens.accessToken, " token ");
  }
});
