import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCasedSchemaMembers as native } from "../dist/schema-member-names.js";
import { validateCasedSchemaMembers as reference } from "../../toolcraft/dist/schema-member-names.js";
import { S } from "toolcraft-schema";
import { spawnSync } from "node:child_process";

test("member validation rejects nested collisions and discriminator aliases", () => {
  const same = () => "member";
  for (const schema of [
    S.Object({ first: S.String(), second: S.Number() }),
    S.Array(S.Object({ first: S.String(), second: S.Number() })),
    S.Record(S.Object({ first: S.String(), second: S.Number() })),
    S.OneOf({ discriminator: "kind", branches: { a: S.Object({ alias: S.String() }) } })
  ]) {
    let expected;
    try { reference(schema, same, "SDK member"); } catch (error) { expected = error; }
    assert.ok(expected);
    assert.throws(() => native(schema, same, "SDK member"), error => error.name === expected.name && error.message === expected.message);
  }
});

test("member traversal preserves entry snapshots, depth-first formatting and getters", () => {
  function run(validate) {
    const log = [];
    const schema = { kind: "object", get shape() { log.push("shape"); return {
      get first() { log.push("first getter"); return S.Object({ inner: S.String() }); },
      get second() { log.push("second getter"); return S.Number(); }
    }; } };
    validate(schema, function(key) { log.push(["format", key, this]); return key; }, "MCP field");
    return log;
  }
  assert.deepEqual(run(native), run(reference));
});

test("member formatter failures preserve arbitrary values and close enclosing iterators", () => {
  for (const validate of [native, reference]) {
    for (const failure of [undefined, null, Symbol("failure"), { failure: true }]) {
      const log = [];
      const branches = { [Symbol.iterator]: () => ({
        next: () => ({ done: false, value: S.Object({ first: S.String() }) }),
        return() { log.push("closed"); throw new Error("cleanup"); }
      }) };
      assert.throws(() => validate({ kind: "union", branches }, () => { throw failure; }, "SDK member"), error => error === failure);
      assert.deepEqual(log, ["closed"]);
    }
  }
});

test("member maps preserve arbitrary formatter keys and independent branch scopes", () => {
  for (const validate of [native, reference]) {
    const key = {};
    assert.throws(() => validate(S.Object({ first: S.String(), second: S.String() }), () => key, "SDK member"), /Parameters "first" and "second"/);
    validate(S.Union([S.Object({ first: S.String() }), S.Object({ second: S.String() })]), () => key, "SDK member");
    validate(S.Object({ first: S.Object({ inner: S.String() }) }), name => name, "SDK member");
  }
});

test("discriminator access repeats per branch and optional wrappers retain it", () => {
  function run(validate) {
    const log = [];
    const schema = { kind: "oneOf", branches: {
      first: S.Optional(S.Object({ field: S.String() })),
      second: S.Object({ other: S.String() })
    }, get discriminator() { log.push("discriminator"); return "kind"; } };
    validate(schema, key => { log.push(key); return key; }, "MCP field");
    return log;
  }
  assert.deepEqual(run(native), run(reference));
});

test("formatters can reenter validation without sharing member maps", () => {
  for (const validate of [native, reference]) {
    const child = S.Object({ nested: S.String() });
    const keys = [];
    validate(S.Object({ first: S.String(), second: S.String() }), key => {
      validate(child, nested => { keys.push(nested); return key; }, "SDK member");
      return key;
    }, "MCP field");
    assert.deepEqual(keys, ["nested", "nested"]);
  }
});

test("cyclic member graphs throw catchable errors and release reentrancy state", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { validateCasedSchemaMembers } from ${JSON.stringify(new URL("../dist/schema-member-names.js", import.meta.url).href)};
    for (const schema of [{ kind: "optional" }, { kind: "object", shape: {} }]) {
      if (schema.kind === "optional") schema.inner = schema;
      else schema.shape.self = schema;
      assert.throws(() => validateCasedSchemaMembers(schema, key => key, "SDK member"), RangeError);
    }
    validateCasedSchemaMembers({ kind: "object", shape: {} }, key => key, "MCP field");
  `], { encoding: "utf8", timeout: 3000 });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
