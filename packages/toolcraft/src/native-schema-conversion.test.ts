import { expect, it } from "vitest";
import { validate, toJsonSchema, compileJsonSchema } from "toolcraft-schema";
import { convertJsonSchema } from "./json-schema-converter.js";

it("preserves legacy nullable reference semantics using standard JSON Schema", () => {
  const source = { $defs: { text: { type: "string" as const } }, $ref: "#/$defs/text", nullable: true };
  const converted = convertJsonSchema(source);
  expect(validate(converted, null).ok).toBe(true);
  expect(compileJsonSchema(toJsonSchema(converted)).validate(null).ok).toBe(true);
  expect(toJsonSchema(converted)).not.toHaveProperty("nullable");
});

it("preserves nullable nested composition semantics", () => {
  const source = { type: "object" as const, properties: { value: { anyOf: [{ type: "string" as const }, { type: "number" as const }], nullable: true } }, required: ["value"] };
  const converted = convertJsonSchema(source);
  expect(validate(converted, { value: null }).ok).toBe(true);
  expect(compileJsonSchema(toJsonSchema(converted)).validate({ value: null }).ok).toBe(true);
});

it("retains nested scalar union constraints without an object-only projection", () => {
  const source = { type: "object" as const, properties: { value: { anyOf: [
    { type: "string" as const, minLength: 3 }, { type: "number" as const, minimum: 5 }
  ] } }, required: ["value"] };
  const converted = convertJsonSchema(source);
  for (const value of [{ value: "yes" }, { value: 5 }]) expect(validate(converted, value).ok).toBe(true);
  for (const value of [{ value: "a" }, { value: 1 }, { value: false }]) expect(validate(converted, value).ok).toBe(false);
  expect(toJsonSchema(converted)).toEqual(source);
});

it("preserves nested object intersections", () => {
  const source = { type: "object" as const, properties: { value: { type: "object" as const, allOf: [
    { properties: { a: { type: "string" as const } }, required: ["a"] },
    { properties: { b: { type: "number" as const } }, required: ["b"] }
  ] } }, required: ["value"] };
  const converted = convertJsonSchema(source);
  expect(validate(converted, { value: { a: "yes" } }).ok).toBe(false);
  expect(validate(converted, { value: { a: "yes", b: 1 } }).ok).toBe(true);
  expect(toJsonSchema(converted)).toEqual(source);
});

it("retains valid union branches with identical required field sets", () => {
  const source = { anyOf: [
    { type: "object" as const, properties: { value: { type: "string" as const } }, required: ["value"] },
    { type: "object" as const, properties: { value: { type: "number" as const } }, required: ["value"] }
  ] };
  const converted = convertJsonSchema(source);
  expect(validate(converted, { value: "yes" }).ok).toBe(true);
  expect(validate(converted, { value: 1 }).ok).toBe(true);
  expect(validate(converted, { value: false }).ok).toBe(false);
});

it("retains a self-referencing schema without overflowing reference resolution", () => {
  const source = { $ref: "#" };
  const converted = convertJsonSchema(source);
  expect(toJsonSchema(converted)).toEqual(source);
  expect(validate(converted, "value").ok).toBe(true);
});

it.each(["anyOf", "oneOf"] as const)("preserves overlapping object %s branches", (keyword) => {
  const source = { type: "object" as const, [keyword]: [
    { type: "object" as const, properties: { a: { type: "string" as const } }, required: ["a"] },
    { type: "object" as const, properties: { b: { type: "number" as const } }, required: ["b"] }
  ] };
  const converted = convertJsonSchema(source);
  expect(converted.kind).toBe("object");
  for (const value of [{ a: "yes" }, { b: 1 }, { a: "yes", b: 1 }, {}]) {
    expect(validate(converted, value).ok).toBe(compileJsonSchema(source).validate(value).ok);
  }
  expect(toJsonSchema(converted)).toEqual(source);
});

it("preserves conjunctive reference sibling constraints", () => {
  const source = { $defs: { text: { type: "string" as const, minLength: 5 } }, $ref: "#/$defs/text", minLength: 2 };
  const converted = convertJsonSchema(source);
  expect(validate(converted, "abc").ok).toBe(false);
  expect(validate(converted, "abcde").ok).toBe(true);
  expect(toJsonSchema(converted)).toEqual(source);
});

it("preserves object allOf semantics and a CLI object projection", () => {
  const source = { type: "object" as const, allOf: [
    { type: "object" as const, properties: { a: { type: "string" as const } }, required: ["a"] },
    { type: "object" as const, properties: { b: { type: "number" as const } }, required: ["b"] }
  ] };
  const converted = convertJsonSchema(source);
  expect(converted.kind).toBe("object");
  expect(validate(converted, { a: "yes" }).ok).toBe(false);
  expect(validate(converted, { a: "yes", b: 1 }).ok).toBe(true);
  expect(toJsonSchema(converted)).toEqual(source);
  expect(compileJsonSchema(toJsonSchema(converted)).validate({ a: "yes", b: 1 }).ok).toBe(true);
});

it("retains recursive object fields and native constraints", () => {
  const source = { type: "object" as const, properties: { value: { type: "string" as const }, next: { $ref: "#" } }, required: ["value"] };
  const converted = convertJsonSchema(source);
  expect(converted.kind).toBe("object");
  expect(validate(converted, { value: "yes", next: { value: 2 } }).ok).toBe(false);
  expect(validate(converted, { value: "yes", next: { value: "also" } }).ok).toBe(true);
  expect(toJsonSchema(converted)).toEqual(source);
});
