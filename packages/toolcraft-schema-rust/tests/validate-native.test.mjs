import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { S, validate as reference } from "toolcraft-schema";
import { nativeJsonSchema } from "../dist/host-values.js";

test("DSL validation is available alongside the JSON compiler", () => {
  assert.equal(typeof native.validate, "function");
});

test("all schema kinds match reference outputs and diagnostics in every default mode", () => {
  const schemas = [
    S.String({ minLength: 2, maxLength: 4, pattern: "^(a|🦀)+$" }),
    S.Number({ jsonType: "integer", minimum: 1, maximum: 4 }),
    S.Boolean(),
    S.Enum(["a", 1, false, null]),
    S.Json(),
    S.Array(S.Optional(S.Number({ default: 2 })), { minItems: 1, maxItems: 3 }),
    S.Object({ a: S.String(), b: S.Optional(S.Number({ default: 2 })) }),
    S.Object({ a: S.String({ default: "a" }) }, { additionalProperties: true }),
    S.Record(S.Optional(S.Boolean())),
    S.OneOf({
      discriminator: "kind",
      branches: { a: S.Object({ a: S.String() }), b: S.Object({ b: S.Number() }) }
    }),
    S.Union([S.Object({ a: S.String() }), S.Object({ b: S.Number({ default: 1 }) })]),
    S.Optional(S.Optional(S.String({ default: "a" }))),
    S.Json({ const: { a: 1 }, enum: [{ a: 1 }, [2]] })
  ];
  const values = [
    undefined,
    null,
    true,
    1,
    1.5,
    Infinity,
    NaN,
    "",
    "a",
    "🦀🦀",
    "\ud800",
    [],
    new Array(2),
    [1, undefined, 5, 8],
    {},
    { a: "a" },
    { b: 2 },
    { kind: "a", a: "a" },
    { kind: "bad" },
    { a: "a", b: undefined },
    { a: 1 },
    { extra: [] },
    new Date(),
    () => 1,
    2n
  ];
  for (const schema of schemas)
    for (const value of values) {
      for (const defaults of [undefined, "none", "optional", "all"]) {
        assert.deepEqual(
          native.validate(schema, value, { defaults }),
          reference(schema, value, { defaults })
        );
      }
    }
});

test("defaults retain resources, aliases, thrown values and present undefined semantics", () => {
  const callback = () => 1;
  const resource = new WeakMap();
  const shared = { data: [] };
  const value = { callback, resource, first: shared, second: shared };
  const schema = S.Object({
    settings: S.Optional(S.Object({}, { additionalProperties: true, default: value }))
  });
  const result = native.validate(schema, {});
  assert.equal(result.ok, true);
  assert.equal(result.value.settings.first, result.value.settings.second);
  assert.notEqual(result.value.settings.first, shared);
  assert.equal(result.value.settings.callback, callback);
  assert.equal(result.value.settings.resource, resource);
  assert.deepEqual(
    native.validate(
      S.Object({ a: S.String({ default: "a" }) }),
      { a: undefined },
      { defaults: "all" }
    ),
    reference(S.Object({ a: S.String({ default: "a" }) }), { a: undefined }, { defaults: "all" })
  );
  for (const thrown of [undefined, null, Symbol(), {}, new Error("failed")]) {
    const descriptor = {
      kind: "object",
      shape: {},
      default: Object.defineProperty({}, "x", {
        enumerable: true,
        get() {
          throw thrown;
        }
      })
    };
    let caught = false;
    try {
      native.validate({ kind: "optional", inner: descriptor }, undefined);
    } catch (error) {
      caught = true;
      assert.equal(error, thrown);
    }
    assert.equal(caught, true);
  }
});

test("schema and value getters retain evaluation order", () => {
  function run(validate) {
    const log = [];
    const string = new Proxy(
      { kind: "string", minLength: 2, maxLength: 1, pattern: "[" },
      {
        get(target, key, receiver) {
          if (typeof key !== "symbol") log.push(["string", key]);
          return Reflect.get(target, key, receiver);
        }
      }
    );
    const shape = {
      get a() {
        log.push("shape.a");
        return string;
      },
      b: S.Optional(S.Number({ default: 1 }))
    };
    const schema = new Proxy(
      { kind: "object", shape },
      {
        get(target, key, receiver) {
          if (typeof key !== "symbol") log.push(["object", key]);
          return Reflect.get(target, key, receiver);
        }
      }
    );
    const value = {
      get a() {
        log.push("value.a");
        return "x";
      },
      get extra() {
        log.push("value.extra");
        return 1;
      }
    };
    return { result: validate(schema, value), log };
  }
  assert.deepEqual(run(native.validate), run(reference));
});

test("prototype-safe output keys, dense arrays and inherited discriminators match", () => {
  const shape = Object.create(null);
  shape.__proto__ = S.String();
  shape["\ud800"] = S.Number();
  const value = Object.create(null);
  value.__proto__ = "yes";
  value["\ud800"] = 1;
  const result = native.validate(S.Object(shape), value);
  assert.deepEqual(result, reference(S.Object(shape), value));
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
  assert.equal(Object.hasOwn(result.value, "__proto__"), true);
  const sparse = new Array(2);
  const array = native.validate(S.Array(S.Optional(S.String())), sparse);
  assert.equal(Object.hasOwn(array.value, 0), true);
  assert.deepEqual(array.value, [undefined, undefined]);
  const oneOf = S.OneOf({ discriminator: "toString", branches: { x: S.Object({}) } });
  assert.deepEqual(native.validate(oneOf, {}), reference(oneOf, {}));
});

