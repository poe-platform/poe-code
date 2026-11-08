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

test("stored registration redirects retain validated exact identity before authentication admission", () => {
  for (const requestedRedirectUri of [
    undefined,
    null,
    12,
    "http://localhost/cb",
    "http://localhost:1/cb?app=one",
    "http://127.0.0.1:49152/callback",
    "http://[::1]:49152/cb",
    "https://localhost/cb",
    "http://localhost:0/cb",
    "http://attacker.example/cb",
    "http://localhost/cb?state=x",
    "http://localhost/cb#x"
  ]) {
    const value = { clientId: "c", requestedRedirectUri };
    assert.deepEqual(
      outcome(native.normalizeStoredOAuthClient, value),
      outcome(original.normalizeStoredOAuthClient, value)
    );
  }
  const value = {
    clientId: "c",
    requestedRedirectUri: "http://attacker.example/cb",
    tokenEndpointAuthMethod: "unknown"
  };
  assert.deepEqual(
    outcome(native.normalizeStoredOAuthClient, value),
    outcome(original.normalizeStoredOAuthClient, value)
  );
});

test("fresh registration redirect aliases preserve host, path, query and saved-port binding", () => {
  assert.equal(typeof native.registrationMatchesRedirect, "function");
  const requested = [
    "http://127.0.0.1:39119/cb?app=one",
    "http://localhost:39119/cb",
    "http://[::1]:39119/cb",
    "https://localhost:39119/cb",
    "http://attacker.example:39119/cb"
  ];
  const returned = [
    "http://localhost/cb?app=one",
    "http://localhost:80/cb?app=one",
    "http://localhost:39119/cb?app=one",
    "http://127.0.0.1/cb?app=one",
    "http://127.0.0.1:39120/cb?app=one",
    "http://[::1]/cb",
    "http://localhost/cb",
    "http://localhost/other?app=one",
    "http://localhost/cb?app=two",
    "http://localhost/cb?app=one#x",
    "http://user@localhost/cb?app=one",
    "https://localhost/cb?app=one",
    "invalid"
  ];
  for (const request of requested)
    for (const response of returned)
      for (const fresh of [false, true]) {
        const client = {
          clientId: "c",
          registration: { client_id: "c", redirect_uris: [response] }
        };
        assert.equal(
          native.registrationMatchesRedirect(client, request, fresh),
          original.registrationMatchesRedirect(client, request, fresh)
        );
      }
  for (const redirects of [undefined, null, []])
    assert.equal(
      native.registrationMatchesRedirect(
        { clientId: "c", registration: { client_id: "c", redirect_uris: redirects } },
        requested[0]
      ),
      true
    );
  const client = {
    clientId: "c",
    requestedRedirectUri: requested[0],
    registration: { client_id: "c", redirect_uris: [requested[1]] }
  };
  for (const request of requested)
    for (const fresh of [false, true])
      assert.equal(
        native.registrationMatchesRedirect(client, request, fresh),
        original.registrationMatchesRedirect(client, request, fresh)
      );
});
