import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "toolcraft-schema";

function descriptor(S) {
  return S.Object(
    {
      name: S.String({ minLength: 1, pattern: "^a", description: "Name" }),
      count: S.Optional(S.Number({ jsonType: "integer", default: 2 })),
      choice: S.Enum(["a", "b"], { nullable: true }),
      tags: S.Array(S.String(), { minItems: 1, maxItems: 4 }),
      settings: S.Record(S.Boolean()),
      payload: S.Json({ const: { enabled: true }, nullable: true }),
      event: S.OneOf({
        discriminator: "kind",
        branches: { a: S.Object({ a: S.String() }), b: S.Object({ b: S.Number() }) }
      }),
      target: S.Union([S.Object({ x: S.String() }), S.Object({ y: S.Number({ default: 1 }) })])
    },
    { additionalProperties: false, description: "Example" }
  );
}

test("native builders and schema adapters are available", () => {
  for (const name of [
    "toJsonSchema",
    "toJsonSchemaDocument",
    "withStandardSchema",
    "withJsonSchema",
    "Json",
    "OneOf",
    "Record",
    "Union"
  ]) {
    assert.equal(typeof native[name], "function", name);
  }
  assert.equal(typeof native.S, "object");
  assert.equal(typeof native.nativeJsonSchema, "symbol");
});

test("all builders preserve descriptor shapes, validation and input/output schema conversion", () => {
  const actual = descriptor(native.S),
    expected = descriptor(reference.S);
  assert.deepEqual(actual, expected);
  for (const io of [undefined, "input", "output"]) {
    assert.deepEqual(native.toJsonSchema(actual, { io }), reference.toJsonSchema(expected, { io }));
  }
  for (const target of ["draft-07", "draft-2020-12"])
    for (const io of ["input", "output"]) {
      assert.deepEqual(
        actual["~standard"].jsonSchema[io]({ target }),
        expected["~standard"].jsonSchema[io]({ target })
      );
    }
  assert.deepEqual(actual["~standard"].validate({}), expected["~standard"].validate({}));
  assert.deepEqual(
    native.toJsonSchemaDocument(actual, { id: "example", title: "Title" }),
    reference.toJsonSchemaDocument(expected, { id: "example", title: "Title" })
  );
});

