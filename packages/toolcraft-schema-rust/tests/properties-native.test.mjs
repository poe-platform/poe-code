import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "toolcraft-schema";

test("property projection retains references, annotations, required policy and candidate diagnostics", () => {
  assert.equal(typeof native.projectJsonSchemaProperties, "function");
  const schema = {
    $defs: { ID: { type: "string", minLength: 2, description: "identifier" } },
    allOf: [
      {
        properties: {
          id: { $ref: "#/$defs/ID" },
          nested: { type: "array", items: { type: "number" } }
        },
        required: ["id"]
      },
      {
        anyOf: [
          {
            properties: { shared: { type: "integer" }, first: false },
            required: ["shared", "first"]
          },
          { properties: { shared: { type: "boolean" }, second: true }, required: ["shared"] }
        ]
      }
    ],
    then: { properties: { conditional: { type: "string" } }, required: ["conditional"] }
  };
  const actual = native.projectJsonSchemaProperties(schema);
  const expected = reference.projectJsonSchemaProperties(schema);
  assert.deepEqual(
    actual.map(({ name, required, schemas }) => ({ name, required, schemas })),
    expected.map(({ name, required, schemas }) => ({ name, required, schemas }))
  );
  for (let index = 0; index < actual.length; index++) {
    for (const value of [null, false, 1, 1.5, "", "okay", [1], ["bad"], {}]) {
      assert.deepEqual(actual[index].validate(value), expected[index].validate(value));
    }
  }
});

test("projection isolates annotations, retains snapshot getters and preserves reference ordering", () => {
  function run(api) {
    const log = [];
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $ref: "https://example.test/base",
      properties: { ignored: true },
      get description() {
        log.push("schema getter");
        return "root";
      }
    };
    const registry = {
      "https://example.test/base": {
        properties: {
          ["__proto__"]: { type: "string" },
          "a/b~c": { $ref: "#/$defs/Target", description: "ignored sibling" },
          item: {
            allOf: [{ properties: { count: { type: "integer" } } }],
            "allOf/0": { untouched: true },
            dependencies: { count: ["other"] }
          }
        },
        $defs: { Target: { type: "integer", description: "target" } },
        allOf: [{ $ref: "https://example.test/base" }]
      }
    };
    const options = {
      get registry() {
        log.push("registry getter");
        return registry;
      }
    };
    const properties = api.projectJsonSchemaProperties(schema, options);
    const metadata = properties.map(({ name, required, schemas }) => ({ name, required, schemas }));
    assert.equal(properties.find((item) => item.name === "__proto__").validate("safe").ok, true);
    const projected = properties.find((item) => item.name === "a/b~c");
    registry["https://example.test/base"].$defs.Target.type = "boolean";
    assert.equal(projected.validate(1).ok, true);
    projected.schemas[0].type = "string";
    assert.equal(projected.validate(1).ok, true);
    return { log, metadata };
  }
  assert.deepEqual(run(native), run(reference));
});

test("candidate validators evaluate every declaration with isolated dynamic scope and callbacks", () => {
  function run(api) {
    const log = [];
    const properties = api.projectJsonSchemaProperties(
      {
        allOf: [
          { properties: { value: { format: "first" } } },
          { properties: { value: { format: "second" } } }
        ]
      },
      {
        formats: {
          first: (value) => {
            log.push(["first", value]);
            return true;
          },
          second: (value) => {
            log.push(["second", value]);
            return value === "inner" || properties[0].validate("inner").ok;
          }
        }
      }
    );
    const input = "outer";
    assert.equal(properties[0].validate(input).value, input);
    return log;
  }
  assert.deepEqual(run(native), run(reference));
});

test("projection and compiler format callbacks preserve arbitrary thrown values", () => {
  for (const api of [native, reference])
    for (const thrown of [undefined, null, 7, Symbol("failure"), { reason: "stop" }]) {
      const options = {
        formats: {
          fail: () => {
            throw thrown;
          }
        }
      };
      const candidate = api.projectJsonSchemaProperties(
        { properties: { value: { format: "fail" } } },
        options
      )[0];
      const compiled = api.compileJsonSchema({ format: "fail" }, options);
      for (const validator of [candidate, compiled])
        assert.throws(
          () => validator.validate("value"),
          (error) => Object.is(error, thrown)
        );
    }
});

test("the native schema runtime exposes every reference export", () => {
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
});