test("validation can reenter from a getter and handles deeply nested schemas", () => {
  const input = {
    get a() {
      return native.validate(S.Number(), 2).value;
    }
  };
  assert.deepEqual(native.validate(S.Object({ a: S.Number() }), input), {
    ok: true,
    value: { a: 2 }
  });
  let schema = { kind: "number" },
    value = 1;
  for (let index = 0; index < 3000; index++) {
    schema = { kind: "object", shape: { a: schema } };
    value = { a: value };
  }
  const result = native.validate(schema, value);
  assert.equal(result.ok, true);
  let output = result.value;
  for (let index = 0; index < 3000; index++) output = output.a;
  assert.equal(output, 1);
});

test("custom array methods retain receivers, callback results and enum formatting", () => {
  function run(validate) {
    const log = [];
    const token = {};
    const value = [1];
    value.every = function () {
      log.push(this === value);
      return token;
    };
    const choices = [[1]];
    choices.some = function (callback) {
      log.push(this === choices);
      return callback(this[0]) === token;
    };
    const accepted = validate({ kind: "json", enum: choices }, value);
    const members = ["x"];
    members.join = function (separator) {
      log.push([this === members, separator]);
      return 7;
    };
    const missing = validate(
      { kind: "object", shape: { a: { kind: "enum", values: members } } },
      {}
    );
    return { accepted: { ok: accepted.ok, originalValue: accepted.value === value }, missing, log };
  }
  assert.deepEqual(run(native.validate), run(reference));
});

test("native metadata callbacks retain receiver, issue properties and prefixed paths", () => {
  const extra = Symbol("extra");
  const problem = {
    path: ["\ud800"],
    expected: "custom",
    received: "object",
    message: "custom",
    [extra]: 1
  };
  const validator = {
    validate(value) {
      assert.equal(this, validator);
      assert.deepEqual(value, {});
      return { ok: false, issues: [problem] };
    }
  };
  const child = { kind: "json", [nativeJsonSchema]: { validator } };
  const result = native.validate({ kind: "object", shape: { child } }, { child: {} });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues[0], { ...problem, path: ["child", "\ud800"] });
  assert.notEqual(result.issues[0], problem);
  for (const thrown of [undefined, null, Symbol(), {}, new Error("callback")]) {
    validator.validate = () => {
      throw thrown;
    };
    let caught = false;
    try {
      native.validate(child, {});
    } catch (error) {
      caught = true;
      assert.equal(error, thrown);
    }
    assert.equal(caught, true);
  }
});

test("cyclic descriptors and values terminate with the reference RangeError", () => {
  for (const validate of [native.validate, reference]) {
    const schema = { kind: "object", shape: {} };
    schema.shape.self = schema;
    const value = {};
    value.self = value;
    const optional = { kind: "optional" };
    optional.inner = optional;
    for (const [descriptor, input] of [
      [schema, value],
      [optional, undefined],
      [optional, 1]
    ]) {
      assert.throws(() => validate(descriptor, input), {
        name: "RangeError",
        message: "Maximum call stack size exceeded"
      });
    }
    const a = {},
      b = {};
    assert.throws(
      () =>
        validate(
          {
            kind: "json",
            get const() {
              a.self = a;
              b.self = b;
              return b;
            }
          },
          a
        ),
      { name: "RangeError", message: "Maximum call stack size exceeded" }
    );
  }
});

test("the recursion guard permits wide inputs and descriptors whose getters terminate recursion", () => {
  const value = new Array(20000).fill(true);
  const schema = { kind: "array", item: { kind: "boolean" } };
  assert.deepEqual(native.validate(schema, value), reference(schema, value));
  function run(validate) {
    let reads = 0;
    const schema = {
      get kind() {
        return ++reads < 10 ? "optional" : "number";
      },
      get inner() {
        return schema;
      }
    };
    return { result: validate(schema, 1), reads };
  }
  assert.deepEqual(run(native.validate), run(reference));
});

test("union iteration closes caller iterators after branch exceptions", () => {
  function run(validate) {
    const log = [];
    const thrown = {};
    let reads = 0;
    const branch = {
      kind: "object",
      get shape() {
        log.push(++reads);
        if (reads > 1) throw thrown;
        return {};
      }
    };
    const branches = [branch];
    branches[Symbol.iterator] = function* () {
      try {
        yield branch;
      } finally {
        log.push("closed");
      }
    };
    let caught = false;
    try {
      validate({ kind: "union", branches }, {}, { defaults: "all" });
    } catch (error) {
      caught = error === thrown;
    }
    return { caught, log };
  }
  assert.deepEqual(run(native.validate), run(reference));
});

test("union iteration captures next once and closes only after body failures", () => {
  function run(validate, failNext) {
    const log = [];
    const branch = { kind: "object", shape: {} };
    const branches = [branch];
    branches[Symbol.iterator] = () => {
      let step = 0;
      return {
        get next() {
          log.push("next method");
          return function () {
            log.push("advance");
            if (failNext) throw "next failed";
            return step++ === 0 ? { value: branch, done: false } : { done: true };
          };
        },
        return() {
          log.push("closed");
          return { done: true };
        }
      };
    };
    let result;
    try {
      result = validate({ kind: "union", branches }, {}, { defaults: "all" });
    } catch (error) {
      result = error;
    }
    return { result, log };
  }
  for (const failNext of [false, true])
    assert.deepEqual(run(native.validate, failNext), run(reference, failNext));
});
