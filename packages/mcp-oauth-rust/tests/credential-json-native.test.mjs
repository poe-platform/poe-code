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
test("credential JSON owns extensions without running accessors or serialization", () => {
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
      new Array(1)
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
test("large registration extensions preserve the missing-client diagnostic", () => {
  const value = { client_id: "", extension: "x".repeat(65536) };
  for (const api of [originalRegistration, ownRegistration])
    assert.throws(
      () => api.parseOAuthClientRegistration(value),
      (error) => error.message === "OAuth client registration response missing client_id"
    );
});

test("credential JSON accepts large and deep extensions while rejecting cycles", () => {
  let extension = "x".repeat(100_000);
  for (let depth = 0; depth < 100; depth++) extension = { next: extension };
  const value = { client_id: "c", extension, nodes: Array(25_000).fill(null) };
  for (const api of [original, { copyBoundedOAuthJson }]) {
    assert.deepEqual(api.copyBoundedOAuthJson(value, "invalid credential"), value);
    const cycle = {}; cycle.self = cycle;
    assert.throws(() => api.copyBoundedOAuthJson(cycle, "invalid credential"), { message: "invalid credential" });
    const shared = { value: "shared" };
    assert.deepEqual(api.copyBoundedOAuthJson([shared, shared], "invalid credential"), [shared, shared]);
  }
});

test("native credential copying handles deep output without recursion", () => {
  let input = "leaf";
  for (let depth = 0; depth < 20_000; depth++) input = { next: input };
  let output = copyBoundedOAuthJson(input, "invalid credential");
  assert.notEqual(output, input);
  for (let depth = 0; depth < 20_000; depth++) output = output.next;
  assert.equal(output, "leaf");
});

test("credential JSON copies large and deeply nested values while rejecting cycles", () => {
  for (const api of [original, { copyBoundedOAuthJson }]) {
    const shared = { text: "x".repeat(65_536), values: Array(20_001).fill(null) };
    const copy = api.copyBoundedOAuthJson([shared, shared], "invalid credential");
    assert.deepEqual(copy, [shared, shared]);
    assert.notEqual(copy[0], copy[1]);
    assert.notEqual(copy[0].values, shared.values);
    let nested = "leaf";
    for (let depth = 0; depth < 5000; depth++) nested = { child: nested };
    let copied = api.copyBoundedOAuthJson(nested, "invalid credential");
    for (let depth = 0; depth < 5000; depth++) copied = copied.child;
    assert.equal(copied, "leaf");
    const cycle = {};
    cycle.child = { parent: cycle };
    assert.throws(() => api.copyBoundedOAuthJson(cycle, "invalid credential"), { message: "invalid credential" });
  }
});
