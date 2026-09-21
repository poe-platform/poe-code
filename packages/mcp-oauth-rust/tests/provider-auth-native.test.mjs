import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("../dist/mcp-oauth-rust.node");
test("native authentication policies bound discovery and retain explicit method profiles", () => {
  for (const method of ["none", "client_secret_basic", "client_secret_post", undefined, null]) {
    assert.deepEqual(native.providerTokenMethod(JSON.stringify({ method })), {
      value: method ?? null
    });
  }
  for (const method of [false, 1, {}, [], "private_key_jwt", "client_secret_basic\ud800"]) {
    assert.deepEqual(native.providerTokenMethod(JSON.stringify({ method })), {
      error: "Unsupported OAuth token endpoint authentication method"
    });
  }
  for (const methods of [null, false, {}, [null], Array(129).fill("none")]) {
    assert.deepEqual(
      native.providerRegistrationMethod(
        JSON.stringify({ metadata: { token_endpoint_auth_methods_supported: methods } })
      ),
      { error: "Invalid OAuth token endpoint authentication metadata" }
    );
  }
  const metadata = {
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"]
  };
  assert.deepEqual(native.providerRegistrationMethod(JSON.stringify({ metadata })), {
    value: "client_secret_basic"
  });
  assert.deepEqual(
    native.providerAssertTokenMethod(
      JSON.stringify({
        metadata,
        client: { clientId: "c", clientSecret: "s", tokenEndpointAuthMethod: "client_secret_basic" }
      })
    ),
    { value: null }
  );
  assert.deepEqual(
    native.providerAssertTokenMethod(
      JSON.stringify({
        metadata,
        client: { clientId: "c", tokenEndpointAuthMethod: "client_secret_basic" }
      })
    ),
    { error: "OAuth token endpoint authentication requires a client secret" }
  );
  assert.deepEqual(
    native.providerAssertSessionMethod(
      JSON.stringify({
        client: { clientId: "c", clientSecret: "s" },
        method: "client_secret_basic"
      })
    ),
    {
      error:
        "Stored session does not match the requested OAuth token endpoint authentication; select separate persistence or reset it"
    }
  );
  assert.deepEqual(
    native.providerAssertSessionMethod(
      JSON.stringify({ client: { clientId: "c", clientSecret: "s" }, method: "client_secret_post" })
    ),
    { value: null }
  );
});
