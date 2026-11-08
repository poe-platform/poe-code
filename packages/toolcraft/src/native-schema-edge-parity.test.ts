import { expect, it } from "vitest";
import { compileJsonSchema, toJsonSchema, validate } from "toolcraft-schema";
import { convertJsonSchema, type JsonSchema } from "./json-schema-converter.js";

it.each([
  { name: "local anchor reference", schema: { type: "object", properties: { value: { $ref: "#value" } }, $defs: { value: { $anchor: "value", type: "string", minLength: 2 } } }, valid: [{ value: "yes" }], invalid: [{ value: 1 }, { value: "x" }] },
  { name: "identified local resource reference", schema: { type: "object", properties: { value: { $ref: "value" } }, $defs: { value: { $id: "value", type: "number", minimum: 2 } } }, valid: [{ value: 2 }], invalid: [{ value: 1 }, { value: "2" }] },
  { name: "Boolean composition", schema: { type: "object", properties: { value: { anyOf: [false, { type: "string" }] } } }, valid: [{ value: "yes" }], invalid: [{ value: 1 }] },
  { name: "draft-seven tuple", schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "array", items: [{ type: "string" }, { type: "number" }], additionalItems: false }, valid: [[], ["yes", 2]], invalid: [[2], ["yes", 2, 3]] },
  { name: "modern tuple", schema: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false }, valid: [[], ["yes", 2]], invalid: [[2], ["yes", 2, 3]] },
  { name: "unconstrained output", schema: {}, valid: [null, 1, "value", {}, []], invalid: [] },
  { name: "multiple output types", schema: { type: ["string", "number"] }, valid: ["value", 1], invalid: [true, {}] },
  { name: "unconstrained array items", schema: { type: "array" }, valid: [[], [null, "value", 1, {}]], invalid: [1, {}] },
  { name: "Boolean property schema", schema: { type: "object", properties: { value: true }, additionalProperties: false }, valid: [{}, { value: { nested: true } }], invalid: [{ extra: true }] },
  { name: "false property schema", schema: { type: "object", properties: { value: false }, additionalProperties: false }, valid: [{}], invalid: [{ value: null }] },
  { name: "Boolean reference target", schema: { type: "object", properties: { value: { $ref: "#/$defs/allowed" } }, $defs: { allowed: true }, additionalProperties: false }, valid: [{}, { value: "yes" }], invalid: [{ extra: true }] },
  { name: "typed const intersection", schema: { type: "string", const: 1 }, valid: [], invalid: [1, "1"] },
  { name: "typed enum intersection", schema: { type: "string", enum: [1] }, valid: [], invalid: [1, "1"] }
])("retains compiler parity for $name", ({ schema, valid, invalid }) => {
  const source = schema as JsonSchema;
  const native = compileJsonSchema(source);
  for (const value of valid) expect(native.validate(value).ok).toBe(true);
  for (const value of invalid) expect(native.validate(value).ok).toBe(false);
  const converted = convertJsonSchema(source);
  expect(toJsonSchema(converted)).toEqual(source);
  for (const value of valid) expect(validate(converted, value).ok).toBe(true);
  for (const value of invalid) expect(validate(converted, value).ok).toBe(false);
});
