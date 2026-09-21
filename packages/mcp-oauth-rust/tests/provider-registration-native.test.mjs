import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("../dist/mcp-oauth-rust.node");
test("registration trust preserves exact issuer and lazy public/unlimited expiry admission", () => {
  const client = {
    clientId: "c",
    clientSecret: "s",
    registration: { issuer: "https://auth.example", client_secret_expires_at: 10 }
  };
  assert.deepEqual(
    native.providerAssertRegistrationIssuer(JSON.stringify(client), "https://auth.example"),
    { value: null }
  );
  assert.deepEqual(
    native.providerAssertRegistrationIssuer(JSON.stringify(client), "https://auth.example/"),
    { error: "OAuth client registration issuer does not match the authorization server" }
  );
  assert.equal(native.providerSecretNeedsClock(JSON.stringify(client)), true);
  assert.equal(native.providerSecretExpired(JSON.stringify(client), 9999), false);
  assert.equal(native.providerSecretExpired(JSON.stringify(client), 10000), true);
  for (const value of [
    { clientId: "c" },
    { ...client, tokenEndpointAuthMethod: "none" },
    { ...client, registration: { client_secret_expires_at: 0 } },
    { ...client, registration: { client_secret_expires_at: null } }
  ]) {
    assert.equal(native.providerSecretNeedsClock(JSON.stringify(value)), false);
    assert.equal(native.providerSecretExpired(JSON.stringify(value), Infinity), false);
  }
});
test("stored ownership normalization matches original admission and property effects", async () => {
  process.env.TSX_DISABLE_CACHE = "1";
  const { tsImport } = await import("tsx/esm/api"),
    original = await tsImport("../../mcp-oauth/src/client/client-registration.ts", import.meta.url),
    own = await import("../dist/registration.js");
  for (const api of [original, own]) {
    const client = {
      clientId: "c",
      registration: { client_id: "c", extension: { values: [1] } },
      registrationOwnership: "caller"
    };
    const result = api.normalizeStoredOAuthClient(client);
    assert.equal(result.registrationOwnership, "caller");
    result.registration.extension.values.push(2);
    assert.deepEqual(client.registration.extension.values, [1]);
    for (const registrationOwnership of [null, false, 0, {}, "native", "caller\ud800"]) {
      assert.throws(
        () => api.normalizeStoredOAuthClient({ ...client, registrationOwnership }),
        (error) => error.message === "Invalid stored OAuth registration ownership"
      );
    }
    assert.throws(
      () => api.normalizeStoredOAuthClient({ clientId: "c", registrationOwnership: "caller" }),
      (error) => error.message === "Invalid stored OAuth registration ownership"
    );
    const reason = Symbol("ownership getter");
    assert.throws(
      () =>
        api.normalizeStoredOAuthClient({
          ...client,
          get registrationOwnership() {
            throw reason;
          }
        }),
      (error) => error === reason
    );
    assert.equal(
      api.normalizeStoredOAuthClient({
        clientId: "",
        get registrationOwnership() {
          throw Error("must not read");
        }
      }),
      null
    );
  }
});
