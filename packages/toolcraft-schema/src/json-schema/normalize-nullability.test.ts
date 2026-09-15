import { expect, it } from "vitest";
import { compileJsonSchema } from "./index.js";
import { normalizeLegacyNullability } from "./normalize-nullability.js";

it("preserves draft-seven legacy resource identifiers when reference targets move", () => {
  const source = { $schema: "http://json-schema.org/draft-07/schema#", id: "https://example.test/legacy", type: "object", nullable: true,
    properties: { definition: { type: "integer" }, use: { $ref: "https://example.test/legacy#/properties/definition" } } };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ use: 1 }).ok).toBe(true);
  expect(validator.validate({ use: "wrong" }).ok).toBe(false);
});

it("keeps legacy identifiers on the complete nullable resource", () => {
  const source = { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: {
    definition: { id: "https://example.test/nullable", type: "integer", nullable: true },
    use: { $ref: "https://example.test/nullable" }
  } };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ use: null }).ok).toBe(true);
  expect(validator.validate({ use: "wrong" }).ok).toBe(false);
});

it("treats id as an annotation in modern schemas", () => {
  const source = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: {
    definition: { id: "http://[", type: "integer", nullable: true },
    use: { $ref: "#/properties/definition" }
  } };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ use: null }).ok).toBe(true);
  expect(validator.validate({ use: "wrong" }).ok).toBe(false);
});

it("preserves recursive anchor targets under nullable wrapping", () => {
  const source = { $schema: "https://json-schema.org/draft/2019-09/schema", $id: "https://example.test/recursive", $recursiveAnchor: true,
    type: "object", nullable: true, properties: { value: { type: "integer" }, next: { $recursiveRef: "#" } }, required: ["value"] };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ value: 1, next: null }).ok).toBe(true);
  expect(validator.validate({ value: 1, next: { value: "wrong" } }).ok).toBe(false);
});

it("preserves dynamic anchor targets under nullable wrapping", () => {
  const source = { $id: "https://example.test/tree", $dynamicAnchor: "node", type: "object", nullable: true,
    properties: { value: { type: "integer" }, next: { $dynamicRef: "#node" } }, required: ["value"] };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ value: 1, next: null }).ok).toBe(true);
  expect(validator.validate({ value: 1, next: { value: "wrong" } }).ok).toBe(false);
});

it("normalizes nullable entries in draft-seven tuple items", () => {
  const source = { $schema: "http://json-schema.org/draft-07/schema#", type: "array", items: [
    { type: "string", nullable: true }, { type: "number" }
  ] };
  const normalized = normalizeLegacyNullability(source);
  expect(normalized).not.toHaveProperty("items.0.nullable");
  const validator = compileJsonSchema(normalized);
  expect(validator.validate([null, 1]).ok).toBe(true);
  expect(validator.validate([false, 1]).ok).toBe(false);
});

it("remaps absolute in-document reference targets after nullable wrapping", () => {
  const source = { $id: "https://example.test/schema", type: "object", nullable: true, properties: {
    definition: { type: "string" }, use: { $ref: "https://example.test/schema#/properties/definition" }
  } };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ use: "yes" }).ok).toBe(true);
  expect(validator.validate({ use: 1 }).ok).toBe(false);
});

it("keeps references to properties valid after nullable wrapping", () => {
  const source = { type: "object" as const, nullable: true, properties: {
    definition: { type: "string" as const, minLength: 3 }, use: { $ref: "#/properties/definition" }
  }, required: ["use"] };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate(null).ok).toBe(true);
  expect(validator.validate({ use: "yes" }).ok).toBe(true);
  expect(validator.validate({ use: "x" }).ok).toBe(false);
});

it("preserves unchanged reference spelling when no target moves", () => {
  const source = { type: "object" as const, properties: {
    "foo space": { type: "string" as const }, use: { $ref: "#/properties/foo%20space" }
  } };
  expect(normalizeLegacyNullability(source)).toEqual(source);
});

it("resolves moved property references relative to nested resource identifiers", () => {
  const source = { type: "object" as const, properties: { child: {
    $id: "https://example.test/child", type: "object" as const, nullable: true, properties: {
      definition: { type: "string" as const }, use: { $ref: "#/properties/definition" }
    }, required: ["use"]
  } } };
  const validator = compileJsonSchema(normalizeLegacyNullability(source));
  expect(validator.validate({ child: null }).ok).toBe(true);
  expect(validator.validate({ child: { use: "yes" } }).ok).toBe(true);
  expect(validator.validate({ child: { use: 1 } }).ok).toBe(false);
});
