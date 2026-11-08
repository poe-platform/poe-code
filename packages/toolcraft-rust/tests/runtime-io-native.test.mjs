import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/runtime-io.js";
import * as reference from "../../toolcraft/dist/runtime/io.js";

function capture(validate, services) {
  try { return { value: validate(services) }; }
  catch (error) { return { error: [error.name, error.message] }; }
}

test("runtime services preserve reserved-name order and first own enumerable conflict", () => {
  assert.deepEqual([...native.RESERVED_SERVICE_NAMES], [...reference.RESERVED_SERVICE_NAMES]);
  for (const name of [...reference.RESERVED_SERVICE_NAMES, "database", "__proto__", "constructor"]) {
    const services = Object.fromEntries([["database", {}], [name, {}]]);
    assert.deepEqual(capture(native.validateServices, services), capture(reference.validateServices, services));
  }
  for (const services of [null, undefined, 7, "text", Object.create({ params: true }), Object.defineProperty({}, "params", { value: true })])
    assert.deepEqual(capture(native.validateServices, services), capture(reference.validateServices, services));
});

test("runtime reserved-name mutation retains the original diagnostic list and has receiver", () => {
  for (const lib of [native, reference]) {
    const original = lib.RESERVED_SERVICE_NAMES.has;
    const trace = [];
    lib.RESERVED_SERVICE_NAMES.add("custom");
    try {
      const result = capture(lib.validateServices, { custom: true });
      assert.ok(result.error[1].startsWith('Service name "custom" is reserved.'));
      assert.ok(!result.error[1].includes("inputBudget, custom"));
      lib.RESERVED_SERVICE_NAMES.has = function(name) { assert.equal(this, lib.RESERVED_SERVICE_NAMES); trace.push(name); return name === "custom" ? "truthy" : 0; };
      assert.throws(() => lib.validateServices({ database: {}, custom: {} }), /Service name "custom"/);
      assert.deepEqual(trace, ["database", "custom"]);
    } finally {
      lib.RESERVED_SERVICE_NAMES.has = original;
      lib.RESERVED_SERVICE_NAMES.delete("custom");
    }
  }
});

test("runtime capabilities retain injection identity, environment receivers and arbitrary throws", () => {
  for (const lib of [native, reference]) {
    for (const fs of [{}, null, false, 0]) assert.equal(lib.createFs(fs), fs);
    const values = Object.create({ inherited: "available" });
    values.current = "before";
    const env = lib.createEnv(values);
    values.current = "after";
    assert.equal(env.get("current"), "after");
    assert.equal(env.get("inherited"), "available");
    for (const failure of [undefined, null, Symbol("failure"), { failure: true }]) {
      const values = { get value() { assert.equal(this, values); throw failure; } };
      assert.throws(() => lib.createEnv(values).get("value"), error => error === failure);
      const services = new Proxy({}, { ownKeys() { throw failure; } });
      assert.throws(() => lib.validateServices(services), error => error === failure);
    }
  }
});
