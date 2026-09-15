import { expect, it } from "vitest";
import { S, toJsonSchema, compileJsonSchema } from "./index.js";

it.each([
  { name: "string", schema: S.String({ nullable: true, minLength: 2 }), valid: "ok", invalid: "x" },
  { name: "number", schema: S.Number({ nullable: true, minimum: 1 }), valid: 2, invalid: 0 },
  { name: "integer", schema: S.Number({ nullable: true, jsonType: "integer" }), valid: 2, invalid: 1.5 },
  { name: "boolean", schema: S.Boolean({ nullable: true }), valid: false, invalid: "false" },
  { name: "array", schema: S.Array(S.String(), { nullable: true, minItems: 1 }), valid: ["ok"], invalid: [] },
  { name: "object", schema: S.Object({ name: S.String() }, { nullable: true }), valid: { name: "ok" }, invalid: {} },
  { name: "enum", schema: S.Enum(["ready", "done"], { nullable: true }), valid: "ready", invalid: "other" }
])("advertises standard nullable $name constraints", ({ schema, valid, invalid }) => {
  const descriptor = toJsonSchema(schema);
  const { nullable: ignoredExtension, ...standardSchema } = descriptor;
  const validator = compileJsonSchema(standardSchema);
  expect(validator.validate(null).ok).toBe(true);
  expect(validator.validate(valid).ok).toBe(true);
  expect(validator.validate(invalid).ok).toBe(false);
  expect(descriptor).not.toHaveProperty("nullable");
});
