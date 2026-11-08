import { expect, it } from "vitest";
import { compileJsonSchema, toJsonSchema, validate } from "toolcraft-schema";
import { convertJsonSchema, type JsonSchema } from "./json-schema-converter.js";

const cases: Array<{ name: string; source: JsonSchema; valid: unknown; invalid: unknown }> = [
  { name: "numeric multiples", source: { type: "object", properties: { value: { type: "number", multipleOf: 3 } }, required: ["value"] }, valid: { value: 6 }, invalid: { value: 4 } },
  { name: "exclusive numeric bounds", source: { type: "object", properties: { value: { type: "number", exclusiveMinimum: 2, exclusiveMaximum: 5 } }, required: ["value"] }, valid: { value: 3 }, invalid: { value: 2 } },
  { name: "unique array elements", source: { type: "object", properties: { value: { type: "array", items: { type: "integer" }, uniqueItems: true } }, required: ["value"] }, valid: { value: [1, 2] }, invalid: { value: [1, 1] } },
  { name: "array contains", source: { type: "object", properties: { value: { type: "array", items: { type: "integer" }, contains: { const: 7 } } }, required: ["value"] }, valid: { value: [1, 7] }, invalid: { value: [1, 2] } },
  { name: "dependent required properties", source: { type: "object", properties: { card: { type: "string" }, billing: { type: "string" } }, dependentRequired: { card: ["billing"] } }, valid: { card: "123", billing: "street" }, invalid: { card: "123" } },
  { name: "object property counts", source: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } }, minProperties: 1, maxProperties: 1 }, valid: { a: 1 }, invalid: { a: 1, b: 2 } },
  { name: "conditional required properties", source: { type: "object", properties: { kind: { type: "string" }, value: { type: "integer" } }, if: { properties: { kind: { const: "count" } }, required: ["kind"] }, then: { required: ["value"] } }, valid: { kind: "count", value: 1 }, invalid: { kind: "count" } },
  { name: "property name constraints", source: { type: "object", properties: { good: { type: "integer" }, bad: { type: "integer" } }, propertyNames: { enum: ["good"] } }, valid: { good: 1 }, invalid: { bad: 1 } },
  { name: "default additional properties", source: { type: "object", properties: { value: { type: "integer" } }, required: ["value"] }, valid: { value: 1, extra: true }, invalid: { value: "wrong" } }
];

it.each(cases)("preserves $name in validation and advertisement", ({ source, valid, invalid }) => {
  if (source.type === "object" && !source.required?.includes("extra") && !(typeof valid === "object" && valid !== null && "extra" in valid)) {
    source = { ...source, additionalProperties: false };
  }
  const original = compileJsonSchema(source);
  expect(original.validate(valid).ok).toBe(true);
  expect(original.validate(invalid).ok).toBe(false);
  const converted = convertJsonSchema(source);
  expect(validate(converted, valid).ok).toBe(true);
  expect(validate(converted, invalid).ok).toBe(false);
  expect(toJsonSchema(converted)).toEqual(source);
});

it("retains string enum siblings in closed object schemas", () => {
  const source: JsonSchema = { type: "object", additionalProperties: false,
    properties: { value: { type: "string", enum: ["yes", "x"], minLength: 3 } }, required: ["value"] };
  expect(compileJsonSchema(source).validate({ value: "x" }).ok).toBe(false);
  const converted = convertJsonSchema(source);
  expect(validate(converted, { value: "yes" }).ok).toBe(true);
  expect(validate(converted, { value: "x" }).ok).toBe(false);
  expect(toJsonSchema(converted)).toEqual(source);
});
