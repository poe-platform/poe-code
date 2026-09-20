import assert from "node:assert/strict";
import { test } from "node:test";
import { compileJsonSchema, formatIssues } from "../dist/index.js";
import {
  compileJsonSchema as referenceCompile,
  formatIssues as referenceFormat
} from "../../toolcraft-schema/dist/json-schema/index.js";

test("native diagnostics agree with the TypeScript compiler across supported applicators", () => {
  const schemas = [
    true,
    false,
    { type: ["integer", "null"] },
    { const: { a: 1, b: 2 } },
    { enum: [null, { x: 1 }] },
    { const: 0 },
    { enum: [0] },
    { minimum: 2, exclusiveMaximum: 4, multipleOf: 0.1 },
    { minLength: 2, maxLength: 3 },
    {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 } },
      required: ["name"],
      additionalProperties: false,
      dependentRequired: { age: ["name"] }
    },
    {
      prefixItems: [{ type: "integer" }],
      items: { type: "string" },
      contains: { const: "yes" },
      minContains: 1,
      maxContains: 1,
      uniqueItems: true
    },
    {
      anyOf: [
        { properties: { a: true }, required: ["a"] },
        { properties: { b: true }, required: ["b"] }
      ],
      unevaluatedProperties: false
    },
    { if: { type: "integer" }, then: { minimum: 2 }, else: { type: "string" } },
    { oneOf: [{ type: "integer" }, { type: "number" }] },
    { not: { type: "string" } },
    { $defs: { "a/b~c": { type: "integer" } }, $ref: "#/$defs/a~1b~0c", minimum: 2 },
    { type: "object", properties: { next: { $ref: "#" }, value: { type: "integer" } } },
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: { n: { type: "integer" } },
      $ref: "#/definitions/n",
      minimum: 2
    },
    {
      propertyNames: { minLength: 2 },
      dependentSchemas: { a: { required: ["b"] } },
      minProperties: 1,
      maxProperties: 2
    },
    { contains: { type: "integer" }, unevaluatedItems: false },
    { $ref: "#" }
  ];
  const values = [
    null,
    false,
    0,
    -0,
    1,
    1.1,
    0.3,
    4,
    "",
    "hello",
    "🦀\ud800",
    [],
    [1],
    [1, "yes"],
    [1, "yes", "yes"],
    [1, 1],
    {},
    { name: 1 },
    { age: -1 },
    { a: 1, b: 2 },
    { a: 1, c: 3 },
    { next: { value: "bad" } },
    { "\ud800": 1 }
  ];
  for (const schema of schemas) {
    const native = compileJsonSchema(schema),
      reference = referenceCompile(schema);
    for (const value of values) {
      const actual = native.validate(value),
        expected = reference.validate(value);
      assert.deepEqual(actual, expected, JSON.stringify({ schema, value }));
      if (!actual.ok) assert.equal(formatIssues(actual.issues), referenceFormat(expected.issues));
    }
  }
});

test("native schema diagnostics preserve UTF16 property names beyond the reference URI scanner", () => {
  const schema = { properties: { "\ud800": { type: "string" } }, required: ["\udfff"] };
  assert.throws(() => referenceCompile(schema), { message: "URI malformed" });
  const result = compileJsonSchema(schema).validate({ "\ud800": 1 });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.path),
    [["\ud800"], ["\udfff"]]
  );
  assert.equal(result.issues[1].received, "undefined");
  assert.equal(result.issues[1].message, "must have required property '\udfff'");
});

test("native compilation reports invalid schema grammar before any instance is validated", () => {
  for (const schema of [
    null,
    [],
    { type: "invalid" },
    { type: ["string", "string"] },
    { minLength: -1 },
    { multipleOf: 0 },
    { required: ["x", "x"] },
    { properties: { x: 1 } },
    { anyOf: [] },
    { items: [] },
    { enum: {} },
    { uniqueItems: 1 },
    { $ref: 1 }
  ]) {
    let expected;
    try {
      referenceCompile(schema);
    } catch (error) {
      expected = error.message;
    }
    assert.notEqual(expected, undefined, JSON.stringify(schema));
    assert.throws(() => compileJsonSchema(schema), { message: expected });
  }
});

test("successful validation preserves caller value identity and schemas are copied safely", () => {
  const schema = { type: "object", properties: { name: { type: "string" } } };
  const compiled = compileJsonSchema(schema);
  schema.properties.name.type = "number";
  const value = { name: "hello" };
  assert.equal(compiled.validate(value).value, value);
  let effects = 0;
  for (const invalid of [
    {
      get type() {
        effects++;
        return "object";
      }
    },
    {
      toJSON() {
        effects++;
        return {};
      }
    },
    new Date(),
    new Array(2)
  ]) {
    assert.throws(() => compileJsonSchema(invalid));
    assert.equal(effects, 0);
  }
  assert.throws(() =>
    compiled.validate({
      get name() {
        effects++;
        return "hello";
      }
    })
  );
  assert.equal(effects, 0);
});

test("unfinished schema features fail explicitly rather than silently relaxing constraints", () => {
  for (const schema of [
    { pattern: "^a" },
    { $dynamicRef: "#node" },
    { $id: "https://example.test/schema" },
    { patternProperties: { a: false } }
  ]) {
    assert.throws(() => compileJsonSchema(schema), /Schema feature not yet implemented/);
  }
  assert.throws(() => compileJsonSchema({}, { formats: {} }), /options are not yet implemented/);
});
