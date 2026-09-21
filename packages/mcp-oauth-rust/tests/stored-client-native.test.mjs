import { test } from "node:test";
import assert from "node:assert/strict";
import * as native from "../dist/registration.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport(
  "../../mcp-oauth/src/client/client-registration.ts",
  import.meta.url
);
const outcome = (fn, value) => {
  try {
    return { value: fn(value) };
  } catch (error) {
    return { error: error.message, name: error.name };
  }
};
test("stored clients normalize identity, registration ownership and authentication consistently", () => {
  assert.equal(typeof native.normalizeStoredOAuthClient, "function");
  const samples = [
    null,
    [],
    true,
    "c",
    {},
    { clientId: "" },
    { clientId: " c " },
    { clientId: " c ", clientSecret: " s " },
    { clientId: "c", clientSecret: null },
    { clientId: "c", clientSecret: "" },
    { clientId: "c", clientSecret: undefined }
  ];
  for (const method of [
    undefined,
    null,
    "none",
    "client_secret_post",
    "client_secret_basic",
    "unknown",
    false
  ]) {
    samples.push({ clientId: "c", tokenEndpointAuthMethod: method });
    for (const registeredMethod of [
      undefined,
      null,
      "none",
      "client_secret_post",
      "client_secret_basic",
      "unknown"
    ]) {
      samples.push({
        clientId: " c ",
        clientSecret: " s ",
        tokenEndpointAuthMethod: method,
        registration: {
          client_id: " c ",
          client_secret: " s ",
          token_endpoint_auth_method: registeredMethod,
          extension: { list: [true, null, "\ud800"] }
        }
      });
    }
  }
  for (const registration of [
    null,
    undefined,
    {},
    { client_id: "different" },
    { client_id: "c", client_secret: "s" },
    { client_id: "c", client_secret: null }
  ])
    samples.push({ clientId: "c", registration });
  samples.push(Object.create({ clientId: "c" }));
  const inheritedMethod = Object.create({ tokenEndpointAuthMethod: "unknown" });
  inheritedMethod.clientId = "c";
  samples.push(inheritedMethod);
  for (const value of samples)
    assert.deepEqual(
      outcome(native.normalizeStoredOAuthClient, value),
      outcome(original.normalizeStoredOAuthClient, value)
    );
  const input = { clientId: "c", registration: { client_id: "c", extension: { list: [1] } } };
  const result = native.normalizeStoredOAuthClient(input);
  result.registration.extension.list.push(2);
  assert.deepEqual(input.registration.extension.list, [1]);
});
