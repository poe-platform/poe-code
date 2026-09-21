import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOAuthScope as own } from "../dist/scope.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api"),
  { normalizeOAuthScope: original } = await tsImport(
    "../../mcp-oauth/src/client/scope.ts",
    import.meta.url
  );
const outcome = (fn, value) => {
  try {
    return { value: fn(value) };
  } catch (error) {
    return { error: error.message, name: error.name };
  }
};
test("scope set normalization matches original grammar and preserves token case", () => {
  let seed = 0x13119c4;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const samples = [
    undefined,
    null,
    0,
    false,
    [],
    {},
    "",
    "   ",
    "write read READ read",
    "read\\write",
    'read"write',
    "read\twrite",
    "x\ud800",
    "read\ufeff"
  ];
  let effects = 0;
  samples.push({
    toString() {
      effects++;
      return "read";
    }
  });
  for (let index = 0; index < 2048; index++)
    samples.push(
      String.fromCharCode(...Array.from({ length: random() % 64 }, () => random() % 129))
    );
  for (const value of samples) assert.deepEqual(outcome(own, value), outcome(original, value));
  assert.equal(effects, 0);
});
test("invalid response scopes defer rejection until after expiry validation and clock effects", async () => {
  const native = await import("../dist/tokens.js"),
    reference = await tsImport("../../mcp-oauth/src/client/token-endpoint.ts", import.meta.url);
  for (const clock of [0, 0.5, Infinity]) {
    const observations = [];
    for (const api of [reference, native]) {
      let clocks = 0;
      const error = await api
        .exchangeAuthorizationCode({
          tokenEndpoint: "https://auth.example/token",
          clientId: "c",
          resource: "https://resource.example/",
          code: "c",
          codeVerifier: "v",
          redirectUri: "http://localhost/cb",
          fetch: async () =>
            Response.json({
              access_token: "t",
              token_type: "Bearer",
              expires_in: 0,
              scope: "x\ud800"
            }),
          now() {
            clocks++;
            return clock;
          }
        })
        .catch((error) => error);
      observations.push({ message: error.message, name: error.name, clocks });
    }
    assert.deepEqual(observations[1], observations[0]);
  }
});