test("constructor failures and option getter order agree with JavaScript", () => {
  function run(S, kind, input) {
    const log = [];
    const options = new Proxy(input, {
      get(target, key, receiver) {
        log.push(["get", key]);
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        log.push("keys");
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        log.push(["descriptor", key]);
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    try {
      const value =
        kind === "Array"
          ? S.Array(S.String(), options)
          : kind === "Enum"
            ? S.Enum([1, 2], options)
            : S[kind](options);
      return { value, log };
    } catch (error) {
      return { error: { name: error.name, message: error.message }, log };
    }
  }
  for (const [kind, input] of [
    ["String", { minLength: 1, maxLength: 3, default: "ab" }],
    ["String", { minLength: -1 }],
    ["String", { pattern: "[" }],
    ["Number", { minimum: 4, maximum: 2 }],
    ["Number", { jsonType: "integer", default: 1.5 }],
    ["Number", { default: Infinity }],
    ["Boolean", { default: "wrong" }],
    ["Array", { minItems: 1, default: [] }],
    ["Enum", { default: 3 }]
  ])
    assert.deepEqual(run(native.S, kind, input), run(reference.S, kind, input));
});

test("standard adapters retain descriptors, receiver semantics and fresh adapter identity", () => {
  const schema = native.S.String();
  const property = Object.getOwnPropertyDescriptor(schema, "~standard");
  assert.equal(property.enumerable, false);
  assert.equal(property.configurable, true);
  assert.equal(property.set, undefined);
  assert.notEqual(schema["~standard"], schema["~standard"]);
  const adapter = property.get.call({ kind: "number" });
  assert.deepEqual(adapter.validate(2), { value: 2 });
  assert.equal(adapter.validate("x").issues[0].expected, "number");
  assert.throws(() => adapter.jsonSchema.input({ target: "unknown" }), {
    message: "Unsupported JSON Schema target: unknown"
  });
});

test("native document overrides preserve the projection and native symbol identity", () => {
  const source = {
    type: "object",
    required: ["count"],
    properties: { count: { type: "integer" } }
  };
  const schema = native.withJsonSchema(native.S.Object({}), source);
  assert.equal(Object.hasOwn(schema, native.nativeJsonSchema), true);
  assert.equal(native.validate(schema, {}).ok, false);
  assert.equal(native.validate(schema, { count: 1 }).ok, true);
  source.required.push("other");
  const result = native.toJsonSchema(schema);
  assert.deepEqual(result.required, ["count"]);
  result.required.push("extra");
  assert.deepEqual(native.toJsonSchema(schema).required, ["count"]);
});

test("branch schemas preserve nullable/default and discriminator semantics", () => {
  function build(S) {
    return [
      S.OneOf({
        discriminator: "kind",
        branches: {
          a: S.Object(
            { x: S.Optional(S.String({ default: "x" })) },
            { default: { x: "x" }, nullable: true }
          ),
          b: S.Object({}, { nullable: true })
        }
      }),
      {
        ...S.Union([S.Object({ a: S.String({ default: "a" }) }), S.Object({ b: S.String() })]),
        nullable: true
      }
    ];
  }
  const actual = build(native.S),
    expected = build(reference.S);
  for (let index = 0; index < actual.length; index++)
    for (const io of ["input", "output"]) {
      assert.deepEqual(
        native.toJsonSchema(actual[index], { io }),
        reference.toJsonSchema(expected[index], { io })
      );
    }
});

test("builders retain symbols, option overrides, identity and constructor behavior", () => {
  const marker = Symbol("option");
  const callback = () => {};
  for (const api of [native, reference]) {
    const options = { kind: "json", [marker]: callback, default: { enabled: true } };
    const result = api.S.Boolean(options);
    assert.equal(result.kind, "json");
    assert.equal(result[marker], callback);
    assert.equal(result.default, options.default);
    assert.equal(Object.hasOwn(result, "~standard"), true);
    assert.throws(() => new api.S.String(), TypeError);
    assert.deepEqual(new api.Json(), api.Json());
    assert.equal(api.S.Json, api.Json);
    assert.equal(api.S.Record, api.Record);
  }
});

test("conversion preserves getter order, special property names and document option enumeration", () => {
  function run(api) {
    const log = [];
    const watch = (name, object) =>
      new Proxy(object, {
        get(target, key, receiver) {
          log.push([name, "get", typeof key === "symbol" ? key.description : key]);
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          log.push([name, "keys"]);
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          log.push([name, "descriptor", key]);
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
      });
    const child = watch("child", {
      kind: "string",
      description: "child",
      default: "x",
      nullable: true,
      minLength: 1
    });
    const schema = watch("schema", {
      kind: "object",
      shape: watch("shape", {
        ["__proto__"]: child,
        constructor: { kind: "optional", inner: child }
      }),
      additionalProperties: true,
      description: "example"
    });
    const options = watch("options", {
      id: "example",
      schema: "urn:schema",
      title: "Title",
      description: "Document",
      extra: "discard"
    });
    return { result: api.toJsonSchemaDocument(schema, options), log };
  }
  assert.deepEqual(run(native), run(reference));
});

test("enum and union constructors preserve caller iteration, callbacks and sparse arrays", () => {
  function run(api) {
    const log = [];
    const values = [1, 2];
    values.some = function (predicate) {
      log.push(["some", this === values, predicate(1.5), predicate(Infinity), predicate(null)]);
      return false;
    };
    const enumeration = api.S.Enum(values, { jsonType: "integer" });
    const branches = [];
    branches[1] = api.S.Object({ ["a+b"]: api.S.String() });
    branches[3] = api.S.Object({ a: api.S.String(), b: api.S.String() });
    branches.forEach = function (callback) {
      log.push(["forEach", this === branches, callback.length]);
      Array.prototype.forEach.call(this, callback);
    };
    const union = api.S.Union(branches);
    assert.equal(enumeration.values, values);
    assert.equal(union.branches, branches);
    return log;
  }
  assert.deepEqual(run(native), run(reference));
});

test("union conversion retains custom map receivers, results and synchronous reentrancy", () => {
  function run(api, io) {
    const log = [];
    const schema = api.S.Union([api.S.Object({ a: api.S.String() })]);
    const custom = {
      [Symbol.iterator]: function* () {
        log.push("iterator");
        yield { custom: true };
      }
    };
    schema.branches.map = function (callback) {
      log.push(["map", this === schema.branches, callback.length]);
      log.push(callback(this[0]));
      log.push(api.toJsonSchema(api.S.String()));
      return custom;
    };
    const output = api.toJsonSchema(schema, { io });
    if (io === "input") assert.equal(output.oneOf, custom);
    return { log, output: io === "input" ? Object.keys(output) : output };
  }
  for (const io of ["input", "output"]) assert.deepEqual(run(native, io), run(reference, io));
});

test("constructor, conversion and adapter host exceptions preserve thrown-value identity", () => {
  for (const api of [native, reference])
    for (const thrown of [undefined, null, 7, Symbol("thrown"), { reason: "stop" }]) {
      const get = () => {
        throw thrown;
      };
      const fails = (operation) => assert.throws(operation, (error) => Object.is(error, thrown));
      fails(() =>
        api.S.String({
          get minLength() {
            return get();
          }
        })
      );
      fails(() =>
        api.toJsonSchema({
          kind: "object",
          get shape() {
            return get();
          }
        })
      );
      const schema = api.S.String();
      fails(() =>
        schema["~standard"].jsonSchema.output({
          get target() {
            return get();
          }
        })
      );
      fails(() =>
        api.toJsonSchemaDocument(schema, {
          get title() {
            return get();
          }
        })
      );
      const branches = [api.S.Object({})];
      branches.map = get;
      fails(() => api.toJsonSchema(api.S.Union(branches)));
    }
});

test("conversion is iterative for deep descriptors and bounds cyclic/reentrant graphs", () => {
  let schema = { kind: "string" };
  for (let depth = 0; depth < 2_000; depth++) schema = { kind: "array", item: schema };
  let result = native.toJsonSchema(schema);
  for (let depth = 0; depth < 2_000; depth++) {
    assert.equal(result.type, "array");
    result = result.items;
  }
  assert.equal(result.type, "string");
  const optional = { kind: "optional" };
  optional.inner = optional;
  const array = { kind: "array" };
  array.item = array;
  const union = { kind: "union", branches: [] };
  union.branches.push({ kind: "object", shape: { nested: union } });
  for (const descriptor of [optional, array, union]) {
    assert.throws(() => native.toJsonSchema(descriptor), {
      name: "RangeError",
      message: "Maximum call stack size exceeded"
    });
  }
  assert.deepEqual(native.toJsonSchema(native.S.String()), { type: "string" });
});
