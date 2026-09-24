import { describe, expect, it } from "vitest";
import { S, Json, OneOf, Record, Union, compileJsonSchema, toJsonSchema, validate, withJsonSchema, withStandardSchema } from "./index.js";

describe("standard schema interoperability", () => {
  it("exposes validation and JSON Schema on every public builder", async () => {
    const cases = [
      [S.String(), "hello"], [S.Number(), 2], [S.Boolean(), true],
      [S.Enum(["a", "b"]), "a"], [S.Array(S.Number()), [1]],
      [S.Object({ name: S.String() }), { name: "Ada" }],
      [S.Optional(S.String()), undefined], [Record(S.Number()), { a: 1 }],
      [Json(), { anything: [null] }],
      [OneOf({ discriminator: "kind", branches: { a: S.Object({ a: S.String() }) } }), { kind: "a", a: "x" }],
      [Union([S.Object({ a: S.String() }), S.Object({ b: S.Number() })]), { b: 2 }]
    ] as const;
    for (const [schema, value] of cases) {
      const standard = schema["~standard"];
      expect(standard.version).toBe(1);
      expect(standard.vendor).toBe("toolcraft-schema");
      expect(await standard.validate(value)).toEqual({ value });
      if (value !== undefined) {
        const document = standard.jsonSchema.input({ target: "draft-2020-12" });
        expect(compileJsonSchema(document).validate(value).ok).toBe(true);
      }
    }
  });

  it("returns standard issues and independent parsed defaults", async () => {
    const schema = S.Object({ items: S.Optional(S.Array(S.String(), { default: [] })) });
    const input = {};
    const first = await schema["~standard"].validate(input);
    const second = await schema["~standard"].validate(input);
    expect(first).toEqual({ value: { items: [] } });
    expect(second).toEqual(first);
    expect(first.value).not.toBe(second.value);
    expect(input).toEqual({});
    const invalid = await schema["~standard"].validate({ items: [false] });
    expect(invalid.issues).toEqual([expect.objectContaining({ path: ["items", "0"], message: expect.any(String) })]);
    expect(invalid).not.toHaveProperty("ok");
  });

  it("distinguishes accepted input from default-populated output recursively", () => {
    const schema = S.Object({
      count: S.Optional(S.Number({ default: 10 })),
      note: S.Optional(S.String()),
      children: S.Array(S.Object({ enabled: S.Optional(S.Boolean({ default: true })) }))
    });
    const input = schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    const output = schema["~standard"].jsonSchema.output({ target: "draft-2020-12" });
    expect(input.required).toEqual(["children"]);
    expect(output.required).toEqual(["count", "children"]);
    expect(compileJsonSchema(input).validate({ children: [{}] }).ok).toBe(true);
    expect(compileJsonSchema(output).validate({ count: 10, children: [{}] }).ok).toBe(false);
    expect(compileJsonSchema(output).validate({ count: 10, children: [{ enabled: true }] }).ok).toBe(true);
    expect(toJsonSchema(schema).required).toEqual(["children"]);
  });

  it("keeps descriptors serializable and native schemas authoritative", async () => {
    const schema = S.Object({ count: S.Number() });
    expect(structuredClone(schema)).toEqual({ kind: "object", shape: { count: { kind: "number" } } });
    expect(JSON.parse(JSON.stringify(schema))).toEqual(structuredClone(schema));
    expect(validate({ ...schema }, { count: 1 }).ok).toBe(true);
    const native = withJsonSchema(schema, { type: "object", properties: { count: { const: 2 } }, required: ["count"] });
    expect((await native["~standard"].validate({ count: 1 })).issues).toBeDefined();
    expect(native["~standard"].jsonSchema.input({ target: "draft-2020-12" })).toMatchObject({ properties: { count: { const: 2 } } });
    const copied = withStandardSchema(structuredClone(schema));
    expect(await copied["~standard"].validate({ count: 3 })).toEqual({ value: { count: 3 } });
    const projected = withJsonSchema(S.Object({ count: S.Optional(S.Number({ default: 1 })) }), { type: "object" });
    expect(await projected["~standard"].validate({})).toEqual({ value: {} });
    expect(projected["~standard"].jsonSchema.output({ target: "draft-2020-12" })).not.toHaveProperty("required");
  });

  it("rejects unsupported JSON Schema targets and isolates returned documents", () => {
    const schema = S.Object({ count: S.Optional(S.Number({ default: 10 })) });
    expect(() => schema["~standard"].jsonSchema.input({ target: "openapi-3.0" })).toThrow("Unsupported JSON Schema target");
    const first = schema["~standard"].jsonSchema.input({ target: "draft-07" });
    first.properties = {};
    expect(schema["~standard"].jsonSchema.input({ target: "draft-07" }).properties).toHaveProperty("count");
  });

  it("never relabels native dialects and silently drops their constraints", () => {
    const tuple = withJsonSchema(S.Json(), { type: "array", prefixItems: [{ type: "string" }] });
    const nested = S.Object({ tuple });
    expect(() => tuple["~standard"].jsonSchema.input({ target: "draft-07" })).toThrow("dialect");
    expect(() => nested["~standard"].jsonSchema.output({ target: "draft-07" })).toThrow("dialect");
    expect(tuple["~standard"].jsonSchema.input({ target: "draft-2020-12" })).toMatchObject({ prefixItems: [{ type: "string" }] });
  });

  it("describes union outputs when defaults make their branches overlap", async () => {
    const schema = Union([
      S.Object({ a: S.Number(), b: S.Optional(S.Number({ default: 2 })) }),
      S.Object({ b: S.Number(), a: S.Optional(S.Number({ default: 1 })) })
    ]);
    const parsed = await schema["~standard"].validate({ a: 1 });
    expect(parsed).toEqual({ value: { a: 1, b: 2 } });
    const output = schema["~standard"].jsonSchema.output({ target: "draft-2020-12" });
    expect(compileJsonSchema(output).validate(parsed.value).ok).toBe(true);
  });
});
