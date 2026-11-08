import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSegment, validateObjectSchema as native } from "../dist/sdk-validation.js";
import { validateObjectSchema as reference } from "../../toolcraft/dist/sdk.js";
import { S, withJsonSchema } from "toolcraft-schema";
import { withJsonSchema as withNativeJsonSchema } from "toolcraft-schema-rust";

function capture(validate, schema, value, label = "") {
  const errors = [];
  try { return { value: validate(schema, value, label, errors), errors }; }
  catch (error) { return { error: [error?.name, error?.message], errors }; }
}

test("SDK numeric validation observes Number predicates changed after module loading",()=>{
  const finite=Number.isFinite,integer=Number.isInteger;
  function run(validate,method,result){
    const trace=[];
    Number[method]=function(value){trace.push([method,this===Number,value]);return result;};
    try{return {...capture(validate,{kind:"object",shape:{value:{kind:"number",jsonType:"integer"}}},{value:1.5}),trace};}
    finally{Number.isFinite=finite;Number.isInteger=integer;}
  }
  for(const method of ["isFinite","isInteger"])for(const result of [true,false,"truthy",0])assert.deepEqual(run(native,method,result),run(reference,method,result));
});

test("SDK validation preserves all canonical kinds, defaults, casing and ordered errors", () => {
  const kinds = [S.String({ minLength: 2, maxLength: 3, pattern: "^a" }),
    S.Number({ jsonType: "integer", minimum: 1, maximum: 3 }), S.Boolean(),
    S.Enum(["ready", "running", 2, null]), S.Json(), S.Array(S.Optional(S.String({ default: "seed" })), { minItems: 1, maxItems: 2 }),
    S.Record(S.Number()), S.Object({ display_name: S.String() }),
    S.OneOf({ discriminator: "delivery_kind", branches: { email: S.Object({ address: S.String() }) } }),
    S.Union([S.Object({ left: S.String() }), S.Object({ right: S.String() })])];
  const values = [undefined, null, false, 0, 1.5, 2, NaN, Infinity, "a", "abcd", "réady", "😀😀", 4n,
    Symbol("value"), () => {}, [], [undefined, "a", 3], Array(2), {}, { displayName: "ok" },
    { deliveryKind: "email", address: "ready" }, { left: "ok" }, { field: undefined }, new Date(0)];
  for (const kind of kinds) for (const optional of [false, true]) for (const value of values) {
    const schema = S.Object({ input_value: optional ? S.Optional(kind) : kind });
    assert.deepEqual(capture(native, schema, { inputValue: value }), capture(reference, schema, { inputValue: value }));
  }
});

test("SDK casing preserves UTF-16 words, acronyms, contextual Unicode and collisions", () => {
  for (const name of ["HTTPServer", "getURL", "a_B.c d-e", "İSTANBUL_name", "ΟΣ_Σ", "ßFoo", "𐐀Foo", "\ud800Name", "then", "__proto__", "constructor", ""]) {
    const schema = S.Object(Object.fromEntries([[name, S.Optional(S.String())]]));
    const expected = capture(reference, schema, { unknown: 1 });
    assert.deepEqual(capture(native, schema, { unknown: 1 }), expected);
  }
  const callback = () => 42;
  const schema = S.Object({ display_name: S.Optional(S.String()) }, { additionalProperties: true });
  for (const input of [{ display_name: "alias" }, { displayName: "ok", display_name: "alias", callback }, { callback }])
    assert.deepEqual(capture(native, schema, input), capture(reference, schema, input));
});

