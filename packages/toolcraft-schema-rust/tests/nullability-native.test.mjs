import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { normalizeLegacyNullability as reference } from "../../toolcraft-schema/dist/json-schema/normalize-nullability.js";
import { compileJsonSchema as referenceCompile } from "../../toolcraft-schema/dist/json-schema/index.js";

test("legacy nullable normalization preserves identities and remaps relocated reference targets", () => {
  const schemas = [
    {
      type: "string",
      nullable: true,
      description: "name",
      default: null,
      title: "Name",
      minLength: 3
    },
    {
      type: "object",
      nullable: true,
      properties: {
        definition: { type: "string", minLength: 3 },
        use: { $ref: "#/properties/definition" }
      },
      required: ["use"]
    },
    {
      $id: "https://example.test/schema",
      type: "object",
      nullable: true,
      properties: {
        definition: { type: "integer" },
        use: { $ref: "https://example.test/schema#/properties/definition" }
      }
    },
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      id: "https://example.test/legacy",
      type: "object",
      nullable: true,
      properties: {
        definition: { type: "integer" },
        use: { $ref: "https://example.test/legacy#/properties/definition" }
      }
    },
    {
      type: "object",
      properties: {
        child: {
          $id: "nested/child",
          type: "object",
          nullable: true,
          properties: {
            definition: { type: "string" },
            use: { $ref: "#/properties/definition" }
          },
          required: ["use"]
        }
      }
    },
    {
      type: "object",
      nullable: true,
      properties: {
        "foo space/~": { type: "string", nullable: true },
        use: { $ref: "#/properties/foo%20space~1~0" }
      }
    },
    {
      type: "object",
      properties: { "foo space": { type: "string" }, use: { $ref: "#/properties/foo%20space" } }
    },
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        definition: { id: "http://[", type: "integer", nullable: true },
        use: { $ref: "#/properties/definition" }
      }
    },
    {
      $id: "https://example.test/tree",
      $dynamicAnchor: "node",
      type: "object",
      nullable: true,
      properties: { value: { type: "integer" }, next: { $dynamicRef: "#node" } },
      required: ["value"]
    },
    {
      $schema: "https://json-schema.org/draft/2019-09/schema",
      $id: "https://example.test/tree",
      $recursiveAnchor: true,
      type: "object",
      nullable: true,
      properties: { value: { type: "integer" }, next: { $recursiveRef: "#" } },
      required: ["value"]
    },
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "string", nullable: true }, { type: "number" }]
    },
    {
      type: "object",
      nullable: false,
      default: { nullable: true, type: "string" },
      properties: {
        values: { type: "array", items: { type: "string", nullable: true } }
      }
    },
    ...[
      "properties",
      "$defs",
      "definitions",
      "patternProperties",
      "dependentSchemas",
      "dependencies"
    ].map((key) => ({
      type: "object",
      [key]: { nested: { type: "string", nullable: true } }
    })),
    ...["allOf", "anyOf", "oneOf", "prefixItems", "items"].map((key) => ({
      [key]: [{ type: "string", nullable: true }]
    })),
    ...[
      "items",
      "additionalProperties",
      "additionalItems",
      "contains",
      "not",
      "if",
      "then",
      "else",
      "propertyNames",
      "unevaluatedProperties",
      "unevaluatedItems"
    ].map((key) => ({ [key]: { type: "string", nullable: true } }))
  ];
  for (const schema of schemas) {
    const snapshot = structuredClone(schema);
    const actual = native.normalizeLegacyNullability(schema);
    const expected = reference(schema);
    assert.deepEqual(actual, expected);
    assert.deepEqual(schema, snapshot);
    if (schema === schemas[0] || schemas.indexOf(schema) > 11) continue;
    const compiled = native.compileJsonSchema(actual);
    const oracle = referenceCompile(expected);
    for (const value of [
      null,
      "yes",
      "x",
      false,
      1,
      {},
      { use: null },
      { use: "yes" },
      { use: 1 },
      { child: null },
      { child: { use: 1 } },
      { value: 1, next: null },
      { value: 1, next: { value: "wrong" } },
      [null, 1]
    ]) {
      assert.equal(compiled.validate(value).ok, oracle.validate(value).ok);
    }
  }
});

test("nullable normalization copies UTF16 names and rejects host hooks without invoking them", () => {
  const schema = { nullable: true, properties: { "\ud800": { type: "string", nullable: true } } };
  assert.deepEqual(native.normalizeLegacyNullability(schema), reference(schema));
  let calls = 0;
  for (const value of [
    {
      get nullable() {
        calls++;
        return true;
      }
    },
    {
      toJSON() {
        calls++;
        return {};
      }
    },
    (() => {
      const cyclic = {};
      cyclic.properties = cyclic;
      return cyclic;
    })()
  ])
    assert.throws(() => native.normalizeLegacyNullability(value));
  assert.equal(calls, 0);
  const normalized = native.normalizeLegacyNullability({
    nullable: true,
    properties: {
      ["__proto__"]: { type: "string" }
    }
  });
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.deepEqual(normalized.anyOf[0].properties["__proto__"], { type: "string" });
  assert.ok(Object.hasOwn(normalized.anyOf[0].properties, "__proto__"));
});
