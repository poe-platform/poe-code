import assert from "node:assert/strict";
import { test } from "node:test";
import { captureEnvironment, restoreEnvironment } from "./environment.js";

test("complete snapshots restore exact variables including empty values", () => {
  const original = { PATH: "/tools", EMPTY: "", TOKEN: "synthetic-secret", UNSET: undefined };
  const snapshot = captureEnvironment(original);
  assert.deepEqual(restoreEnvironment(snapshot, { EXTRA: "new", TOKEN: "changed" }), { PATH: "/tools", EMPTY: "", TOKEN: "synthetic-secret" });
  assert.deepEqual(original, { PATH: "/tools", EMPTY: "", TOKEN: "synthetic-secret", UNSET: undefined });
});

test("selected snapshots distinguish unset variables and preserve unrelated values", () => {
  const snapshot = captureEnvironment({ EMPTY: "", VALUE: "old" }, { names: ["EMPTY", "VALUE", "ABSENT"] });
  assert.equal(snapshot.variables.ABSENT, null);
  assert.deepEqual(restoreEnvironment(snapshot, { EMPTY: "changed", VALUE: "changed", ABSENT: "new", OTHER: "keep" }), { EMPTY: "", VALUE: "old", OTHER: "keep" });
});

test("snapshots and restored values are detached and serialize losslessly", () => {
  const source = { VALUE: "before" };
  const snapshot = captureEnvironment(source);
  source.VALUE = "after";
  const restored = restoreEnvironment(JSON.parse(JSON.stringify(snapshot)), {});
  assert.equal(restored.VALUE, "before");
  restored.VALUE = "another";
  assert.equal(snapshot.variables.VALUE, "before");
});

test("invalid snapshots fail without changing current state", () => {
  const current = { VALUE: "unchanged" };
  for (const snapshot of [null, {}, { version: 2, scope: "complete", variables: {} }, { version: 1, scope: "invalid", variables: {} }, { version: 1, scope: "complete", variables: { VALUE: 12 } }, { version: 1, scope: "complete", variables: { "BAD=NAME": "x" } }]) {
    assert.throws(() => restoreEnvironment(snapshot, current));
    assert.deepEqual(current, { VALUE: "unchanged" });
  }
});

test("prototype-like variable names remain ordinary data", () => {
  const variables = JSON.parse('{"__proto__":"plain","constructor":"data"}');
  const restored = restoreEnvironment(captureEnvironment(variables), {});
  assert.equal(Object.hasOwn(restored, "__proto__"), true);
  assert.equal(restored.__proto__, "plain");
  assert.equal(restored.constructor, "data");
  assert.equal(Object.getPrototypeOf(restored), Object.prototype);
});

test("capture rejects invalid names and NUL values without leaking values", () => {
  for (const source of [{ "": "private" }, { "A=B": "private" }, { NAME: "private\0value" }]) {
    assert.throws(() => captureEnvironment(source), error => error instanceof Error && !error.message.includes("private"));
  }
});
