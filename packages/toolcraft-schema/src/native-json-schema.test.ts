import { expect, it } from "vitest";
import { S, toJsonSchema, validate, withJsonSchema } from "./index.js";

const intersection = {
  type: "object", allOf: [
    { properties: { a: { type: "string" } }, required: ["a"] },
    { properties: { b: { type: "number" } }, required: ["b"] }
  ]
};

it("validates the native intersection rather than the CLI projection", () => {
  const schema = withJsonSchema(S.Object({ a: S.String() }), intersection);
  expect(validate(schema, { a: "yes" }).ok).toBe(false);
  expect(validate(schema, { a: "yes", b: 1 }).ok).toBe(true);
  expect(toJsonSchema(schema)).toEqual(intersection);
});

it("retains recursive native object constraints", () => {
  const document = { type: "object", properties: { value: { type: "string" }, next: { $ref: "#" } }, required: ["value"] };
  const schema = withJsonSchema(S.Object({ value: S.String() }), document);
  expect(validate(schema, { value: "yes", next: { value: "also" } }).ok).toBe(true);
  expect(validate(schema, { value: "yes", next: { value: 2 } }).ok).toBe(false);
  expect(toJsonSchema(schema)).toEqual(document);
});

it("isolates the contract from caller and exported document mutations", () => {
  const document = { type: "string", minLength: 2 };
  const projection = S.String();
  const schema = withJsonSchema(projection, document);
  document.minLength = 0;
  toJsonSchema(schema).minLength = 0;
  expect(validate(schema, "a").ok).toBe(false);
  expect(validate(projection, "a").ok).toBe(true);
});

it("prefixes native validation issues inside containing schemas", () => {
  const child = withJsonSchema(S.Json(), { type: "object", properties: { count: { type: "integer" } }, required: ["count"] });
  const result = validate(S.Object({ child }), { child: { count: "wrong" } });
  expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({ path: ["child", "count"] })] });
});

it("rejects opaque values before running native JSON Schema validation", () => {
  const schema = withJsonSchema(S.Json(), {});
  expect(validate(schema, new Date()).ok).toBe(false);
});
