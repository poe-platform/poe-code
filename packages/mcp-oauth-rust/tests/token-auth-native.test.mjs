import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/tokens.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api"),
  original = await tsImport("../../mcp-oauth/src/client/token-endpoint.ts", import.meta.url);
test("seeded Unicode credentials match original Basic, POST and public forms", async () => {
  let seed = 0x42148;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let index = 0; index < 128; index++) {
    const id =
        String.fromCharCode(...Array.from({ length: random() % 24 }, () => random() & 65535)) +
        ": +",
      secret =
        String.fromCharCode(...Array.from({ length: random() % 24 }, () => random() & 65535)) +
        ": +";
    for (const method of ["none", "client_secret_basic", "client_secret_post", undefined]) {
      const observations = [];
      for (const api of [original, own]) {
        let observed;
        const result = await api.refreshAccessToken({
          clientId: id,
          clientSecret: secret,
          tokenEndpointAuthMethod: method,
          tokenEndpoint: "https://auth.example/token",
          resource: "https://resource.example/",
          refreshToken: "r\ud800 +",
          now: () => 0,
          fetch: async (url, init) => {
            observed = {
              url,
              body: init.body,
              headers: [...new Headers(init.headers)],
              redirect: init.redirect,
              signal: !!init.signal
            };
            return Response.json({ access_token: "t", token_type: "Bearer" });
          }
        });
        observations.push({ result, observed });
      }
      assert.deepEqual(observations[1], observations[0]);
    }
  }
});
test("invalid token auth methods and absent secrets reject before fetch, retaining cancellation identity", async () => {
  for (const api of [original, own])
    for (const [method, secret] of [
      ["private_key_jwt", undefined],
      [12, "s"],
      ["client_secret_post", undefined],
      ["client_secret_basic", "  "]
    ]) {
      let calls = 0;
      await assert.rejects(
        api.refreshAccessToken({
          clientId: "id",
          clientSecret: secret,
          tokenEndpointAuthMethod: method,
          tokenEndpoint: "https://auth.example/token",
          resource: "https://resource.example/",
          refreshToken: "r",
          now: () => 0,
          fetch: async () => {
            calls++;
            return Response.json({});
          }
        }),
        (error) => error.message.includes("OAuth token endpoint authentication")
      );
      assert.equal(calls, 0);
    }
  for (const api of [original, own])
    for (const reason of [null, false, 0, "", { cancelled: true }]) {
      let calls = 0;
      const controller = new AbortController();
      controller.abort(reason);
      await assert.rejects(
        api.refreshAccessToken({
          clientId: "id",
          tokenEndpoint: "https://auth.example/token",
          resource: "https://resource.example/",
          refreshToken: "r",
          now: () => 0,
          signal: controller.signal,
          fetch: async () => {
            calls++;
            return Response.json({});
          }
        }),
        (error) => Object.is(error, reason)
      );
      assert.equal(calls, 0);
    }
});
