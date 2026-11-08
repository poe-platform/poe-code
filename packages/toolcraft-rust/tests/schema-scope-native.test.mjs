import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/schema-scope.js";
import * as reference from "../../toolcraft/dist/schema-scope.js";
import { S } from "toolcraft-schema";
import { spawnSync } from "node:child_process";

test("scope projection retains origins, optional promotion and all container kinds", () => {
  for (const api of [native, reference]) {
    const leaf = S.String({ requiredScopes: ["sdk"] });
    const schema = S.Object({
      required: S.Optional(leaf),
      hidden: S.String({ scope: ["cli"] }),
      array: S.Array(S.Number()), record: S.Record(S.Json()),
      union: S.Union([S.Object({ value: S.Boolean() })]),
      oneOf: S.OneOf({ discriminator: "kind", branches: { first: S.Object({ value: S.String() }) } })
    });
    const result = api.filterSchemaForScope(schema, "sdk");
    assert.equal(result.shape.required, leaf);
    assert.equal(api.getUnfilteredSchema(leaf), leaf);
    assert.equal(Object.hasOwn(result.shape, "hidden"), false);
    assert.equal(api.getUnfilteredSchema(result), schema);
    assert.equal(api.getUnfilteredSchema(api.filterSchemaForScope(result, "mcp")), schema);
    assert.deepEqual(result, reference.filterSchemaForScope(schema, "sdk"));
  }
});

test("scope projection preserves getter order, spread descriptors and custom includes", () => {
  function run(api) {
    const log = [];
    const scope = { includes(value) { log.push(["includes", this === scope, value]); return "yes"; } };
    const symbol = Symbol.for("scope-test");
    const schema = new Proxy({
      kind: "array", scope, item: { kind: "string" }, [symbol]: "kept"
    }, {
      get(target, key, receiver) { log.push(["get", key]); return Reflect.get(target, key, receiver); },
      ownKeys(target) { log.push("keys"); return Reflect.ownKeys(target); }
    });
    const result = api.filterSchemaForScope(schema, "sdk");
    assert.equal(result.scope, scope);
    const descriptors = Object.getOwnPropertyDescriptors(result);
    descriptors.scope.value = "same scope";
    return { log, descriptors };
  }
  assert.deepEqual(run(native), run(reference));
});

test("scope projection keeps custom flatMap results and retained callbacks", () => {
  for (const api of [native, reference]) {
    let retained;
    const branches = [];
    const custom = { length: 1, result: true };
    branches.flatMap = function(callback) { assert.equal(this, branches); retained = callback; return custom; };
    const schema = { kind: "union", branches };
    const result = api.filterSchemaForScope(schema, "sdk");
    assert.equal(result.branches, custom);
    assert.deepEqual(retained(S.Object({ visible: S.String(), hidden: S.String({ scope: ["cli"] }) })), [S.Object({ visible: S.String() })]);
    assert.deepEqual(retained(S.String()), []);
    assert.deepEqual(retained(S.Object({}, { scope: ["cli"] })), []);
  }
});

test("scope projection keeps arbitrary host exceptions and permits reentrant filters", () => {
  for (const api of [native, reference]) {
    for (const failure of [undefined, null, 7, Symbol("failure"), { failure: true }]) {
      assert.throws(() => api.filterSchemaForScope({ get scope() { throw failure; } }, "sdk"), error => error === failure);
    }
    const inner = S.Object({ field: S.String() });
    const schema = { kind: "string", scope: { includes() {
      assert.deepEqual(api.filterSchemaForScope(inner, "sdk"), inner);
      return true;
    } } };
    assert.equal(api.filterSchemaForScope(schema, "sdk"), schema);
  }
});

test("object projection spreads before traversing shape and preserves changing getters", () => {
  function run(api) {
    const log = [];
    let reads = 0;
    const child = new Proxy(S.String(), { get(target, key) { log.push(["child", key]); return target[key]; } });
    const schema = new Proxy({
      kind: "object",
      get shape() { log.push("shape"); return ++reads === 1 ? { discarded: child } : { visible: child }; }
    }, { get(target, key, receiver) { log.push(["parent", key]); return Reflect.get(target, key, receiver); } });
    const result = api.filterSchemaForScope(schema, "sdk");
    assert.equal(result.shape.visible, child);
    return { log, keys: Object.keys(result.shape) };
  }
  assert.deepEqual(run(native), run(reference));
});

test("empty sparse unions use strict nullable and length checks", () => {
  for (const nullable of [undefined, false, true, 1, "true"]) {
    for (const length of [0, "0", undefined]) {
      const branches = new Array(3);
      branches.flatMap = () => ({ length });
      const schema = { kind: "union", branches, nullable };
      assert.deepEqual(native.filterSchemaForScope(schema, "sdk"), reference.filterSchemaForScope(schema, "sdk"));
    }
  }
});

test("deep and cyclic scope graphs fail with catchable errors instead of aborting Node", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { filterSchemaForScope } from ${JSON.stringify(new URL("../dist/schema-scope.js", import.meta.url).href)};
    for (const kind of ["optional", "object"]) {
      const schema = kind === "optional" ? { kind } : { kind, shape: {} };
      if (kind === "optional") schema.inner = schema;
      else schema.shape.self = schema;
      assert.throws(() => filterSchemaForScope(schema, "sdk"), RangeError);
    }
    assert.deepEqual(filterSchemaForScope({ kind: "object", shape: {} }, "sdk"), { kind: "object", shape: {} });
  `], { encoding: "utf8", timeout: 3000 });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
