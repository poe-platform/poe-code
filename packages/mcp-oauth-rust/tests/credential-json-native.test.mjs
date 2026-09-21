import { test } from "node:test";
import assert from "node:assert/strict";
import { copyBoundedOAuthJson } from "../dist/bounded-json.js";
import * as ownRegistration from "../dist/registration.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../mcp-oauth/src/client/bounded-json.ts", import.meta.url),
  originalRegistration = await tsImport(
    "../../mcp-oauth/src/client/client-registration.ts",
    import.meta.url
  );
test("bounded credential JSON owns extensions without running accessors or serialization", () => {
  for (const api of [original, { copyBoundedOAuthJson }]) {
    const input = JSON.parse('{"__proto__":{"values":[1,true,null,"\\ud800"]}}');
    const result = api.copyBoundedOAuthJson(input, "invalid credential");
    assert.deepEqual(result, input);
    result.__proto__.values.push(2);
    assert.equal(input.__proto__.values.length, 4);
    for (const value of [null, false, "x\\ud800", 1])
      assert.equal(api.copyBoundedOAuthJson(value, "invalid credential"), value);
    for (const value of [
      undefined,
      NaN,
      Infinity,
      () => {},
      new Date(),
      new Array(1),
      "x".repeat(65_536)
    ])
      assert.throws(
        () => api.copyBoundedOAuthJson(value, "invalid credential"),
        (error) => error.message === "invalid credential"
      );
    let touched = false;
    assert.throws(
      () =>
        api.copyBoundedOAuthJson(
          {
            get hidden() {
              touched = true;
              throw Error("secret");
            }
          },
          "invalid credential"
        ),
      (error) => error.message === "invalid credential"
    );
    assert.equal(touched, false);
    const ignored = { visible: "x" };
    Object.defineProperty(ignored, "ignored".repeat(10000), {
      get() {
        throw Error("must ignore");
      }
    });
    assert.deepEqual(api.copyBoundedOAuthJson(ignored, "invalid credential"), { visible: "x" });
  }
});
test("registration byte budget rejects before a missing-client diagnostic", () => {
  const value = { client_id: "", extension: "x".repeat(65536) };
  for (const api of [originalRegistration, ownRegistration])
    assert.throws(
      () => api.parseOAuthClientRegistration(value),
      (error) => error.message === "Invalid OAuth client registration metadata"
    );
});