test("SDK validation preserves getter access order and arbitrary exceptions", () => {
  const run = validate => {
    const reads = [];
    const observe = (value, prefix) => new Proxy(value, { get(target, key, receiver) { reads.push(`${prefix}:${String(key)}`); return Reflect.get(target, key, receiver); } });
    const child = observe({ kind: "number", jsonType: "integer", minimum: 1, maximum: 3 }, "child");
    const schema = observe({ kind: "object", shape: { my_number: child }, additionalProperties: true }, "schema");
    return { ...capture(validate, schema, observe({ myNumber: 9, extra: 2 }, "value")), reads };
  };
  assert.deepEqual(run(native), run(reference));
  for (const failure of [undefined, null, false, Symbol("failure"), { failure: true }]) {
    for (const validate of [native, reference]) {
      assert.throws(() => validate(S.Object({ input: S.String() }), { get input() { throw failure; } }, "", []), error => error === failure);
      const errors = [];
      errors.push = function() { assert.equal(this, errors); throw failure; };
      assert.throws(() => validate(S.Object({ input: S.String() }), {}, "", errors), error => error === failure);
    }
  }
});

test("SDK native JSON ingress preserves descriptors, optional omission and key normalization", () => {
  const child = S.Object({ display_name: S.String(), optional_value: S.Optional(S.String()) });
  const projection = S.Object({ nested_value: child, rows: S.Array(child), entries: S.Record(child) });
  const document = { type: "object", properties: {
    nested_value: { type: "object", properties: { display_name: { type: "string" }, optional_value: { type: "string" } }, required: ["display_name"], additionalProperties: false },
    rows: { type: "array" }, entries: { type: "object" }
  }, required: ["nested_value"], additionalProperties: false };
  const schema = withJsonSchema(projection, document);
  const nativeSchema = withNativeJsonSchema(projection, document);
  for (const input of [
    { nestedValue: { displayName: "ok", optionalValue: undefined }, rows: [{ displayName: "row" }], entries: { x: { displayName: "entry" } } },
    { nestedValue: { displayName: 7 } }, { nestedValue: { displayName: "ok", get optionalValue() { return undefined; } } },
    { nestedValue: { displayName: "ok" }, nested_value: {} }, { nestedValue: { displayName: "ok" }, rows: Array(1) }
  ]) assert.deepEqual(capture(native, nativeSchema, input), capture(reference, schema, input));
});

test("SDK diagnostics retain push lookup order alongside schema constraint getters", () => {
  for (const child of [{ kind: "string", minLength: 4, maxLength: 1, pattern: "^z" },
    { kind: "number", minimum: 2, maximum: 3 }, { kind: "enum", values: ["ready"] },
    { kind: "array", item: S.String(), minItems: 4, maxItems: 1 }]) {
    const run = validate => {
      const reads = [];
      const schema = new Proxy(child, { get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); } });
      const errors = new Proxy([], { get(target, key, receiver) { reads.push(`errors.${String(key)}`); return Reflect.get(target, key, receiver); } });
      const input = child.kind === "array" ? ["a", "b"] : child.kind === "number" ? 1 : "ab";
      const result = validate(S.Object({ field: schema }), { field: input }, "", errors);
      return { result, errors: [...errors], reads };
    };
    assert.deepEqual(run(native), run(reference));
  }
});

test("SDK enum methods retain receiver, truthiness and reentrant validation", () => {
  for (const validate of [native, reference]) {
    const values = ["ready"];
    values.includes = function(value) {
      assert.equal(this, values);
      assert.equal(value, "custom");
      assert.deepEqual(validate(S.Object({ nested: S.Number() }), { nested: 1 }, "", []), { nested: 1 });
      return "accepted";
    };
    const errors = [];
    assert.deepEqual(validate({ kind: "object", shape: { field: { kind: "enum", values } } }, { field: "custom" }, "", errors), { field: "custom" });
    assert.deepEqual(errors, []);
  }
});

test("SDK native validation returns catchable errors for cyclic schema wrappers", () => {
  const cyclic = { kind: "optional" };
  cyclic.inner = cyclic;
  assert.throws(() => native({ kind: "object", shape: { field: cyclic } }, {}, "", []), RangeError);
  assert.deepEqual(native(S.Object({ field: S.String() }), { field: "still usable" }, "", []), { field: "still usable" });
});

test("SDK casing keeps empty words returned by the caller's string runtime", () => {
  const original = String.prototype.toLowerCase;
  try {
    String.prototype.toLowerCase = () => "";
    assert.equal(formatSegment("first_second"), "");
  } finally { String.prototype.toLowerCase = original; }
});
