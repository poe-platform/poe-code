import { expect, it } from "vitest";
import { toJsonSchema, validate } from "toolcraft-schema-rust";
import { convertJsonSchema as native } from "../dist/json-schema-converter.js";
import { convertJsonSchema as reference } from "../../toolcraft/src/json-schema-converter.js";

const leafSchemas = [
  true, false, {}, { type: "string", default: "demo", description: "label", pattern: "^a", minLength: 2, maxLength: 4 },
  { type: "integer", default: 3.5, minimum: -1, maximum: 4 }, { type: "number", default: NaN },
  { type: "boolean", default: false }, { type: "null", default: { any: true } },
  { type: ["string", "null"], default: null }, { type: ["number", "boolean"] },
  { enum: [] }, { enum: [null] }, { enum: ["a", "b", null], default: "a" },
  { enum: [{ state: "on" }, [1], null], description: "choices" },
  { const: null }, { const: 3 }, { const: { x: [1] }, description: "fixed" },
  { type: "integer", enum: [1, 2], default: 2 },
  { type: "array" }, { type: "array", items: [{ type: "string" }] },
  { type: "array", items: { type: "boolean" }, default: [false] },
  { type: "object", additionalProperties: { type: "string" } },
  { type: "invalid" }, { type: ["null"] }, { anyOf: [] },
  { $ref: "#/$defs/flag", $defs: { flag: { type: "boolean" } }, description: "reference" },
  { $ref: "#/$defs/missing" }, { $ref: "#/$defs/yes", $defs: { yes: true } }
];
const samples = [undefined, null, false, true, 0, 2, 3.5, "", "abc", [], [false], {}, { x: [1] }, { value: "abc" }];

function projection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projection);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, projection(child)]));
  return value;
}

function convert(convertSchema: typeof reference, input: unknown) {
  try {
    const schema = convertSchema(input as never);
    // Compiled validators are per-schema callbacks. Compare their behavior and
    // schema document separately from the projection's public string fields.
    return { schema: projection(schema), wire: toJsonSchema(schema), validation: samples.map(sample => validate(schema, sample)) };
  } catch (error) {
    return { error: [(error as Error).name, (error as Error).message] };
  }
}

it("matches schema structure, wire constraints and validation for nested projections", () => {
  for (const leaf of leafSchemas) {
    for (const input of [leaf, { type: "object", properties: { value: leaf }, additionalProperties: false },
      { type: "object", properties: { value: leaf }, required: ["value"] },
      { type: "array", items: leaf }]) {
      expect(convert(native, input), JSON.stringify(input)).toEqual(convert(reference, input));
    }
  }
});

it("retains recursive references, conditional fields, defaults and literal branch projections", () => {
  const branch = (tag: string, key: string) => ({ type: "object", properties: {
    kind: { const: tag }, [key]: { type: "string", default: tag }, shared: { enum: [tag] }
  }, required: ["kind", key] });
  for (const input of [
    { type: "object", properties: { next: { $ref: "#" } } },
    { $ref: "#/$defs/root", $defs: { root: { type: "object", properties: { next: { $ref: "#/$defs/root" } } } } },
    { type: "object", allOf: [{ properties: { unconditional: { type: "string", default: "base" } }, required: ["unconditional"] }], oneOf: [branch("a", "first"), branch("b", "second")] },
    { type: "object", anyOf: [branch("a", "first"), branch("b", "second")] },
    { oneOf: [branch("a", "first"), branch("b", "second")] },
    { anyOf: [{ type: "object", properties: { x: { type: "string" } }, required: ["x"] }, { type: "object", properties: { y: { type: "number" } }, required: ["y"] }] },
    { anyOf: [{ type: "object", properties: { x: { type: "string" } } }, { type: "object", properties: { y: { type: "number" } } }] },
    { $ref: "#/$defs/base", $defs: { base: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } }, properties: { y: { type: "number" } }, required: ["y"] },
    JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"],"additionalProperties":false}')
  ]) expect(convert(native, input), JSON.stringify(input)).toEqual(convert(reference, input));
});

it("preserves source getter order and arbitrary thrown values", () => {
  const run = (convertSchema: typeof reference, source: unknown) => {
    const reads: string[] = [];
    const wrap = (value: unknown, path: string): unknown => {
      if (value === null || typeof value !== "object") return value;
      const target = Array.isArray(value) ? value.map((item, index) => wrap(item, `${path}.${index}`))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wrap(item, `${path}.${key}`)]));
      return new Proxy(target, { get(object, key, receiver) { reads.push(`${path}.${String(key)}`); return Reflect.get(object, key, receiver); } });
    };
    const result = convert(convertSchema, wrap(source, "schema"));
    return { result, reads };
  };
  for (const source of [
    ...leafSchemas,
    { type: "string", default: "value", pattern: "x" },
    { type: "object", properties: { value: { type: "number", default: 2 } }, required: ["value"], additionalProperties: false },
    { type: "object", properties: { value: { type: "boolean" } } },
    { $ref: "#/$defs/value", $defs: { value: { type: "string" } } }
  ]) expect(run(native, source), JSON.stringify(source)).toEqual(run(reference, source));
  for (const error of [undefined, null, Symbol("failure"), { failure: true }]) {
    for (const lib of [native, reference]) {
      let caught = false;
      try { lib({ get $ref() { throw error; } }); }
      catch (actual) { caught = true; expect(actual).toBe(error); }
      expect(caught).toBe(true);
    }
  }
});
