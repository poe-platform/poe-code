import { expect, it, vi } from "vitest";
import { compileJsonSchema } from "./index.js";

it("asserts explicitly registered formats through propertyNames and references", () => {
  const schema = { type: "object", propertyNames: { $ref: "#/$defs/key" }, $defs: { key: { type: "string", format: "key" } } };
  const compiled = compileJsonSchema(schema, { formats: { key: (value: string) => value !== "invalid" } });
  expect(compiled.validate({ valid: true }).ok).toBe(true);
  expect(compiled.validate({ invalid: true }).ok).toBe(false);
});
it("keeps unregistered formats as annotations", () => {
  expect(compileJsonSchema({ type: "string", format: "unknown" }).validate("any").ok).toBe(true);
});
it("does not apply string format validators to other instance types", () => {
  const check = vi.fn(() => false);
  const compiled = compileJsonSchema({ format: "custom" }, { formats: { custom: check } });
  expect(compiled.validate(1).ok).toBe(true);
  expect(check).not.toHaveBeenCalled();
});
it("snapshots format registrations without inherited registry lookups", () => {
  const formats = { custom: () => false };
  const compiled = compileJsonSchema({ format: "custom" }, { formats });
  formats.custom = () => true;
  expect(compiled.validate("value").ok).toBe(false);
  expect(compileJsonSchema({ format: "toString" }, { formats: {} }).validate("value").ok).toBe(true);
});
