import assert from "node:assert/strict";
import { test } from "node:test";
import { parseObjectSelectors } from "./selectors.js";

test("batch selectors accept plain lines and parsed JSON objects or arrays", () => {
  assert.deepEqual(parseObjectSelectors("First Vault\r\n\n second \n"), ["First Vault", "second"]);
  assert.deepEqual(parseObjectSelectors([{ id: "first", ignored: true }, { id: "second" }]), ["first", "second"]);
  assert.deepEqual(parseObjectSelectors({ id: "one" }), ["one"]);
  assert.deepEqual(parseObjectSelectors([{ name: "not a selector" }, { id: "valid" }]), ["valid"]);
});

test("batch JSON streams ignore line breaks but respect strings and nested metadata", () => {
  const first = { id: "first", metadata: { braces: "} { [ ]", quote: '\\"' } };
  const second = { id: "second" };
  for (const separator of ["", "\n", "\r\n\t"]) {
    assert.deepEqual(parseObjectSelectors(JSON.stringify(first, null, 2) + separator + JSON.stringify(second)), ["first", "second"]);
  }
  assert.deepEqual(parseObjectSelectors('[{"id":"one"}, {"id":"two"}]'), ["one", "two"]);
});

test("invalid batch input fails without returning partial selectors or exposing its contents", () => {
  for (const value of [undefined, null, 1, false, [], {}, "", "\n", '[{"id":"valid"},', '{"id":"valid"} secret-private-tail', [{ id: "valid" }, { id: 2 }], [{ id: "" }], new Date(), new Uint8Array([1])]) {
    assert.throws(() => parseObjectSelectors(value), { message: "Object selectors are required" });
  }
});

test("batch parsing does not invoke selector accessors or mutate its input", () => {
  let calls = 0;
  const accessor = { get id() { calls++; return "secret"; } };
  assert.throws(() => parseObjectSelectors(accessor));
  assert.equal(calls, 0);
  const input = Object.freeze([Object.freeze({ id: "one" }), Object.freeze({ id: "one" })]);
  assert.deepEqual(parseObjectSelectors(input), ["one", "one"]);
});
