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
  for (const schema of [{ pattern: "(a)\\1" }, { pattern: "(?<=a)b" }]) {
    assert.throws(() => compileJsonSchema(schema), /Pattern feature not yet implemented/);
  }
  assert.throws(
    () => compileJsonSchema({}, { formats: { uri: {} } }),
    /Custom schema formats are not yet implemented/
  );
});

test("registered resources, URI aliases, dynamic and recursive references match native diagnostics", () => {
  const cases = [
    [
      { $ref: "https://retrieve.test/root#/$defs/value" },
      {
        "https://retrieve.test/root": {
          $id: "https://declared.test/root",
          $defs: { value: { $ref: "value" } }
        },
        "https://declared.test/value": { type: "integer", minimum: 2 }
      }
    ],
    [
      {
        $id: "https://test.test/root",
        $defs: { leaf: { type: "integer" } },
        $ref: " \t#/$defs/leaf\n "
      },
      {}
    ],
    [
      {
        $id: "https://test.test/root",
        $dynamicAnchor: "node",
        type: "object",
        properties: { next: { $dynamicRef: "#node" }, value: { type: "integer" } }
      },
      {}
    ],
    [
      {
        $id: "https://test.test/root",
        $recursiveAnchor: true,
        type: "object",
        properties: { next: { $recursiveRef: "#" }, value: { type: "integer" } }
      },
      {}
    ],
    [
      {
        $schema: "https://test.test/meta",
        properties: { value: { minimum: 10 }, forbidden: false }
      },
      {
        "https://test.test/meta": {
          $vocabulary: { "https://json-schema.org/draft/2020-12/vocab/core": true }
        }
      }
    ]
  ];
  for (const [schema, registry] of cases) {
    const native = compileJsonSchema(schema, { registry });
    const reference = referenceCompile(schema, { registry });
    for (const input of [
      null,
      1,
      2,
      "bad",
      {},
      { value: 1 },
      { next: { value: "bad" } },
      { forbidden: 1 }
    ]) {
      assert.deepEqual(
        native.validate(input),
        reference.validate(input),
        JSON.stringify({ schema, input })
      );
    }
  }
  for (const [schema, registry] of [
    [true, { "https://test.test/bad": null }],
    [{ $ref: "https://test.test/missing" }, {}]
  ]) {
    let expected;
    try {
      referenceCompile(schema, { registry });
    } catch (error) {
      expected = error.message;
    }
    assert.notEqual(expected, undefined);
    assert.throws(() => compileJsonSchema(schema, { registry }), { message: expected });
  }
});

test("schema resource URI normalization agrees with Node URL and the TypeScript compiler", () => {
  for (const [reference, base] of [
    ["http:relative", "http://example.test/a/root"],
    ["https:relative", "http://example.test/a/root"],
    ["\\\\other.test\\x", "https://example.test/a/root"],
    ["?x='", "https://example.test/a/root"],
    ["https://user:@example.test", "https://example.test"],
    ["https://@example.test", "https://example.test"],
    ["https://[0:0:0:0:0:0:0:1]/", "https://example.test"],
    ["https://127.1/", "https://example.test"],
    ["https://%65xample.test/", "https://example.test"]
  ]) {
    const schema = { $id: base, $ref: reference };
    const registry = { [new URL(reference, base).href]: { type: "integer" } };
    const native = compileJsonSchema(schema, { registry });
    const expected = referenceCompile(schema, { registry });
    for (const input of [1, "bad"])
      assert.deepEqual(native.validate(input), expected.validate(input), reference);
  }
});

test("fragment references normalize controls and follow later registered resource aliases", () => {
  for (const [schema, registry] of [
    [{ $defs: { leaf: { type: "integer" } }, $ref: "#/$defs/leaf\t\n " }, {}],
    [
      { $id: "https://test.test/root", $defs: { leaf: { type: "string" } }, $ref: "#/$defs/leaf" },
      {
        "https://test.test/root": { $defs: { leaf: { type: "integer" } } }
      }
    ]
  ]) {
    const native = compileJsonSchema(schema, { registry });
    const reference = referenceCompile(schema, { registry });
    for (const input of [1, "bad"])
      assert.deepEqual(native.validate(input), reference.validate(input));
  }
});

test("Rust Unicode patterns agree with the TypeScript engine for classes, assertions and repetition", () => {
  const patterns = [
    "",
    "a",
    "^a*$",
    "a+",
    "a?",
    "(?:ab|c){2,3}",
    "^(?=a)[^0-9]+$",
    "a(?!b)",
    "^.$",
    "^.*$",
    "^[^]*$",
    "[]",
    "[^]",
    "[a-z]",
    "[^a-z]",
    "[-a]",
    "[a-]",
    "^\\d{2,}$",
    "^\\D+$",
    "^\\w+$",
    "^\\W+$",
    "^\\s+$",
    "^\\S+$",
    "\\ba\\b",
    "\\Ba\\B",
    "^a{0}$",
    "^(?:a?){2,3}$",
    "^(?:a*)*$",
    "^\\p{Letter}+$",
    "^\\P{Letter}+$",
    "^\\p{Decimal_Number}+$",
    "^\\p{General_Category=Mark}+$",
    "^\\p{ASCII}+$",
    "^\\p{Assigned}+$",
    "^\\u{1F980}$",
    "^\\uD83E\\uDD80$",
    "^\\uD800$",
    "^\\cA$",
    "^\\0$"
  ];
  const inputs = [
    "",
    "a",
    "b",
    "aa",
    "ab",
    "abc",
    "aab",
    "xxaayy",
    "a31b",
    "π漢",
    "123",
    "１２",
    "🦀",
    "🦀🦀",
    "\ud800",
    "\udfff",
    "\n",
    "a\n",
    "\r\n",
    "\u2028",
    "\u0301",
    "\ufeff",
    "\u0085",
    "_",
    "-",
    "\u0001",
    "\u0000"
  ];
  for (const left of ["a", "b", "1", "π", "🦀", "\n"]) {
    for (const right of ["a", "b", "1", "π", "🦀", "\n"]) inputs.push(left + right);
  }
  for (const pattern of patterns) {
    const native = compileJsonSchema({ pattern }),
      reference = referenceCompile({ pattern });
    for (const input of inputs)
      assert.deepEqual(
        native.validate(input),
        reference.validate(input),
        JSON.stringify({ pattern, input })
      );
  }
  for (const schema of [
    {
      patternProperties: { "a*": { type: "integer" }, "aaa*": { maximum: 20 } },
      additionalProperties: false
    },
    {
      properties: { a: { minimum: 3 } },
      patternProperties: { "^a": { maximum: 2 } },
      unevaluatedProperties: false
    },
    { patternProperties: { "^\\p{Letter}+$": { type: "number" } }, additionalProperties: false }
  ]) {
    const native = compileJsonSchema(schema),
      reference = referenceCompile(schema);
    for (const input of [
      {},
      { a: 1 },
      { a: 21 },
      { aaaa: 31 },
      { abc: "bad" },
      { π: 1 },
      { a: 1, other: 2 }
    ]) {
      assert.deepEqual(
        native.validate(input),
        reference.validate(input),
        JSON.stringify({ schema, input })
      );
    }
  }
});
